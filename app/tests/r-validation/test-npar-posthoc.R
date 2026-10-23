# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-posthoc.R — validates K-sample nonparametric pairwise post-hoc
# (Dunn-Bonferroni, see spss-parity-analysis.md §3.7) and the Lilliefors
# caveat warning in npar-ks.R.

test_that("kruskal-wallis: pairwise table appears only when requested, k>2", {
  set.seed(21)
  df <- data.frame(
    score = c(rnorm(15, 5), rnorm(15, 7), rnorm(15, 5.5)),
    grp = factor(rep(c("A", "B", "C"), each = 15))
  )
  fixture_off <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group"
  ))
  result_off <- run_analysis_script("npar-kruskal-wallis.R", fixture_off)
  expect_true(isTRUE(result_off$success), "off: result$success")
  has_pw_off <- any(vapply(result_off$tables, function(t) startsWith(t$titleKey, "output.npar.pairwiseTitle"), logical(1)))
  expect_true(!has_pw_off, "no pairwise table by default")

  fixture_on <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    factor = "grp", factorName = "Group",
    options = list(pairwise = TRUE)
  ))
  result_on <- run_analysis_script("npar-kruskal-wallis.R", fixture_on)
  expect_true(isTRUE(result_on$success), "on: result$success")
  pw_table <- find_table(result_on, "output.npar.pairwiseTitle")
  expect_true(length(pw_table$rows) == 3, "3 pairwise comparisons for 3 groups")

  # Cross-check one pair's z manually against the Dunn formula.
  x <- df$score; g <- df$grp
  r <- rank(x); N <- length(x)
  ni <- tapply(r, g, length); mean_r <- tapply(r, g, mean)
  se_ab <- sqrt((N * (N + 1) / 12) * (1 / ni["A"] + 1 / ni["B"]))
  z_ab <- unname((mean_r["A"] - mean_r["B"]) / se_ab)
  expect_equal(cell_num(pw_table, 1, 4), z_ab, tolerance = 1e-4, "A-B z statistic matches Dunn formula")
})

test_that("friedman: pairwise table appears only when requested, k>2", {
  set.seed(22)
  n <- 20
  df <- data.frame(t1 = rnorm(n), t2 = rnorm(n, 0.5), t3 = rnorm(n, 1))
  fixture_off <- write_fixture(df, list(
    variables = list("t1", "t2", "t3"),
    varNames = list(t1 = "T1", t2 = "T2", t3 = "T3")
  ))
  result_off <- run_analysis_script("npar-friedman.R", fixture_off)
  expect_true(isTRUE(result_off$success), "off: result$success")
  has_pw_off <- any(vapply(result_off$tables, function(t) startsWith(t$titleKey, "output.npar.pairwiseTitle"), logical(1)))
  expect_true(!has_pw_off, "no pairwise table by default")

  fixture_on <- write_fixture(df, list(
    variables = list("t1", "t2", "t3"),
    varNames = list(t1 = "T1", t2 = "T2", t3 = "T3"),
    options = list(pairwise = TRUE)
  ))
  result_on <- run_analysis_script("npar-friedman.R", fixture_on)
  expect_true(isTRUE(result_on$success), "on: result$success")
  pw_table <- find_table(result_on, "output.npar.pairwiseTitle")
  expect_true(length(pw_table$rows) == 3, "3 pairwise comparisons for 3 conditions")
})

test_that("one-sample K-S: Lilliefors correction for normal, absent otherwise", {
  set.seed(23)
  df <- data.frame(x = rnorm(50, 10, 2))
  fixture_normal <- write_fixture(df, list(
    variables = list("x"), varNames = list(x = "X"), dist = "normal"
  ))
  result_normal <- run_analysis_script("npar-ks.R", fixture_normal)
  expect_true(isTRUE(result_normal$success), "normal: result$success")
  # The correction is now a COLUMN (this is the significance SPSS itself
  # prints); the warning is only the fallback for a missing `nortest`.
  ks_tab <- find_table(result_normal, "output.nparKS.title")
  has_col <- "output.col.lillieforsSig" %in% unlist(ks_tab$columns)
  has_warn <- "output.nparKS.lillieforsWarning" %in% unlist(result_normal$warnings)
  expect_true(has_col || has_warn, "dist=normal: Lilliefors column, or the warning if nortest is absent")
  if (has_col) {
    expect_equal(
      as.numeric(ks_tab$rows[[1]][[10]]),
      nortest::lillie.test(df$x)$p.value,
      tolerance = 1e-5,
      label = "Lilliefors sig. matches nortest::lillie.test"
    )
  }

  df2 <- data.frame(x = runif(50, 0, 10))
  fixture_unif <- write_fixture(df2, list(
    variables = list("x"), varNames = list(x = "X"), dist = "uniform"
  ))
  result_unif <- run_analysis_script("npar-ks.R", fixture_unif)
  expect_true(isTRUE(result_unif$success), "uniform: result$success")
  expect_true(
    !("output.nparKS.lillieforsWarning" %in% unlist(result_unif$warnings)),
    "no Lilliefors warning for dist=uniform"
  )
})
