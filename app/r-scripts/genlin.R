# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# genlin.R — Generalized Linear Models (SPSS GENLIN-style).
#
# Params: dependent (colId), dependentName, predictors (colIds), varNames,
#         distribution ("poisson"|"negbin"|"gamma"|"normal").
# Output: "Goodness of Fit" (Deviance, Pearson Chi-Square, Log Likelihood, AIC,
#         BIC), "Omnibus Test" (LR Chi-Square, df, Sig.) and "Parameter
#         Estimates" (B, Std. Error, Wald Chi-Square, df, Sig., Exp(B), 95% CI).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  dep  <- params$dependent
  dname <- if (is.null(params$dependentName)) dep else params$dependentName
  preds <- unlist(params$predictors); var_names <- params$varNames
  dist  <- if (is.null(params$distribution)) "poisson" else params$distribution
  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (length(preds) == 0) sai_error("No predictors specified")
  if (dist == "negbin" && !requireNamespace("MASS", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.genlin.needsPackage"); quit(save = "no")
  }
  pred_names <- vapply(preds, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  dat <- data.frame(.y = suppressWarnings(as.numeric(df[[dep]])))
  for (i in seq_along(preds)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[preds[i]]]))
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  if (nrow(dat) <= length(preds) + 1) sai_error("Not enough complete cases")

  form  <- as.formula(paste(".y ~", paste(paste0("x", seq_along(preds)), collapse = " + ")))
  nform <- .y ~ 1
  fit <- switch(dist,
    negbin = MASS::glm.nb(form, data = dat),
    gamma  = glm(form, data = dat, family = Gamma(link = "log")),
    normal = glm(form, data = dat, family = gaussian(link = "identity")),
    glm(form, data = dat, family = poisson(link = "log")))
  null <- switch(dist,
    negbin = MASS::glm.nb(nform, data = dat),
    gamma  = glm(nform, data = dat, family = Gamma(link = "log")),
    normal = glm(nform, data = dat, family = gaussian(link = "identity")),
    glm(nform, data = dat, family = poisson(link = "log")))

  ll  <- as.numeric(logLik(fit))
  gof_rows <- list(
    list("output.col.deviance", round(fit$deviance, 3), as.integer(fit$df.residual)),
    list("output.col.pearsonChi", round(sum(residuals(fit, "pearson")^2), 3),
         as.integer(fit$df.residual)),
    list("output.col.logLikelihood", round(ll, 3), NULL),
    list("output.col.aic", round(AIC(fit), 3), NULL),
    list("output.col.bic", round(BIC(fit), 3), NULL))

  # Likelihood-ratio chi-square = 2 * (logLik_full - logLik_null). The deviance
  # difference is only that for a fixed-dispersion family (Poisson): for
  # normal/gamma it is in the units of the response, and for negbin the two
  # fits estimate different thetas.
  lrchi <- max(0, 2 * (as.numeric(logLik(fit)) - as.numeric(logLik(null)))); dfm <- length(preds)
  omni_rows <- list(list(round(lrchi, 3), as.integer(dfm),
                         round(pchisq(lrchi, dfm, lower.tail = FALSE), 6)))

  co <- summary(fit)$coefficients
  pe_rows <- list()
  lbl <- c("output.col.constant", pred_names)
  for (i in seq_len(nrow(co))) {
    b <- co[i, 1]; se <- co[i, 2]; wald <- (b / se)^2
    pe_rows <- c(pe_rows, list(list(
      if (i == 1) "output.col.constant" else pred_names[i - 1],
      round(b, 6), round(se, 6),
      round(wald, 3), 1L, round(pchisq(wald, 1, lower.tail = FALSE), 6),
      round(exp(b), 3), round(exp(b - qnorm(0.975) * se), 3),
      round(exp(b + qnorm(0.975) * se), 3))))
  }

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(titleKey = "output.genlin.gofTitle",
         columns = list("output.col.statistic", "output.col.value", "output.col.df"),
         rows = gof_rows, footnoteKey = paste0("output.genlin.distFootnote:", dist)),
    list(titleKey = "output.genlin.omniTitle",
         columns = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
         rows = omni_rows, footnoteKey = NULL),
    list(titleKey = "output.genlin.paramTitle",
         columns = list("output.col.model", "output.col.b", "output.col.stdError",
                        "output.col.wald", "output.col.df", "output.col.sig",
                        "output.col.expB", "output.col.expBLower", "output.col.expBUpper"),
         rows = pe_rows, footnoteKey = paste0("output.genlin.depFootnote:", dname))))
}, error = function(e) sai_error(conditionMessage(e)))
