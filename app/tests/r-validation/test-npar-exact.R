# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-exact.R — validates the "science-over-SPSS" exact p-values added
# to npar-mann-whitney.R and npar-wilcoxon.R (CLAUDE.md §11). The scripts keep
# the SPSS-comparable asymptotic Z/Sig. and ADD an "Exact Sig." column computed
# by base R's own stats::wilcox.test(exact=TRUE) when it is valid (no ties,
# n < 50). The oracle here IS wilcox.test — because production now delegates
# the exact computation to it, the test only needs to confirm the wiring
# (right data in, right p out, blanked when exact is invalid).

test_that("Mann-Whitney Exact Sig. matches wilcox.test(exact=TRUE) for small, tie-free data", {
  x <- c(12, 15, 17, 20, 22, 25, 9, 11, 13, 14)
  g <- c(rep("A", 5), rep("B", 5))
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B"
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- wilcox.test(x[g == "A"], x[g == "B"], exact = TRUE)$p.value
  ts <- find_table(result, "output.npar.testStatsTitle")
  # Columns: variable(1), U(2), W(3), Z(4), Asymp.Sig(5), Exact.Sig(6)
  expect_equal(cell_num(ts, 1, 6), ref, tolerance = 2e-4, "Exact Sig. == wilcox.test exact p")
  # Asymptotic column still present and populated (SPSS-comparable reference).
  expect_true(!is.na(cell_num(ts, 1, 5)), "Asymp. Sig. still reported")
})

test_that("Mann-Whitney Exact Sig. is blank when ties make R's exact test invalid", {
  # Deliberate ties in the pooled sample → exact_ok gate must block, so R
  # would only give an approximation; we leave Exact Sig. empty rather than
  # mislabel it.
  x <- c(2, 2, 3, 4, 3, 4, 5, 5)
  g <- c(rep("A", 4), rep("B", 4))
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B"
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ts <- find_table(result, "output.npar.testStatsTitle")
  expect_true(is.na(cell_num(ts, 1, 6)), "Exact Sig. blank under ties")
  expect_true(!is.na(cell_num(ts, 1, 5)), "Asymp. Sig. still reported under ties")
})

test_that("Mann-Whitney: the Exact button's coin path fills Exact Sig. where R's gate leaves it blank", {
  # Same tied data as the "blank" test above, but this time with the Exact
  # button's method='exact' explicitly requested — the `coin` package's exact
  # network algorithm should now fill the SAME column (not add a new one),
  # since it computes the identical quantity base R's exact_ok gate blocks.
  if (!requireNamespace("coin", quietly = TRUE)) {
    cat("  (skipped: coin not installed)\n"); return(invisible())
  }
  x <- c(2, 2, 3, 4, 3, 4, 5, 5)
  g <- c(rep("A", 4), rep("B", 4))
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B",
    options = list(pMethod = list(method = "exact"))
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- as.numeric(coin::pvalue(coin::wilcox_test(x ~ factor(g), distribution = coin::exact())))
  ts <- find_table(result, "output.npar.testStatsTitle")
  expect_true(length(ts$columns) == 6, "no extra column for 'exact' — same Exact Sig. slot")
  expect_equal(cell_num(ts, 1, 6), ref, tolerance = 1e-5,
               "Exact Sig. == an independent coin::wilcox_test(exact()) reference")
})

test_that("Mann-Whitney: Monte Carlo adds its own column, distinct from Exact Sig.", {
  if (!requireNamespace("coin", quietly = TRUE)) {
    cat("  (skipped: coin not installed)\n"); return(invisible())
  }
  x <- c(2, 2, 3, 4, 3, 4, 5, 5)
  g <- c(rep("A", 4), rep("B", 4))
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B",
    options = list(pMethod = list(method = "montecarlo", samples = 5000, seed = 1))
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ts <- find_table(result, "output.npar.testStatsTitle")
  expect_true(length(ts$columns) == 7, "Monte Carlo adds a 7th column")
  expect_true(is.na(cell_num(ts, 1, 6)), "Exact Sig. (6th) is untouched — still blank under ties")
  mc_p <- cell_num(ts, 1, 7)
  expect_true(!is.na(mc_p) && mc_p >= 0 && mc_p <= 1, "Monte Carlo Sig. is a valid p-value")
})

test_that("Wilcoxon signed-rank Exact Sig. matches wilcox.test(paired, exact=TRUE)", {
  a <- c(10, 12, 14, 16, 18, 20, 22)
  b <- c(12, 9, 19, 9, 29, 7, 39)   # diffs 2,-3,5,-7,11,-13,17 → abs all distinct, no zeros
  df <- data.frame(col_1 = a, col_2 = b)

  fixture <- write_fixture(df, list(
    var1 = list("col_1"), var2 = list("col_2"),
    varNames = list(col_1 = "pre", col_2 = "post")
  ))
  result <- run_analysis_script("npar-wilcoxon.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- wilcox.test(b, a, paired = TRUE, exact = TRUE)$p.value
  ts <- find_table(result, "output.npar.testStatsTitle")
  # Columns: variable(1), Z(2), Asymp.Sig(3), Exact.Sig(4)
  expect_equal(cell_num(ts, 1, 4), ref, tolerance = 2e-4, "Exact Sig. == wilcox.test paired exact p")
})
