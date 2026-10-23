# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-report-columns-2026-08.R — validation for r-scripts/report-summaries-columns.R
# (Reports > Report Summaries in Columns, SPSS REPORT with the summary
# functions in columns).
#
# Two things this file is really about:
#
#  1. The layout. Each break group is ONE row and the statistics run across as
#     (variable × statistic) columns — the mirror of report-summaries.R. Most
#     assertions therefore pin the shape, since a report that computes a
#     correct mean and puts it under the wrong header is still broken.
#
#  2. That the three Reports procedures genuinely share one statistic
#     registry (_bootstrap.R sai_summary_stat_defs). The last block runs the
#     same data through this script and through report-summaries.R and
#     requires the numbers to agree — the cheapest possible guard against the
#     shared definitions being forked back into per-script copies.
#
# Run via run-all.R (sets options(sai.rScriptsDir)).

.standalone <- !exists("test_that")
if (.standalone) source("_harness.R")

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

# ── 1. Layout ───────────────────────────────────────────────────────────────
test_that("report columns: one row per group, statistics across as columns", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(), list(options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")

  # Gender + (Salary × {N, Mean}) + (Age × {N, Mean}) = 5 columns.
  expect_equal(length(t$columns), 1 + 4)
  expect_equal(t$columns[[1]], "Gender")
  # Headers pair the variable name with the statistic's key; the renderer
  # translates the second half (see translateOutputKey's nested-key handling).
  expect_equal(t$columns[[2]], "output.reportColumns.varStat:Salary|output.col.n")
  expect_equal(t$columns[[3]], "output.reportColumns.varStat:Salary|output.col.mean")
  expect_equal(t$columns[[4]], "output.reportColumns.varStat:Age|output.col.n")
  expect_equal(t$columns[[5]], "output.reportColumns.varStat:Age|output.col.mean")

  # 2 groups + the report-level row. This is the shape that distinguishes the
  # procedure: in the rows report the same run takes 6 rows.
  expect_equal(length(t$rows), 3)
  expect_true(identical(t$rows[[1]][[1]], "F"))
  expect_true(identical(t$rows[[2]][[1]], "M"))
  expect_true(identical(t$rows[[3]][[1]], "output.col.total"))
})

# ── 2. The numbers ──────────────────────────────────────────────────────────
test_that("report columns: each cell is its header's variable and statistic", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(), list(options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")

  f_sal <- df$salary[f_rows(df) & !is.na(df$salary)]
  m_sal <- df$salary[m_rows(df) & !is.na(df$salary)]

  expect_equal(cell_num(t, 1, 2), length(f_sal))   # F Salary N
  expect_equal(cell_num(t, 1, 3), mean(f_sal))     # F Salary Mean
  expect_equal(cell_num(t, 1, 4), sum(f_rows(df))) # F Age N
  expect_equal(cell_num(t, 1, 5), mean(df$age[f_rows(df)]))
  expect_equal(cell_num(t, 2, 3), mean(m_sal))     # M Salary Mean

  # Salary and Age have different Ns in the M group (one NA salary), so a
  # script that reused one variable's values across the row would fail here.
  expect_equal(cell_num(t, 2, 2), 5)
  expect_equal(cell_num(t, 2, 4), 6)

  # The report-level row excludes the NA-gender case, like every other block.
  kept <- !is.na(df$gender)
  expect_equal(cell_num(t, 3, 2), sum(kept & !is.na(df$salary)))
  expect_equal(cell_num(t, 3, 2), 10)
  expect_equal(cell_num(t, 3, 3), mean(df$salary[kept & !is.na(df$salary)]))
})

test_that("report columns: grandTotal=FALSE drops the report-level row", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE, options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")
  expect_equal(length(t$rows), 2)
})

# ── 3. Nested breaks ────────────────────────────────────────────────────────
test_that("report columns: inner break label reprints when the outer changes", {
  # Same trap as the rows report: F has only jobcat "b", so the F/b block is
  # followed by M/b and the repeated inner value must still be printed.
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
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")

  expect_equal(length(t$rows), 3)
  expect_true(identical(t$rows[[1]][[1]], "F")); expect_true(identical(t$rows[[1]][[2]], "b"))
  expect_true(identical(t$rows[[2]][[1]], "M")); expect_true(identical(t$rows[[2]][[2]], "b"))
  expect_true(identical(t$rows[[3]][[1]], "")); expect_true(identical(t$rows[[3]][[2]], "c"))

  expect_equal(cell_num(t, 1, 3), mean(c(10, 20)))
  expect_equal(cell_num(t, 2, 3), mean(c(30, 40)))
  expect_equal(cell_num(t, 3, 3), mean(c(50, 60)))
})

test_that("report columns: without breaks it is a single report row", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary"),
    varNames = list(salary = "Salary"),
    options = list(stats = N_MEAN)
  ))
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")
  expect_equal(length(t$columns), 2)   # no break column
  expect_equal(length(t$rows), 1)      # and no duplicate "Total" row
  all_sal <- df$salary[!is.na(df$salary)]
  expect_equal(cell_num(t, 1, 1), length(all_sal))
  expect_equal(cell_num(t, 1, 2), mean(all_sal))
})

# ── 4. Value labels and missing values ──────────────────────────────────────
test_that("report columns: break categories print their value labels", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE,
                                 breakValueLabels = list(gender = list(F = "Female", M = "Male")),
                                 options = list(stats = list(n = TRUE)))))
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")
  expect_true(identical(t$rows[[1]][[1]], "Female"))
  expect_true(identical(t$rows[[2]][[1]], "Male"))
})

test_that("report columns: user-defined missing values are honoured", {
  df <- mk_df()
  df$salary[f_rows(df)][1] <- -99
  fx <- write_fixture(df, c(base_params(),
                            list(grandTotal = FALSE,
                                 missingValues = list(salary = list(type = "discrete",
                                                                    discrete = list(-99))),
                                 options = list(stats = N_MEAN))))
  result <- run_analysis_script("report-summaries-columns.R", fx)
  t <- find_table(result, "output.reportColumns.title")

  f_sal <- df$salary[f_rows(df)]
  f_valid <- f_sal[f_sal != -99]
  expect_equal(cell_num(t, 1, 2), length(f_valid))
  expect_equal(cell_num(t, 1, 3), mean(f_valid))
  # Proof it was excluded rather than merely rounded away.
  expect_true(cell_num(t, 1, 3) > min(f_valid))
})

# ── 5. The shared registry ──────────────────────────────────────────────────
test_that("report columns and report rows agree, because they share one registry", {
  df <- mk_df()
  stats <- list(n = TRUE, mean = TRUE, median = TRUE, sd = TRUE, min = TRUE,
                max = TRUE, sum = TRUE, skewness = TRUE, kurtosis = TRUE)
  p <- c(base_params(), list(grandTotal = FALSE, options = list(stats = stats)))

  cols <- find_table(run_analysis_script("report-summaries-columns.R", write_fixture(df, p)),
                     "output.reportColumns.title")
  rows <- find_table(run_analysis_script("report-summaries.R", write_fixture(df, p)),
                     "output.reportSummaries.title")

  # 9 statistics × 2 variables in columns; 9 statistic rows × 2 groups in rows.
  n_stats <- 9
  expect_equal(length(cols$columns), 1 + n_stats * 2)
  expect_equal(length(rows$rows), n_stats * 2)

  # Group F: the columns report's row 1 holds, for each variable in turn, the
  # same values the rows report puts down its first block.
  for (si in seq_len(n_stats)) {
    for (vi in seq_len(2)) {
      col_cell <- cols$rows[[1]][[1 + (vi - 1) * n_stats + si]]
      row_cell <- rows$rows[[si]][[2 + vi]]
      expect_true(identical(is.null(col_cell), is.null(row_cell)),
                  sprintf("stat %d var %d: one report produced a value, the other did not", si, vi))
      if (!is.null(col_cell)) {
        expect_equal(as.numeric(col_cell), as.numeric(row_cell),
                     label = sprintf("stat %d, variable %d", si, vi))
      }
    }
  }
})

if (.standalone) report()
