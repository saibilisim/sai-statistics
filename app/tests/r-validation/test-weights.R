# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-weights.R — validates Weight Cases (W1) across the "core set" scripts
# that actually consume params$weightVariable, plus the honesty guarantee
# (_bootstrap.R's sai_output() auto-warning) for a script outside that scope.
#
# Reference strategy: an integer-weighted case with weight k is mathematically
# equivalent to k identical unweighted cases (SPSS frequency-weight
# semantics), so every reference value here is computed by literally
# replicating rows via rep(..., times = w) and feeding that expanded data
# frame to R's own trusted functions (t.test/aov/chisq.test/etc.) — never the
# analysis script's own internals, matching this suite's overall philosophy.

# ── Frequencies (weighted counts/percentages/mean/sd) ───────────────────────
test_that("frequencies: weighted counts and stats match row-expansion reference", {
  df <- data.frame(
    grp   = c("A", "A", "B", "B", "A"),
    score = c(10, 20, 30, 40, 15),
    w     = c(2, 1, 3, 1, 2)
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    options = list(showTable = TRUE, statistics = list(mean = TRUE, sd = TRUE)),
    weightVariable = "w"
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true(length(result$warnings) == 0, "no 'weight not applied' warning expected")

  expanded <- rep(df$score, times = df$w)
  stats_table <- find_table(result, "output.frequencies.statsTitle")
  # rows: nValid, nMissing, mean, sd (in that order per frequencies.R)
  expect_equal(cell_num(stats_table, 1, 2), length(expanded), tolerance = 1e-9, "weighted N")
  expect_equal(cell_num(stats_table, 3, 2), mean(expanded), tolerance = 1e-6, "weighted mean")
  expect_equal(cell_num(stats_table, 4, 2), sd(expanded), tolerance = 1e-6, "weighted sd")
})

# ── Crosstabs (weighted counts + chi-square) ────────────────────────────────
test_that("crosstabs: weighted chi-square matches row-expansion reference", {
  set.seed(42)
  df <- data.frame(
    gender = rep(c("M", "F"), 10),
    passed = rep(c("Y", "Y", "N", "Y"), 5),
    w      = sample(1:3, 20, replace = TRUE)
  )
  fixture <- write_fixture(df, list(
    rows = list("gender"), rowNames = list(gender = "Gender"),
    cols = list("passed"), colNames = list(passed = "Passed"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = TRUE)),
    weightVariable = "w"
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  exp_g <- rep(df$gender, times = df$w); exp_p <- rep(df$passed, times = df$w)
  tab_ref <- table(exp_g, exp_p)
  ref <- suppressWarnings(chisq.test(tab_ref, correct = FALSE))

  chisq_table <- find_table(result, "output.crosstabs.chiSqTitle")
  expect_equal(cell_num(chisq_table, 1, 2), unname(ref$statistic), tolerance = 1e-4, "weighted chi-square")
  expect_equal(cell_num(chisq_table, 1, 4), ref$p.value, tolerance = 1e-4, "weighted p-value")
})

# ── Descriptives (weighted mean/sd/skewness/kurtosis) ───────────────────────
test_that("descriptives: weighted moments match row-expansion reference", {
  set.seed(7)
  df <- data.frame(x = rnorm(20, 50, 10), w = sample(1:4, 20, replace = TRUE))
  fixture <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"),
    options = list(mean = TRUE, sd = TRUE, variance = TRUE, skewness = TRUE, kurtosis = TRUE),
    weightVariable = "w"
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  expanded <- rep(df$x, times = df$w)
  n <- length(expanded)
  # Canonical adjusted Fisher-Pearson G1 / Fisher excess G2 (biased moments),
  # the definitions SPSS matches — expressed independently of the script's
  # own wtd_ helpers. (Replaces the pre-2026-07-07 buggy (n-1)^1.5/(n-1)^2
  # reference that had matched the equally-buggy old script formula.)
  m2 <- mean((expanded - mean(expanded))^2)
  m3 <- mean((expanded - mean(expanded))^3)
  m4 <- mean((expanded - mean(expanded))^4)
  ref_skew <- sqrt(n * (n - 1)) / (n - 2) * (m3 / m2^1.5)
  ref_kurt <- (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * (m4 / m2^2 - 3) + 6)
  ref_se_skew <- sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
  ref_se_kurt <- sqrt(4 * (n^2 - 1) * ref_se_skew^2 / ((n - 3) * (n + 5)))

  # Column order (descriptives.R): variable, n, mean, sum, sd, variance, range,
  # min, max, seMean, skewness, skewSE, kurtosis, kurtSE — only requested ones
  # included. With mean/sd/variance/skewness/kurtosis requested:
  # variable(1), n(2), mean(3), sd(4), variance(5), skewness(6), skewSE(7),
  # kurtosis(8), kurtSE(9).
  table <- find_table(result, "output.descriptives.title")
  expect_equal(cell_num(table, 1, 2), n, tolerance = 1e-9, "weighted N")
  expect_equal(cell_num(table, 1, 3), mean(expanded), tolerance = 1e-6, "weighted mean")
  expect_equal(cell_num(table, 1, 4), sd(expanded), tolerance = 1e-6, "weighted sd")
  expect_equal(cell_num(table, 1, 5), var(expanded), tolerance = 1e-6, "weighted variance")
  expect_equal(cell_num(table, 1, 6), ref_skew, tolerance = 1e-4, "weighted skewness")
  expect_equal(cell_num(table, 1, 7), ref_se_skew, tolerance = 1e-4, "weighted SE skewness")
  expect_equal(cell_num(table, 1, 8), ref_kurt, tolerance = 1e-3, "weighted kurtosis")
  expect_equal(cell_num(table, 1, 9), ref_se_kurt, tolerance = 1e-4, "weighted SE kurtosis")
})

# ── Means (weighted per-group N/mean/sd) ────────────────────────────────────
test_that("means: weighted group report matches row-expansion reference", {
  set.seed(3)
  df <- data.frame(
    score = round(rnorm(12, 70, 10), 1),
    grp   = rep(c("A", "B", "C"), 4),
    w     = sample(1:3, 12, replace = TRUE)
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group", weightVariable = "w"
  ))
  result <- run_analysis_script("means.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.means.reportTitle")
  for (i in seq_along(c("A", "B", "C"))) {
    lvl <- c("A", "B", "C")[i]
    idx <- df$grp == lvl
    expanded <- rep(df$score[idx], times = df$w[idx])
    expect_equal(cell_num(table, i, 2), mean(expanded), tolerance = 1e-4, paste("group", lvl, "mean"))
    expect_equal(cell_num(table, i, 3), length(expanded), tolerance = 1e-9, paste("group", lvl, "N"))
    expect_equal(cell_num(table, i, 4), sd(expanded), tolerance = 1e-4, paste("group", lvl, "sd"))
  }
})

# ── Independent-samples t-test (weighted group stats + Levene + t/df/p) ────
test_that("ttest-independent: weighted t-test matches row-expansion reference", {
  set.seed(21)
  df <- data.frame(
    score = c(rnorm(10, 50, 8), rnorm(9, 58, 10)),
    grp   = c(rep("A", 10), rep("B", 9)),
    w     = sample(1:3, 19, replace = TRUE)
  )
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    groupVar = "grp", groupName = "Group", group1 = "A", group2 = "B",
    weightVariable = "w"
  ))
  result <- run_analysis_script("ttest-independent.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  a <- df[df$grp == "A", ]; b <- df[df$grp == "B", ]
  ea <- rep(a$score, times = a$w); eb <- rep(b$score, times = b$w)
  ref_eq <- t.test(ea, eb, var.equal = TRUE)
  ref_we <- t.test(ea, eb, var.equal = FALSE)

  test_table <- find_table(result, "output.ttestInd.testTitle")
  expect_equal(cell_num(test_table, 1, 5), unname(ref_eq$statistic), tolerance = 1e-4, "t (equal var)")
  expect_equal(cell_num(test_table, 1, 6), unname(ref_eq$parameter), tolerance = 1e-4, "df (equal var)")
  expect_equal(cell_num(test_table, 1, 7), ref_eq$p.value, tolerance = 1e-3, "p (equal var)")
  expect_equal(cell_num(test_table, 2, 5), unname(ref_we$statistic), tolerance = 1e-4, "t (Welch)")
  expect_equal(cell_num(test_table, 2, 6), unname(ref_we$parameter), tolerance = 1e-2, "df (Welch)")

  group_table <- find_table(result, "output.ttestInd.groupStatsTitle")
  expect_equal(cell_num(group_table, 1, 3), length(ea), tolerance = 1e-9, "group A weighted N")
  expect_equal(cell_num(group_table, 1, 4), mean(ea), tolerance = 1e-6, "group A weighted mean")
})

# ── One-sample t-test (weighted) ────────────────────────────────────────────
test_that("ttest-onesample: weighted t-test matches row-expansion reference", {
  set.seed(9)
  df <- data.frame(x = rnorm(15, 105, 12), w = sample(1:3, 15, replace = TRUE))
  fixture <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"), testValue = 100, weightVariable = "w"
  ))
  result <- run_analysis_script("ttest-onesample.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  expanded <- rep(df$x, times = df$w)
  ref <- t.test(expanded, mu = 100)
  test_table <- find_table(result, "output.ttest1.testTitle")
  expect_equal(cell_num(test_table, 1, 2), unname(ref$statistic), tolerance = 1e-4, "t")
  expect_equal(cell_num(test_table, 1, 3), unname(ref$parameter), tolerance = 1e-9, "df")
  expect_equal(cell_num(test_table, 1, 4), ref$p.value, tolerance = 1e-3, "p")
})

# ── Paired-samples t-test (weighted correlation + paired t-test) ───────────
test_that("ttest-paired: weighted correlation and paired t-test match row-expansion reference", {
  set.seed(17)
  n <- 15
  pre <- rnorm(n, 100, 10); post <- pre + rnorm(n, 5, 6)
  w <- sample(1:3, n, replace = TRUE)
  df <- data.frame(pre = pre, post = post, w = w)
  fixture <- write_fixture(df, list(
    var1 = list("pre"), var2 = list("post"),
    varNames = list(pre = "Pre", post = "Post"), weightVariable = "w"
  ))
  result <- run_analysis_script("ttest-paired.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  epre <- rep(pre, times = w); epost <- rep(post, times = w)
  ref_cor <- cor.test(epre, epost)
  ref_tt  <- t.test(epre, epost, paired = TRUE)

  corr_table <- find_table(result, "output.ttestPaired.corrTitle")
  expect_equal(cell_num(corr_table, 1, 3), unname(ref_cor$estimate), tolerance = 1e-4, "weighted correlation")

  test_table <- find_table(result, "output.ttestPaired.testTitle")
  expect_equal(cell_num(test_table, 1, 7), unname(ref_tt$statistic), tolerance = 1e-4, "t (paired)")
  expect_equal(cell_num(test_table, 1, 9), ref_tt$p.value, tolerance = 1e-3, "p (paired)")
})

# ── One-Way ANOVA (weighted SS/F + Levene + Welch) ──────────────────────────
test_that("anova-oneway: weighted F/Levene/Welch match row-expansion reference", {
  set.seed(42)
  n_per <- c(9, 11, 8)
  g <- factor(rep(c("A", "B", "C"), n_per))
  x <- c(rnorm(9, 20, 3), rnorm(11, 25, 5), rnorm(8, 18, 2))
  w <- sample(1:3, length(x), replace = TRUE)
  df <- data.frame(score = x, grp = as.character(g), w = w)
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group",
    options = list(homogeneity = TRUE, welch = TRUE), weightVariable = "w"
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  exp_x <- rep(df$score, times = df$w); exp_g <- factor(rep(df$grp, times = df$w))
  aov_ref <- summary(aov(exp_x ~ exp_g))[[1]]
  welch_ref <- oneway.test(exp_x ~ exp_g, var.equal = FALSE)
  z <- abs(exp_x - ave(exp_x, exp_g, FUN = mean))
  levene_ref <- summary(aov(z ~ exp_g))[[1]]

  anova_table <- find_table(result, "output.anova.title")
  expect_equal(cell_num(anova_table, 1, 2), aov_ref[["Sum Sq"]][1], tolerance = 1e-3, "weighted SSB")
  expect_equal(cell_num(anova_table, 1, 5), aov_ref[["F value"]][1], tolerance = 1e-3, "weighted F")

  # Homogeneity table now has a leading method-label column (Based on
  # Mean/Median/Trimmed, A3); row 1 = Based on Mean, statistic in column 2.
  homog_table <- find_table(result, "output.anova.homogTitle")
  expect_equal(cell_num(homog_table, 1, 2), levene_ref[["F value"]][1], tolerance = 1e-3, "weighted Levene F (Based on Mean)")

  welch_table <- find_table(result, "output.anova.robustTitle")
  expect_equal(cell_num(welch_table, 1, 2), unname(welch_ref$statistic), tolerance = 1e-2, "weighted Welch F")
  expect_equal(cell_num(welch_table, 1, 4), unname(welch_ref$parameter[2]), tolerance = 1e-1, "weighted Welch df2")
})

# ── Decimal weights use real weighted formulas, not rounding/replication ────
test_that("descriptives: fractional weights use exact weighted-sum formulas", {
  df <- data.frame(x = c(1, 2, 3, 4, 5), w = c(1.5, 0.5, 2.25, 1, 0.75))
  fixture <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"),
    options = list(mean = TRUE, sd = TRUE), weightVariable = "w"
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  W <- sum(df$w)
  ref_mean <- sum(df$w * df$x) / W
  m <- ref_mean
  ref_var <- sum(df$w * (df$x - m)^2) / (W - 1)

  table <- find_table(result, "output.descriptives.title")
  # tolerance 1e-6 (not tighter): the script round()s displayed values to 6dp.
  expect_equal(cell_num(table, 1, 2), W, tolerance = 1e-9, "fractional weighted N")
  expect_equal(cell_num(table, 1, 3), ref_mean, tolerance = 1e-6, "fractional weighted mean")
  expect_equal(cell_num(table, 1, 4), sqrt(ref_var), tolerance = 1e-6, "fractional weighted sd")
})

# ── Honesty guarantee: a script outside the weighted "core set" must not
# silently ignore the weight — sai_output() should attach the auto-warning.
test_that("npar-mann-whitney (out of core-set scope) warns that weight wasn't applied", {
  df <- data.frame(
    x   = c(1, 2, 3, 4, 5, 6, 7, 8),
    grp = c(rep("A", 4), rep("B", 4)),
    w   = c(1, 2, 1, 1, 2, 1, 1, 3)
  )
  fixture <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"),
    groupVar = "grp", groupName = "Group", group1 = "A", group2 = "B",
    weightVariable = "w"
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true("output.warn.weightNotApplied" %in% unlist(result$warnings),
              "expected the auto 'weight not applied' warning")
})

# ── Sanity: weight OFF (no weightVariable) behaves exactly as before ────────
test_that("frequencies: no weightVariable produces the original unweighted output", {
  df <- data.frame(grp = c("A", "A", "B", "B", "A"))
  fixture <- write_fixture(df, list(
    variables = list("grp"), varNames = list(grp = "Group"),
    options = list(showTable = TRUE)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_true(length(result$warnings) == 0, "no weight warning when weight is unset")
  table <- find_table(result, "output.frequencies.tableTitle")
  # A=3, B=2 (unweighted counts) — looked up by category label, not position:
  # the default row order is ascending by value (SPSS parity, 2026-08).
  row_by_value <- function(v) Filter(function(r) identical(r[[1]], v), table$rows)[[1]]
  expect_equal(as.numeric(row_by_value("A")[[2]]), 3, tolerance = 1e-9, "unweighted A count")
  expect_equal(as.numeric(row_by_value("B")[[2]]), 2, tolerance = 1e-9, "unweighted B count")
})
