# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# regression-curve.R — Curve Estimation (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir     — directory containing _bootstrap.R
#   dependents      — character vector of dependent-variable colIds
#   dependentNames  — named list colId -> display name
#   independentMode — "variable" | "time" (time = case sequence 1..N)
#   independent     — independent-variable colId (only when mode = "variable")
#   independentName — display name of the independent
#   caseLabels      — colId of a Case Labels variable (optional; used as plot
#                     hover text on the observed-points trace)
#   includeConstant — bool, default TRUE
#   plotModels      — bool, default TRUE
#   displayAnova    — bool, default FALSE
#   models          — { linear, logarithmic, inverse, quadratic, cubic, power,
#                        s, growth, exponential, compound, logistic } booleans
#   logisticUpperBound — number, required only when models$logistic is TRUE
#
# Every curve family below is fit as an ORDINARY linear regression on a
# transformed y and/or x (the same linearization SPSS's CURVEFIT/Chart Builder
# use) — R²/F/Sig. are computed on that transformed scale, which is also what
# SPSS itself reports (CLAUDE.md §11: this is a case where matching SPSS's own
# convention IS the scientifically legitimate choice, not a weaker substitute
# for it). One "Model Summary and Parameter Estimates" table (+ optional ANOVA
# table, + optional overlay plot) is produced PER DEPENDENT.

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

MODEL_ORDER <- c("linear", "logarithmic", "inverse", "quadratic", "cubic",
                  "power", "s", "growth", "exponential", "compound", "logistic")
MODEL_LABEL_KEY <- c(
  linear = "output.col.mLinear", logarithmic = "output.col.mLogarithmic",
  inverse = "output.col.mInverse", quadratic = "output.col.mQuadratic",
  cubic = "output.col.mCubic", power = "output.col.mPower",
  s = "output.col.mS", growth = "output.col.mGrowth",
  exponential = "output.col.mExponential", compound = "output.col.mCompound",
  logistic = "output.col.mLogistic"
)
# Plot legend names: not run through the i18n pipeline, same precedent as
# survival-cox.R's plot trace names (raw text, plots are not part of the
# table-column translation contract).
MODEL_PLOT_NAME <- c(
  linear = "Linear", logarithmic = "Logarithmic", inverse = "Inverse",
  quadratic = "Quadratic", cubic = "Cubic", power = "Power", s = "S",
  growth = "Growth", exponential = "Exponential", compound = "Compound",
  logistic = "Logistic"
)

#' Build one curve model's linearized fit + back-transform, or NULL if this
#' model's domain requirements (x>0, x!=0, y>0, y<upper) aren't met by the
#' data — the whole model is skipped rather than silently dropping rows, so
#' every model reported for a dependent shares the same case count.
curve_model_spec <- function(model, x, y, upper, include_constant) {
  report_b0 <- identity
  report_b1 <- identity
  if (model == "linear") {
    xt <- function(v) data.frame(x = v)
    yt <- identity; back <- identity
  } else if (model == "logarithmic") {
    if (any(x <= 0)) return(NULL)
    xt <- function(v) data.frame(logx = log(v))
    yt <- identity; back <- identity
  } else if (model == "inverse") {
    if (any(x == 0)) return(NULL)
    xt <- function(v) data.frame(invx = 1 / v)
    yt <- identity; back <- identity
  } else if (model == "quadratic") {
    xt <- function(v) data.frame(x = v, x2 = v^2)
    yt <- identity; back <- identity
  } else if (model == "cubic") {
    xt <- function(v) data.frame(x = v, x2 = v^2, x3 = v^3)
    yt <- identity; back <- identity
  } else if (model == "power") {
    if (any(x <= 0) || any(y <= 0)) return(NULL)
    xt <- function(v) data.frame(logx = log(v))
    yt <- log; back <- exp; report_b0 <- exp
  } else if (model == "compound") {
    if (any(y <= 0)) return(NULL)
    xt <- function(v) data.frame(x = v)
    yt <- log; back <- exp; report_b0 <- exp; report_b1 <- exp
  } else if (model == "s") {
    if (any(x == 0) || any(y <= 0)) return(NULL)
    xt <- function(v) data.frame(invx = 1 / v)
    yt <- log; back <- exp
  } else if (model == "growth") {
    if (any(y <= 0)) return(NULL)
    xt <- function(v) data.frame(x = v)
    yt <- log; back <- exp
  } else if (model == "exponential") {
    if (any(y <= 0)) return(NULL)
    xt <- function(v) data.frame(x = v)
    yt <- log; back <- exp; report_b0 <- exp
  } else if (model == "logistic") {
    if (is.null(upper) || !is.finite(upper) || upper <= 0 ||
        any(y <= 0) || any(y >= upper)) return(NULL)
    xt <- function(v) data.frame(x = v)
    yt <- function(v) log(1 / v - 1 / upper)
    back <- function(eta) 1 / (1 / upper + exp(eta))
    report_b0 <- exp; report_b1 <- exp
  } else {
    return(NULL)
  }

  xdf <- xt(x)
  dat <- cbind(data.frame(.y = yt(y)), xdf)
  rhs <- paste(names(xdf), collapse = " + ")
  form <- stats::as.formula(paste0(".y ~ ", if (include_constant) rhs else paste0("0 + ", rhs)))
  f <- tryCatch(stats::lm(form, data = dat), error = function(e) NULL)
  if (is.null(f) || is.null(summary(f)$fstatistic)) return(NULL)

  list(
    fit = f, back = back, report_b0 = report_b0, report_b1 = report_b1,
    predict_y = function(newx) {
      eta <- as.numeric(stats::predict(f, newdata = xt(newx)))
      back(eta)
    }
  )
}

tryCatch({
  progress(5L, "progress.loading")

  deps <- unlist(params$dependents)
  if (is.null(deps) || length(deps) == 0) sai_error("No dependent variables specified")
  dep_names        <- params$dependentNames
  indep_mode       <- if (is.null(params$independentMode)) "variable" else params$independentMode
  indep            <- params$independent
  case_labels_col  <- params$caseLabels
  include_constant <- on_flag(params$includeConstant, TRUE)
  plot_models      <- on_flag(params$plotModels, TRUE)
  display_anova    <- on_flag(params$displayAnova, FALSE)
  models_req       <- if (is.null(params$models)) list() else params$models
  upper_bound      <- suppressWarnings(as.numeric(params$logisticUpperBound))
  if (length(upper_bound) == 0 || is.na(upper_bound)) upper_bound <- NULL

  time_mode <- identical(indep_mode, "time")
  if (!time_mode && (is.null(indep) || !indep %in% names(df)))
    sai_error("Independent variable not found")
  for (d in deps) if (!d %in% names(df)) sai_error("Dependent variable not found")

  indep_disp_name <- if (time_mode) "output.curve.timeLabel" else
    if (!is.null(params$independentName)) params$independentName else indep

  want <- setNames(vapply(MODEL_ORDER, function(m) isTRUE(models_req[[m]]), logical(1)), MODEL_ORDER)
  if (!any(want)) want["linear"] <- TRUE

  tables <- list(); plots <- list()
  warnings <- character(0); notes <- character(0)
  case_vars <- list()
  want_new <- requested_new_vars(params)
  save_idx <- 0L # running counter across every (dependent x model) combination

  for (dep in deps) {
    dep_label <- if (!is.null(dep_names[[dep]])) dep_names[[dep]] else dep

    y_all <- suppressWarnings(as.numeric(df[[dep]]))
    x_all <- if (time_mode) seq_len(nrow(df)) else suppressWarnings(as.numeric(df[[indep]]))
    lbl_all <- if (!is.null(case_labels_col) && case_labels_col %in% names(df))
      as.character(df[[case_labels_col]]) else NULL

    ok <- !is.na(x_all) & !is.na(y_all)
    x <- x_all[ok]; y <- y_all[ok]
    row_idx <- row_index_of(df)[ok]
    lbl <- if (!is.null(lbl_all)) lbl_all[ok] else NULL
    if (length(y) < 3) {
      warnings <- c(warnings, paste0("output.curve.tooFewCases:", dep_label))
      next
    }
    rows_df <- { d <- data.frame(.tmp = seq_along(row_idx)); d[["__row_idx"]] <- row_idx; d }

    eq_rows <- list(); anova_rows <- list(); plot_traces <- list()
    if (plot_models) {
      plot_traces <- list(list(
        type = "scatter", mode = "markers", name = "Observed",
        marker = list(color = "#4C78A8", size = 6),
        x = as.list(x), y = as.list(y),
        text = if (!is.null(lbl)) as.list(lbl) else NULL
      ))
    }

    for (m in MODEL_ORDER) {
      if (!want[[m]]) next
      spec <- curve_model_spec(m, x, y, upper_bound, include_constant)
      if (is.null(spec)) {
        warnings <- c(warnings, paste0("output.curve.modelSkipped:",
                                       paste0(MODEL_LABEL_KEY[[m]], "|", dep_label)))
        next
      }
      f <- spec$fit
      s <- summary(f)
      fs <- s$fstatistic
      r2 <- s$r.squared
      Fv <- as.numeric(fs[1]); df1 <- as.integer(fs[2]); df2 <- as.integer(fs[3])
      pv <- pf(Fv, df1, df2, lower.tail = FALSE)

      b_raw <- stats::coef(f)
      b0 <- if ("(Intercept)" %in% names(b_raw)) b_raw[["(Intercept)"]] else 0
      terms_b <- b_raw[setdiff(names(b_raw), "(Intercept)")]
      b0_disp <- spec$report_b0(b0)
      b1_disp <- if (length(terms_b) >= 1) spec$report_b1(terms_b[[1]]) else NA_real_
      b2_disp <- if (length(terms_b) >= 2) terms_b[[2]] else NA_real_
      b3_disp <- if (length(terms_b) >= 3) terms_b[[3]] else NA_real_

      eq_rows <- c(eq_rows, list(list(
        MODEL_LABEL_KEY[[m]], round(r2, 6), round(Fv, 6), df1, df2, round(pv, 6),
        round(b0_disp, 6), round(b1_disp, 6),
        if (is.na(b2_disp)) NULL else round(b2_disp, 6),
        if (is.na(b3_disp)) NULL else round(b3_disp, 6))))

      if (display_anova) {
        ss_res <- sum(stats::residuals(f)^2)
        ss_reg <- if (df1 > 0) Fv * df1 * (ss_res / df2) else NA_real_
        ss_tot <- ss_reg + ss_res
        anova_rows <- c(anova_rows, list(
          list(MODEL_LABEL_KEY[[m]], "output.col.regression", round(ss_reg, 6), df1,
               round(ss_reg / df1, 6), round(Fv, 6), round(pv, 6)),
          list(MODEL_LABEL_KEY[[m]], "output.col.residual", round(ss_res, 6), df2,
               round(ss_res / df2, 6), NULL, NULL),
          list(MODEL_LABEL_KEY[[m]], "output.col.total", round(ss_tot, 6),
               as.integer(df1 + df2), NULL, NULL, NULL)))
      }

      if (plot_models) {
        xs <- seq(min(x), max(x), length.out = 100)
        pred_new <- spec$predict_y(xs)
        pred_new[!is.finite(pred_new)] <- NA_real_
        plot_traces <- c(plot_traces, list(list(
          type = "scatter", mode = "lines", name = MODEL_PLOT_NAME[[m]],
          x = as.list(xs), y = as.list(pred_new))))
      }

      if (length(want_new) > 0) {
        save_idx <- save_idx + 1L
        pred_orig <- spec$predict_y(x)
        resid_orig <- y - pred_orig
        pr <- tryCatch(stats::predict(f, interval = "prediction"), error = function(e) NULL)
        lower_orig <- if (is.null(pr)) rep(NA_real_, length(x)) else spec$back(pr[, "lwr"])
        upper_orig <- if (is.null(pr)) rep(NA_real_, length(x)) else spec$back(pr[, "upr"])
        add_stem <- function(key, values) {
          stem <- want_new[[key]]
          if (is.null(stem)) return(invisible(NULL))
          case_vars[[length(case_vars) + 1L]] <<- sai_case_var(
            paste0(stem, save_idx), values, rows_df,
            labelKey = paste0("output.curve.newVar.", key, ":", dep_label, "|", MODEL_LABEL_KEY[[m]]),
            decimals = 6)
        }
        add_stem("predicted", pred_orig)
        add_stem("residual", resid_orig)
        add_stem("lower", lower_orig)
        add_stem("upper", upper_orig)
      }
    } # models

    if (length(eq_rows) > 0) {
      tables <- c(tables, list(list(
        titleKey = paste0("output.curve.title:", dep_label),
        columns  = list("output.col.model", "output.col.rSquare", "output.col.f",
                        "output.col.df1", "output.col.df2", "output.col.sig",
                        "output.col.constant", "output.col.b1", "output.col.b2", "output.col.b3"),
        rows     = eq_rows,
        footnoteKey = paste0("output.curve.indepFootnote:", indep_disp_name)
      )))
    }
    if (display_anova && length(anova_rows) > 0) {
      tables <- c(tables, list(list(
        titleKey = paste0("output.curve.anovaTitle:", dep_label),
        columns  = list("output.col.model", "output.col.source", "output.col.sumSq",
                        "output.col.df", "output.col.meanSq", "output.col.f", "output.col.sig"),
        rows     = anova_rows, footnoteKey = NULL
      )))
    }
    if (plot_models && length(plot_traces) > 1) {
      plots <- c(plots, list(list(
        titleKey = paste0("output.curve.plotTitle:", dep_label), type = "plotly",
        data = list(data = plot_traces, layout = list(
          xaxis = list(title = list(text = if (time_mode) "Time" else indep_disp_name)),
          yaxis = list(title = list(text = dep_label)),
          margin = list(t = 40, r = 20, b = 40, l = 60),
          showlegend = TRUE
        ))
      )))
    }
  } # dependents

  if (length(tables) == 0) sai_error("No models could be fit")

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, warnings = warnings, notes = notes, caseVars = case_vars)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
