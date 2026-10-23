# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-bayes-anova-cor-reg.R — validates r-scripts/bayes-anova.R,
# bayes-correlation.R and bayes-regression.R against direct BayesFactor calls
# (anovaBF/correlationBF/lmBF + extractBF) as the independent reference, plus
# base-R cross-checks (cor(), lm() coefficients) for the posterior summaries.
#
# The BF values are deterministic (numerical integration), so they are compared
# tightly (script rounds to 4 decimals -> tolerance 1e-3). The "Posterior
# Summary" tables are MCMC-based and the scripts set no seed, so posterior
# assertions compare against a fresh reference chain with generous tolerances.

# BayesFactor is an OPTIONAL package (shared/r-packages.json), so it is absent
# on a stock install. Guarded the same way test-anova-dunnett.R guards mvtnorm/
# multcomp — before this, the bare library() call aborted the whole run and,
# because run-all.R sources files in sorted order, silently blinded the 50
# test files that sort after this one.
if (!requireNamespace("BayesFactor", quietly = TRUE)) {
  cat("  (skipped: BayesFactor not installed)
")
} else {

suppressPackageStartupMessages(library(BayesFactor))

test_that("bayes-anova: BF10/BF01/error% match anovaBF reference (default medium prior)", {
  set.seed(42)
  g <- rep(c("A", "B", "C"), each = 20)
  y <- 10 + rep(c(0, 1, 2), each = 20) + rnorm(60, sd = 2)
  df <- data.frame(col_1 = y, col_2 = g)
  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    factor = "col_2",
    factorName = "group"
  ))
  result <- run_analysis_script("bayes-anova.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- BayesFactor::extractBF(BayesFactor::anovaBF(
    y ~ g, data = data.frame(y = y, g = factor(g)),
    rscaleFixed = "medium", progress = FALSE
  ))

  bf_table <- find_table(result, "output.bayes.bfTitle")
  # row: variable label, BF10, BF01, error %
  expect_equal(bf_table$rows[[1]][[1]], "score", label = "variable label")
  expect_equal(cell_num(bf_table, 1, 2), ref$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(cell_num(bf_table, 1, 3), 1 / ref$bf[1], tolerance = 1e-3, "BF01")
  # error% is rounded to 4 decimals and near zero -> absolute check
  expect_lt(abs(cell_num(bf_table, 1, 4) - 100 * ref$error[1]), 1e-4, "error %")
  expect_equal(bf_table$footnoteKey, "output.bayes.priorFootnote:output.bayes.scaleMedium|0.5",
               label = "prior footnote (default medium)")
})

test_that("bayes-anova: rscale pass-through, NA filtering, two dependents", {
  set.seed(7)
  g <- rep(c("A", "B", "C"), each = 15)
  y1 <- 5 + rep(c(0, 0.8, 1.6), each = 15) + rnorm(45, sd = 2)
  y1[c(3, 20)] <- NA
  y2 <- rnorm(45)  # no group effect -> BF01 > 1 expected
  df <- data.frame(col_1 = y1, col_2 = y2, col_3 = g)
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "dv1", col_2 = "dv2"),
    factor = "col_3",
    factorName = "group",
    rscale = "wide"
  ))
  result <- run_analysis_script("bayes-anova.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref_bf <- function(y) {
    ok <- !is.na(y)
    BayesFactor::extractBF(BayesFactor::anovaBF(
      y ~ g, data = data.frame(y = y[ok], g = droplevels(factor(g[ok]))),
      rscaleFixed = "wide", progress = FALSE
    ))
  }
  r1 <- ref_bf(y1)
  r2 <- ref_bf(y2)

  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_true(length(bf_table$rows) == 2, "two BF rows")
  expect_equal(cell_num(bf_table, 1, 2), r1$bf[1], tolerance = 1e-3, "BF10 dv1 (NA-filtered)")
  expect_equal(cell_num(bf_table, 2, 2), r2$bf[1], tolerance = 1e-3, "BF10 dv2")
  expect_true(cell_num(bf_table, 2, 3) > 1, "BF01 > 1 for null-effect dv2")
  expect_equal(bf_table$footnoteKey, "output.bayes.priorFootnote:output.bayes.scaleWide|0.7071",
               label = "prior footnote (wide)")
})

test_that("bayes-correlation: BF and posterior summary match correlationBF reference", {
  set.seed(11)
  x <- rnorm(60)
  y <- 0.8 * x + rnorm(60, sd = 0.6)
  df <- data.frame(col_1 = x, col_2 = y)
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "height", col_2 = "weight")
  ))
  result <- run_analysis_script("bayes-correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- BayesFactor::extractBF(BayesFactor::correlationBF(y = x, x = y, rscale = "medium"))

  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(bf_table$rows[[1]][[1]], "height – weight", label = "pair label")
  expect_equal(cell_num(bf_table, 1, 2), ref$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(cell_num(bf_table, 1, 3), 1 / ref$bf[1], tolerance = 1e-3, "BF01")

  # Posterior summary is MCMC (no seed in script): compare against a fresh
  # reference chain with loose tolerances, and against the Pearson r.
  ch <- BayesFactor::posterior(
    BayesFactor::correlationBF(y = x, x = y, rscale = "medium"),
    iterations = 10000, progress = FALSE
  )
  ref_rho <- as.numeric(ch[, "rho"])
  ref_qs <- stats::quantile(ref_rho, c(0.025, 0.975))

  post_table <- find_table(result, "output.bayes.postTitle")
  # row: pair, mean, sd, ciLower95, ciUpper95
  expect_equal(cell_num(post_table, 1, 2), mean(ref_rho), tolerance = 0.05, "posterior mean rho")
  expect_equal(cell_num(post_table, 1, 2), cor(x, y), tolerance = 0.1, "posterior mean ~ Pearson r")
  expect_equal(cell_num(post_table, 1, 3), sd(ref_rho), tolerance = 0.3, "posterior sd rho")
  expect_equal(cell_num(post_table, 1, 4), unname(ref_qs[1]), tolerance = 0.1, "CI lower")
  expect_equal(cell_num(post_table, 1, 5), unname(ref_qs[2]), tolerance = 0.1, "CI upper")
})

test_that("bayes-correlation: three variables -> three pairs, pairwise NA handling", {
  set.seed(23)
  a <- rnorm(40)
  b <- 0.7 * a + rnorm(40, sd = 0.7)
  c <- rnorm(40)
  a[c(5, 12)] <- NA  # pairs involving col_1 lose 2 cases
  df <- data.frame(col_1 = a, col_2 = b, col_3 = c)
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "v1", col_2 = "v2", col_3 = "v3")
  ))
  result <- run_analysis_script("bayes-correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref_pair <- function(x, y) {
    ok <- !is.na(x) & !is.na(y)
    BayesFactor::extractBF(BayesFactor::correlationBF(y = x[ok], x = y[ok], rscale = "medium"))$bf[1]
  }

  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_true(length(bf_table$rows) == 3, "three pair rows")
  expect_equal(bf_table$rows[[1]][[1]], "v1 – v2", label = "pair 1 label")
  expect_equal(bf_table$rows[[2]][[1]], "v1 – v3", label = "pair 2 label")
  expect_equal(bf_table$rows[[3]][[1]], "v2 – v3", label = "pair 3 label")
  expect_equal(cell_num(bf_table, 1, 2), ref_pair(a, b), tolerance = 1e-3, "BF10 v1-v2")
  expect_equal(cell_num(bf_table, 2, 2), ref_pair(a, c), tolerance = 1e-3, "BF10 v1-v3")
  expect_equal(cell_num(bf_table, 3, 2), ref_pair(b, c), tolerance = 1e-3, "BF10 v2-v3")

  post_table <- find_table(result, "output.bayes.postTitle")
  expect_true(length(post_table$rows) == 3, "three posterior rows")
})

test_that("bayes-regression: BF and posterior coefficients match lmBF reference", {
  set.seed(31)
  x1 <- rnorm(80)
  x2 <- rnorm(80)
  y <- 2 + 1.5 * x1 - 0.8 * x2 + rnorm(80)
  df <- data.frame(col_1 = y, col_2 = x1, col_3 = x2)
  fixture <- write_fixture(df, list(
    dependent = "col_1",
    dependentName = "outcome",
    independents = list("col_2", "col_3"),
    varNames = list(col_1 = "outcome", col_2 = "pred1", col_3 = "pred2")
  ))
  result <- run_analysis_script("bayes-regression.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- BayesFactor::extractBF(BayesFactor::lmBF(
    y ~ x1 + x2, data = data.frame(y = y, x1 = x1, x2 = x2),
    rscaleCont = "medium", progress = FALSE
  ))

  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(bf_table$rows[[1]][[1]], "output.bayes.fullModel", label = "full-model row key")
  expect_equal(cell_num(bf_table, 1, 2), ref$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(cell_num(bf_table, 1, 3), 1 / ref$bf[1], tolerance = 1e-3, "BF01")

  # Posterior coefficient means vs fresh reference chain (MCMC, loose tol)
  # and vs OLS estimates (shrinkage is negligible at this effect size/n).
  ch <- BayesFactor::posterior(
    BayesFactor::lmBF(y ~ x1 + x2, data = data.frame(y = y, x1 = x1, x2 = x2),
                      rscaleCont = "medium", progress = FALSE),
    iterations = 10000, progress = FALSE
  )
  ols <- coef(lm(y ~ x1 + x2))

  post_table <- find_table(result, "output.bayes.postTitle")
  expect_true(length(post_table$rows) == 2, "two coefficient rows")
  expect_equal(post_table$rows[[1]][[1]], "pred1", label = "coef 1 label")
  expect_equal(post_table$rows[[2]][[1]], "pred2", label = "coef 2 label")
  expect_equal(cell_num(post_table, 1, 2), mean(as.numeric(ch[, "x1"])), tolerance = 0.05,
               "posterior mean pred1")
  expect_equal(cell_num(post_table, 2, 2), mean(as.numeric(ch[, "x2"])), tolerance = 0.05,
               "posterior mean pred2")
  expect_equal(cell_num(post_table, 1, 2), unname(ols["x1"]), tolerance = 0.2,
               "posterior mean pred1 ~ OLS")
  expect_equal(cell_num(post_table, 2, 2), unname(ols["x2"]), tolerance = 0.2,
               "posterior mean pred2 ~ OLS")
  # 95% credible intervals bracket the posterior mean
  expect_true(cell_num(post_table, 1, 4) < cell_num(post_table, 1, 2) &&
              cell_num(post_table, 1, 2) < cell_num(post_table, 1, 5),
              "pred1 CI brackets mean")
})

test_that("bayes-regression: listwise complete-case filtering and custom rscale", {
  set.seed(47)
  x1 <- rnorm(50)
  x2 <- 0.5 * x1 + rnorm(50, sd = 0.8)
  y <- 1 + x1 + rnorm(50)
  y[7] <- NA
  x2[13] <- NA
  df <- data.frame(col_1 = y, col_2 = x1, col_3 = x2)
  fixture <- write_fixture(df, list(
    dependent = "col_1",
    dependentName = "dv",
    independents = list("col_2", "col_3"),
    varNames = list(col_1 = "dv", col_2 = "p1", col_3 = "p2"),
    rscale = "ultrawide"
  ))
  result <- run_analysis_script("bayes-regression.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ok <- stats::complete.cases(data.frame(y, x1, x2))
  ref <- BayesFactor::extractBF(BayesFactor::lmBF(
    y ~ x1 + x2, data = data.frame(y = y[ok], x1 = x1[ok], x2 = x2[ok]),
    rscaleCont = "ultrawide", progress = FALSE
  ))

  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(cell_num(bf_table, 1, 2), ref$bf[1], tolerance = 1e-3,
               "BF10 (complete cases, ultrawide)")
  expect_equal(bf_table$footnoteKey, "output.bayes.priorFootnote:output.bayes.scaleUltrawide|0.7071",
               label = "prior footnote (ultrawide)")
})

}  # end BayesFactor guard
