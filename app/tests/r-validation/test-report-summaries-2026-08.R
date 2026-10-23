# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-report-summaries-2026-08.R — validation for r-scripts/report-summaries.R
# (Reports > Report Summaries in Rows, SPSS REPORT with /SUMMARY lines).
#
# What makes this procedure different from OLAP Cubes / Case Summaries is the
# layout: data variables are COLUMNS and summary statistics are ROWS, repeated
# inside every break group. Most of these cases therefore assert the SHAPE of
# the table (which row holds which statistic, where break labels print, how the
# case listing interleaves) as much as the arithmetic — a report that computes
# a correct mean and puts it in the wrong row is still broken.
#
# Run via run-all.R (sets options(sai.rScriptsDir)).

# run-all.R sources _harness.R before this file and runs from the repo root,
# where this relative path would not resolve — the guard keeps that working
# while still allowing the file to be run on its own from this directory.
.standalone <- !exists("test_that")
if (.standalone) source("_harness.R")

# ── Fixture ─────────────────────────────────────────────────────────────────
# Two break variables (nested: gender → jobcat), two data variables, with NAs
# placed deliberately: one missing salary (dropped from salary statistics only)
# and one missing gender (dropped from the whole report, SPSS-style).
mk_df <- function() {
  data.frame(
    salary = c(100, 200, 300, NA, 500, 600, 700, 800, 900, 1000, 1100, 1200),
    age    = c(25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80),
    gender = c("M", "M", "M", "M", "F", "F", "F", "F", NA, "M", "F", "M"),
    jobcat = c("a", "a", "b", "b", "a", "a", "b", "b", "a", "b", "b", "a"),
    stringsAsFactors = FALSE
  )
}

# `==` yields NA for the NA-gender case and NA-indexing splices phantom
# elements into the result — %in% keeps these masks strictly logical.
f_rows <- function(df) df$gender %in% "F"
m_rows <- function(df) df$gender %in% "M"

base_params <- function() {
  list(
    variables = c("salary", "age"),
    varNames = list(salary = "Salary", age = "Age"),
    breakVars = c("gender"),
    breakVarNames = list(gender = "Gender", jobcat = "Jobcat")
  )
}

N_MEAN <- list(n = TRUE, mean = TRUE)

# ── 1. Layout: statistics are rows, data variables are columns ──────────────
test_that("report: summary lines are rows and data variables are columns", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(), list(options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # Columns: Gender, Statistic, Salary, Age.
  expect_equal(length(t$columns), 1 + 1 + 2)
  expect_equal(t$columns[[1]], "Gender")
  expect_equal(t$columns[[2]], "output.col.statistic")
  expect_equal(t$columns[[3]], "Salary")
  expect_equal(t$columns[[4]], "Age")

  # 2 break groups × 2 statistics + 2 grand-total statistics = 6 rows.
  expect_equal(length(t$rows), 6)

  # The statistic's NAME lives in the Statistic column — this is the whole
  # point of "summaries in rows" and the thing that would silently regress if
  # someone refactored this toward the OLAP/Case Summaries layout.
  expect_true(identical(t$rows[[1]][[2]], "output.col.n"))
  expect_true(identical(t$rows[[2]][[2]], "output.col.mean"))
  expect_true(identical(t$rows[[3]][[2]], "output.col.n"))
  expect_true(identical(t$rows[[4]][[2]], "output.col.mean"))

  # Break label prints on the block's first row only.
  expect_true(identical(t$rows[[1]][[1]], "F"))
  expect_true(identical(t$rows[[2]][[1]], ""))
  expect_true(identical(t$rows[[3]][[1]], "M"))
  expect_true(identical(t$rows[[4]][[1]], ""))
})

# ── 2. The numbers themselves ───────────────────────────────────────────────
test_that("report: each cell is its column variable's statistic for that group", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(), list(options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  f_sal <- df$salary[f_rows(df) & !is.na(df$salary)]   # 500 600 700 800 1100
  m_sal <- df$salary[m_rows(df) & !is.na(df$salary)]   # 100 200 300 1000 1200
  f_age <- df$age[f_rows(df)]
  m_age <- df$age[m_rows(df)]

  # Row 1 = F/N, row 2 = F/Mean; columns 3 = Salary, 4 = Age.
  expect_equal(cell_num(t, 1, 3), length(f_sal))
  expect_equal(cell_num(t, 1, 4), length(f_age))
  expect_equal(cell_num(t, 2, 3), mean(f_sal))
  expect_equal(cell_num(t, 2, 4), mean(f_age))
  expect_equal(cell_num(t, 3, 3), length(m_sal))
  expect_equal(cell_num(t, 4, 3), mean(m_sal))
  expect_equal(cell_num(t, 4, 4), mean(m_age))

  # Salary and Age have DIFFERENT Ns in the same group (one NA salary sits in
  # an M row), so a script that computed one N for the whole row would pass
  # every other assertion here and fail this one.
  expect_equal(cell_num(t, 3, 3), 5)
  expect_equal(cell_num(t, 3, 4), 6)
})

# ── 3. Report-level summary (grand total) ───────────────────────────────────
test_that("report: the grand-total block covers every retained case", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(), list(options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # Rows 5-6 are the report-level block, labelled Total on its first row.
  expect_true(identical(t$rows[[5]][[1]], "output.col.total"))
  expect_true(identical(t$rows[[5]][[2]], "output.col.n"))
  expect_true(identical(t$rows[[6]][[1]], ""))
  expect_true(identical(t$rows[[6]][[2]], "output.col.mean"))

  # The NA-gender case is excluded from the report entirely, so the total is
  # NOT the whole file — that distinction is the reason this is asserted here.
  kept <- !is.na(df$gender)
  all_sal <- df$salary[kept & !is.na(df$salary)]
  expect_equal(cell_num(t, 5, 3), length(all_sal))
  expect_equal(cell_num(t, 5, 3), 10)                # not 11
  expect_equal(cell_num(t, 6, 3), mean(all_sal))
  expect_equal(cell_num(t, 5, 4), sum(kept))         # Age N = 11 retained cases
})

test_that("report: grandTotal=FALSE drops the block", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE, options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")
  expect_equal(length(t$rows), 4)
  expect_true(!identical(t$rows[[4]][[1]], "output.col.total"))
})

# ── 4. Nested break variables ───────────────────────────────────────────────
test_that("report: nested breaks label each block and restart on a parent change", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary"),
    varNames = list(salary = "Salary"),
    breakVars = c("gender", "jobcat"),
    breakVarNames = list(gender = "Gender", jobcat = "Jobcat"),
    grandTotal = FALSE,
    options = list(stats = list(mean = TRUE))
  ))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # Valid combos (NA-gender dropped): F×a, F×b, M×a, M×b → one Mean row each.
  expect_equal(length(t$rows), 4)
  expect_equal(length(t$columns), 2 + 1 + 1)

  expect_true(identical(t$rows[[1]][[1]], "F")); expect_true(identical(t$rows[[1]][[2]], "a"))
  expect_true(identical(t$rows[[2]][[1]], "")); expect_true(identical(t$rows[[2]][[2]], "b"))
  expect_true(identical(t$rows[[3]][[1]], "M")); expect_true(identical(t$rows[[3]][[2]], "a"))
  expect_true(identical(t$rows[[4]][[1]], "")); expect_true(identical(t$rows[[4]][[2]], "b"))

  fa <- df$salary[f_rows(df) & df$jobcat %in% "a"]                    # 500 600
  mb <- df$salary[m_rows(df) & df$jobcat %in% "b" & !is.na(df$salary)]  # 300 1000
  expect_equal(cell_num(t, 1, 4), mean(fa))
  expect_equal(cell_num(t, 4, 4), mean(mb))
})

# ── 4b. The inner label must restart when only the OUTER level changes ──────
# This needs its own fixture. In mk_df() every gender has both jobcats, so the
# blocks run F/a, F/b, M/a, M/b and the inner value always differs from the
# previous row's — which means the naive "blank it if it repeats the previous
# row" rule passes test 4 while still being wrong. Verified: sabotaging the
# script to that naive rule leaves test 4 green and fails only this one.
#
# Here F has jobcat "b" only, so the F/b block is immediately followed by M/b:
# the inner value repeats across a parent change and must still be printed.
test_that("report: inner break label reprints when the outer level changes", {
  df <- data.frame(
    salary = c(10, 20, 30, 40, 50, 60),
    gender = c("F", "F", "M", "M", "M", "M"),
    jobcat = c("b", "b", "b", "b", "c", "c"),
    stringsAsFactors = FALSE
  )
  fx <- write_fixture(df, list(
    variables = c("salary"),
    varNames = list(salary = "Salary"),
    breakVars = c("gender", "jobcat"),
    breakVarNames = list(gender = "Gender", jobcat = "Jobcat"),
    grandTotal = FALSE,
    options = list(stats = list(mean = TRUE))
  ))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # Blocks: F/b, M/b, M/c.
  expect_equal(length(t$rows), 3)
  expect_true(identical(t$rows[[1]][[1]], "F")); expect_true(identical(t$rows[[1]][[2]], "b"))
  # The assertion that matters: gender changed to M, so jobcat "b" restarts and
  # must be reprinted even though the previous row's jobcat was also "b".
  expect_true(identical(t$rows[[2]][[1]], "M")); expect_true(identical(t$rows[[2]][[2]], "b"))
  expect_true(identical(t$rows[[3]][[1]], "")); expect_true(identical(t$rows[[3]][[2]], "c"))

  expect_equal(cell_num(t, 1, 4), mean(c(10, 20)))
  expect_equal(cell_num(t, 2, 4), mean(c(30, 40)))
  expect_equal(cell_num(t, 3, 4), mean(c(50, 60)))
})

# ── 5. Case listing ─────────────────────────────────────────────────────────
test_that("report: displayCases interleaves case rows above each block's summary", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(displayCases = TRUE, grandTotal = FALSE,
                                 options = list(stats = list(n = TRUE)))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # 5 F cases + 1 summary + 6 M cases + 1 summary = 13 rows.
  expect_equal(length(t$rows), 13)

  # Case numbers restart at 1 in each block, the way SPSS numbers report lines.
  expect_equal(cell_num(t, 1, 2), 1)
  expect_equal(cell_num(t, 5, 2), 5)
  expect_true(identical(t$rows[[6]][[2]], "output.col.n"))   # F summary
  expect_equal(cell_num(t, 7, 2), 1)                          # M block restarts
  expect_true(identical(t$rows[[13]][[2]], "output.col.n"))  # M summary

  # A listing row carries the case's own values, not a statistic.
  f_sal_sorted <- df$salary[f_rows(df)]
  expect_equal(cell_num(t, 1, 3), f_sal_sorted[1])
  expect_equal(cell_num(t, 6, 3), length(f_sal_sorted))      # F Salary N
})

test_that("report: limitCases bounds the listing across the report, not per group", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(displayCases = TRUE, grandTotal = FALSE, limitCases = 7,
                                 options = list(stats = list(n = TRUE)))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # 7 listed lines in TOTAL (5 in F, then only 2 of M's 6) + 2 summary rows.
  # A per-group budget would have listed 7 in each block and produced 16 rows.
  expect_equal(length(t$rows), 9)
  expect_equal(cell_num(t, 7, 2), 1)   # M block's first listed case
  expect_equal(cell_num(t, 8, 2), 2)   # ...and its last

  # The summary lines still see EVERY case, not just the listed ones — the
  # documented difference from Case Summaries, where SPSS restricts the whole
  # procedure. M Salary N stays 5 even though only 2 M cases were printed.
  expect_equal(cell_num(t, 9, 3), 5)

  # And the truncation is declared rather than left to look like the full file.
  expect_true(length(result$notes) > 0)
  expect_true(grepl("^output.reportSummaries.limitNote:7|11$", result$notes[[1]]))
})

# ── 6. No break variables ───────────────────────────────────────────────────
test_that("report: without breaks it is a single summary block", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary"),
    varNames = list(salary = "Salary"),
    options = list(stats = N_MEAN)
  ))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  expect_equal(length(t$columns), 2)     # Statistic, Salary — no break column
  # No grand-total block appended: with no breaks the single block already IS
  # the whole report, so repeating it under a "Total" heading is noise.
  expect_equal(length(t$rows), 2)

  all_sal <- df$salary[!is.na(df$salary)]   # the NA-gender case IS kept here
  expect_equal(cell_num(t, 1, 2), length(all_sal))
  expect_equal(cell_num(t, 1, 2), 11)
  expect_equal(cell_num(t, 2, 2), mean(all_sal))
})

# ── 7. Statistics selection ─────────────────────────────────────────────────
test_that("report: every offered statistic computes correctly, in SPSS's order", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("age"),
    varNames = list(age = "Age"),
    options = list(stats = list(n = TRUE, mean = TRUE, median = TRUE, seMean = TRUE,
                                sum = TRUE, min = TRUE, max = TRUE, range = TRUE,
                                first = TRUE, last = TRUE, sd = TRUE, variance = TRUE,
                                kurtosis = TRUE, seKurtosis = TRUE,
                                skewness = TRUE, seSkewness = TRUE))
  ))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  x <- df$age
  n <- length(x)
  # Row order comes from the shared registry (_bootstrap.R
  # sai_summary_stat_defs), which is SPSS's own print order — not the order the
  # checkboxes happen to be listed in above.
  expect_equal(length(t$rows), 16)
  expect_equal(cell_num(t, 1, 2), n)                       # N
  expect_equal(cell_num(t, 2, 2), mean(x))                 # Mean
  expect_equal(cell_num(t, 3, 2), median(x))               # Median
  expect_equal(cell_num(t, 4, 2), sd(x) / sqrt(n))         # Std. Error of Mean
  expect_equal(cell_num(t, 5, 2), sum(x))                  # Sum
  expect_equal(cell_num(t, 6, 2), min(x))                  # Minimum
  expect_equal(cell_num(t, 7, 2), max(x))                  # Maximum
  expect_equal(cell_num(t, 8, 2), diff(range(x)))          # Range
  expect_equal(cell_num(t, 9, 2), x[1])                    # First (file order)
  expect_equal(cell_num(t, 10, 2), x[n])                   # Last
  expect_equal(cell_num(t, 11, 2), sd(x))                  # Std. Deviation
  expect_equal(cell_num(t, 12, 2), var(x))                 # Variance

  # Skewness/kurtosis use SPSS's adjusted Fisher-Pearson forms, cross-checked
  # here against an inline reference rather than the shared helper they call.
  g1 <- n / ((n - 1) * (n - 2)) * sum(((x - mean(x)) / sd(x))^3)
  g2 <- n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * sum(((x - mean(x)) / sd(x))^4) -
    3 * (n - 1)^2 / ((n - 2) * (n - 3))
  ses <- sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
  expect_equal(cell_num(t, 13, 2), g2)                                        # Kurtosis
  expect_equal(cell_num(t, 14, 2), 2 * ses * sqrt((n^2 - 1) / ((n - 3) * (n + 5))))
  expect_equal(cell_num(t, 15, 2), g1)                                        # Skewness
  expect_equal(cell_num(t, 16, 2), ses)                                       # SE Skewness
})

test_that("report: an empty statistics selection falls back to N", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("age"), varNames = list(age = "Age"),
    options = list(stats = list(n = FALSE, mean = FALSE))
  ))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")
  expect_equal(length(t$rows), 1)
  expect_true(identical(t$rows[[1]][[1]], "output.col.n"))
  expect_equal(cell_num(t, 1, 2), nrow(df))
})

# ── 8. Missing values ───────────────────────────────────────────────────────
test_that("report: listwise drops cases missing on any data or break variable", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE,
                                 options = list(missing = "listwise", stats = list(n = TRUE)))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  # Listwise removes the NA-salary case AND the NA-gender case, leaving 5 F and
  # 5 M. Under the default "analysis" strategy Age's M count was 6 (test 2).
  expect_equal(cell_num(t, 1, 3), 5)
  expect_equal(cell_num(t, 1, 4), 5)
  expect_equal(cell_num(t, 2, 3), 5)
  expect_equal(cell_num(t, 2, 4), 5)
})

test_that("report: user-defined missing values are honoured in analysis mode too", {
  # M1: apply_listwise() only consults user-missing when it is actually
  # filtering, so the default strategy needs its own apply_user_missing() pass.
  # Without it a -99 placeholder would be averaged in as a real salary.
  df <- mk_df()
  df$salary[df$gender %in% "F"][1] <- -99
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE,
                                 missingValues = list(salary = list(type = "discrete",
                                                                    discrete = list(-99))),
                                 options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")

  f_sal <- df$salary[f_rows(df)]
  f_valid <- f_sal[f_sal != -99]
  expect_equal(cell_num(t, 1, 3), length(f_valid))
  expect_equal(cell_num(t, 2, 3), mean(f_valid))
  # The proof it was excluded rather than merely rounded away: including -99
  # would drag the mean far below every real salary in the group.
  expect_true(cell_num(t, 2, 3) > min(f_valid))
})

# ── 9. Value labels ─────────────────────────────────────────────────────────
test_that("report: break categories print their value labels", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE,
                                 breakValueLabels = list(gender = list(F = "Female", M = "Male")),
                                 options = list(stats = list(n = TRUE)))))
  result <- run_analysis_script("report-summaries.R", fx)
  t <- find_table(result, "output.reportSummaries.title")
  expect_true(identical(t$rows[[1]][[1]], "Female"))
  expect_true(identical(t$rows[[2]][[1]], "Male"))
})

# Only when run on its own. Under run-all.R the suite reports once at the
# end — and report() quits the process if anything has failed, so calling it
# here truncated the whole run at the first earlier failure.
if (.standalone) report()
