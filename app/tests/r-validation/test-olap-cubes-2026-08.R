# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-olap-cubes-2026-08.R — validation for r-scripts/olap-cubes.R
# (Reports > OLAP Cubes, SPSS OLAP): nested grouping, the shared Reports cell
# menu (_bootstrap.R sai_summary_stat_defs) plus OLAP's four percentage cells,
# the Case Processing Summary, missing-value handling, SPSS defaults.
#
# Run via run-all.R (sets options(sai.rScriptsDir)).

# run-all.R sources _harness.R before this file and runs from the repo root,
# where this relative path would not resolve — the guard keeps that working
# while still allowing the file to be run on its own from this directory.
.standalone <- !exists("test_that")
if (.standalone) source("_harness.R")

# ── Fixture ─────────────────────────────────────────────────────────────────
# Two grouping variables (nested: gender → jobcat), two summary variables,
# with NAs sprinkled in: one missing salary, one missing gender (that case must
# be excluded from the grouped table entirely, SPSS-style).
mk_df <- function() {
  data.frame(
    salary = c(100, 200, 300, NA, 500, 600, 700, 800, 900, 1000, 1100, 1200),
    age    = c(25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80),
    gender = c("M", "M", "M", "M", "F", "F", "F", "F", NA, "M", "F", "M"),
    jobcat = c("a", "a", "b", "b", "a", "a", "b", "b", "a", "b", "b", "a"),
    stringsAsFactors = FALSE
  )
}

base_params <- function(df) {
  list(
    variables = c("salary"),
    varNames = list(salary = "Salary", age = "Age"),
    groupVars = c("gender"),
    groupVarNames = list(gender = "Gender", jobcat = "Jobcat")
  )
}

ALL_STATS <- list(n = TRUE, mean = TRUE, sd = TRUE, sum = TRUE, median = TRUE,
                  min = TRUE, max = TRUE, pctTotalN = TRUE, pctTotalSum = TRUE)

# Cell columns come out in the shared registry's (SPSS's) order, not in the
# order the flags were written: N, Mean, Median, Sum, Min, Max, Std. Deviation,
# then the percentages. Named here so the index arithmetic below stays readable.
C_N <- 3; C_MEAN <- 4; C_MEDIAN <- 5; C_SUM <- 6
C_MIN <- 7; C_MAX <- 8; C_SD <- 9; C_PCT_N <- 10; C_PCT_SUM <- 11

# ── 1. Single grouping variable, all statistics ─────────────────────────────
test_that("olap: single group — stats match direct R computation", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(df), list(options = list(stats = ALL_STATS))))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # Columns: Gender, Variable, then 9 stat columns.
  expect_equal(length(t$columns), 2 + 9)

  # 2 gender levels × 1 variable, plus the closing Total block (SPSS's Total
  # layer) = 3 rows. The NA-gender case is excluded from all of them.
  expect_equal(length(t$rows), 3)

  # Row 1 = F (sorted), row 2 = M. Labels only on each block's first row.
  expect_equal(t$rows[[1]][[1]], "F")
  expect_equal(t$rows[[2]][[1]], "M")

  # `==` yields NA for the NA-gender case and NA-indexing would splice a
  # phantom element into the vector — %in% keeps these masks strictly logical.
  f_sal <- df$salary[df$gender %in% "F" & !is.na(df$salary)]   # 500 600 700 800 1100
  m_sal <- df$salary[df$gender %in% "M" & !is.na(df$salary)]   # 100 200 300 1000 1200
  expect_equal(cell_num(t, 1, C_N), length(f_sal))
  expect_equal(cell_num(t, 1, C_MEAN), mean(f_sal))
  expect_equal(cell_num(t, 1, C_SD), sd(f_sal))
  expect_equal(cell_num(t, 1, C_SUM), sum(f_sal))
  expect_equal(cell_num(t, 1, C_MEDIAN), median(f_sal))
  expect_equal(cell_num(t, 1, C_MIN), min(f_sal))
  expect_equal(cell_num(t, 1, C_MAX), max(f_sal))

  # % of Total N / Sum: base is the whole table (NA-gender case excluded,
  # NA salary excluded for the salary variable).
  tot_n <- length(df$salary[!is.na(df$gender) & !is.na(df$salary)])
  tot_sum <- sum(df$salary[!is.na(df$gender)], na.rm = TRUE)
  expect_equal(cell_num(t, 1, C_PCT_N), 100 * length(f_sal) / tot_n, tolerance = 1e-4)
  expect_equal(cell_num(t, 1, C_PCT_SUM), 100 * sum(f_sal) / tot_sum, tolerance = 1e-4)
  expect_equal(cell_num(t, 2, C_PCT_N), 100 * length(m_sal) / tot_n, tolerance = 1e-4)
  expect_equal(cell_num(t, 2, C_PCT_SUM), 100 * sum(m_sal) / tot_sum, tolerance = 1e-4)
})

# ── 2. Nested grouping (two variables) ──────────────────────────────────────
test_that("olap: nested grouping — block labels and cell values", {
  df <- mk_df()
  fx <- write_fixture(df, c(
    list(
      variables = c("salary"),
      varNames = list(salary = "Salary"),
      groupVars = c("gender", "jobcat"),
      groupVarNames = list(gender = "Gender", jobcat = "Jobcat"),
      options = list(stats = list(n = TRUE, mean = TRUE))
    )
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # Valid combos (NA-gender case dropped): F×a, F×b, M×a, M×b, + Total → 5.
  expect_equal(length(t$rows), 5)
  expect_equal(length(t$columns), 2 + 1 + 2)   # Gender, Jobcat, Variable, N, Mean

  # Nesting labels: outer label printed only where its value changes.
  expect_equal(t$rows[[1]][[1]], "F"); expect_equal(t$rows[[1]][[2]], "a")
  expect_equal(t$rows[[2]][[1]], "");  expect_equal(t$rows[[2]][[2]], "b")
  expect_equal(t$rows[[3]][[1]], "M"); expect_equal(t$rows[[3]][[2]], "a")
  expect_equal(t$rows[[4]][[1]], "");  expect_equal(t$rows[[4]][[2]], "b")

  fa <- df$salary[df$gender %in% "F" & df$jobcat %in% "a"]   # 500 600
  mb <- df$salary[df$gender %in% "M" & df$jobcat %in% "b" & !is.na(df$salary)]  # 300 1000
  expect_equal(cell_num(t, 1, 4), length(fa))
  expect_equal(cell_num(t, 1, 5), mean(fa))
  expect_equal(cell_num(t, 4, 4), length(mb))
  expect_equal(cell_num(t, 4, 5), mean(mb))
})

# ── 2b. Nested labels restart when the parent level changes ─────────────────
# Regression: the inner label was blanked whenever its own value repeated the
# previous row's, even if the OUTER level had just changed — so the second
# gender's first block came out with an empty Jobcat cell.
test_that("olap: inner nesting label reprints after the outer level changes", {
  # F appears only with jobcat "b", so M's FIRST block is also "b" — the inner
  # value repeats exactly across the parent change, which is the only shape
  # that exposes the bug.
  df <- data.frame(
    x      = c(1, 2, 3, 4),
    gender = c("F", "F", "M", "M"),
    jobcat = c("b", "b", "b", "c"),
    stringsAsFactors = FALSE
  )
  fx <- write_fixture(df, list(
    variables = c("x"),
    varNames = list(x = "X"),
    groupVars = c("gender", "jobcat"),
    groupVarNames = list(gender = "Gender", jobcat = "Jobcat"),
    options = list(stats = list(mean = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # Blocks sort to F/b, M/b, M/c, plus the Total block.
  expect_equal(length(t$rows), 4)
  expect_equal(t$rows[[1]][[1]], "F"); expect_equal(t$rows[[1]][[2]], "b")
  expect_equal(t$rows[[2]][[1]], "M")
  expect_equal(t$rows[[2]][[2]], "b")         # outer changed → inner reprints
  expect_equal(t$rows[[3]][[1]], "")          # gender unchanged within M
  expect_equal(t$rows[[3]][[2]], "c")
})

# ── 3. Multiple summary variables ───────────────────────────────────────────
test_that("olap: multiple summary variables stack rows within a block", {
  df <- mk_df()
  fx <- write_fixture(df, c(
    list(
      variables = c("salary", "age"),
      varNames = list(salary = "Salary", age = "Age"),
      groupVars = c("gender"),
      groupVarNames = list(gender = "Gender"),
      options = list(stats = list(n = TRUE, mean = TRUE))
    )
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # 2 levels × 2 variables = 4 rows, plus 2 Total rows (one per variable);
  # the group label prints only on each block's first row.
  expect_equal(length(t$rows), 6)
  expect_equal(t$rows[[1]][[1]], "F"); expect_equal(t$rows[[1]][[2]], "Salary")
  expect_equal(t$rows[[2]][[1]], "");  expect_equal(t$rows[[2]][[2]], "Age")
  expect_equal(t$rows[[3]][[1]], "M")
  expect_equal(t$rows[[4]][[1]], "")

  f_age <- df$age[df$gender %in% "F"]
  expect_equal(cell_num(t, 2, 3), length(f_age))
  expect_equal(cell_num(t, 2, 4), mean(f_age))
})

# ── 4. No grouping variables ────────────────────────────────────────────────
test_that("olap: no grouping variable — overall statistics only", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary", "age"),
    varNames = list(salary = "Salary", age = "Age"),
    options = list(stats = list(n = TRUE, mean = TRUE, sum = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  expect_equal(length(t$columns), 1 + 3)   # Variable, N, Mean, Sum
  expect_equal(length(t$rows), 2)
  sal <- df$salary[!is.na(df$salary)]
  expect_equal(cell_num(t, 1, 2), length(sal))
  expect_equal(cell_num(t, 1, 3), mean(sal))
  expect_equal(cell_num(t, 1, 4), sum(sal))
})

# ── 5. SPSS default statistics when none are sent ───────────────────────────
test_that("olap: absent stats selection → SPSS defaults (N Mean SD Sum %N %Sum)", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary"),
    varNames = list(salary = "Salary"),
    groupVars = c("gender"),
    groupVarNames = list(gender = "Gender")
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  expect_equal(length(t$columns), 2 + 6)

  cols <- unlist(t$columns)
  expect_true("output.col.n" %in% cols)
  expect_true("output.col.mean" %in% cols)
  expect_true("output.col.sd" %in% cols)
  expect_true("output.col.sum" %in% cols)
  expect_true("output.col.pctTotalN" %in% cols)
  expect_true("output.col.pctTotalSum" %in% cols)
})

# ── 6. Listwise missing strategy ────────────────────────────────────────────
test_that("olap: listwise deletion drops incomplete cases before grouping", {
  df <- mk_df()
  fx <- write_fixture(df, c(
    list(
      variables = c("salary", "age"),
      varNames = list(salary = "Salary", age = "Age"),
      groupVars = c("gender"),
      groupVarNames = list(gender = "Gender"),
      options = list(missing = "listwise", stats = list(n = TRUE))
    )
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # Listwise: case 4 (NA salary) and case 9 (NA gender) dropped everywhere.
  # F keeps 500,600,700,800,1100 → 5; M keeps 100,200,300,1000,1200 → 5.
  expect_equal(cell_num(t, 1, 3), 5)
  expect_equal(cell_num(t, 3, 3), 5)
})

# ── 7. Value labels on grouping variables ───────────────────────────────────
test_that("olap: grouping value labels are resolved", {
  df <- data.frame(
    x = c(1, 2, 3, 4),
    grp = c(0, 0, 1, 1),
    stringsAsFactors = FALSE
  )
  fx <- write_fixture(df, list(
    variables = c("x"),
    varNames = list(x = "X"),
    groupVars = c("grp"),
    groupVarNames = list(grp = "Group"),
    groupValueLabels = list(grp = list(`0` = "Zero", `1` = "One")),
    options = list(stats = list(mean = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  expect_equal(t$rows[[1]][[1]], "Zero")
  expect_equal(t$rows[[2]][[1]], "One")
  expect_equal(cell_num(t, 1, 3), 1.5)
  expect_equal(cell_num(t, 2, 3), 3.5)
})

# ── 8. Error paths ──────────────────────────────────────────────────────────
test_that("olap: no variables → sai_error", {
  df <- mk_df()
  fx <- write_fixture(df, list(variables = list()))
  result <- run_analysis_script("olap-cubes.R", fx)
  expect_true(!isTRUE(result$success))
})

# ── Total layer ─────────────────────────────────────────────────────────────
# SPSS's OLAP Cubes is a layered table whose Total layer — every case,
# ungrouped — is the one it opens on. A manual comparison had SPSS reporting
# N=309 / Sum=47895 for a variable while we printed only the 237 and 72 of the
# two groups, with nothing tying them together.
test_that("olap: a Total block closes the cube and covers every case", {
  df <- mk_df()
  fx <- write_fixture(df, c(base_params(df), list(options = list(stats = ALL_STATS))))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # F, M and now Total — the NA-gender case is still excluded from all three.
  expect_equal(length(t$rows), 3)
  expect_true(identical(t$rows[[3]][[1]], "output.col.total"))

  kept <- !is.na(df$gender)
  all_sal <- df$salary[kept & !is.na(df$salary)]
  expect_equal(cell_num(t, 3, C_N), length(all_sal))
  expect_equal(cell_num(t, 3, C_MEAN), mean(all_sal))
  expect_equal(cell_num(t, 3, C_SUM), sum(all_sal))

  # The Total block must be the two groups added up, which is the property the
  # comparison actually checked.
  expect_equal(cell_num(t, 3, C_N), cell_num(t, 1, C_N) + cell_num(t, 2, C_N))
  expect_equal(cell_num(t, 3, C_SUM), cell_num(t, 1, C_SUM) + cell_num(t, 2, C_SUM))
  # And being the whole table, its percentages are 100.
  expect_equal(cell_num(t, 3, C_PCT_N), 100, tolerance = 1e-4)
  expect_equal(cell_num(t, 3, C_PCT_SUM), 100, tolerance = 1e-4)
})

test_that("olap: no Total block when there is nothing to total over", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary"), varNames = list(salary = "Salary"),
    options = list(stats = list(n = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  # Without grouping variables the single row already IS the total; repeating
  # it under a "Total" label would just print the same numbers twice.
  expect_equal(length(t$rows), 1)
})

# ── String summary variables are refused ────────────────────────────────────
# Found by a manual SPSS comparison: SPSS will not accept a string variable as
# an OLAP summary variable at all, while we took one and printed a row of
# N=0 / Sum=0 with every other cell blank — which reads as a finding rather
# than a refused input. (Case Summaries deliberately still accepts strings;
# SPSS reports their Minimum/Maximum/First/Last there.)
test_that("olap: a string summary variable is rejected, not summarised as zero", {
  df <- mk_df()
  df$name <- paste0("case", seq_len(nrow(df)))
  fx <- write_fixture(df, list(
    variables = c("salary", "name"),
    varNames = list(salary = "Salary", name = "Patient"),
    groupVars = c("gender"),
    groupVarNames = list(gender = "Gender"),
    options = list(stats = list(n = TRUE, mean = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)

  expect_true(!isTRUE(result$success), "the run must fail rather than produce an empty cube")
  # The message is an i18n key carrying the offending variable's display name,
  # so the user is told WHICH variable to remove.
  expect_true(grepl("output.olapCubes.stringVarError", result$error, fixed = TRUE),
              "error names the stringVarError key")
  expect_true(grepl("Patient", result$error, fixed = TRUE),
              "error names the offending variable")
})

test_that("olap: an all-numeric selection is unaffected by the guard", {
  df <- mk_df()
  df$name <- paste0("case", seq_len(nrow(df)))
  fx <- write_fixture(df, list(
    variables = c("salary"),
    varNames = list(salary = "Salary"),
    groupVars = c("gender"),
    groupVarNames = list(gender = "Gender"),
    options = list(stats = list(n = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  expect_true(isTRUE(result$success), "a string column merely PRESENT in the data is fine")
})

# ── The rest of SPSS's cell menu ────────────────────────────────────────────
# Found by comparing our cube against a real SPSS OLAP CUBES run: SPSS offers
# twenty-three cells, the dialog offered nine. The missing fourteen were not
# missing formulas — Case Summaries had been computing them from the shared
# registry all along — so the fix was to stop keeping a second, shorter menu.
test_that("olap: the shared registry's statistics all reach the cube", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("age"), varNames = list(age = "Age"),
    groupVars = c("gender"), groupVarNames = list(gender = "Gender"),
    options = list(stats = list(
      n = TRUE, groupedMedian = TRUE, seMean = TRUE, range = TRUE, first = TRUE,
      last = TRUE, variance = TRUE, kurtosis = TRUE, seKurtosis = TRUE,
      skewness = TRUE, seSkewness = TRUE, harmonic = TRUE, geometric = TRUE
    ))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  cols <- unlist(t$columns)
  for (k in c("groupedMedian", "seMean", "range", "first", "last", "variance",
              "kurtosis", "seKurtosis", "skewness", "seSkewness",
              "harmonic", "geometric")) {
    expect_true(paste0("output.col.", k) %in% cols, paste("column present:", k))
  }

  # Values against direct R, on the F block (age has no missing values, so the
  # only exclusion is the NA-gender case).
  f_age <- df$age[df$gender %in% "F"]
  col_at <- function(key) which(cols == paste0("output.col.", key))
  expect_equal(cell_num(t, 1, col_at("range")), diff(range(f_age)))
  expect_equal(cell_num(t, 1, col_at("variance")), var(f_age))
  expect_equal(cell_num(t, 1, col_at("seMean")), sd(f_age) / sqrt(length(f_age)))
  # First/Last are the first and last CASE of the cell in file order — not the
  # smallest and largest, and not the order the block happens to be sorted in.
  expect_equal(cell_num(t, 1, col_at("first")), f_age[1])
  expect_equal(cell_num(t, 1, col_at("last")), f_age[length(f_age)])
  expect_equal(cell_num(t, 1, col_at("harmonic")), length(f_age) / sum(1 / f_age))
  expect_equal(cell_num(t, 1, col_at("geometric")), exp(mean(log(f_age))))
})

test_that("olap: harmonic/geometric mean stay empty when a value is not positive", {
  df <- data.frame(x = c(0, 2, 4, 6), grp = c("a", "a", "b", "b"),
                   stringsAsFactors = FALSE)
  fx <- write_fixture(df, list(
    variables = c("x"), varNames = list(x = "X"),
    groupVars = c("grp"), groupVarNames = list(grp = "Group"),
    options = list(stats = list(harmonic = TRUE, geometric = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  # Group "a" contains 0: 1/0 and log(0) are undefined, and SPSS leaves the
  # cell empty rather than printing Inf/-Inf.
  expect_true(is.null(t$rows[[1]][[3]]), "harmonic mean cell is empty")
  expect_true(is.null(t$rows[[1]][[4]]), "geometric mean cell is empty")
  # Group "b" is positive throughout and still gets its numbers.
  expect_equal(cell_num(t, 2, 3), 2 / (1 / 4 + 1 / 6))
  expect_equal(cell_num(t, 2, 4), sqrt(24))
})

# ── % of N / Sum in <grouping variable> ─────────────────────────────────────
# SPSS's NPCT(var)/SPCT(var): the base is the cell's OWN category of the named
# grouping variable, collapsed over every other one — not the whole cube (that
# is NPCT/SPCT) and not the parent block.
test_that("olap: '% in grouping variable' uses that variable's category as base", {
  df <- data.frame(
    x      = c(1, 3, 2, 4, 10, 30, 20, 40),
    outer  = c("A", "A", "A", "A", "B", "B", "B", "B"),
    inner  = c("p", "p", "q", "q", "p", "p", "q", "q"),
    stringsAsFactors = FALSE
  )
  fx <- write_fixture(df, list(
    variables = c("x"), varNames = list(x = "X"),
    groupVars = c("outer", "inner"),
    groupVarNames = list(outer = "Outer", inner = "Inner"),
    options = list(stats = list(sum = TRUE, pctNIn = TRUE, pctSumIn = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")

  # Outer, Inner, Variable, Sum, then one column per grouping variable per
  # checkbox: % of N in Outer, % of N in Inner, % of Sum in Outer, % of Sum in
  # Inner — the variable's name travels in the column key's parameter.
  expect_equal(unlist(t$columns)[5:8],
               c("output.col.pctNInVar:Outer", "output.col.pctNInVar:Inner",
                 "output.col.pctSumInVar:Outer", "output.col.pctSumInVar:Inner"))

  # Row 1 = A/p (sum 4). Base for Outer is all of A (sum 10); for Inner it is
  # every p row, A's and B's alike (4 + 40 = 44).
  expect_equal(cell_num(t, 1, 4), 4)
  expect_equal(cell_num(t, 1, 5), 50, tolerance = 1e-4)                # 2 of A's 4 cases
  expect_equal(cell_num(t, 1, 6), 50, tolerance = 1e-4)                # 2 of p's 4 cases
  expect_equal(cell_num(t, 1, 7), 100 * 4 / 10, tolerance = 1e-4)
  expect_equal(cell_num(t, 1, 8), 100 * 4 / 44, tolerance = 1e-4)

  # The closing Total row is the whole cube, so every percentage is 100.
  last <- length(t$rows)
  for (col in 5:8) expect_equal(cell_num(t, last, col), 100, tolerance = 1e-4)
})

test_that("olap: '% in grouping variable' adds no column without grouping variables", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("age"), varNames = list(age = "Age"),
    options = list(stats = list(n = TRUE, pctNIn = TRUE, pctSumIn = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  expect_equal(length(t$columns), 2)   # Variable, N
})

# ── Case Processing Summary ─────────────────────────────────────────────────
# SPSS opens OLAP CUBES with this table and it is the only place a lost case is
# visible: in the comparison that prompted this, SPSS's Krea row read N = 308
# against its neighbours' 309, and our cube gave the reader no way to see it.
test_that("olap: Case Processing Summary counts Included/Excluded per variable", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("salary", "age"),
    varNames = list(salary = "Salary", age = "Age"),
    groupVars = c("gender"), groupVarNames = list(gender = "Gender"),
    options = list(stats = list(n = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.cps.title")

  expect_equal(length(t$rows), 2)
  # SPSS's row label names the dependent and every grouping variable.
  expect_equal(t$rows[[1]][[1]], "Salary * Gender")
  expect_equal(t$rows[[2]][[1]], "Age * Gender")

  # 12 cases; salary loses its own NA and the NA-gender case (two different
  # rows), age loses only the NA-gender one.
  expect_equal(cell_num(t, 1, 2), 10); expect_equal(cell_num(t, 1, 4), 2)
  expect_equal(cell_num(t, 2, 2), 11); expect_equal(cell_num(t, 2, 4), 1)
  expect_equal(cell_num(t, 1, 6), 12); expect_equal(cell_num(t, 2, 6), 12)
  expect_equal(cell_num(t, 1, 3), 83.3, tolerance = 1e-3)
  expect_equal(cell_num(t, 2, 7), 100)

  # Included must be the N the cube itself reports (Total block, salary).
  cube <- find_table(result, "output.olapCubes.title")
  expect_equal(cell_num(cube, 5, 3), 10)
})

# ── User-defined missing values ─────────────────────────────────────────────
# SPSS's own Notes table for this procedure: "user-defined missing values for
# the dependent and all grouping variables are treated as missing". The script
# never called apply_user_missing(), so a 99-coded refusal was averaged in as
# the number 99 (sai_output's honesty warning was the only signal).
test_that("olap: user-defined missing values are excluded, not averaged in", {
  df <- data.frame(x = c(1, 2, 3, 99), grp = c("a", "a", "b", "b"),
                   stringsAsFactors = FALSE)
  fx <- write_fixture(df, list(
    variables = c("x"), varNames = list(x = "X"),
    groupVars = c("grp"), groupVarNames = list(grp = "Group"),
    missingValues = list(x = list(type = "discrete", discrete = list(99))),
    options = list(stats = list(n = TRUE, mean = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  t <- find_table(result, "output.olapCubes.title")
  # Group b keeps only the 3.
  expect_equal(cell_num(t, 2, 3), 1)
  expect_equal(cell_num(t, 2, 4), 3)
  # And the 99 is Excluded, not merely dropped silently.
  cps <- find_table(result, "output.cps.title")
  expect_equal(cell_num(cps, 1, 2), 3)
  expect_equal(cell_num(cps, 1, 4), 1)
})

# ── Case weights are refused by name, not silently ──────────────────────────
# SPSS's OLAP CUBES honours a case weight; this script does not (the shared
# registry is unweighted by construction). The generic "this analysis does not
# apply weighting" warning is honest but anonymous — with several blocks in the
# Output view, a collapsed one gives no clue which analysis it belongs to.
test_that("olap: an active case weight produces a warning naming the procedure", {
  df <- mk_df()
  df$wt <- rep(2, nrow(df))
  fx <- write_fixture(df, list(
    variables = c("age"), varNames = list(age = "Age"),
    groupVars = c("gender"), groupVarNames = list(gender = "Gender"),
    weightVariable = "wt",
    options = list(stats = list(n = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  warns <- unlist(result$warnings)
  expect_true("output.warn.weightNotSupported:output.olapCubes.title" %in% warns,
              "the warning carries this procedure's own title key")
  expect_true(!("output.warn.weightNotApplied" %in% warns),
              "and replaces the anonymous one rather than doubling it")
  # The cells themselves stay unweighted: 5 F cases, not 10.
  t <- find_table(result, "output.olapCubes.title")
  expect_equal(cell_num(t, 1, 3), 5)
})

test_that("olap: no weight, no warning", {
  df <- mk_df()
  fx <- write_fixture(df, list(
    variables = c("age"), varNames = list(age = "Age"),
    groupVars = c("gender"), groupVarNames = list(gender = "Gender"),
    options = list(stats = list(n = TRUE))
  ))
  result <- run_analysis_script("olap-cubes.R", fx)
  expect_equal(length(result$warnings), 0)
})

# Only when run on its own. Under run-all.R the suite reports once at the
# end — and report() quits the process if anything has failed, so calling it
# here truncated the whole run at the first earlier failure.
if (.standalone) report()
