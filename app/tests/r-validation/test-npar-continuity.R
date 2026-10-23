# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-continuity.R — the ±0.5 continuity correction on
# npar-mann-whitney.R and npar-wilcoxon.R's asymptotic Z is OPT-IN.
#
# 2026-10: it used to default ON on the belief that SPSS applies it. It does
# not — the SPSS NPAR TESTS algorithms give the tie-corrected Z with no
# continuity term (only the sign test has one), and tests/spss-parity proved
# it: with the correction our Z was -2.478 / -5.901 against SPSS's -2.481 /
# -5.903; without it both match. The asymptotic Z column exists to be the
# SPSS-comparable figure (the exact p is reported beside it), so the default
# now reproduces SPSS and the corrected version stays one checkbox away.
#
# The oracle is base R's own wilcox.test(exact=FALSE, correct=...) normal-
# approximation p-value, computed both with and without the correction.

test_that("Mann-Whitney Asymp. Sig. is uncorrected by default, corrected on request", {
  x <- c(12, 15, 17, 20, 22, 25, 9, 11, 13, 14, 30, 31)
  g <- c(rep("A", 6), rep("B", 6))
  df <- data.frame(col_1 = x, col_2 = g)

  base_params <- list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B"
  )

  fixture_default <- write_fixture(df, base_params)
  result_default <- run_analysis_script("npar-mann-whitney.R", fixture_default)
  expect_true(isTRUE(result_default$success), "result$success (default options)")

  fixture_on <- write_fixture(df, c(base_params, list(options = list(continuityCorrection = TRUE))))
  result_on <- run_analysis_script("npar-mann-whitney.R", fixture_on)
  expect_true(isTRUE(result_on$success), "result$success (continuityCorrection = TRUE)")

  ref_corrected   <- wilcox.test(x[g == "A"], x[g == "B"], exact = FALSE, correct = TRUE)$p.value
  ref_uncorrected <- wilcox.test(x[g == "A"], x[g == "B"], exact = FALSE, correct = FALSE)$p.value
  expect_true(ref_corrected > ref_uncorrected, "sanity: correction is more conservative here")

  ts_default <- find_table(result_default, "output.npar.testStatsTitle")
  ts_on <- find_table(result_on, "output.npar.testStatsTitle")
  # Columns: variable(1), U(2), W(3), Z(4), Asymp.Sig(5), Exact.Sig(6)
  expect_equal(cell_num(ts_default, 1, 5), ref_uncorrected, tolerance = 1e-6,
               label = "default Asymp. Sig. matches wilcox.test(correct=FALSE), as SPSS")
  expect_equal(cell_num(ts_on, 1, 5), ref_corrected, tolerance = 1e-6,
               label = "continuityCorrection=TRUE matches wilcox.test(correct=TRUE)")
})

test_that("Wilcoxon signed-rank Asymp. Sig. is uncorrected by default, corrected on request", {
  a <- c(10, 12, 14, 16, 18, 20, 22, 24)
  b <- c(12, 9, 19, 9, 29, 7, 39, 21)   # diffs 2,-3,5,-7,11,-13,17,-3 — no zeros
  df <- data.frame(col_1 = a, col_2 = b)

  base_params <- list(
    var1 = list("col_1"), var2 = list("col_2"),
    varNames = list(col_1 = "pre", col_2 = "post")
  )

  fixture_default <- write_fixture(df, base_params)
  result_default <- run_analysis_script("npar-wilcoxon.R", fixture_default)
  expect_true(isTRUE(result_default$success), "result$success (default options)")

  fixture_on <- write_fixture(df, c(base_params, list(options = list(continuityCorrection = TRUE))))
  result_on <- run_analysis_script("npar-wilcoxon.R", fixture_on)
  expect_true(isTRUE(result_on$success), "result$success (continuityCorrection = TRUE)")

  ref_corrected   <- suppressWarnings(
    wilcox.test(b, a, paired = TRUE, exact = FALSE, correct = TRUE)$p.value)
  ref_uncorrected <- suppressWarnings(
    wilcox.test(b, a, paired = TRUE, exact = FALSE, correct = FALSE)$p.value)

  ts_default <- find_table(result_default, "output.npar.testStatsTitle")
  ts_on <- find_table(result_on, "output.npar.testStatsTitle")
  # Columns: variable(1), Z(2), Asymp.Sig(3), Exact.Sig(4)
  expect_equal(cell_num(ts_default, 1, 3), ref_uncorrected, tolerance = 1e-6,
               label = "default Asymp. Sig. matches wilcox.test(correct=FALSE), as SPSS")
  expect_equal(cell_num(ts_on, 1, 3), ref_corrected, tolerance = 1e-6,
               label = "continuityCorrection=TRUE matches wilcox.test(correct=TRUE)")
})
