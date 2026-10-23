# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-mixed-models.R — validates r-scripts/mixed-models.R against
# lme4::lmer (an independent REML implementation of the same random-intercept
# model; the production script uses nlme::lme).
#
# Note: the script's only package guard is requireNamespace("nlme"); it does
# NOT use lme4/pbkrtest/lmerTest/emmeans, so the absence of lmerTest/emmeans
# is irrelevant to it. nlme is a base recommended package and always present.

# ── Shared data generator ──────────────────────────────────────────────────
# 25 subjects x 8 observations, two numeric predictors, a real random
# intercept (sd 1.5) and residual sd 2. A few NAs are injected to exercise
# the script's complete.cases() path; the reference applies the same filter.
.make_mixed_data <- function() {
  set.seed(123)
  n_subj <- 25; n_obs <- 8
  subj <- rep(paste0("S", 1:n_subj), each = n_obs)
  re   <- rep(rnorm(n_subj, 0, 1.5), each = n_obs)
  x1   <- rnorm(n_subj * n_obs, 5, 2)
  x2   <- rnorm(n_subj * n_obs, 0, 1)
  y    <- 10 + 2.5 * x1 - 1.8 * x2 + re + rnorm(n_subj * n_obs, 0, 2)
  df <- data.frame(col_y = y, col_s = subj, col_x1 = x1, col_x2 = x2,
                   stringsAsFactors = FALSE)
  df$col_y[c(3, 57)] <- NA        # dependent missing
  df$col_x1[100] <- NA            # predictor missing
  df
}

.mixed_params <- list(
  dependent = "col_y", dependentName = "outcome",
  predictors = list("col_x1", "col_x2"),
  subject = "col_s",
  varNames = list(col_x1 = "dose", col_x2 = "time")
)

# lme4 is an OPTIONAL package (shared/r-packages.json): absent on a stock
# install, where the reference fit below simply cannot be computed. Reported
# as a skip rather than four product failures, the same way
# test-anova-dunnett.R treats mvtnorm/multcomp.
.has_lme4 <- requireNamespace("lme4", quietly = TRUE)

# Independent reference: lme4::lmer REML fit on the complete-case data.
.mixed_reference <- function(df) {
  suppressPackageStartupMessages(library(lme4))
  cc <- df[stats::complete.cases(df), ]
  fit <- lmer(col_y ~ col_x1 + col_x2 + (1 | col_s), data = cc, REML = TRUE)
  list(
    fit = fit,
    n = nrow(cc),
    m2ll = -2 * as.numeric(logLik(fit)),
    b = unname(fixef(fit)),
    se = unname(sqrt(diag(vcov(fit)))),
    vc = as.data.frame(VarCorr(fit))  # rows: grp=col_s (intercept), then Residual
  )
}

test_that("mixed model: information criteria match lmer REML reference", {
  if (!.has_lme4) { cat("  (skipped: lme4 not installed)\n"); return(invisible(NULL)) }
  df <- .make_mixed_data()
  fixture <- write_fixture(df, .mixed_params)
  result <- run_analysis_script("mixed-models.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- .mixed_reference(df)
  fit_table <- find_table(result, "output.mixed.fitTitle")
  # rows (SPSS order): -2 Restricted Log Likelihood, AIC, AICC, CAIC, BIC
  expect_equal(cell_num(fit_table, 1, 2), ref$m2ll, tolerance = 1e-3, "-2 restricted logLik")
  # SPSS Statistics Algorithms (MIXED, "Information Criteria"): under REML,
  # n = cases - fixed-effect parameters and d = covariance parameters only.
  # Here 3 fixed effects and 2 covariance parameters, so d = 2, n = N - 3.
  # (2026-10: these used lme4's ML-style counting, d = 5 and n = N, which is
  # not what SPSS prints for a REML fit.)
  expect_equal(cell_num(fit_table, 2, 2), ref$m2ll + 2 * 2, tolerance = 1e-3, "AIC")
  bic_row <- which(vapply(fit_table$rows, function(r) identical(r[[1]], "output.col.bic"), logical(1)))
  expect_equal(cell_num(fit_table, bic_row, 2), ref$m2ll + 2 * log(ref$n - 3),
               tolerance = 1e-3, "BIC (SPSS REML convention)")
  expect_true(grepl("outcome", fit_table$footnoteKey), "fit table footnote names dependent")
})

test_that("mixed model: fixed effects match lmer reference", {
  if (!.has_lme4) { cat("  (skipped: lme4 not installed)\n"); return(invisible(NULL)) }
  df <- .make_mixed_data()
  fixture <- write_fixture(df, .mixed_params)
  result <- run_analysis_script("mixed-models.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- .mixed_reference(df)
  fe_table <- find_table(result, "output.mixed.fixedTitle")
  # rows: (Intercept), dose, time — cols: model, B, SE, df, t, Sig, ciLo, ciHi
  expect_equal(length(fe_table$rows), 3, label = "fixed-effects row count")
  expect_equal(cell_num(fe_table, 1, 2), ref$b[1], tolerance = 1e-4, "B intercept")
  expect_equal(cell_num(fe_table, 2, 2), ref$b[2], tolerance = 1e-4, "B dose")
  expect_equal(cell_num(fe_table, 3, 2), ref$b[3], tolerance = 1e-4, "B time")
  expect_equal(cell_num(fe_table, 1, 3), ref$se[1], tolerance = 1e-4, "SE intercept")
  expect_equal(cell_num(fe_table, 2, 3), ref$se[2], tolerance = 1e-4, "SE dose")
  expect_equal(cell_num(fe_table, 3, 3), ref$se[3], tolerance = 1e-4, "SE time")

  # t, Sig. and 95% CI are deterministic transforms of B/SE/df — verify the
  # arithmetic with base R (t and CI in the table are rounded to 3/6 dp).
  for (i in 1:3) {
    dfr <- cell_num(fe_table, i, 4)
    t_ref <- ref$b[i] / ref$se[i]
    expect_equal(cell_num(fe_table, i, 5), t_ref, tolerance = 1e-3,
                 sprintf("t row %d", i))
    expect_equal(cell_num(fe_table, i, 6), 2 * pt(-abs(t_ref), dfr), tolerance = 1e-3,
                 sprintf("p row %d", i))
    tcrit <- qt(0.975, dfr)
    expect_equal(cell_num(fe_table, i, 7), ref$b[i] - tcrit * ref$se[i], tolerance = 1e-4,
                 sprintf("CI lo row %d", i))
    expect_equal(cell_num(fe_table, i, 8), ref$b[i] + tcrit * ref$se[i], tolerance = 1e-4,
                 sprintf("CI hi row %d", i))
  }
})

test_that("mixed model: covariance parameters match lmer VarCorr", {
  if (!.has_lme4) { cat("  (skipped: lme4 not installed)\n"); return(invisible(NULL)) }
  df <- .make_mixed_data()
  fixture <- write_fixture(df, .mixed_params)
  result <- run_analysis_script("mixed-models.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- .mixed_reference(df)
  resid_var <- ref$vc$vcov[ref$vc$grp == "Residual"]
  int_var   <- ref$vc$vcov[ref$vc$grp == "col_s"]

  cov_table <- find_table(result, "output.mixed.covTitle")
  # row 1 = Residual (variance, stdDev); row 2 = random-intercept variance
  expect_equal(cell_num(cov_table, 1, 2), resid_var, tolerance = 1e-3, "residual variance")
  expect_equal(cell_num(cov_table, 1, 3), sqrt(resid_var), tolerance = 1e-3, "residual SD")
  expect_equal(cell_num(cov_table, 2, 2), int_var, tolerance = 1e-3, "intercept variance")
  expect_equal(cell_num(cov_table, 2, 3), sqrt(int_var), tolerance = 1e-3, "intercept SD")
})

test_that("mixed model: single-predictor model also matches lmer", {
  if (!.has_lme4) { cat("  (skipped: lme4 not installed)\n"); return(invisible(NULL)) }
  df <- .make_mixed_data()
  params <- list(
    dependent = "col_y", dependentName = "outcome",
    predictors = list("col_x1"), subject = "col_s",
    varNames = list(col_x1 = "dose")
  )
  fixture <- write_fixture(df, params)
  result <- run_analysis_script("mixed-models.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  suppressPackageStartupMessages(library(lme4))
  cc <- df[stats::complete.cases(df), ]
  fit <- lmer(col_y ~ col_x1 + (1 | col_s), data = cc, REML = TRUE)
  fe_table <- find_table(result, "output.mixed.fixedTitle")
  expect_equal(length(fe_table$rows), 2, label = "fixed-effects row count (1 predictor)")
  expect_equal(cell_num(fe_table, 1, 2), unname(fixef(fit)[1]), tolerance = 1e-4, "B intercept")
  expect_equal(cell_num(fe_table, 2, 2), unname(fixef(fit)[2]), tolerance = 1e-4, "B dose")
  fit_table <- find_table(result, "output.mixed.fitTitle")
  expect_equal(cell_num(fit_table, 1, 2), -2 * as.numeric(logLik(fit)), tolerance = 1e-3, "-2ll")
})

test_that("mixed model: error on subject factor with a single group", {
  df <- .make_mixed_data()
  df$col_s <- "only-one-group"
  fixture <- write_fixture(df, .mixed_params)
  result <- run_analysis_script("mixed-models.R", fixture)
  expect_true(!isTRUE(result$success), "result$success is FALSE")
  expect_true(grepl("at least 2 groups", result$error), "error message")
})

test_that("mixed model: error on unknown dependent variable", {
  df <- .make_mixed_data()
  params <- .mixed_params
  params$dependent <- "col_nonexistent"
  fixture <- write_fixture(df, params)
  result <- run_analysis_script("mixed-models.R", fixture)
  expect_true(!isTRUE(result$success), "result$success is FALSE")
  expect_true(grepl("Dependent variable not found", result$error), "error message")
})
