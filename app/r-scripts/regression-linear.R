# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# regression-linear.R — Linear Regression (SPSS-style, OLS).
#
# Params (from JSON):
#   rScriptsDir  — directory containing _bootstrap.R
#   dependent    — dependent-variable colId
#   dependentName— display name of the dependent
#   independents — character vector of predictor colIds
#   varNames     — named list colId → display name
#   options$method — "enter" (default, all predictors in one block), "forward",
#     "backward" or "stepwise". SPSS's "Remove" is not offered — it drops a
#     BLOCK's variables relative to a PREVIOUS block, and this script fits a
#     single block, so there is no earlier block to remove anything relative
#     to.
#   options$criteria — Stepping Method Criteria (only consulted when method
#     != "enter"): { type: "prob"|"fvalue", entryProb, removalProb, entryF,
#     removalF }. SPSS's own defaults: prob entry .05 / removal .10, or
#     F entry 3.84 / removal 2.71. Selection uses nested-model F-tests
#     (equivalent to ranking candidates by partial correlation magnitude for
#     entry, or by partial F for removal) — the standard textbook algorithm,
#     not R's step()'s AIC-based one.
#   options$collinearity      — Tolerance/VIF columns in Coefficients (every step)
#   options$durbinWatson      — Durbin-Watson column in Model Summary (every step)
#   options$confidenceIntervals / options$ciLevel — CI columns for B (default 95,
#     every step)
#   options$covarianceMatrix  — Coefficient Correlations/Covariances table for
#     the FINAL step's model
#   options$rSquaredChange    — Change Statistics columns in Model Summary. For
#     a single-step model (Enter, or any method's first step) this is the
#     step's own overall R²/F/Sig — the correct value when the baseline is
#     R²=0. For a later step (forward/backward/stepwise), it is the actual
#     nested single-df F-test that decided that step's entry/removal.
#   options$descriptives      — Descriptive Statistics + Correlations tables,
#     covering the dependent and EVERY candidate predictor (not just the ones
#     the final step kept) — matches SPSS, which describes the variables it
#     was given regardless of what stepwise selection kept.
#   options$partialCorrelations — Zero-order/Partial/Part columns in
#     Coefficients (every step; partial/part are computed against that STEP's
#     own other included terms, not the full candidate set)
#   options$casewiseDiagnostics / options$casewiseOutliersOnly /
#     options$casewiseSD       — Casewise Diagnostics table, FINAL step's model
#   options$includeConstant   — FALSE fits through the origin (default TRUE)
#   options$missingMethod     — "listwise" (default) or "mean" (each variable's
#     own mean substituted before fitting). SPSS's "Exclude cases pairwise" is
#     NOT offered here — pairwise deletion for multiple regression solves the
#     normal equations from a pairwise-complete covariance matrix, which SPSS's
#     own documentation flags as potentially inconsistent (non-positive-
#     definite matrices, out-of-range R²) and which has no independent
#     reference implementation to validate against (CLAUDE.md §11: a wrong
#     statistic is the most critical bug here).
#   options$plots — { scatterY, scatterX: one of DEPENDNT/ZPRED/ZRESID/DRESID/
#     ADJPRED/SRESID/SDRESID; histogram, normalPP, partialPlots: booleans },
#     all computed from the FINAL step's model
#   options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1): bootstraps
#     every coefficient of the FINAL step's model via case-resampling — SPSS's
#     own default method (residual/wild bootstrap are syntax-only/niche, not
#     offered here). Same sai_bootstrap() contract as ttest-onesample.R.
#
# Output: "Model Summary" (R, R², Adj. R², Std. Error of the Estimate — one row
#         per step), "ANOVA" and "Coefficients" (one group of rows per step),
#         "Excluded Variables" (forward/backward/stepwise only), plus the
#         optional tables/plots listed above (final-step-only where noted).

suppressPackageStartupMessages(library(jsonlite))

.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

BAR_COLOR <- "#3b6ea5"

params <- read_params()
df     <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  dep       <- params$dependent
  dep_name  <- if (is.null(params$dependentName)) dep else params$dependentName
  preds     <- unlist(params$independents)
  var_names <- params$varNames
  opts      <- if (is.null(params$options)) list() else params$options
  plots_opts <- if (is.null(opts$plots)) list() else opts$plots
  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (length(preds) == 0) sai_error("No independent variables specified")

  pred_names <- vapply(preds, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  y  <- suppressWarnings(as.numeric(apply_user_missing(df[[dep]], dep, params)))
  X  <- lapply(preds, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  dat <- data.frame(.y = y)
  for (i in seq_along(preds)) dat[[paste0("x", i)]] <- X[[i]]
  # Carried through the listwise deletion so any new variable this run creates
  # knows which dataset rows its values belong to (NV1, roadmap ★11).
  dat[["__row_idx"]] <- row_index_of(df)

  missing_method <- if (is.null(opts$missingMethod)) "listwise" else opts$missingMethod
  data_cols <- c(".y", paste0("x", seq_along(preds)))
  if (identical(missing_method, "mean")) {
    for (col in data_cols) {
      v <- dat[[col]]
      m <- mean(v, na.rm = TRUE)
      v[is.na(v)] <- m
      dat[[col]] <- v
    }
  } else {
    dat <- dat[stats::complete.cases(dat[, data_cols, drop = FALSE]), , drop = FALSE]
  }
  n   <- nrow(dat)
  if (n <= length(preds) + 1) sai_error("Not enough complete cases for regression")

  include_const <- if (is.null(opts$includeConstant)) TRUE else isTRUE(opts$includeConstant)
  all_terms     <- paste0("x", seq_along(preds))

  # ── Term-set helpers (shared by the fit, the stepwise search and every
  #    per-step table builder below) ──────────────────────────────────────
  build_formula <- function(terms) {
    if (length(terms) == 0) {
      rhs <- "1"
    } else {
      rhs <- paste(terms, collapse = " + ")
      if (!include_const) rhs <- paste("0 +", rhs)
    }
    as.formula(paste(".y ~", rhs))
  }
  # NULL only for the transient "nothing at all" baseline (no terms, no
  # constant) that the stepwise search compares its first candidate against —
  # never a real, reported step (compute_step_stats() errors if one ever is).
  fit_terms <- function(terms) {
    if (length(terms) == 0 && !include_const) return(NULL)
    lm(build_formula(terms), data = dat)
  }
  term_label <- function(term) {
    if (identical(term, "(Intercept)")) return("output.col.constant")
    idx <- suppressWarnings(as.integer(sub("^x", "", term)))
    if (!is.na(idx) && idx >= 1 && idx <= length(pred_names)) pred_names[idx] else term
  }
  # Tolerance of `term` if regressed on `other_terms` (1 when there are none —
  # nothing to be collinear with).
  compute_tolerance <- function(term, other_terms) {
    if (length(other_terms) == 0) return(1)
    rj <- summary(lm(as.formula(paste0(term, " ~ ", paste(other_terms, collapse = " + "))),
                     data = dat))$r.squared
    max(1 - rj, .Machine$double.eps)
  }
  # Added-variable pair: residuals of y and of `term` once `other_terms` is
  # partialled out. No other terms left means "partial out nothing", which
  # correctly collapses to centered y/term — so partial/part correlation
  # reduces to the zero-order correlation, as it must.
  compute_partial_pair <- function(term, other_terms) {
    xi <- dat[[term]]
    if (length(other_terms) == 0) {
      list(e_y = dat$.y - mean(dat$.y), e_xi = xi - mean(xi))
    } else {
      rhs_others <- paste(other_terms, collapse = " + ")
      list(
        e_y  = residuals(lm(as.formula(paste(".y ~", rhs_others)), data = dat)),
        e_xi = residuals(lm(as.formula(paste0(term, " ~ ", rhs_others)), data = dat))
      )
    }
  }
  # Residual sum of squares (and its df) for a term set, without requiring a
  # fittable lm() object — the empty/no-constant baseline has RSS = sum(y²)
  # with n df "used up" by nothing, which is exactly what a nested F-test
  # against it needs.
  rss_of <- function(terms) {
    fit_t <- fit_terms(terms)
    if (is.null(fit_t)) return(list(rss = sum(dat$.y^2), dfres = n))
    list(rss = sum(residuals(fit_t)^2), dfres = df.residual(fit_t))
  }
  nested_f_test <- function(terms_small, terms_large) {
    a <- rss_of(terms_small); b <- rss_of(terms_large)
    df1 <- a$dfres - b$dfres; df2 <- b$dfres
    if (df1 <= 0 || df2 <= 0 || b$rss <= 0) return(list(f = NA_real_, p = NA_real_, df1 = df1, df2 = df2))
    f <- ((a$rss - b$rss) / df1) / (b$rss / df2)
    if (!is.finite(f) || f < 0) f <- 0
    list(f = f, p = pf(f, df1, df2, lower.tail = FALSE), df1 = df1, df2 = df2)
  }
  f_to_enter  <- function(current, candidate) nested_f_test(current, c(current, candidate))
  f_to_remove <- function(current, drop)      nested_f_test(setdiff(current, drop), current)

  # ── Method / Stepping Method Criteria ───────────────────────────────────
  method     <- if (is.null(opts$method)) "enter" else opts$method
  multi_step <- !identical(method, "enter")
  crit       <- if (is.null(opts$criteria)) list() else opts$criteria
  crit_type  <- if (is.null(crit$type)) "prob" else crit$type
  entry_p    <- if (is.null(crit$entryProb)) 0.05 else as.numeric(crit$entryProb)
  removal_p  <- if (is.null(crit$removalProb)) 0.10 else as.numeric(crit$removalProb)
  entry_f    <- if (is.null(crit$entryF)) 3.84 else as.numeric(crit$entryF)
  removal_f  <- if (is.null(crit$removalF)) 2.71 else as.numeric(crit$removalF)
  qualifies_entry <- function(stat) {
    if (is.na(stat$f)) return(FALSE)
    if (identical(crit_type, "fvalue")) stat$f >= entry_f else stat$p <= entry_p
  }
  qualifies_removal <- function(stat) {
    if (is.na(stat$f)) return(FALSE)
    if (identical(crit_type, "fvalue")) stat$f < removal_f else stat$p > removal_p
  }

  # steps[[i]]: terms (character vector), entered/removed (term or NULL), and
  # change (the nested_f_test() that decided this step, or NULL for a step
  # that IS the starting full/empty model rather than a single add/remove).
  steps <- list()
  if (method == "enter") {
    steps[[1]] <- list(terms = all_terms, entered = NULL, removed = NULL, change = NULL)

  } else if (method == "forward") {
    current <- character(0)
    repeat {
      candidates <- setdiff(all_terms, current)
      if (length(candidates) == 0) break
      fstats <- lapply(candidates, function(cnd) f_to_enter(current, cnd))
      fvals  <- vapply(fstats, function(s) if (is.na(s$f)) -Inf else s$f, numeric(1))
      bi <- which.max(fvals)
      if (!qualifies_entry(fstats[[bi]])) break
      current <- c(current, candidates[bi])
      steps[[length(steps) + 1L]] <- list(terms = current, entered = candidates[bi],
                                           removed = NULL, change = fstats[[bi]])
    }
    if (length(steps) == 0)
      steps[[1]] <- list(terms = character(0), entered = NULL, removed = NULL, change = NULL)

  } else if (method == "backward") {
    current <- all_terms
    steps[[1]] <- list(terms = current, entered = NULL, removed = NULL, change = NULL)
    repeat {
      if (length(current) == 0) break
      fstats <- lapply(current, function(cnd) f_to_remove(current, cnd))
      fvals  <- vapply(fstats, function(s) if (is.na(s$f)) Inf else s$f, numeric(1))
      wi <- which.min(fvals)
      if (!qualifies_removal(fstats[[wi]])) break
      removed_term <- current[wi]
      current <- setdiff(current, removed_term)
      steps[[length(steps) + 1L]] <- list(terms = current, entered = NULL,
                                           removed = removed_term, change = fstats[[wi]])
    }

  } else { # stepwise
    current <- character(0)
    max_iter <- 4L * length(all_terms) + 4L
    iter <- 0L
    repeat {
      iter <- iter + 1L
      if (iter > max_iter) break
      did_something <- FALSE
      just_entered <- NULL
      candidates <- setdiff(all_terms, current)
      if (length(candidates) > 0) {
        fstats <- lapply(candidates, function(cnd) f_to_enter(current, cnd))
        fvals  <- vapply(fstats, function(s) if (is.na(s$f)) -Inf else s$f, numeric(1))
        bi <- which.max(fvals)
        if (qualifies_entry(fstats[[bi]])) {
          just_entered <- candidates[bi]
          current <- c(current, just_entered)
          steps[[length(steps) + 1L]] <- list(terms = current, entered = just_entered,
                                               removed = NULL, change = fstats[[bi]])
          did_something <- TRUE
        }
      }
      repeat {
        removal_candidates <- setdiff(current, just_entered)
        if (length(removal_candidates) == 0) break
        rstats <- lapply(removal_candidates, function(cnd) f_to_remove(current, cnd))
        rvals  <- vapply(rstats, function(s) if (is.na(s$f)) Inf else s$f, numeric(1))
        wi <- which.min(rvals)
        if (!qualifies_removal(rstats[[wi]])) break
        removed_term <- removal_candidates[wi]
        current <- setdiff(current, removed_term)
        steps[[length(steps) + 1L]] <- list(terms = current, entered = NULL,
                                             removed = removed_term, change = rstats[[wi]])
        did_something <- TRUE
        just_entered <- NULL
      }
      if (!did_something) break
    }
    if (length(steps) == 0)
      steps[[1]] <- list(terms = character(0), entered = NULL, removed = NULL, change = NULL)
  }

  compute_step_stats <- function(terms) {
    fit_s <- fit_terms(terms)
    if (is.null(fit_s))
      sai_error("No predictors met the entry criteria, and no constant is included — nothing to fit")
    sm_s <- summary(fit_s)
    if (length(terms) > 0) {
      fstat_s <- as.numeric(sm_s$fstatistic[1])
      dfn_s   <- as.integer(sm_s$fstatistic[2])
      dfd_s   <- as.integer(sm_s$fstatistic[3])
      pval_s  <- pf(fstat_s, dfn_s, dfd_s, lower.tail = FALSE)
    } else {
      fstat_s <- NA_real_; dfn_s <- 0L; dfd_s <- as.integer(n - 1L); pval_s <- NA_real_
    }
    sse_s <- sum(residuals(fit_s)^2)
    sst_s <- if (include_const) sum((dat$.y - mean(dat$.y))^2) else sum(dat$.y^2)
    list(fit = fit_s, r2 = sm_s$r.squared, adjr2 = sm_s$adj.r.squared, se = sm_s$sigma,
         fstat = fstat_s, df_num = dfn_s, df_den = dfd_s, pval = pval_s,
         sse = sse_s, sst = sst_s, ssr = sst_s - sse_s, terms = terms)
  }
  step_stats <- lapply(steps, function(s) compute_step_stats(s$terms))
  final <- step_stats[[length(step_stats)]]
  fit    <- final$fit
  se_est <- final$se

  want_coll    <- isTRUE(opts$collinearity)
  want_dw      <- isTRUE(opts$durbinWatson)
  want_ci      <- isTRUE(opts$confidenceIntervals)
  ci_level     <- if (is.null(opts$ciLevel)) 95 else as.numeric(opts$ciLevel)
  want_cov     <- isTRUE(opts$covarianceMatrix)
  want_r2chg   <- isTRUE(opts$rSquaredChange)
  want_desc    <- isTRUE(opts$descriptives)
  want_partial <- isTRUE(opts$partialCorrelations)
  want_casewise<- isTRUE(opts$casewiseDiagnostics)
  casewise_outliers_only <- if (is.null(opts$casewiseOutliersOnly)) TRUE else isTRUE(opts$casewiseOutliersOnly)
  casewise_sd  <- if (is.null(opts$casewiseSD)) 3 else as.numeric(opts$casewiseSD)

  # ── Coefficients (one row-group per step) ───────────────────────────────
  build_coeff_rows_for_step <- function(terms) {
    fit_s  <- fit_terms(terms)
    sm_s   <- summary(fit_s)
    co_s   <- sm_s$coefficients
    sdy    <- sd(dat$.y)
    ci_mat_s <- if (want_ci) stats::confint(fit_s, level = ci_level / 100) else NULL
    get_co <- function(term) if (term %in% rownames(co_s)) co_s[term, ] else rep(NA_real_, 4)
    get_ci <- function(term)
      if (want_ci && term %in% rownames(ci_mat_s)) unname(ci_mat_s[term, ]) else c(NA_real_, NA_real_)

    mk <- function(label, b, se, beta, tval, p, ci_lo, ci_hi, zero_o, partial_o, part_o, tol_vif) {
      row <- list(label, b, se, beta, tval, p)
      if (want_ci) row <- c(row, list(ci_lo, ci_hi))
      if (want_partial) row <- c(row, list(zero_o, partial_o, part_o))
      if (want_coll) row <- c(row, tol_vif)
      row
    }

    rows <- list()
    if (include_const) {
      crow <- get_co("(Intercept)"); ci <- get_ci("(Intercept)")
      rows <- list(mk("output.col.constant", round(crow[1], 6), round(crow[2], 6), NULL,
                       round(crow[3], 6), round(crow[4], 6), round(ci[1], 6), round(ci[2], 6),
                       NULL, NULL, NULL, list(NULL, NULL)))
    }
    for (term in terms) {
      crow <- get_co(term); ci <- get_ci(term)
      others <- setdiff(terms, term)
      beta <- crow[1] * sd(dat[[term]]) / sdy
      if (want_partial) {
        pr <- compute_partial_pair(term, others)
        zero_o    <- round(cor(dat$.y, dat[[term]]), 6)
        partial_o <- round(cor(pr$e_y, pr$e_xi), 6)
        part_o    <- round(cor(dat$.y, pr$e_xi), 6)
      } else { zero_o <- NULL; partial_o <- NULL; part_o <- NULL }
      if (want_coll) {
        tol <- compute_tolerance(term, others)
        tol_vif <- list(round(tol, 4), round(1 / tol, 4))
      } else tol_vif <- list(NULL, NULL)
      rows <- c(rows, list(mk(term_label(term), round(crow[1], 6), round(crow[2], 6),
                               round(beta, 6), round(crow[3], 6), round(crow[4], 6),
                               round(ci[1], 6), round(ci[2], 6), zero_o, partial_o, part_o, tol_vif)))
    }
    rows
  }

  value_cols <- c(list("output.col.b", "output.col.stdError", "output.col.beta",
                       "output.col.t", "output.col.sig"))
  if (want_ci) value_cols <- c(value_cols,
    list(paste0("output.col.ciLowerPct:", ci_level), paste0("output.col.ciUpperPct:", ci_level)))
  if (want_partial) value_cols <- c(value_cols,
    list("output.col.zeroOrder", "output.col.partialCorr", "output.col.partCorr"))
  if (want_coll) value_cols <- c(value_cols, list("output.col.tolerance", "output.col.vif"))

  if (multi_step) {
    coeff_cols <- c(list("output.col.model", "output.col.variable"), value_cols)
    coeff_rows <- list()
    for (i in seq_along(steps)) {
      rows_i <- build_coeff_rows_for_step(steps[[i]]$terms)
      rows_i <- lapply(rows_i, function(r) c(list(i), r))
      coeff_rows <- c(coeff_rows, rows_i)
    }
  } else {
    coeff_cols <- c(list("output.col.model"), value_cols)
    coeff_rows <- build_coeff_rows_for_step(steps[[1]]$terms)
  }

  # ── Model Summary (one row per step) ────────────────────────────────────
  build_ms_row <- function(i) {
    st <- step_stats[[i]]
    row <- list(round(sqrt(max(st$r2, 0)), 6), round(st$r2, 6), round(st$adjr2, 6), round(st$se, 6))
    if (want_r2chg) {
      prev_r2 <- if (i == 1) 0 else step_stats[[i - 1]]$r2
      chg <- steps[[i]]$change
      if (is.null(chg)) {
        f_chg <- st$fstat; p_chg <- st$pval; df1_chg <- st$df_num; df2_chg <- st$df_den
      } else {
        f_chg <- chg$f; p_chg <- chg$p; df1_chg <- chg$df1; df2_chg <- chg$df2
      }
      row <- c(row, list(round(st$r2 - prev_r2, 6), round(f_chg, 6), df1_chg, df2_chg, round(p_chg, 6)))
    }
    if (want_dw) {
      e <- residuals(st$fit)
      row <- c(row, list(round(sum(diff(e)^2) / sum(e^2), 3)))
    }
    row
  }
  ms_value_cols <- list("output.col.rVal", "output.col.rSquare", "output.col.adjRSquare",
                        "output.col.stdErrEst")
  if (want_r2chg) ms_value_cols <- c(ms_value_cols, list("output.col.rSquareChange",
    "output.col.fChange", "output.col.df1", "output.col.df2", "output.col.sigFChange"))
  if (want_dw) ms_value_cols <- c(ms_value_cols, list("output.col.durbinWatson"))

  if (multi_step) {
    ms_cols <- c(list("output.col.model"), ms_value_cols)
    ms_rows <- lapply(seq_along(steps), function(i) c(list(i), build_ms_row(i)))
  } else {
    ms_cols <- ms_value_cols
    ms_rows <- list(build_ms_row(1))
  }

  # ── ANOVA (one row-group per step) ──────────────────────────────────────
  build_anova_rows <- function(i) {
    st <- step_stats[[i]]
    msr_s <- if (st$df_num > 0) st$ssr / st$df_num else NA_real_
    mse_s <- if (st$df_den > 0) st$sse / st$df_den else NA_real_
    list(
      list("output.col.regression", round(st$ssr, 6), st$df_num, round(msr_s, 6),
           round(st$fstat, 6), round(st$pval, 6)),
      list("output.col.residual", round(st$sse, 6), st$df_den, round(mse_s, 6), NULL, NULL),
      list("output.col.total", round(st$sst, 6), as.integer(st$df_num + st$df_den), NULL, NULL, NULL)
    )
  }
  anova_value_cols <- list("output.col.source", "output.col.sumSq", "output.col.df",
                           "output.col.meanSq", "output.col.f", "output.col.sig")
  if (multi_step) {
    anova_cols <- c(list("output.col.model"), anova_value_cols)
    anova_rows <- list()
    for (i in seq_along(steps)) {
      rows_i <- build_anova_rows(i)
      rows_i <- lapply(rows_i, function(r) c(list(i), r))
      anova_rows <- c(anova_rows, rows_i)
    }
  } else {
    anova_cols <- anova_value_cols
    anova_rows <- build_anova_rows(1)
  }

  # ── Excluded Variables (forward/backward/stepwise only) ─────────────────
  excluded_rows <- list()
  if (multi_step) {
    for (i in seq_along(steps)) {
      current  <- steps[[i]]$terms
      excluded <- setdiff(all_terms, current)
      for (term in excluded) {
        stat <- f_to_enter(current, term)
        fit_cand <- fit_terms(c(current, term))
        co_cand  <- summary(fit_cand)$coefficients
        b <- if (term %in% rownames(co_cand)) co_cand[term, 1] else NA_real_
        beta_in <- if (is.na(b)) NA_real_ else b * sd(dat[[term]]) / sd(dat$.y)
        t_in <- if (is.na(stat$f) || is.na(b)) NA_real_ else sign(b) * sqrt(stat$f)
        pr <- compute_partial_pair(term, current)
        excluded_rows[[length(excluded_rows) + 1L]] <- list(
          i, term_label(term), round(beta_in, 6), round(t_in, 6), round(stat$p, 6),
          round(cor(pr$e_y, pr$e_xi), 6), round(compute_tolerance(term, current), 4))
      }
    }
  }

  progress(60L, "progress.computing")

  tables <- list(
    list(titleKey = "output.regression.modelSummaryTitle", columns = ms_cols, rows = ms_rows,
         footnoteKey = NULL),
    list(titleKey = "output.regression.anovaTitle", columns = anova_cols, rows = anova_rows,
         footnoteKey = paste0("output.regression.depFootnote:", dep_name)),
    list(titleKey = "output.regression.coeffTitle", columns = coeff_cols, rows = coeff_rows,
         footnoteKey = paste0("output.regression.depFootnote:", dep_name))
  )
  if (multi_step && length(excluded_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey = "output.regression.excludedTitle",
      columns  = list("output.col.model", "output.col.variable", "output.col.betaIn",
                      "output.col.t", "output.col.sig", "output.col.partialCorr",
                      "output.col.tolerance"),
      rows        = excluded_rows,
      footnoteKey = paste0("output.regression.depFootnote:", dep_name)
    )))
  }

  # ── Covariance / correlation of the coefficient estimates (final step) ──
  if (want_cov && length(final$terms) > 0) {
    fterms  <- final$terms
    fnames  <- vapply(fterms, term_label, character(1))
    covmat  <- vcov(fit)
    cv      <- covmat[fterms, fterms, drop = FALSE]
    cr      <- stats::cov2cor(cv)
    cov_rows <- list()
    for (i in seq_along(fterms)) {
      cov_rows <- c(cov_rows,
        list(c(list(fnames[i], "output.col.correlation"), as.list(round(cr[i, ], 6)))),
        list(c(list("", "output.col.covariance"), as.list(round(cv[i, ], 6)))))
    }
    tables <- c(tables, list(list(
      titleKey    = "output.regression.covMatrixTitle",
      columns     = as.list(unname(c("", "", fnames))),
      rows        = cov_rows,
      footnoteKey = paste0("output.regression.depFootnote:", dep_name)
    )))
  }

  # ── Descriptives: per-variable Mean/SD/N + a Pearson correlation matrix —
  #    every candidate variable, regardless of what the final step kept ────
  if (want_desc) {
    desc_rows <- list(list(dep_name, round(mean(dat$.y), 6), round(sd(dat$.y), 6), n))
    for (i in seq_along(preds)) {
      xi <- dat[[paste0("x", i)]]
      desc_rows <- c(desc_rows, list(list(pred_names[i], round(mean(xi), 6), round(sd(xi), 6), n)))
    }
    tables <- c(tables, list(list(
      titleKey    = "output.regression.descriptivesTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.col.stdDeviation", "output.col.n"),
      rows        = desc_rows,
      footnoteKey = NULL
    )))

    all_names <- c(dep_name, pred_names)
    all_vecs  <- c(list(dat$.y), lapply(seq_along(preds), function(i) dat[[paste0("x", i)]]))
    k <- length(all_names)
    corr_rows <- list()
    for (i in seq_len(k)) {
      corr_row <- list(all_names[i], "output.col.pearsonCorr")
      sig_row  <- list("", "output.col.sigOneTailed")
      n_row    <- list("", "output.col.n")
      for (j in seq_len(k)) {
        if (i == j) {
          corr_row <- c(corr_row, list(1)); sig_row <- c(sig_row, list(""))
        } else {
          ct <- suppressWarnings(cor.test(all_vecs[[i]], all_vecs[[j]]))
          corr_row <- c(corr_row, list(round(as.numeric(ct$estimate), 6)))
          # One-tailed: SPSS halves the two-tailed p (assumes the observed
          # sign is the hypothesised direction).
          sig_row  <- c(sig_row, list(round(ct$p.value / 2, 6)))
        }
        n_row <- c(n_row, list(n))
      }
      corr_rows <- c(corr_rows, list(corr_row), list(sig_row), list(n_row))
    }
    tables <- c(tables, list(list(
      titleKey    = "output.regression.correlationsTitle",
      columns     = as.list(unname(c("", "", all_names))),
      rows        = corr_rows,
      footnoteKey = NULL
    )))
  }

  # ── Casewise diagnostics (final step) ────────────────────────────────────
  if (want_casewise) {
    std_resid <- as.numeric(residuals(fit) / se_est)
    case_idx  <- dat[["__row_idx"]]
    keep <- if (casewise_outliers_only) abs(std_resid) > casewise_sd else rep(TRUE, n)
    ord  <- which(keep)
    fitted_vals <- fitted(fit)
    resid_vals  <- residuals(fit)
    cw_rows <- lapply(ord, function(k) list(
      as.integer(case_idx[k]) + 1L, round(std_resid[k], 3), round(dat$.y[k], 6),
      round(fitted_vals[k], 6), round(resid_vals[k], 6)))
    tables <- c(tables, list(list(
      titleKey    = "output.regression.casewiseTitle",
      columns     = list("output.caseSummaries.caseNumber", "output.col.stdResidual",
                         dep_name, "output.col.predictedValue", "output.col.residual"),
      rows        = cw_rows,
      footnoteKey = paste0("output.regression.depFootnote:", dep_name)
    )))
  }

  # ── Bootstrapping (BOOT2, final step) ───────────────────────────────────
  boot_rows <- list()
  final_form <- build_formula(final$terms)
  boot_out <- sai_bootstrap(
    dat,
    function(data, indices) {
      d <- data[indices, , drop = FALSE]
      stats::coefficients(lm(final_form, data = d))
    },
    params
  )
  if (!is.null(boot_out)) {
    for (r in boot_out) {
      boot_rows <- c(boot_rows, list(list(
        term_label(r$term), round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
        round(r$ci_lower, 6), round(r$ci_upper, 6))))
    }
  }
  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.coefficientsTitle",
      columns     = list("output.col.model", "output.col.b", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  # ── Plots (Plots… sub-dialog, final step) ───────────────────────────────
  # DEPENDNT/ZPRED/ZRESID/DRESID/ADJPRED/SRESID/SDRESID — SPSS's own Plots
  # source-variable tokens.
  reg_plots <- list()
  hat <- as.numeric(hatvalues(fit))
  zpred   <- as.numeric(scale(fitted(fit)))
  zresid  <- as.numeric(residuals(fit) / se_est)
  dresid  <- as.numeric(residuals(fit) / (1 - hat))
  adjpred <- as.numeric(dat$.y - dresid)
  sresid  <- as.numeric(rstandard(fit))
  sdresid <- as.numeric(rstudent(fit))

  plot_vec <- function(token) {
    switch(token,
      DEPENDNT = dat$.y, ZPRED = zpred, ZRESID = zresid, DRESID = dresid,
      ADJPRED = adjpred, SRESID = sresid, SDRESID = sdresid, NULL)
  }
  plot_label <- function(token) {
    switch(token,
      DEPENDNT = dep_name,
      ZPRED = "Regression Standardized Predicted Value",
      ZRESID = "Regression Standardized Residual",
      DRESID = "Deleted Residual",
      ADJPRED = "Adjusted Predicted Value",
      SRESID = "Studentized Residual",
      SDRESID = "Studentized Deleted Residual",
      token)
  }

  scatter_y <- plots_opts$scatterY; scatter_x <- plots_opts$scatterX
  if (!is.null(scatter_y) && !is.null(scatter_x) && nzchar(scatter_y) && nzchar(scatter_x)) {
    py <- plot_vec(scatter_y); px <- plot_vec(scatter_x)
    if (!is.null(py) && !is.null(px)) {
      trace <- list(type = "scatter", mode = "markers", showlegend = FALSE,
                    x = as.list(px), y = as.list(py), marker = list(color = BAR_COLOR, size = 5))
      layout <- list(xaxis = list(title = list(text = plot_label(scatter_x))),
                     yaxis = list(title = list(text = plot_label(scatter_y))),
                     margin = list(t = 40, r = 20, b = 40, l = 60))
      reg_plots <- c(reg_plots, list(list(
        titleKey = "output.regression.scatterTitle", type = "plotly",
        data = list(data = list(trace), layout = layout))))
    }
  }

  if (isTRUE(plots_opts$histogram)) {
    htrace <- sai_histogram_trace(zresid, name = "Std. Residual", color = BAR_COLOR)
    hlayout <- list(xaxis = list(title = list(text = "Regression Standardized Residual")),
                    yaxis = list(title = list(text = "Frequency")),
                    bargap = 0.02, margin = list(t = 40, r = 20, b = 40, l = 60))
    reg_plots <- c(reg_plots, list(list(
      titleKey = "output.regression.histTitle", type = "plotly",
      data = list(data = list(htrace), layout = hlayout))))
  }

  if (isTRUE(plots_opts$normalPP)) {
    ordv <- sort(zresid)
    nn   <- length(ordv)
    m <- mean(ordv); s <- sd(ordv)
    observed_cp <- (seq_len(nn) - 0.5) / nn
    expected_cp <- pnorm(ordv, mean = m, sd = s)
    pptrace <- list(type = "scatter", mode = "markers",
                    x = as.list(expected_cp), y = as.list(observed_cp),
                    marker = list(color = BAR_COLOR))
    diag <- list(type = "scatter", mode = "lines", x = list(0, 1), y = list(0, 1),
                line = list(color = "#999999", dash = "dash"))
    pplayout <- list(xaxis = list(title = list(text = "Expected Cum Prob"), range = list(0, 1)),
                     yaxis = list(title = list(text = "Observed Cum Prob"), range = list(0, 1)),
                     showlegend = FALSE, margin = list(t = 40, r = 20, b = 40, l = 60))
    reg_plots <- c(reg_plots, list(list(
      titleKey = "output.regression.ppTitle", type = "plotly",
      data = list(data = list(pptrace, diag), layout = pplayout))))
  }

  if (isTRUE(plots_opts$partialPlots)) {
    for (term in final$terms) {
      pr <- compute_partial_pair(term, setdiff(final$terms, term))
      ptrace <- list(type = "scatter", mode = "markers", showlegend = FALSE,
                     x = as.list(pr$e_xi), y = as.list(pr$e_y),
                     marker = list(color = BAR_COLOR, size = 5))
      playout <- list(xaxis = list(title = list(text = term_label(term))),
                      yaxis = list(title = list(text = dep_name)),
                      margin = list(t = 40, r = 20, b = 40, l = 60))
      reg_plots <- c(reg_plots, list(list(
        titleKey = paste0("output.regression.partialPlotTitle:", term_label(term)), type = "plotly",
        data = list(data = list(ptrace), layout = playout))))
    }
  }

  progress(90L, "progress.computing")

  # ── New variables (NV1, final step) ─────────────────────────────────────
  # The regression diagnostics people actually re-analyse: a residual you can
  # plot or test for normality, a predicted value you can compare against a
  # holdout, and the influence measures that tell you WHICH case is bending
  # the line. Cases dropped by listwise deletion simply get no value.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    add <- function(key, values, decimals = 4) {
      if (!is.null(want[[key]])) {
        case_vars[[length(case_vars) + 1L]] <<-
          sai_case_var(want[[key]], values, dat,
                       labelKey = paste0("output.regression.newVar.", key), decimals = decimals)
      }
    }
    add("predicted", stats::fitted(fit))
    add("residual", stats::residuals(fit))
    # Standardised = residual / s; studentised (SPSS "Studentized") divides by
    # s * sqrt(1 - h_ii), i.e. it accounts for the leverage of the case, which
    # is why the two differ most exactly where it matters.
    add("standardized", stats::residuals(fit) / se_est)
    add("studentized", stats::rstandard(fit))
    add("deleted", stats::rstudent(fit))
    add("leverage", stats::hatvalues(fit))
    add("cooks", stats::cooks.distance(fit))
    # SPSS reports Mahalanobis distance of the PREDICTORS; for an OLS fit with
    # an intercept that is exactly (n-1)(h_ii - 1/n), so it comes free from the
    # hat values rather than needing the predictor covariance inverted again.
    add("mahalanobis", (n - 1) * (stats::hatvalues(fit) - 1 / n))

    # One column PER COEFFICIENT actually in the final model: the typed name
    # is a STEM that gets 1, 2, 3… appended, in the order lm() itself reports
    # them (intercept first if present).
    if (!is.null(want[["dfbeta"]])) {
      dfb_mat <- as.matrix(stats::dfbeta(fit))
      for (j in seq_len(ncol(dfb_mat))) {
        case_vars[[length(case_vars) + 1L]] <- sai_case_var(
          paste0(want[["dfbeta"]], j), dfb_mat[, j], dat,
          labelKey = paste0("output.regression.newVar.dfbeta:", term_label(colnames(dfb_mat)[j])),
          decimals = 6)
      }
    }
    # Partial (added-variable) residuals: the part of y each predictor explains
    # once the others are held constant. Plotted against the predictor they
    # give the partial-regression plot, which is where a non-linearity that the
    # overall residual plot hides becomes visible.
    if (!is.null(want[["partial"]])) {
      pres <- as.matrix(stats::residuals(fit, type = "partial"))
      for (j in seq_len(ncol(pres))) {
        case_vars[[length(case_vars) + 1L]] <- sai_case_var(
          paste0(want[["partial"]], j), pres[, j], dat,
          labelKey = paste0("output.regression.newVar.partial:", term_label(colnames(pres)[j])),
          decimals = 6)
      }
    }
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = reg_plots, caseVars = case_vars)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
