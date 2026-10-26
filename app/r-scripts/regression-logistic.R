# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# regression-logistic.R — Binary Logistic Regression (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir  — directory containing _bootstrap.R
#   dependent    — dependent-variable colId (binary)
#   dependentName— display name of the dependent
#   covariates   — character vector of predictor colIds
#   varNames     — named list colId → display name
#   options      — LogisticOptions (shared/logistic-types.ts); every field is
#                  optional in the JSON, on_flag()/%||% below supply defaults
#
# Output: "Model Summary" (-2 Log likelihood, Cox & Snell R², Nagelkerke R²),
#         "Variables in the Equation" (B, S.E., Wald, df, Sig., Exp(B), and
#         optionally CI for Exp(B)), plus whichever of the Options tables were
#         requested: Iteration History, Hosmer-Lemeshow test (+ contingency
#         table), Classification Table (+ plot), Casewise listing of
#         residuals, Correlation Matrix of estimates.

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

tryCatch({
  progress(10L, "progress.loading")

  dep       <- params$dependent
  dep_name  <- if (is.null(params$dependentName)) dep else params$dependentName
  covs      <- unlist(params$covariates)
  var_names <- params$varNames
  opts      <- params$options
  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (length(covs) == 0) sai_error("No covariates specified")

  include_constant <- on_flag(opts$includeConstant, TRUE)
  max_iter         <- as.integer(num_opt(opts$maxIterations, 20))
  cutoff           <- num_opt(opts$classificationCutoff, 0.5)
  ci_level         <- num_opt(opts$ciLevel, 95)

  cov_names <- vapply(covs, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  yraw <- df[[dep]]
  dat  <- data.frame(.raw = yraw)
  for (i in seq_along(covs)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[covs[i]]]))
  # Carried through the listwise deletion so any new variable this run creates
  # knows which dataset rows its values belong to (NV1, roadmap ★11).
  dat[["__row_idx"]] <- row_index_of(df)
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]

  # Encode the dependent as 0/1 (lower category = 0, higher category = 1).
  # Numeric codes sort numerically ("2" < "10"); sorting the strings made 10 the
  # reference and 2 the event for 2/10 codings, reversing every B and Exp(B).
  lev_chr <- unique(as.character(dat$.raw))
  lev_num <- suppressWarnings(as.numeric(lev_chr))
  lev <- if (!anyNA(lev_num)) lev_chr[order(lev_num)] else sort(lev_chr)
  if (length(lev) != 2) sai_error("Dependent variable must have exactly two categories")
  dat$.y <- as.integer(as.character(dat$.raw) == lev[2])
  n <- nrow(dat)
  if (n <= length(covs) + 1) sai_error("Not enough complete cases for logistic regression")

  rhs  <- paste(paste0("x", seq_along(covs)), collapse = " + ")
  form <- as.formula(paste(".y ~", if (include_constant) rhs else paste("0 +", rhs)))

  trace_lines <- capture.output(
    fit <- glm(form, data = dat, family = binomial(),
               control = glm.control(maxit = max_iter, trace = TRUE))
  )
  sm   <- summary(fit)
  co   <- sm$coefficients

  warnings <- character(0)
  notes    <- character(0)
  if (!isTRUE(fit$converged)) warnings <- c(warnings, "output.logistic.notConverged")
  fitted_p <- stats::fitted(fit)
  if (any(fitted_p < 1e-8 | fitted_p > 1 - 1e-8)) warnings <- c(warnings, "output.logistic.separation")

  dev0 <- fit$null.deviance
  dev1 <- fit$deviance
  cox  <- 1 - exp((dev1 - dev0) / n)
  nag  <- cox / (1 - exp(-dev0 / n))
  prob <- as.numeric(stats::fitted(fit))

  # ── Variables in the Equation ───────────────────────────────────────────────
  # Predictors first, constant last (SPSS order); the constant row is simply
  # absent when the model was fit without one.
  b_all  <- stats::coef(fit)
  cnames <- names(b_all)
  const_i <- which(cnames == "(Intercept)")
  pred_i  <- setdiff(seq_along(b_all), const_i)
  order_idx <- c(pred_i, const_i)

  z_crit <- stats::qnorm(1 - (1 - ci_level / 100) / 2)
  want_ci <- on_flag(opts$ciExpB)
  eq_rows <- list()
  for (r in order_idx) {
    b  <- b_all[r]; se <- co[r, "Std. Error"]
    wald <- (b / se)^2
    pv   <- pchisq(wald, 1, lower.tail = FALSE)
    is_const <- identical(cnames[r], "(Intercept)")
    lbl  <- if (is_const) "output.col.constant" else {
      idx <- as.integer(sub("^x", "", cnames[r]))
      cov_names[idx]
    }
    row <- list(lbl, round(b, 6), round(se, 6), round(wald, 6), 1L, round(pv, 6), round(exp(b), 6))
    if (want_ci) {
      row <- if (is_const) c(row, list("", "")) else
        c(row, list(round(exp(b - z_crit * se), 6), round(exp(b + z_crit * se), 6)))
    }
    eq_rows <- c(eq_rows, list(row))
  }

  progress(60L, "progress.computing")

  eq_cols <- list("output.col.model", "output.col.b", "output.col.stdError",
                  "output.col.wald", "output.col.df", "output.col.sig", "output.col.expB")
  if (want_ci) eq_cols <- c(eq_cols, list("output.col.expBLower", "output.col.expBUpper"))

  tables <- list(
    list(
      titleKey    = "output.logistic.modelSummaryTitle",
      columns     = list("output.col.neg2LL", "output.col.coxSnell", "output.col.nagelkerke"),
      rows        = list(list(round(dev1, 6), round(cox, 6), round(nag, 6))),
      footnoteKey = NULL
    ),
    list(
      titleKey    = "output.logistic.equationTitle",
      columns     = eq_cols,
      rows        = eq_rows,
      footnoteKey = paste0("output.logistic.depFootnote:", dep_name, " (", lev[2], " = 1)")
    )
  )

  # ── Iteration History ───────────────────────────────────────────────────────
  if (on_flag(opts$iterationHistory)) {
    m <- regmatches(trace_lines, regexec("Deviance = ([0-9.eE+-]+) Iterations - ([0-9]+)",
                                         trace_lines))
    m <- Filter(function(x) length(x) == 3, m)
    if (length(m) > 0) {
      tables <- c(tables, list(list(
        titleKey    = "output.logistic.iterationTitle",
        columns     = list("output.col.iteration", "output.col.neg2LL"),
        rows        = lapply(m, function(x) list(as.integer(x[3]), round(as.numeric(x[2]), 6))),
        footnoteKey = NULL
      )))
    } else {
      warnings <- c(warnings, "output.logistic.iterationUnavailable")
    }
  }

  # ── Correlation of estimates ────────────────────────────────────────────────
  if (on_flag(opts$correlation)) {
    # unname(): vapply() over a character X auto-names the result BY ITS OWN
    # VALUES (USE.NAMES default), and as.list() on a named vector carries
    # those names onto the list elements — which makes jsonlite serialize
    # `columns` as a JSON OBJECT instead of an array. Caught by running this
    # script end-to-end against a synthetic dataset outside the app harness.
    labs <- unname(vapply(cnames, function(nm)
      if (identical(nm, "(Intercept)")) "output.col.constant"
      else cov_names[as.integer(sub("^x", "", nm))], character(1)))
    R <- tryCatch(stats::cov2cor(as.matrix(stats::vcov(fit))), error = function(e) NULL)
    if (!is.null(R)) {
      tables <- c(tables, list(list(
        titleKey    = "output.logistic.correlationTitle",
        columns     = c(list("output.col.variable"), as.list(labs)),
        rows        = lapply(seq_len(nrow(R)), function(i)
          c(list(labs[i]), lapply(seq_len(ncol(R)), function(j) round(R[i, j], 6)))),
        footnoteKey = NULL
      )))
    }
  }

  # ── Hosmer-Lemeshow goodness-of-fit ─────────────────────────────────────────
  if (on_flag(opts$hosmerLemeshow)) {
    g <- min(10L, length(unique(prob)))
    if (g < 3L) {
      warnings <- c(warnings, "output.logistic.hlUnavailable")
    } else {
      grp <- cut(prob, breaks = unique(stats::quantile(prob, probs = seq(0, 1, length.out = g + 1))),
                include.lowest = TRUE, labels = FALSE)
      g <- length(unique(grp))
      obs1 <- tapply(dat$.y, grp, sum)
      cnt  <- tapply(dat$.y, grp, length)
      exp1 <- tapply(prob, grp, sum)
      hl_stat <- sum((obs1 - exp1)^2 / exp1 + ((cnt - obs1) - (cnt - exp1))^2 / (cnt - exp1))
      hl_df   <- g - 2
      hl_p    <- pchisq(hl_stat, hl_df, lower.tail = FALSE)
      tables <- c(tables, list(list(
        titleKey    = "output.logistic.hlTitle",
        columns     = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
        rows        = list(list(round(hl_stat, 6), hl_df, round(hl_p, 6))),
        footnoteKey = NULL
      )))
      grp_ord <- sort(unique(grp))
      tables <- c(tables, list(list(
        titleKey    = "output.logistic.hlContingencyTitle",
        columns     = list("output.col.group", "output.col.n",
                           paste0("output.logistic.observedFor:", lev[2]),
                           paste0("output.logistic.expectedFor:", lev[2]),
                           paste0("output.logistic.observedFor:", lev[1]),
                           paste0("output.logistic.expectedFor:", lev[1])),
        rows        = lapply(grp_ord, function(k) list(
          as.integer(k), as.integer(cnt[[as.character(k)]]),
          as.integer(obs1[[as.character(k)]]), round(exp1[[as.character(k)]], 6),
          as.integer(cnt[[as.character(k)]] - obs1[[as.character(k)]]),
          round(cnt[[as.character(k)]] - exp1[[as.character(k)]], 6))),
        footnoteKey = NULL
      )))
    }
  }

  # ── Classification table ────────────────────────────────────────────────────
  pred_cat <- ifelse(prob >= cutoff, lev[2], lev[1])
  tab <- table(factor(dat$.raw, levels = lev), factor(pred_cat, levels = lev))
  pct1 <- if (sum(tab[1, ]) > 0) tab[1, 1] / sum(tab[1, ]) * 100 else NA_real_
  pct2 <- if (sum(tab[2, ]) > 0) tab[2, 2] / sum(tab[2, ]) * 100 else NA_real_
  overall_pct <- (tab[1, 1] + tab[2, 2]) / sum(tab) * 100
  tables <- c(tables, list(list(
    titleKey    = "output.logistic.classificationTitle",
    columns     = list("", lev[1], lev[2], "output.col.pctCorrect"),
    rows        = list(
      list(lev[1], as.integer(tab[1, 1]), as.integer(tab[1, 2]),
           if (is.na(pct1)) "" else round(pct1, 1)),
      list(lev[2], as.integer(tab[2, 1]), as.integer(tab[2, 2]),
           if (is.na(pct2)) "" else round(pct2, 1)),
      list("output.col.total", "", "", round(overall_pct, 1))
    ),
    footnoteKey = paste0("output.logistic.classificationCutFootnote:", format(cutoff, nsmall = 3))
  )))

  # ── Casewise listing of residuals ───────────────────────────────────────────
  if (on_flag(opts$casewiseListing)) {
    resid_raw <- stats::residuals(fit, type = "response")
    zresid    <- resid_raw / sqrt(prob * (1 - prob))
    threshold <- num_opt(opts$casewiseThreshold, 2)
    outliers_only <- on_flag(opts$casewiseOutliersOnly, TRUE)
    idx <- if (outliers_only) which(abs(zresid) > threshold) else seq_len(n)
    if (outliers_only && length(idx) == 0) {
      notes <- c(notes, "output.logistic.noOutliers")
    } else {
      case_no <- as.integer(dat[["__row_idx"]][idx]) + 1L
      tables <- c(tables, list(list(
        titleKey    = "output.logistic.casewiseTitle",
        columns     = list("output.col.case", "output.col.observed", "output.col.predictedGroup",
                           "output.col.predictedProb", "output.col.residual", "output.col.zResid"),
        rows        = lapply(seq_along(idx), function(k) {
          i <- idx[k]
          list(case_no[k], as.character(dat$.raw[i]), pred_cat[i],
               round(prob[i] * 100, 1), round(resid_raw[i], 6), round(zresid[i], 6))
        }),
        footnoteKey = if (outliers_only)
          paste0("output.logistic.casewiseOutlierFootnote:", format(threshold, nsmall = 1))
        else "output.logistic.casewiseAllFootnote"
      )))
    }
  }

  progress(80L, "progress.computing")

  # ── Classification plot ─────────────────────────────────────────────────────
  plots <- list()
  if (on_flag(opts$classificationPlots)) {
    mk_trace <- function(which_lev) {
      vals <- prob[as.character(dat$.raw) == which_lev]
      list(type = "histogram", name = which_lev, opacity = 0.65,
           xbins = list(start = 0, end = 1, size = 0.05),
           x = as.list(vals))
    }
    plots <- list(list(
      titleKey = "output.logistic.classificationPlotTitle", type = "plotly",
      data = list(data = list(mk_trace(lev[1]), mk_trace(lev[2])), layout = list(
        barmode = "overlay",
        xaxis = list(title = list(text = "Predicted probability"), range = list(0, 1)),
        yaxis = list(title = list(text = "Frequency")),
        margin = list(t = 40, r = 20, b = 40, l = 60),
        showlegend = TRUE))
    ))
  }

  # ── New variables (NV1) ────────────────────────────────────────────────────
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    add <- function(key, values, decimals = 4, type = "numeric", measure = "scale") {
      if (!is.null(want[[key]])) {
        case_vars[[length(case_vars) + 1L]] <<-
          sai_case_var(want[[key]], values, dat,
                       labelKey = paste0("output.logistic.newVar.", key),
                       type = type, measure = measure, decimals = decimals)
      }
    }
    add("probability", prob)
    # The predicted GROUP is written back as the original category label, not
    # as 0/1: a column the user has to decode against "lower category = 0" is
    # useless as the input to the next analysis, which is the whole point.
    add("predictedGroup", pred_cat, type = "string", measure = "nominal")
    add("residual", stats::residuals(fit, type = "response"))
    add("logit", stats::residuals(fit, type = "response") / (prob * (1 - prob)))
    add("standardized", stats::rstandard(fit, type = "pearson"))
    add("studentized", stats::rstudent(fit))
    add("deviance", stats::residuals(fit, type = "deviance"))
    add("leverage", stats::hatvalues(fit))
    add("cooks", stats::cooks.distance(fit))

    # DfBeta: one column PER COEFFICIENT, so the name the user typed is a STEM
    # that gets 1, 2, 3… appended (matches Cox's dfbeta / Schoenfeld slots).
    stem <- want[["dfbeta"]]
    if (!is.null(stem)) {
      dfb <- as.matrix(stats::dfbeta(fit))
      for (j in seq_len(ncol(dfb))) {
        lbl <- if (identical(cnames[j], "(Intercept)")) "output.col.constant" else
          cov_names[as.integer(sub("^x", "", cnames[j]))]
        case_vars[[length(case_vars) + 1L]] <- sai_case_var(
          paste0(stem, j), dfb[, j], dat,
          labelKey = paste0("output.logistic.newVar.dfbeta:", lbl), decimals = 6)
      }
    }
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots, warnings = warnings, notes = notes,
             caseVars = case_vars)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
