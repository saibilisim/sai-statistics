# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-glmm-genlin.R — validates r-scripts/glmm.R and r-scripts/genlin.R.
#
# lme4 and MASS are installed in this environment, so both scripts take the
# compute path (the needsPackage guards in glmm.R / genlin.R only fire when
# lme4 / MASS are absent — not testable here). References are independent
# fits: lme4::glmer() called directly for glmm.R, and stats::glm() /
# MASS::glm.nb() for genlin.R, each on the same complete-case data.

# Packages live in ~/R/library here (same location run_analysis_script exposes
# to spawned scripts via R_LIBS and _bootstrap.R adds via .libPaths); the test
# session itself needs it on the path too for the reference fits.
local({
  user_lib <- file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = "."))
  if (dir.exists(user_lib) && !(user_lib %in% .libPaths())) {
    .libPaths(c(user_lib, .libPaths()))
  }
})
# lme4 is an OPTIONAL package (shared/r-packages.json), absent on a stock
# install. Guarded like test-anova-dunnett.R guards mvtnorm/multcomp: before
# this, the bare library(lme4) aborted the file, which run-all.R then reported
# as a load failure rather than a skip.
if (!requireNamespace("lme4", quietly = TRUE)) {
  cat("  (skipped: lme4 not installed)\n")
} else {

suppressPackageStartupMessages({
  library(lme4)
  library(MASS)
})

# The script rounds p-values to 6 decimals, so relative-tolerance comparison
# breaks down near the rounding grid (and any p < 5e-7 is emitted as 0).
# Rounding to 6 decimals means an absolute error of at most 5e-7 — compare
# with a small absolute margin instead.
expect_p <- function(actual, ref, label) {
  expect_true(is.finite(actual) && abs(actual - ref) < 1e-6,
              sprintf("%s (actual=%s, ref=%s)", label, actual, ref))
}

# Rebuild the script's complete-case analysis frame (numeric coercion +
# factor grouping) so the reference fit sees exactly the same data.
prep_glmm_data <- function(df, dep, preds, subj) {
  dat <- data.frame(.y = as.numeric(df[[dep]]), .g = factor(df[[subj]]))
  for (i in seq_along(preds)) dat[[paste0("x", i)]] <- as.numeric(df[[preds[i]]])
  dat[stats::complete.cases(dat), , drop = FALSE]
}

# glmm.R fixed-effects table rows: label, B, SE, z, Sig., Exp(B) — check a row
# against the matching summary(fit)$coefficients row.
expect_glmm_fe_row <- function(table, row, co, i) {
  expect_equal(cell_num(table, row, 2), co[i, 1], tolerance = 1e-5, label = sprintf("B row %d", row))
  expect_equal(cell_num(table, row, 3), co[i, 2], tolerance = 1e-5, label = sprintf("SE row %d", row))
  expect_equal(cell_num(table, row, 4), co[i, 3], tolerance = 2e-3, label = sprintf("z row %d", row))
  expect_p(cell_num(table, row, 5), co[i, 4], sprintf("Sig row %d", row))
  expect_equal(cell_num(table, row, 6), exp(co[i, 1]), tolerance = 1e-3,
               label = sprintf("Exp(B) row %d", row))
}

# glmm.R fit table rows: AIC, BIC, -2 Log Likelihood, Deviance.
expect_glmm_fit <- function(table, ref_fit) {
  expect_equal(cell_num(table, 1, 2), AIC(ref_fit), tolerance = 1e-3, label = "AIC")
  expect_equal(cell_num(table, 2, 2), BIC(ref_fit), tolerance = 1e-3, label = "BIC")
  expect_equal(cell_num(table, 3, 2), -2 * as.numeric(logLik(ref_fit)), tolerance = 1e-3,
               label = "-2 Log Likelihood")
  expect_equal(cell_num(table, 4, 2), deviance(ref_fit), tolerance = 1e-3, label = "Deviance")
}

test_that("glmm binomial matches direct lme4::glmer reference", {
  set.seed(123)
  n <- 240
  g <- rep(1:12, each = 20)
  x1 <- rnorm(n)
  x2 <- rnorm(n)
  re <- rnorm(12, sd = 0.8)[g]
  y <- rbinom(n, 1, plogis(-0.4 + 0.7 * x1 - 0.5 * x2 + re))
  df <- data.frame(col_1 = y, col_2 = x1, col_3 = x2, col_4 = paste0("s", g))

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "outcome",
    predictors = list("col_2", "col_3"),
    varNames = list(col_2 = "age", col_3 = "dose"),
    subject = "col_4", family = "binomial"
  ))
  result <- run_analysis_script("glmm.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- prep_glmm_data(df, "col_1", c("col_2", "col_3"), "col_4")
  ref <- lme4::glmer(.y ~ x1 + x2 + (1 | .g), data = dat, family = binomial(link = "logit"))
  co <- summary(ref)$coefficients

  expect_glmm_fit(find_table(result, "output.glmm.fitTitle"), ref)
  fe <- find_table(result, "output.glmm.fixedTitle")
  expect_glmm_fe_row(fe, 1, co, 1) # constant
  expect_glmm_fe_row(fe, 2, co, 2) # age
  expect_glmm_fe_row(fe, 3, co, 3) # dose

  rand <- find_table(result, "output.glmm.randomTitle")
  ref_iv <- unname(as.matrix(VarCorr(ref)$.g)[1, 1])
  expect_equal(cell_num(rand, 1, 2), ref_iv, tolerance = 1e-5, label = "intercept variance")
  expect_equal(cell_num(rand, 1, 3), sqrt(ref_iv), tolerance = 1e-5, label = "intercept SD")
})

test_that("glmm poisson matches direct lme4::glmer reference", {
  set.seed(456)
  n <- 200
  g <- rep(1:10, each = 20)
  x1 <- rnorm(n)
  re <- rnorm(10, sd = 0.5)[g]
  y <- rpois(n, exp(0.8 + 0.4 * x1 + re))
  df <- data.frame(col_1 = y, col_2 = x1, col_4 = paste0("s", g))

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "count",
    predictors = list("col_2"),
    varNames = list(col_2 = "exposure"),
    subject = "col_4", family = "poisson"
  ))
  result <- run_analysis_script("glmm.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- prep_glmm_data(df, "col_1", c("col_2"), "col_4")
  ref <- lme4::glmer(.y ~ x1 + (1 | .g), data = dat, family = poisson(link = "log"))
  co <- summary(ref)$coefficients

  expect_glmm_fit(find_table(result, "output.glmm.fitTitle"), ref)
  fe <- find_table(result, "output.glmm.fixedTitle")
  expect_glmm_fe_row(fe, 1, co, 1)
  expect_glmm_fe_row(fe, 2, co, 2)

  rand <- find_table(result, "output.glmm.randomTitle")
  ref_iv <- unname(as.matrix(VarCorr(ref)$.g)[1, 1])
  expect_equal(cell_num(rand, 1, 2), ref_iv, tolerance = 1e-5, label = "intercept variance")
})

# genlin.R checks, shared across distributions: gof table rows are
# Deviance / Pearson Chi-Square / Log Likelihood / AIC / BIC (value col 2,
# df col 3); omnibus row is LR Chi-Square, df, Sig.; parameter rows are
# label, B, SE, Wald, df, Sig., Exp(B), CI lower, CI upper.
expect_genlin_common <- function(result, ref_fit, ref_null, n_preds) {
  gof <- find_table(result, "output.genlin.gofTitle")
  expect_equal(cell_num(gof, 1, 2), ref_fit$deviance, tolerance = 1e-3, label = "deviance")
  expect_equal(cell_num(gof, 1, 3), ref_fit$df.residual, tolerance = 1e-6, label = "deviance df")
  expect_equal(cell_num(gof, 2, 2), sum(residuals(ref_fit, "pearson")^2), tolerance = 1e-3,
               label = "pearson chi-square")
  expect_equal(cell_num(gof, 3, 2), as.numeric(logLik(ref_fit)), tolerance = 1e-3, label = "logLik")
  expect_equal(cell_num(gof, 4, 2), AIC(ref_fit), tolerance = 1e-3, label = "AIC")
  expect_equal(cell_num(gof, 5, 2), BIC(ref_fit), tolerance = 1e-3, label = "BIC")

  omni <- find_table(result, "output.genlin.omniTitle")
  lrchi <- ref_null$deviance - ref_fit$deviance
  expect_equal(cell_num(omni, 1, 1), lrchi, tolerance = 1e-3, label = "LR chi-square")
  expect_equal(cell_num(omni, 1, 2), n_preds, tolerance = 1e-6, label = "omnibus df")
  expect_p(cell_num(omni, 1, 3), pchisq(lrchi, n_preds, lower.tail = FALSE), "omnibus sig")

  co <- summary(ref_fit)$coefficients
  pe <- find_table(result, "output.genlin.paramTitle")
  for (i in seq_len(nrow(co))) {
    b <- co[i, 1]; se <- co[i, 2]
    expect_equal(cell_num(pe, i, 2), b, tolerance = 1e-5, label = sprintf("B row %d", i))
    expect_equal(cell_num(pe, i, 3), se, tolerance = 1e-5, label = sprintf("SE row %d", i))
    expect_equal(cell_num(pe, i, 4), (b / se)^2, tolerance = 1e-3, label = sprintf("Wald row %d", i))
    expect_p(cell_num(pe, i, 6), pchisq((b / se)^2, 1, lower.tail = FALSE), sprintf("Sig row %d", i))
    expect_equal(cell_num(pe, i, 7), exp(b), tolerance = 1e-3, label = sprintf("Exp(B) row %d", i))
    expect_equal(cell_num(pe, i, 8), exp(b - 1.96 * se), tolerance = 1e-3,
                 label = sprintf("CI lower row %d", i))
    expect_equal(cell_num(pe, i, 9), exp(b + 1.96 * se), tolerance = 1e-3,
                 label = sprintf("CI upper row %d", i))
  }
}

test_that("genlin poisson matches direct glm reference", {
  set.seed(789)
  n <- 150
  x1 <- rnorm(n)
  x2 <- rnorm(n)
  y <- rpois(n, exp(1 + 0.5 * x1 - 0.3 * x2))
  df <- data.frame(col_1 = y, col_2 = x1, col_3 = x2)

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "count",
    predictors = list("col_2", "col_3"),
    varNames = list(col_2 = "x1", col_3 = "x2"),
    distribution = "poisson"
  ))
  result <- run_analysis_script("genlin.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- data.frame(.y = y, x1 = x1, x2 = x2)
  ref_fit <- glm(.y ~ x1 + x2, data = dat, family = poisson(link = "log"))
  ref_null <- glm(.y ~ 1, data = dat, family = poisson(link = "log"))
  expect_genlin_common(result, ref_fit, ref_null, 2)
})

test_that("genlin negbin matches direct MASS::glm.nb reference", {
  set.seed(321)
  n <- 150
  x1 <- rnorm(n)
  x2 <- rnorm(n)
  y <- rnbinom(n, size = 1.5, mu = exp(0.8 + 0.4 * x1 - 0.2 * x2))
  df <- data.frame(col_1 = y, col_2 = x1, col_3 = x2)

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "count",
    predictors = list("col_2", "col_3"),
    varNames = list(col_2 = "x1", col_3 = "x2"),
    distribution = "negbin"
  ))
  result <- run_analysis_script("genlin.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- data.frame(.y = y, x1 = x1, x2 = x2)
  ref_fit <- MASS::glm.nb(.y ~ x1 + x2, data = dat)
  ref_null <- MASS::glm.nb(.y ~ 1, data = dat)
  expect_genlin_common(result, ref_fit, ref_null, 2)
})

test_that("genlin gamma matches direct glm reference", {
  set.seed(654)
  n <- 120
  x1 <- rnorm(n)
  x2 <- rnorm(n)
  mu <- exp(0.7 + 0.4 * x1 - 0.2 * x2)
  y <- rgamma(n, shape = 3, rate = 3 / mu)
  df <- data.frame(col_1 = y, col_2 = x1, col_3 = x2)

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "cost",
    predictors = list("col_2", "col_3"),
    varNames = list(col_2 = "x1", col_3 = "x2"),
    distribution = "gamma"
  ))
  result <- run_analysis_script("genlin.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- data.frame(.y = y, x1 = x1, x2 = x2)
  ref_fit <- glm(.y ~ x1 + x2, data = dat, family = Gamma(link = "log"))
  ref_null <- glm(.y ~ 1, data = dat, family = Gamma(link = "log"))
  expect_genlin_common(result, ref_fit, ref_null, 2)
})

}  # end lme4 guard
