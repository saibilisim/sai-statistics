# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-missing-values.R — validates Missing Values (M1) wiring across the
# scripts that call apply_user_missing(), plus the honesty guarantee
# (_bootstrap.R's sai_output() auto-warning) for a script outside that scope.
#
# Reference strategy: a user-defined missing value is equivalent to that case
# being system-missing (NA) for the purposes of the analysis, so every
# reference value here is computed by literally recoding the flagged values to
# NA in a plain data.frame and feeding that to R's own trusted functions —
# never the analysis script's own internals, matching test-weights.R's
# philosophy.

# ── Frequencies (discrete missing excluded from counts/stats) ───────────────
test_that("frequencies: discrete missing values are excluded like system-missing", {
  df <- data.frame(score = c(10, 20, 99, 30, 99, 40))
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    options = list(showTable = TRUE, statistics = list(mean = TRUE, sd = TRUE)),
    missingValues = list(score = list(type = "discrete", discrete = list(99)))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true(length(result$warnings) == 0, "no 'missing not applied' warning expected")

  ref <- c(10, 20, 30, 40)
  stats_table <- find_table(result, "output.frequencies.statsTitle")
  # rows: nValid, nMissing, mean, sd (in that order per frequencies.R)
  expect_equal(cell_num(stats_table, 1, 2), length(ref), tolerance = 1e-9, "valid N excludes discrete missing")
  expect_equal(cell_num(stats_table, 2, 2), 2, tolerance = 1e-9, "missing count = 2")
  expect_equal(cell_num(stats_table, 3, 2), mean(ref), tolerance = 1e-6, "mean excludes discrete missing")
  expect_equal(cell_num(stats_table, 4, 2), sd(ref), tolerance = 1e-6, "sd excludes discrete missing")
})

# ── Descriptives (range missing excluded) ───────────────────────────────────
test_that("descriptives: range missing values are excluded from N/mean/sd", {
  df <- data.frame(x = c(5, 10, 15, 995, 20, 998))
  fixture <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"),
    options = list(mean = TRUE, sd = TRUE),
    missingValues = list(x = list(type = "range", rangeLow = 990, rangeHigh = 999))
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- c(5, 10, 15, 20)
  table <- find_table(result, "output.descriptives.title")
  expect_equal(cell_num(table, 1, 2), length(ref), tolerance = 1e-9, "N excludes range missing")
  expect_equal(cell_num(table, 1, 3), mean(ref), tolerance = 1e-6, "mean excludes range missing")
  expect_equal(cell_num(table, 1, 4), sd(ref), tolerance = 1e-6, "sd excludes range missing")
})

# ── Crosstabs (missing on either row or column variable excludes the case) ──
test_that("crosstabs: user-defined missing excludes cases like system-missing", {
  df <- data.frame(
    gender = c("M", "M", "F", "F", "M", "F"),
    passed = c("Y", "N", "Y", "9", "Y", "N")
  )
  fixture <- write_fixture(df, list(
    rows = list("gender"), rowNames = list(gender = "Gender"),
    cols = list("passed"), colNames = list(passed = "Passed"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = TRUE)),
    missingValues = list(passed = list(type = "discrete", discrete = list("9")))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  keep <- df$passed != "9"
  ref <- suppressWarnings(chisq.test(table(df$gender[keep], df$passed[keep]), correct = FALSE))

  chisq_table <- find_table(result, "output.crosstabs.chiSqTitle")
  expect_equal(cell_num(chisq_table, 1, 2), unname(ref$statistic), tolerance = 1e-4, "chi-square excludes missing-flagged case")
})

# ── One-way ANOVA (missing on the dependent variable) ───────────────────────
test_that("anova-oneway: discrete missing on the dependent variable is excluded", {
  df <- data.frame(
    grp   = c("A", "A", "A", "B", "B", "B"),
    score = c(10, 999, 12, 20, 21, 999)
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group",
    missingValues = list(score = list(type = "discrete", discrete = list(999)))
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  keep <- df$score != 999
  ref <- summary(aov(score ~ grp, data = df[keep, ]))[[1]]

  anova_table <- find_table(result, "output.anova.title")
  expect_equal(cell_num(anova_table, 1, 5), ref["grp", "F value"], tolerance = 1e-4, "F excludes missing-flagged case")
})

# ── Honesty guarantee: a script outside the wired scope must not silently
# ignore a missing-value spec — sai_output() should attach the auto-warning.
test_that("kmeans (not wired for missing values) warns that missing wasn't applied", {
  set.seed(21)
  df <- data.frame(
    x = c(rnorm(10, 0, 0.3), rnorm(10, 5, 0.3), 999),
    y = c(rnorm(10, 0, 0.3), rnorm(10, 5, 0.3), 1)
  )
  fixture <- write_fixture(df, list(
    variables = list("x", "y"), varNames = list(x = "X", y = "Y"), clusters = 2,
    missingValues = list(x = list(type = "discrete", discrete = list(999)))
  ))
  result <- run_analysis_script("kmeans.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true("output.warn.missingNotApplied" %in% unlist(result$warnings),
              "expected the auto 'missing not applied' warning")
})

# Nonparametric tests honour user-missing codes (audit 2026-10): 999 must not be
# ranked as the largest observation.
test_that("npar-mann-whitney applies user-missing values", {
  df <- data.frame(
    x   = c(1, 2, 3, 999, 5, 6, 7, 8),
    grp = c(rep("A", 4), rep("B", 4))
  )
  fixture <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"),
    groupVar = "grp", groupName = "Group", group1 = "A", group2 = "B",
    missingValues = list(x = list(type = "discrete", discrete = list(999)))
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true(!("output.warn.missingNotApplied" %in% unlist(result$warnings)),
              "no 'missing not applied' warning any more")
  ref <- wilcox.test(c(1, 2, 3), c(5, 6, 7, 8), exact = FALSE, correct = FALSE)
  tests <- Filter(function(tb) grepl("test|Test", tb$titleKey), result$tables)
  found <- FALSE
  for (tb in tests) for (row in tb$rows) {
    vals <- suppressWarnings(as.numeric(unlist(row)))
    if (any(abs(vals - ref$statistic) < 1e-6, na.rm = TRUE)) found <- TRUE
  }
  expect_true(found, "U statistic computed without the 999 case")
})

# ── Sanity: no missingValues spec produces the original unrecoded output ────
test_that("frequencies: no missing spec behaves exactly as before", {
  df <- data.frame(grp = c("A", "A", "B", "B", "A"))
  fixture <- write_fixture(df, list(
    variables = list("grp"), varNames = list(grp = "Group"),
    options = list(showTable = TRUE)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true(length(result$warnings) == 0, "no missing warning when no spec is defined")
  table <- find_table(result, "output.frequencies.tableTitle")
  # Looked up by category label, not position: the default row order is
  # ascending by value (SPSS parity, 2026-08).
  row_by_value <- function(v) Filter(function(r) identical(r[[1]], v), table$rows)[[1]]
  expect_equal(as.numeric(row_by_value("A")[[2]]), 3, tolerance = 1e-9, "unrecoded A count")
  expect_equal(as.numeric(row_by_value("B")[[2]]), 2, tolerance = 1e-9, "unrecoded B count")
})

# ── Frequencies Missing block breakdown (MV4, 2026-07-17) ───────────────────
# SPSS never lumps a coded missing value (99) and true system-missing into a
# single "Missing" row — each user-missing value gets its own row, plus a
# "System" row. Reference: hand-counted from the fixture (score = 10,20,99,
# 30,99,40,NA — 4 valid, 99 x2, 1 system-missing).
test_that("frequencies: Missing block breaks down user-missing values + System separately", {
  df <- data.frame(score = c(10, 20, 99, 30, 99, 40, NA))
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    options = list(showTable = TRUE),
    missingValues = list(score = list(type = "discrete", discrete = list(99)))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.frequencies.tableTitle")
  # rows: 4 valid categories (10,20,30,40) + Valid Total + "99" + System + Total = 8
  expect_equal(length(table$rows), 8, label = "row count: 4 valid + ValidTotal + 99 + System + Total")

  row99 <- table$rows[[6]]
  expect_equal(row99[[1]], "99", label = "row 6 label is the coded missing value")
  expect_equal(as.numeric(row99[[2]]), 2, tolerance = 1e-9, "99 appears twice")

  rowSys <- table$rows[[7]]
  expect_equal(rowSys[[1]], "output.freq.system", label = "row 7 is the System row")
  expect_equal(as.numeric(rowSys[[2]]), 1, tolerance = 1e-9, "1 true system-missing case")

  rowTotal <- table$rows[[8]]
  expect_equal(rowTotal[[1]], "output.freq.total", label = "row 8 is Total")
  expect_equal(as.numeric(rowTotal[[2]]), 7, tolerance = 1e-9, "Total N = 7 cases")
})

# ── Weighted variant: counts should sum weights, not raw case counts ────────
test_that("frequencies: Missing block breakdown respects Weight Cases", {
  df <- data.frame(score = c(10, 99, 99, NA), w = c(1, 2, 3, 4))
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    options = list(showTable = TRUE),
    missingValues = list(score = list(type = "discrete", discrete = list(99))),
    weightVariable = "w"
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.frequencies.tableTitle")
  # rows: 1 valid (10) + Valid Total + "99" + System + Total = 5
  expect_equal(length(table$rows), 5, label = "row count with a single valid category")
  row99 <- table$rows[[3]]
  expect_equal(as.numeric(row99[[2]]), 5, tolerance = 1e-9, "99's weight sum = 2+3")
  rowSys <- table$rows[[4]]
  expect_equal(as.numeric(rowSys[[2]]), 4, tolerance = 1e-9, "System weight = 4 (the NA row's own weight)")
})
