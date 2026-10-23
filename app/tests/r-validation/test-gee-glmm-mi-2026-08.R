# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-gee-glmm-mi-2026-08.R — independent validation for the three procedures
# that no reference product settles for us.
#
# GEE is compared against SPSS 32 in tests/spss-parity and matches. GLMM and
# Multiple Imputation are not compared against anything: SPSS's GENLINMIXED was
# never run, and MI's output is a pooled estimate whose value depends on a
# stochastic imputation. That absence is not a licence to assume they are right
# — it is the reason these tests exist.
#
# The tests here deliberately avoid the trap the existing coverage falls into:
# calling the SAME package the script calls and comparing the two. That proves
# the wiring and nothing else, because a wrong argument is passed identically on
# both sides. Instead each procedure is checked against something that does not
# share its implementation:
#
#   * a mathematical identity the fit must satisfy (GEE under independence
#     reproduces GLM's coefficients exactly);
#   * recovery of parameters from data simulated with a known truth;
#   * internal consistency of the printed table (z = B/SE, Sig from z, Exp(B) =
#     exp(B), SD = sqrt(variance)), which catches a value landing in the wrong
#     column — the failure this project has hit repeatedly;
#   * for MI, the pooling formula rewritten from Rubin (1987) in the test.

col <- function(t, key) which(unlist(t$columns) == key)
cellv <- function(t, row, key) cell_num(t, row, col(t, key))
rowlab <- function(t, label) {
  for (i in seq_along(t$rows)) {
    if (any(vapply(t$rows[[i]], function(c) identical(as.character(c), label), logical(1)))) {
      return(i)
    }
  }
  NA_integer_
}

# ── GEE ─────────────────────────────────────────────────────────────────────

if (!requireNamespace("geepack", quietly = TRUE)) {
  cat("  (atlandi: geepack kurulu degil)\n")
} else {

test_that("gee: independence working correlation reproduces GLM's coefficients", {
  # Not a second call to geepack — a property of the estimator. GEE solves the
  # same estimating equation as GLM when the working correlation is the
  # identity, so the point estimates must agree to numerical precision while
  # the standard errors must NOT: GEE reports the robust sandwich SE.
  set.seed(101)
  n <- 200
  d <- data.frame(
    col_1 = rnorm(n, 10, 3),          # predictor
    col_2 = rep(1:40, each = 5)       # cluster id
  )
  d$col_3 <- 2 + 0.5 * d$col_1 + rnorm(n, 0, 2)   # dependent

  result <- run_analysis_script("gee.R", write_fixture(d, list(
    dependent = "col_3", dependentName = "y", predictors = list("col_1"),
    varNames = list(col_1 = "x"), subject = "col_2",
    family = "gaussian", corstr = "independence"
  )))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.gee.paramTitle")

  ref <- stats::glm(col_3 ~ col_1, data = d, family = gaussian())
  ref_b <- unname(stats::coef(ref))
  ref_se <- unname(summary(ref)$coefficients[, 2])

  expect_equal(cellv(t, 1, "output.col.b"), ref_b[1], tolerance = 1e-4,
               "intercept equals GLM's")
  expect_equal(cellv(t, 2, "output.col.b"), ref_b[2], tolerance = 1e-4,
               "slope equals GLM's")
  # And the SE must be the robust one, i.e. genuinely different from GLM's.
  # Without this the test would pass against an implementation that quietly
  # returned model-based standard errors.
  expect_true(abs(cellv(t, 2, "output.col.stdError") - ref_se[2]) > 1e-6,
              "the standard error is the robust one, not GLM's model-based SE")
})

test_that("gee: the printed table is internally consistent", {
  set.seed(102)
  n <- 180
  d <- data.frame(col_1 = rnorm(n), col_2 = rep(1:36, each = 5))
  d$col_3 <- rbinom(n, 1, plogis(-0.3 + 0.8 * d$col_1))

  result <- run_analysis_script("gee.R", write_fixture(d, list(
    dependent = "col_3", dependentName = "y", predictors = list("col_1"),
    varNames = list(col_1 = "x"), subject = "col_2",
    family = "binomial", corstr = "exchangeable"
  )))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.gee.paramTitle")

  for (i in 1:2) {
    b <- cellv(t, i, "output.col.b")
    se <- cellv(t, i, "output.col.stdError")
    wald <- cellv(t, i, "output.col.wald")
    sig <- cellv(t, i, "output.col.sig")
    expect_equal(wald, (b / se)^2, tolerance = 1e-2,
                 sprintf("row %d: Wald = (B/SE)^2", i))
    expect_equal(sig, stats::pchisq((b / se)^2, df = 1, lower.tail = FALSE),
                 tolerance = 1e-3, sprintf("row %d: Sig. from the Wald chi-square", i))
    expect_equal(cellv(t, i, "output.col.expB"), exp(b), tolerance = 1e-2,
                 sprintf("row %d: Exp(B) = exp(B)", i))
  }
})

test_that("gee: a known slope is recovered from clustered data", {
  # The estimator has to find a parameter that was put there on purpose. This
  # is what neither a wiring test nor an internal-consistency test can do.
  set.seed(103)
  n_clust <- 60; per <- 6
  cl <- rep(seq_len(n_clust), each = per)
  u <- rnorm(n_clust, 0, 1.5)[cl]          # cluster random effect
  x <- rnorm(n_clust * per, 0, 1)
  d <- data.frame(col_1 = x, col_2 = cl, col_3 = 1 + 2 * x + u + rnorm(length(x), 0, 1))

  result <- run_analysis_script("gee.R", write_fixture(d, list(
    dependent = "col_3", dependentName = "y", predictors = list("col_1"),
    varNames = list(col_1 = "x"), subject = "col_2",
    family = "gaussian", corstr = "exchangeable"
  )))
  t <- find_table(result, "output.gee.paramTitle")
  expect_equal(cellv(t, 2, "output.col.b"), 2, tolerance = 0.15,
               "slope recovers the simulated 2")
  expect_equal(cellv(t, 1, "output.col.b"), 1, tolerance = 0.5,
               "intercept recovers the simulated 1")
})

}

# ── GLMM ────────────────────────────────────────────────────────────────────

if (!requireNamespace("lme4", quietly = TRUE)) {
  cat("  (atlandi: lme4 kurulu degil)\n")
} else {

test_that("glmm: fixed effects recover a known simulated truth", {
  set.seed(201)
  n_sub <- 80; per <- 8
  sid <- rep(seq_len(n_sub), each = per)
  u <- rnorm(n_sub, 0, 1.2)[sid]
  x <- rnorm(n_sub * per)
  eta <- -0.5 + 1.5 * x + u
  d <- data.frame(col_1 = x, col_2 = sid, col_3 = rbinom(length(x), 1, plogis(eta)))

  result <- run_analysis_script("glmm.R", write_fixture(d, list(
    dependent = "col_3", dependentName = "y", predictors = list("col_1"),
    varNames = list(col_1 = "x"), subject = "col_2", family = "binomial"
  )))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.glmm.fixedTitle")

  expect_equal(cellv(t, 2, "output.col.b"), 1.5, tolerance = 0.3,
               "slope recovers the simulated 1.5")
  expect_equal(cellv(t, 1, "output.col.b"), -0.5, tolerance = 0.4,
               "intercept recovers the simulated -0.5")

  rt <- find_table(result, "output.glmm.randomTitle")
  v <- cell_num(rt, 1, 2)
  expect_equal(sqrt(v), cell_num(rt, 1, 3), tolerance = 1e-3,
               "random-effect SD is the square root of its variance")
  expect_equal(sqrt(v), 1.2, tolerance = 0.4,
               "random-intercept SD recovers the simulated 1.2")
})

test_that("glmm: the printed table is internally consistent", {
  set.seed(202)
  n_sub <- 60; per <- 6
  sid <- rep(seq_len(n_sub), each = per)
  x <- rnorm(n_sub * per)
  d <- data.frame(col_1 = x, col_2 = sid,
                  col_3 = rbinom(length(x), 1, plogis(0.2 + 0.9 * x + rnorm(n_sub, 0, 1)[sid])))

  result <- run_analysis_script("glmm.R", write_fixture(d, list(
    dependent = "col_3", dependentName = "y", predictors = list("col_1"),
    varNames = list(col_1 = "x"), subject = "col_2", family = "binomial"
  )))
  t <- find_table(result, "output.glmm.fixedTitle")
  for (i in 1:2) {
    b <- cellv(t, i, "output.col.b")
    se <- cellv(t, i, "output.col.stdError")
    expect_equal(cellv(t, i, "output.col.z"), b / se, tolerance = 1e-2,
                 sprintf("row %d: z = B/SE", i))
    expect_equal(cellv(t, i, "output.col.sig"), 2 * stats::pnorm(-abs(b / se)),
                 tolerance = 1e-3, sprintf("row %d: Sig. from z", i))
    expect_equal(cellv(t, i, "output.col.expB"), exp(b), tolerance = 1e-2,
                 sprintf("row %d: Exp(B) = exp(B)", i))
  }
})

test_that("glmm: with no between-subject variance the fit approaches plain GLM", {
  # A limit the model must respect: when every subject behaves alike, the
  # random intercept carries nothing and the fixed effects should land on the
  # GLM estimates. glmer is not being compared to itself here — glm is a
  # different estimator that happens to agree in this corner.
  set.seed(203)
  n <- 300
  d <- data.frame(col_1 = rnorm(n), col_2 = rep(1:50, each = 6))
  d$col_3 <- rbinom(n, 1, plogis(0.4 + 1.1 * d$col_1))   # no subject effect

  result <- run_analysis_script("glmm.R", write_fixture(d, list(
    dependent = "col_3", dependentName = "y", predictors = list("col_1"),
    varNames = list(col_1 = "x"), subject = "col_2", family = "binomial"
  )))
  t <- find_table(result, "output.glmm.fixedTitle")
  ref <- stats::glm(col_3 ~ col_1, data = d, family = binomial())
  expect_equal(cellv(t, 2, "output.col.b"), unname(stats::coef(ref))[2], tolerance = 0.05,
               "slope matches GLM when the random variance vanishes")
})

}

# ── Multiple Imputation ─────────────────────────────────────────────────────

if (!requireNamespace("mice", quietly = TRUE)) {
  cat("  (atlandi: mice kurulu degil)\n")
} else {

test_that("mi: the pooled estimate follows Rubin's rules", {
  # mice does the imputing and its correctness is mice's business. The pooling
  # is OURS: q-bar, U-bar, B, T = U-bar + (1 + 1/m)B. Rewritten here from the
  # definition and compared, with the same seed so both sides see the same
  # imputations.
  set.seed(301)
  n <- 120
  x <- rnorm(n, 50, 10); y <- 2 * x + rnorm(n, 0, 5)
  x[sample(n, 18)] <- NA
  d <- data.frame(col_1 = x, col_2 = y)
  m <- 5; seed <- 4242

  result <- run_analysis_script("mi.R", write_fixture(d, list(
    variables = list("col_1", "col_2"), varNames = list(col_1 = "x", col_2 = "y"),
    m = m, seed = seed
  )))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.mi.pooledTitle")

  ref <- data.frame(v1 = d$col_1, v2 = d$col_2)
  imp <- mice::mice(ref, m = m, seed = seed, printFlag = FALSE)
  qi <- ui <- numeric(m)
  for (i in seq_len(m)) {
    ci <- mice::complete(imp, i)[["v1"]]
    qi[i] <- mean(ci); ui[i] <- stats::var(ci) / length(ci)
  }
  qbar <- mean(qi); ubar <- mean(ui); b <- stats::var(qi)
  tt <- ubar + (1 + 1 / m) * b
  se <- sqrt(tt)
  nu <- (m - 1) * (1 + ubar / ((1 + 1 / m) * b))^2

  expect_equal(cellv(t, 1, "output.col.mean"), qbar, tolerance = 1e-3,
               "pooled mean is the mean of the m estimates")
  expect_equal(cellv(t, 1, "output.col.stdError"), se, tolerance = 1e-3,
               "pooled SE is sqrt(U-bar + (1 + 1/m)B)")
  expect_equal(cellv(t, 1, "output.col.df"), nu, tolerance = 1e-2,
               "degrees of freedom follow Rubin (1987)")
})

test_that("mi: the interval uses Rubin's t, not the normal quantile", {
  # The defect this test was written for. A flat 1.96 is invisible when little
  # information is missing and 8% too narrow at 50% — precisely where multiple
  # imputation is being used. The fixture is built with heavy missingness so the
  # two quantiles are far apart and the assertion can tell them apart.
  set.seed(302)
  n <- 90
  x <- rnorm(n, 20, 6)
  x[sample(n, 40)] <- NA               # ~44% missing
  d <- data.frame(col_1 = x, col_2 = rnorm(n, 5, 1))

  result <- run_analysis_script("mi.R", write_fixture(d, list(
    variables = list("col_1", "col_2"), varNames = list(col_1 = "x", col_2 = "y"),
    m = 5, seed = 77
  )))
  t <- find_table(result, "output.mi.pooledTitle")

  qbar <- cellv(t, 1, "output.col.mean")
  se <- cellv(t, 1, "output.col.stdError")
  nu <- cellv(t, 1, "output.col.df")
  lo <- cellv(t, 1, "output.col.ciLower95")
  hi <- cellv(t, 1, "output.col.ciUpper95")
  tcrit <- stats::qt(0.975, df = nu)

  expect_equal(hi - qbar, tcrit * se, tolerance = 1e-3, "upper limit uses t(nu)")
  expect_equal(qbar - lo, tcrit * se, tolerance = 1e-3, "lower limit uses t(nu)")
  # And t must be meaningfully wider than z here, or the assertion above would
  # pass against the old 1.96 as well.
  expect_true(tcrit > 1.96 * 1.01,
              sprintf("the fixture separates t from z (t = %.3f, df = %.1f)", tcrit, nu))
})

test_that("mi: more imputations, and the missing count, are reported honestly", {
  set.seed(303)
  n <- 100
  x <- rnorm(n); x[sample(n, 25)] <- NA
  d <- data.frame(col_1 = x, col_2 = rnorm(n))

  result <- run_analysis_script("mi.R", write_fixture(d, list(
    variables = list("col_1", "col_2"), varNames = list(col_1 = "x", col_2 = "y"),
    m = 7, seed = 9
  )))
  spec <- find_table(result, "output.mi.specTitle")
  expect_equal(cell_num(spec, 1, 2), 25, tolerance = 1e-9,
               "the missing count is the real one")
  expect_equal(cell_num(spec, 2, 2), 0, tolerance = 1e-9,
               "a complete variable reports zero missing")
  expect_true(grepl("7", spec$footnoteKey), "the footnote states m = 7")
})

}
