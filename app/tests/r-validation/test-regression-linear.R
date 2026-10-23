# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-regression-linear.R — validates r-scripts/regression-linear.R against
# R's own lm() (independent implementation) using mtcars mpg ~ wt + hp, a
# widely published textbook regression (R² ≈ 0.8268).

test_that("linear regression matches lm() reference (mtcars mpg ~ wt + hp)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp)

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3"),
    varNames = list(col_2 = "wt", col_3 = "hp")
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- lm(mpg ~ wt + hp, data = mtcars)
  sm <- summary(ref)

  ms <- find_table(result, "output.regression.modelSummaryTitle")
  expect_equal(cell_num(ms, 1, 2), sm$r.squared, tolerance = 1e-4, "R-squared")
  expect_equal(cell_num(ms, 1, 3), sm$adj.r.squared, tolerance = 1e-4, "Adj R-squared")
  expect_equal(cell_num(ms, 1, 4), sm$sigma, tolerance = 1e-4, "Std. Error of Estimate")

  anova <- find_table(result, "output.regression.anovaTitle")
  fstat <- unname(sm$fstatistic["value"])
  dfb <- unname(sm$fstatistic["numdf"])
  dfw <- unname(sm$fstatistic["dendf"])
  ref_p <- pf(fstat, dfb, dfw, lower.tail = FALSE)
  expect_equal(cell_num(anova, 1, 5), fstat, tolerance = 1e-3, "F statistic")
  expect_equal(cell_num(anova, 1, 6), ref_p, tolerance = 1e-4, "regression p-value")

  coeff <- find_table(result, "output.regression.coeffTitle")
  co <- sm$coefficients
  # Row 1 = constant/intercept: [label, B, SE, beta, t, sig]
  expect_equal(cell_num(coeff, 1, 2), co["(Intercept)", "Estimate"], tolerance = 1e-4, "intercept B")
  expect_equal(cell_num(coeff, 1, 3), co["(Intercept)", "Std. Error"], tolerance = 1e-4, "intercept SE")
  # Row 2 = wt: [label, B, SE, beta, t, sig]
  expect_equal(cell_num(coeff, 2, 2), co["wt", "Estimate"], tolerance = 1e-4, "wt B")
  expect_equal(cell_num(coeff, 2, 5), co["wt", "t value"], tolerance = 1e-3, "wt t")
  expect_equal(cell_num(coeff, 2, 6), co["wt", "Pr(>|t|)"], tolerance = 1e-4, "wt p")
  # Row 3 = hp
  expect_equal(cell_num(coeff, 3, 2), co["hp", "Estimate"], tolerance = 1e-4, "hp B")
  # Script rounds to 6 decimals before serialising — compare within that
  # rounding rather than full double precision.
  expect_equal(cell_num(coeff, 3, 6), co["hp", "Pr(>|t|)"], tolerance = 5e-4, "hp p")

  # Published reference value for this exact well-known dataset/model.
  expect_equal(round(sm$r.squared, 4), 0.8268, tolerance = 1e-3, "published R²=0.8268")
})

test_that("linear regression Statistics extensions match independent references (mtcars mpg ~ wt + hp)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp)

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3"),
    varNames = list(col_2 = "wt", col_3 = "hp"),
    options = list(
      confidenceIntervals = TRUE, ciLevel = 95,
      covarianceMatrix = TRUE,
      rSquaredChange = TRUE,
      descriptives = TRUE,
      partialCorrelations = TRUE,
      casewiseDiagnostics = TRUE, casewiseOutliersOnly = TRUE, casewiseSD = 1
    )
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- lm(mpg ~ wt + hp, data = mtcars)
  sm  <- summary(ref)
  ci  <- confint(ref, level = 0.95)

  # Coefficients table columns (after Sig.): CI Lower, CI Upper, Zero-order,
  # Partial, Part — in that order (want_ci then want_partial).
  coeff <- find_table(result, "output.regression.coeffTitle")
  expect_equal(cell_num(coeff, 2, 7), ci["wt", 1], tolerance = 1e-4, "wt CI lower")
  expect_equal(cell_num(coeff, 2, 8), ci["wt", 2], tolerance = 1e-4, "wt CI upper")
  expect_equal(cell_num(coeff, 3, 7), ci["hp", 1], tolerance = 1e-4, "hp CI lower")
  expect_equal(cell_num(coeff, 3, 8), ci["hp", 2], tolerance = 1e-4, "hp CI upper")

  zero_wt <- cor(mtcars$mpg, mtcars$wt)
  expect_equal(cell_num(coeff, 2, 9), zero_wt, tolerance = 1e-4, "wt zero-order correlation")
  # Partial correlation of wt: residuals of mpg~hp and wt~hp.
  e_y  <- residuals(lm(mpg ~ hp, data = mtcars))
  e_wt <- residuals(lm(wt ~ hp, data = mtcars))
  expect_equal(cell_num(coeff, 2, 10), cor(e_y, e_wt), tolerance = 1e-4, "wt partial correlation")
  expect_equal(cell_num(coeff, 2, 11), cor(mtcars$mpg, e_wt), tolerance = 1e-4, "wt part correlation")

  # Model Summary: R Square Change equals R² for this single-block model.
  ms <- find_table(result, "output.regression.modelSummaryTitle")
  fstat <- unname(sm$fstatistic["value"])
  expect_equal(cell_num(ms, 1, 5), sm$r.squared, tolerance = 1e-4, "R Square Change")
  expect_equal(cell_num(ms, 1, 6), fstat, tolerance = 1e-3, "F Change")

  # Coefficient covariance/correlation table.
  covmat <- vcov(ref)
  cormat <- cov2cor(covmat[c("wt", "hp"), c("wt", "hp")])
  covtab <- find_table(result, "output.regression.covMatrixTitle")
  expect_equal(cell_num(covtab, 1, 3), cormat["wt", "wt"], tolerance = 1e-4, "wt-wt correlation (=1)")
  expect_equal(cell_num(covtab, 1, 4), cormat["wt", "hp"], tolerance = 1e-4, "wt-hp correlation")
  expect_equal(cell_num(covtab, 2, 3), covmat["wt", "wt"], tolerance = 1e-4, "wt-wt covariance")
  expect_equal(cell_num(covtab, 2, 4), covmat["wt", "hp"], tolerance = 1e-4, "wt-hp covariance")

  # Descriptives: Mean/SD match base R exactly (full mtcars has no missing).
  desc <- find_table(result, "output.regression.descriptivesTitle")
  expect_equal(cell_num(desc, 1, 2), mean(mtcars$mpg), tolerance = 1e-6, "mpg mean")
  expect_equal(cell_num(desc, 1, 3), sd(mtcars$mpg), tolerance = 1e-6, "mpg sd")
  expect_equal(cell_num(desc, 2, 2), mean(mtcars$wt), tolerance = 1e-6, "wt mean")

  corr <- find_table(result, "output.regression.correlationsTitle")
  ct <- cor.test(mtcars$mpg, mtcars$wt)
  expect_equal(cell_num(corr, 1, 4), as.numeric(ct$estimate), tolerance = 1e-4, "mpg-wt correlation")
  expect_equal(cell_num(corr, 2, 4), ct$p.value / 2, tolerance = 1e-4, "mpg-wt one-tailed sig")

  # Casewise diagnostics: with a 1-SD threshold, at least one row is flagged,
  # and every flagged row's own |Std. Residual| really does exceed 1.
  cw <- find_table(result, "output.regression.casewiseTitle")
  expect_true(length(cw$rows) > 0, "casewise has at least one flagged row")
  for (row in cw$rows) {
    expect_true(abs(as.numeric(row[[2]])) > 1, "flagged row's |Std. Residual| > threshold")
  }
})

test_that("linear regression Include constant / mean substitution match lm() references", {
  set.seed(42)
  x <- rnorm(60, mean = 5); y <- 2.5 * x + rnorm(60)
  y_missing <- y
  y_missing[c(3, 10, 25)] <- NA
  df <- data.frame(col_1 = y_missing, col_2 = x)

  fixture_noconst <- write_fixture(df, list(
    dependent = "col_1", dependentName = "y",
    independents = list("col_2"), varNames = list(col_2 = "x"),
    options = list(includeConstant = FALSE)
  ))
  result_noconst <- run_analysis_script("regression-linear.R", fixture_noconst)
  expect_true(isTRUE(result_noconst$success), "no-constant result$success")
  ref_noconst <- lm(col_1 ~ 0 + col_2, data = df)
  sm_noconst  <- summary(ref_noconst)
  ms_noconst  <- find_table(result_noconst, "output.regression.modelSummaryTitle")
  expect_equal(cell_num(ms_noconst, 1, 2), sm_noconst$r.squared, tolerance = 1e-4, "no-constant R Square")
  coeff_noconst <- find_table(result_noconst, "output.regression.coeffTitle")
  expect_equal(length(coeff_noconst$rows), 1,
               label = "no-constant coefficients table has one row (no intercept)")
  expect_equal(cell_num(coeff_noconst, 1, 2), unname(coef(ref_noconst)["col_2"]), tolerance = 1e-4,
               "no-constant slope")

  fixture_mean <- write_fixture(df, list(
    dependent = "col_1", dependentName = "y",
    independents = list("col_2"), varNames = list(col_2 = "x"),
    options = list(missingMethod = "mean")
  ))
  result_mean <- run_analysis_script("regression-linear.R", fixture_mean)
  expect_true(isTRUE(result_mean$success), "mean-substitution result$success")
  df_imputed <- df
  df_imputed$col_1[is.na(df_imputed$col_1)] <- mean(df_imputed$col_1, na.rm = TRUE)
  ref_mean <- lm(col_1 ~ col_2, data = df_imputed)
  ms_mean <- find_table(result_mean, "output.regression.modelSummaryTitle")
  expect_equal(cell_num(ms_mean, 1, 2), summary(ref_mean)$r.squared, tolerance = 1e-4,
               "mean-substitution R Square uses all 60 rows")
  anova_mean <- find_table(result_mean, "output.regression.anovaTitle")
  expect_true(cell_num(anova_mean, 3, 3) + 1 == 60, "mean-substitution keeps N=60")
})

test_that("linear regression Plots produce the requested plotly traces (mtcars mpg ~ wt + hp)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp)

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3"),
    varNames = list(col_2 = "wt", col_3 = "hp"),
    options = list(plots = list(
      scatterY = "ZRESID", scatterX = "ZPRED",
      histogram = TRUE, normalPP = TRUE, partialPlots = TRUE
    ))
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  title_keys <- vapply(result$plots, function(p) p$titleKey, character(1))
  expect_true("output.regression.scatterTitle" %in% title_keys, "scatterplot present")
  expect_true("output.regression.histTitle" %in% title_keys, "histogram present")
  expect_true("output.regression.ppTitle" %in% title_keys, "normal P-P plot present")
  # One partial plot per predictor (wt, hp).
  n_partial <- sum(startsWith(title_keys, "output.regression.partialPlotTitle:"))
  expect_true(n_partial == 2, "one partial plot per predictor")

  # The ZRESID/ZPRED scatter's points are the same values the Casewise/NV1
  # diagnostics use elsewhere — spot-check the first point against rstandard-
  # free standardized residual and z-scored fitted value.
  ref <- lm(mpg ~ wt + hp, data = mtcars)
  z_resid <- residuals(ref) / summary(ref)$sigma
  z_pred  <- as.numeric(scale(fitted(ref)))
  scatter_plot <- result$plots[[which(title_keys == "output.regression.scatterTitle")]]
  trace <- scatter_plot$data$data[[1]]
  expect_equal(as.numeric(trace$y[[1]]), unname(z_resid[1]), tolerance = 1e-4, "first ZRESID point")
  expect_equal(as.numeric(trace$x[[1]]), unname(z_pred[1]), tolerance = 1e-4, "first ZPRED point")
})

# ── Stepwise methods (Forward/Backward/Stepwise) ────────────────────────────
# These independently re-derive selection from base R's own lm()/anova() —
# never by calling into regression-linear.R's internals — so a real bug in
# the script's own search would not also be baked into the reference.

#' Extract, for a given "Model" (step) number, the coefficient table's
#' variable labels (excluding the constant). Coefficients columns under a
#' multi-step method are [Model, Variable, B, ...].
step_vars <- function(coeff_table, step_no) {
  models <- vapply(coeff_table$rows, function(r) as.integer(r[[1]]), integer(1))
  rows <- coeff_table$rows[models == step_no]
  vars <- vapply(rows, function(r) as.character(r[[2]]), character(1))
  setdiff(vars, "output.col.constant")
}

n_steps <- function(coeff_table) {
  max(vapply(coeff_table$rows, function(r) as.integer(r[[1]]), integer(1)))
}

#' Independent forward-selection simulator (nested F-test) — same algorithm
#' class as the script, computed from scratch. Ranks candidates by F (which
#' orders identically to ranking by p for a single-df nested test) and applies
#' whichever criterion (probability or literal F threshold) the caller asks
#' for, at the ACTUAL residual df of that step — not an approximation.
sim_forward <- function(data, dep, all_vars, entry_p = 0.05, entry_f = NULL) {
  current <- character(0)
  repeat {
    candidates <- setdiff(all_vars, current)
    if (length(candidates) == 0) break
    best_f <- -Inf; best_p <- NA_real_; best_v <- NULL
    for (v in candidates) {
      rhs0 <- if (length(current) == 0) "1" else paste(current, collapse = " + ")
      f0 <- lm(as.formula(paste(dep, "~", rhs0)), data = data)
      f1 <- lm(as.formula(paste(dep, "~", paste(c(current, v), collapse = " + "))), data = data)
      a <- anova(f0, f1)
      if (a$F[2] > best_f) { best_f <- a$F[2]; best_p <- a[["Pr(>F)"]][2]; best_v <- v }
    }
    ok <- if (!is.null(entry_f)) best_f >= entry_f else best_p <= entry_p
    if (is.na(ok) || !ok) break
    current <- c(current, best_v)
  }
  current
}

#' Independent stepwise simulator (forward entry + removal check each round),
#' same shape as the script's own search: after each entry, re-check every
#' OTHER included variable (never the one just entered) for removal, and keep
#' removing until nothing else qualifies before trying to enter again.
sim_stepwise <- function(data, dep, all_vars, entry_p = 0.05, removal_p = 0.10,
                          entry_f = NULL, removal_f = NULL) {
  current <- character(0)
  repeat {
    changed <- FALSE
    just_entered <- NULL
    candidates <- setdiff(all_vars, current)
    if (length(candidates) > 0) {
      best_f <- -Inf; best_p <- NA_real_; best_v <- NULL
      for (v in candidates) {
        rhs0 <- if (length(current) == 0) "1" else paste(current, collapse = " + ")
        f0 <- lm(as.formula(paste(dep, "~", rhs0)), data = data)
        f1 <- lm(as.formula(paste(dep, "~", paste(c(current, v), collapse = " + "))), data = data)
        a <- anova(f0, f1)
        if (a$F[2] > best_f) { best_f <- a$F[2]; best_p <- a[["Pr(>F)"]][2]; best_v <- v }
      }
      ok <- if (!is.null(entry_f)) best_f >= entry_f else best_p <= entry_p
      if (isTRUE(ok)) {
        just_entered <- best_v
        current <- c(current, just_entered)
        changed <- TRUE
      }
    }
    repeat {
      removal_candidates <- setdiff(current, just_entered)
      if (length(removal_candidates) == 0) break
      worst_f <- Inf; worst_p <- NA_real_; worst_v <- NULL
      for (v in removal_candidates) {
        rhs_small <- if (length(current) == 1) "1" else paste(setdiff(current, v), collapse = " + ")
        f0 <- lm(as.formula(paste(dep, "~", rhs_small)), data = data)
        f1 <- lm(as.formula(paste(dep, "~", paste(current, collapse = " + "))), data = data)
        a <- anova(f0, f1)
        if (a$F[2] < worst_f) { worst_f <- a$F[2]; worst_p <- a[["Pr(>F)"]][2]; worst_v <- v }
      }
      ok_remove <- if (!is.null(removal_f)) worst_f < removal_f else worst_p > removal_p
      if (!isTRUE(ok_remove)) break
      current <- setdiff(current, worst_v)
      changed <- TRUE
      just_entered <- NULL
    }
    if (!changed) break
  }
  current
}

#' Independent backward-elimination simulator (nested F-test, probability
#' criterion).
sim_backward <- function(data, dep, all_vars, removal_p = 0.10) {
  current <- all_vars
  repeat {
    if (length(current) == 0) break
    worst_p <- -Inf; worst_v <- NULL
    for (v in current) {
      rhs_small <- if (length(current) == 1) "1" else paste(setdiff(current, v), collapse = " + ")
      f0 <- lm(as.formula(paste(dep, "~", rhs_small)), data = data)
      f1 <- lm(as.formula(paste(dep, "~", paste(current, collapse = " + "))), data = data)
      p <- anova(f0, f1)[["Pr(>F)"]][2]
      if (p > worst_p) { worst_p <- p; worst_v <- v }
    }
    if (is.na(worst_p) || worst_p <= removal_p) break
    current <- setdiff(current, worst_v)
  }
  current
}

test_that("Forward selection matches an independent nested-F simulation (mtcars)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp,
                    col_4 = mtcars$disp, col_5 = mtcars$qsec)
  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3", "col_4", "col_5"),
    varNames = list(col_2 = "wt", col_3 = "hp", col_4 = "disp", col_5 = "qsec"),
    options = list(method = "forward")
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  expected <- sim_forward(mtcars, "mpg", c("wt", "hp", "disp", "qsec"))
  coeff <- find_table(result, "output.regression.coeffTitle")
  actual <- step_vars(coeff, n_steps(coeff))
  expect_true(setequal(actual, expected),
              sprintf("forward selection set: actual={%s} expected={%s}",
                      paste(sort(actual), collapse = ","), paste(sort(expected), collapse = ",")))
  expect_true(length(expected) > 0, "at least one predictor should enter for this well-known dataset")

  # Step 1's R Square Change / F Change must equal the simple regression of
  # mpg on whichever variable entered first.
  first_var <- step_vars(coeff, 1)
  expect_equal(length(first_var), 1, label = "exactly one variable enters at step 1")
  ref1 <- lm(as.formula(paste("mpg ~", first_var)), data = mtcars)
  ms <- find_table(result, "output.regression.modelSummaryTitle")
  expect_equal(cell_num(ms, 1, 3), summary(ref1)$r.squared, tolerance = 1e-4, "step 1 R Square")
})

test_that("Backward elimination matches an independent nested-F simulation (mtcars)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp,
                    col_4 = mtcars$disp, col_5 = mtcars$qsec)
  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3", "col_4", "col_5"),
    varNames = list(col_2 = "wt", col_3 = "hp", col_4 = "disp", col_5 = "qsec"),
    options = list(method = "backward")
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  expected <- sim_backward(mtcars, "mpg", c("wt", "hp", "disp", "qsec"))
  coeff <- find_table(result, "output.regression.coeffTitle")
  actual <- step_vars(coeff, n_steps(coeff))
  expect_true(setequal(actual, expected),
              sprintf("backward selection set: actual={%s} expected={%s}",
                      paste(sort(actual), collapse = ","), paste(sort(expected), collapse = ",")))

  # Step 1 (before any removal) is the full 4-predictor model.
  expect_true(setequal(step_vars(coeff, 1), c("wt", "hp", "disp", "qsec")),
              label = "backward step 1 is the full model")
})

test_that("Stepwise (F-value criteria) matches an independent simulation and Excluded Variables checks out", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp,
                    col_4 = mtcars$disp, col_5 = mtcars$qsec)
  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3", "col_4", "col_5"),
    varNames = list(col_2 = "wt", col_3 = "hp", col_4 = "disp", col_5 = "qsec"),
    options = list(method = "stepwise", criteria = list(type = "fvalue", entryF = 4, removalF = 3.9))
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  expected <- sim_stepwise(mtcars, "mpg", c("wt", "hp", "disp", "qsec"), entry_f = 4, removal_f = 3.9)
  coeff <- find_table(result, "output.regression.coeffTitle")
  actual <- step_vars(coeff, n_steps(coeff))
  expect_true(setequal(actual, expected),
              sprintf("stepwise selection set: actual={%s} expected={%s}",
                      paste(sort(actual), collapse = ","), paste(sort(expected), collapse = ",")))

  # Excluded Variables: "step 1" is the model AFTER the first variable has
  # already entered (steps[[1]] records the state post-entry, not the empty
  # baseline before it) — so each excluded candidate's Tolerance/Partial
  # Correlation at step 1 must be computed CONTROLLING FOR that one variable,
  # not against an empty model.
  first_entered <- step_vars(coeff, 1)
  expect_equal(length(first_entered), 1, label = "exactly one variable already in step 1's model")
  excl <- find_table(result, "output.regression.excludedTitle")
  step1_rows <- Filter(function(r) as.integer(r[[1]]) == 1, excl$rows)
  expect_true(length(step1_rows) == 3, "three variables excluded at step 1 (one already entered)")
  for (row in step1_rows) {
    var_disp <- as.character(row[[2]])
    tol <- as.numeric(row[[7]])
    expected_tol <- 1 - summary(lm(as.formula(paste(var_disp, "~", first_entered)), data = mtcars))$r.squared
    expect_equal(tol, expected_tol, tolerance = 1e-4, sprintf("%s tolerance at step 1", var_disp))

    partial_corr <- as.numeric(row[[6]])
    e_y <- residuals(lm(as.formula(paste("mpg ~", first_entered)), data = mtcars))
    e_v <- residuals(lm(as.formula(paste(var_disp, "~", first_entered)), data = mtcars))
    expect_equal(partial_corr, cor(e_y, e_v), tolerance = 1e-4,
                 sprintf("%s partial correlation at step 1", var_disp))
  }
})
