# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-normality.R — validates r-scripts/normality.R's Shapiro-Wilk and
# Kolmogorov-Smirnov output against R's own shapiro.test() plus the same KS
# branch the script itself takes: Lilliefors (nortest::lillie.test) when the
# nortest package is visible, plain ks.test() fallback otherwise. Mirroring
# the script's own branching keeps this test valid in both environments
# (roadmap.md's "R doğrulama: KS/SW ... (tests/r-validation/)" checkbox).

test_that("normality profile matches shapiro.test()/ks.test() (normal sample)", {
  set.seed(123)
  x <- rnorm(50, mean = 10, sd = 2)
  df <- data.frame(col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "x")
  ))
  result <- run_analysis_script("normality.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.normality.title")
  sw <- shapiro.test(x)
  # Same branch as normality.R: Lilliefors when nortest is visible, else plain KS.
  ks <- if (requireNamespace("nortest", quietly = TRUE)) {
    nortest::lillie.test(x)
  } else {
    suppressWarnings(ks.test(x, "pnorm", mean = mean(x), sd = sd(x)))
  }

  # Row 1 = col_1. Columns: variable,n,missing,mean,median,sd,min,max,range,
  # skewness,seSkewness,zSkewness,kurtosis,seKurtosis,zKurtosis,
  # ksStat(16),ksDf(17),ksSig(18),swStat(19),swDf(20),swSig(21),decision(22)
  expect_equal(cell_num(table, 1, 2), 50, tolerance = 1e-9, "n")
  expect_equal(cell_num(table, 1, 4), mean(x), tolerance = 1e-4, "mean")
  expect_equal(cell_num(table, 1, 6), sd(x), tolerance = 1e-4, "sd")
  expect_equal(cell_num(table, 1, 16), unname(ks$statistic), tolerance = 1e-4, "KS statistic (script's own branch)")
  expect_equal(cell_num(table, 1, 18), ks$p.value, tolerance = 1e-3, "KS p-value")
  expect_equal(cell_num(table, 1, 19), unname(sw$statistic), tolerance = 1e-4, "Shapiro-Wilk W")
  expect_equal(cell_num(table, 1, 21), sw$p.value, tolerance = 1e-3, "Shapiro-Wilk p-value")
})

test_that("normality profile flags a clearly non-normal (exponential) sample", {
  set.seed(7)
  x <- rexp(60, rate = 1)
  df <- data.frame(col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "x")
  ))
  result <- run_analysis_script("normality.R", fixture)
  table <- find_table(result, "output.normality.title")

  sw <- shapiro.test(x)
  expect_equal(cell_num(table, 1, 19), unname(sw$statistic), tolerance = 1e-4, "Shapiro-Wilk W (exponential)")
  expect_lt(cell_num(table, 1, 21), 0.05, "exponential sample should reject normality (p<.05)")
  expect_equal(table$rows[[1]][[22]], "notNormal", label = "decision column reflects the rejection")
})
