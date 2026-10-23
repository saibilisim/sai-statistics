# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# regression-probit.R — Probit Analysis (SPSS-style: grouped dose-response
# data, Analyze > Regression > Probit — NOT a per-case binary model).
#
# Params (from JSON):
#   rScriptsDir     — directory containing _bootstrap.R
#   responseFreq    — colId of the Response Frequency variable (successes)
#   totalObserved   — colId of the Total Observed variable (trials)
#   factor          — colId of the Factor (grouping) variable, or null
#   factorRange     — {min, max} to restrict the Factor's values, or null
#   covariates      — colIds of the covariate(s) ("dose" is covariates[1])
#   varNames        — named list colId -> display name
#   transform       — one of PROBIT_TRANSFORMS (shared/probit-types.ts),
#                     applied uniformly to every covariate
#   modelType       — "probit" | "logit"
#   options         — ProbitOptions (shared/probit-types.ts)
#
# Model: a GROUPED binomial GLM, cbind(freq, total-freq) ~ covariates [+
# factor] with a probit/logit link — one shared slope per covariate across
# Factor levels ("parallel lines"), one intercept per level. A non-zero
# natural response rate (Abbott-adjusted: P = C + (1-C)*F(eta)) is not linear
# in its parameters, so it is fit by direct maximum likelihood (optim())
# instead of glm() whenever requested.
#
# Output: "Parameter Estimates", "Chi-Square Tests" (Pearson goodness-of-fit,
# always), optionally "Cell Frequencies", "Test of Parallelism" and the
# "Confidence Limits" fiducial effective-dose table (Fieller's theorem).

suppressPackageStartupMessages(library(jsonlite))

.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

params <- read_params()
df     <- load_data(params)

on_flag <- function(x, default = FALSE) if (is.null(x)) default else isTRUE(x)
num_opt <- function(x, default) {
  if (is.null(x)) return(default)
  n <- suppressWarnings(as.numeric(x))
  if (is.na(n)) default else n
}

#' Fieller's theorem CI for a ratio of two (approximately) jointly normal
#' quantities n1/n2 with variances v11, v22 and covariance v12. Returns
#' NULL when the denominator's relative uncertainty is too large (g >= 1) —
#' the classic case where the fiducial limits are unbounded.
fieller_ci <- function(n1, n2, v11, v22, v12, t_crit) {
  g <- (t_crit^2 * v22) / n2^2
  if (!is.finite(g) || g >= 1) return(NULL)
  A <- n2^2 - t_crit^2 * v22
  B <- -2 * (n1 * n2 - t_crit^2 * v12)
  C <- n1^2 - t_crit^2 * v11
  disc <- B^2 - 4 * A * C
  if (!is.finite(disc) || disc < 0) return(NULL)
  r1 <- (-B - sqrt(disc)) / (2 * A)
  r2 <- (-B + sqrt(disc)) / (2 * A)
  list(estimate = n1 / n2, lower = min(r1, r2), upper = max(r1, r2), g = g)
}

tryCatch({
  progress(5L, "progress.loading")

  freq_col  <- params$responseFreq
  total_col <- params$totalObserved
  factor_col <- params$factor
  covs      <- unlist(params$covariates)
  var_names <- params$varNames
  transform <- if (is.null(params$transform)) "none" else params$transform
  model_type <- if (identical(params$modelType, "logit")) "logit" else "probit"
  opts      <- if (is.null(params$options)) list() else params$options

  if (is.null(freq_col) || !freq_col %in% names(df)) sai_error("Response Frequency variable not found")
  if (is.null(total_col) || !total_col %in% names(df)) sai_error("Total Observed variable not found")
  if (length(covs) == 0) sai_error("At least one covariate is required")

  cov_names <- vapply(covs, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  apply_transform <- function(v) switch(transform,
    ln = log(v), log10 = log10(v), inverse = 1 / v, square = v^2, sqrt = sqrt(v), v)

  freq  <- suppressWarnings(as.numeric(df[[freq_col]]))
  total <- suppressWarnings(as.numeric(df[[total_col]]))
  cov_mat <- do.call(cbind, lapply(covs, function(c) suppressWarnings(as.numeric(df[[c]]))))
  cov_mat_t <- suppressWarnings(matrix(apply_transform(as.vector(cov_mat)), nrow = nrow(cov_mat)))
  # A transform's domain violation (log(<=0), 1/0…) produces -Inf/Inf, not NA —
  # complete.cases() below only screens NA, so those would otherwise reach the
  # model matrix and silently break the fit.
  cov_mat_t[!is.finite(cov_mat_t)] <- NA_real_

  raw_factor <- if (!is.null(factor_col) && factor_col %in% names(df)) df[[factor_col]] else NULL
  factor_num <- if (!is.null(raw_factor)) suppressWarnings(as.numeric(raw_factor)) else NULL

  ok <- !is.na(freq) & !is.na(total) & total > 0 & freq >= 0 & freq <= total &
    stats::complete.cases(cov_mat_t)
  if (!is.null(raw_factor)) ok <- ok & !is.na(raw_factor)
  fr <- params$factorRange
  if (!is.null(raw_factor) && !is.null(fr) && !is.null(factor_num)) {
    lo <- num_opt(fr$min, -Inf); hi <- num_opt(fr$max, Inf)
    ok <- ok & !is.na(factor_num) & factor_num >= lo & factor_num <= hi
  }
  if (sum(ok) == 0) sai_error("No valid rows after applying Response Frequency/Total Observed/Factor range")

  dat <- data.frame(freq = freq[ok], total = total[ok])
  for (i in seq_along(covs)) dat[[paste0("z", i)]] <- cov_mat_t[ok, i]
  has_factor <- !is.null(raw_factor) && length(unique(raw_factor[ok])) >= 2
  if (has_factor) dat$.factor <- factor(raw_factor[ok])
  dat[["__row_idx"]] <- row_index_of(df)[ok]

  n_params_min <- length(covs) + 1L + (if (has_factor) nlevels(dat$.factor) - 1L else 0L)
  if (nrow(dat) < n_params_min + 1L) sai_error("Not enough valid rows to fit this model")

  link  <- model_type
  Fn    <- if (model_type == "logit") stats::plogis else stats::pnorm
  Finv  <- if (model_type == "logit") stats::qlogis else stats::qnorm

  max_iter <- as.integer(num_opt(opts$maxIterations, 20))
  nrm_mode <- if (is.null(opts$naturalResponseMode)) "none" else opts$naturalResponseMode
  nrm_value <- num_opt(opts$naturalResponseValue, NA_real_)

  rhs_terms <- paste0("z", seq_along(covs))
  base_rhs <- paste(c(rhs_terms, if (has_factor) ".factor"), collapse = " + ")

  #' Fit cbind(freq, total-freq) ~ rhs under the current link and natural-
  #' response-rate mode. Returns coef/vcov/loglik/C/nParams/converged, with
  #' `vcov` from the OBSERVED information (matches SPSS PROBIT's own SEs —
  #' the same convention already established for regression-logistic.R's
  #' predecessor in this file) whenever the natural-response custom MLE path
  #' is used; glm()'s own (expected-information) vcov otherwise.
  fit_model <- function(rhs, estimate_c) {
    form <- stats::as.formula(paste0("cbind(freq, total - freq) ~ ", rhs))
    if (identical(nrm_mode, "none")) {
      f <- tryCatch(
        stats::glm(form, data = dat, family = stats::binomial(link = link),
                   control = stats::glm.control(maxit = max_iter)),
        error = function(e) NULL)
      if (is.null(f)) return(NULL)
      list(coef = stats::coef(f), vcov = stats::vcov(f),
           loglik = as.numeric(stats::logLik(f)), C = 0,
           nParams = length(stats::coef(f)), converged = isTRUE(f$converged))
    } else {
      X <- stats::model.matrix(form, data = dat)
      p <- ncol(X)
      y1 <- dat$freq; y0 <- dat$total - dat$freq
      nll <- function(par) {
        b <- par[seq_len(p)]
        eta <- as.numeric(X %*% b)
        Fx <- Fn(eta)
        Cv <- if (estimate_c) stats::plogis(par[p + 1L]) else
          (if (is.na(nrm_value)) 0 else nrm_value)
        pr <- Cv + (1 - Cv) * Fx
        pr <- pmin(pmax(pr, 1e-10), 1 - 1e-10)
        -sum(y1 * log(pr) + y0 * log(1 - pr))
      }
      start_b <- tryCatch(
        stats::coef(stats::glm(form, data = dat, family = stats::binomial(link = link))),
        error = function(e) rep(0, p))
      start <- if (estimate_c) c(start_b, 0) else start_b
      opt <- tryCatch(
        stats::optim(start, nll, method = "BFGS", hessian = TRUE,
                     control = list(maxit = max_iter * 50)),
        error = function(e) NULL)
      if (is.null(opt)) return(NULL)
      b <- opt$par[seq_len(p)]
      names(b) <- colnames(X)
      V <- tryCatch(solve(opt$hessian)[seq_len(p), seq_len(p), drop = FALSE],
                    error = function(e) matrix(NA_real_, p, p))
      Chat <- if (estimate_c) stats::plogis(opt$par[p + 1L]) else
        (if (is.na(nrm_value)) 0 else nrm_value)
      list(coef = b, vcov = V, loglik = -opt$value, C = Chat,
           nParams = p + (if (estimate_c) 1L else 0L), converged = identical(opt$convergence, 0L))
    }
  }

  base <- fit_model(base_rhs, identical(nrm_mode, "calculate"))
  if (is.null(base)) sai_error("The model could not be fit — check Response Frequency/Total Observed and covariates")
  if (!base$converged)
    warnings <- "output.probit.notConverged"
  else
    warnings <- character(0)
  notes <- character(0)

  b_all <- base$coef
  V_all <- base$vcov
  se_all <- suppressWarnings(sqrt(diag(V_all)))

  # ── Pearson goodness-of-fit chi-square (always reported) ───────────────────
  eta_hat <- as.numeric(stats::model.matrix(stats::as.formula(paste0("~", base_rhs)), data = dat) %*% b_all)
  Fx_hat  <- Fn(eta_hat)
  p_hat   <- base$C + (1 - base$C) * Fx_hat
  expected <- dat$total * p_hat
  pearson_terms <- (dat$freq - expected)^2 / pmax(dat$total * p_hat * (1 - p_hat), 1e-10)
  pearson_chisq <- sum(pearson_terms)
  pearson_df <- nrow(dat) - base$nParams
  pearson_p <- if (pearson_df > 0) pchisq(pearson_chisq, pearson_df, lower.tail = FALSE) else NA_real_

  # ── Heterogeneity correction: SPSS scales all variances by max(1, chisq/df)
  # when the goodness-of-fit test is significant below the requested level —
  # the standard overdispersion (quasi-likelihood scale) correction. ─────────
  heterogeneity_sig <- num_opt(opts$heterogeneitySig, 0.15)
  dispersion <- if (pearson_df > 0) pearson_chisq / pearson_df else 1
  use_heterogeneity <- is.finite(pearson_p) && pearson_p < heterogeneity_sig && dispersion > 1
  scale_factor <- if (use_heterogeneity) dispersion else 1
  if (use_heterogeneity) {
    V_all <- V_all * scale_factor
    se_all <- se_all * sqrt(scale_factor)
    notes <- c(notes, paste0("output.probit.heterogeneityNote:", round(scale_factor, 4)))
  }

  # ── Parameter Estimates ─────────────────────────────────────────────────────
  bn <- names(b_all)
  label_for <- function(nm) {
    if (nm == "(Intercept)") return("output.col.constant")
    if (startsWith(nm, "z")) {
      idx <- as.integer(sub("^z", "", nm))
      if (!is.na(idx) && idx <= length(cov_names)) return(cov_names[idx])
    }
    if (has_factor && startsWith(nm, ".factor")) {
      lvl <- sub("^\\.factor", "", nm)
      return(paste0("output.probit.factorLevel:", lvl))
    }
    nm
  }
  pe_rows <- lapply(seq_along(b_all), function(i) {
    z <- b_all[i] / se_all[i]
    list(label_for(bn[i]), round(b_all[[i]], 6), round(se_all[[i]], 6),
         round(z, 3), round(2 * pnorm(abs(z), lower.tail = FALSE), 6))
  })

  tables <- list(list(
    titleKey = "output.probit.paramTitle",
    columns  = list("output.col.model", "output.col.b", "output.col.stdError",
                    "output.col.zVal", "output.col.sig"),
    rows     = pe_rows,
    footnoteKey = paste0("output.probit.modelFootnote:",
                         if (model_type == "logit") "output.probit.logit" else "output.probit.probit")
  ))

  tables <- c(tables, list(list(
    titleKey = "output.probit.chiSquareTitle",
    columns  = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
    rows     = list(list(round(pearson_chisq, 6),
                         if (pearson_df > 0) pearson_df else NULL,
                         if (is.na(pearson_p)) NULL else round(pearson_p, 6))),
    footnoteKey = if (identical(nrm_mode, "none")) NULL else
      paste0("output.probit.naturalResponseFootnote:", round(base$C, 6))
  )))

  progress(40L, "progress.computing")

  # ── Cell Frequencies (per-row observed/expected) ────────────────────────────
  if (on_flag(opts$frequencies, TRUE)) {
    freq_rows <- lapply(seq_len(nrow(dat)), function(i) list(
      as.integer(dat[["__row_idx"]][i]) + 1L,
      round(dat$total[i], 6), round(dat$freq[i], 6),
      round(expected[i], 6), round(dat$freq[i] - expected[i], 6), round(p_hat[i], 6)))
    tables <- c(tables, list(list(
      titleKey = "output.probit.freqTitle",
      columns  = list("output.col.case", "output.probit.colTotal", "output.probit.colObservedResp",
                      "output.probit.colExpectedResp", "output.col.residual", "output.probit.colProbability"),
      rows     = freq_rows, footnoteKey = NULL
    )))
  }

  # ── Test of Parallelism ──────────────────────────────────────────────────────
  if (on_flag(opts$parallelism) && has_factor) {
    ext_rhs <- paste(c(paste0(rhs_terms, "*.factor")), collapse = " + ")
    ext <- fit_model(ext_rhs, identical(nrm_mode, "calculate"))
    if (is.null(ext) || is.null(ext$loglik) || is.null(base$loglik)) {
      warnings <- c(warnings, "output.probit.parallelismUnavailable")
    } else {
      lr <- 2 * (ext$loglik - base$loglik)
      dfp <- ext$nParams - base$nParams
      if (lr < 0) lr <- 0
      pv <- if (dfp > 0) pchisq(lr, dfp, lower.tail = FALSE) else NA_real_
      tables <- c(tables, list(list(
        titleKey = "output.probit.parallelismTitle",
        columns  = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
        rows     = list(list(round(lr, 6), if (dfp > 0) dfp else NULL,
                             if (is.na(pv)) NULL else round(pv, 6))),
        footnoteKey = "output.probit.parallelismFootnote"
      )))
    }
  }

  # ── Confidence Limits (fiducial effective dose) ─────────────────────────────
  if (on_flag(opts$fiducialCI, TRUE)) {
    t_crit <- qnorm(0.975)
    pcts <- c(1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 98, 99)
    # Extra covariates beyond the first ("dose") are held at their sample mean.
    extra_means <- if (length(covs) > 1)
      vapply(2:length(covs), function(i) mean(dat[[paste0("z", i)]]), numeric(1)) else numeric(0)

    levels_to_report <- if (has_factor) levels(dat$.factor) else "__overall__"
    for (lvl in levels_to_report) {
      # Contrast vector a: a'b = the effective intercept at this Factor level
      # with extra covariates fixed at their means; e1 selects the dose slope.
      a <- setNames(rep(0, length(bn)), bn)
      a[["(Intercept)"]] <- 1
      if (has_factor && !identical(lvl, levels(dat$.factor)[1])) {
        nm <- paste0(".factor", lvl)
        if (nm %in% bn) a[[nm]] <- 1
      }
      if (length(extra_means) > 0) {
        for (i in seq_along(extra_means)) {
          nm <- paste0("z", i + 1L)
          if (nm %in% bn) a[[nm]] <- extra_means[i]
        }
      }
      e1 <- setNames(rep(0, length(bn)), bn)
      if ("z1" %in% bn) e1[["z1"]] <- 1
      b0_eff <- sum(a * b_all)
      b1 <- sum(e1 * b_all)
      v_b0 <- as.numeric(t(a) %*% V_all %*% a)
      v_b1 <- as.numeric(t(e1) %*% V_all %*% e1)
      cov01 <- as.numeric(t(a) %*% V_all %*% e1)

      rows <- list()
      for (pc in pcts) {
        p_target <- pc / 100
        p_star <- if (base$C > 0) (p_target - base$C) / (1 - base$C) else p_target
        if (!is.finite(p_star) || p_star <= 0 || p_star >= 1) {
          rows <- c(rows, list(list(pc, NULL, NULL, NULL)))
          next
        }
        Y <- Finv(p_star)
        n1 <- Y - b0_eff
        fc <- fieller_ci(n1, b1, v_b0, v_b1, -cov01, t_crit)
        if (is.null(fc)) {
          rows <- c(rows, list(list(pc, round(n1 / b1, 6), NULL, NULL)))
        } else {
          rows <- c(rows, list(list(pc, round(fc$estimate, 6), round(fc$lower, 6), round(fc$upper, 6))))
        }
      }
      tables <- c(tables, list(list(
        titleKey = if (has_factor) paste0("output.probit.ciTitle:", lvl) else "output.probit.ciTitleOverall",
        columns  = list("output.probit.colPct", "output.probit.colDose",
                        "output.col.ciLowerPct:95", "output.col.ciUpperPct:95"),
        rows     = rows,
        footnoteKey = if (length(extra_means) > 0) "output.probit.otherCovariatesMeanNote" else NULL
      )))
    }
  }

  progress(90L, "progress.computing")

  # ── New variables (NV1) ────────────────────────────────────────────────────
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    add <- function(key, values, type = "numeric", measure = "scale") {
      if (!is.null(want[[key]])) {
        case_vars[[length(case_vars) + 1L]] <<- sai_case_var(
          want[[key]], values, dat, labelKey = paste0("output.probit.newVar.", key),
          type = type, measure = measure)
      }
    }
    add("probability", p_hat)
    add("expected", expected)
    add("residual", dat$freq - expected)
  }

  progress(100L, "progress.done")
  sai_output(caseVars = case_vars, tables = tables, warnings = warnings, notes = notes)

}, error = function(e) sai_error(conditionMessage(e)))
