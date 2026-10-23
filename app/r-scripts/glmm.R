# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# glmm.R — Generalized Linear Mixed Models (SPSS Mixed → Generalized Linear).
#
# Params: dependent (colId), dependentName, predictors (colIds, fixed effects),
#         subject (colId, random-intercept grouping), family ("binomial"|
#         "poisson"), varNames.
# Output: "Information Criteria" (AIC, BIC, −2 Log Likelihood, Deviance),
#         "Fixed Effects" (B, Std. Error, z, Sig., Exp(B)) and "Random Effects"
#         (random-intercept variance + SD). Requires the lme4 package.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("lme4", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.glmm.needsPackage"); quit(save = "no")
  }
  dep   <- params$dependent
  dname <- if (is.null(params$dependentName)) dep else params$dependentName
  preds <- unlist(params$predictors); subj <- params$subject
  var_names <- params$varNames
  fam <- if (is.null(params$family)) "binomial" else params$family
  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (is.null(subj) || !subj %in% names(df)) sai_error("Subject variable not found")
  if (length(preds) == 0) sai_error("No predictors specified")
  pred_names <- vapply(preds, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  dat <- data.frame(.y = suppressWarnings(as.numeric(df[[dep]])), .g = factor(df[[subj]]))
  for (i in seq_along(preds)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[preds[i]]]))
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  if (nrow(dat) <= length(preds) + 2) sai_error("Not enough complete cases")
  if (nlevels(dat$.g) < 2) sai_error("Subject factor needs at least 2 groups")

  progress(40L, "progress.computing")
  famobj <- switch(fam, poisson = poisson(link = "log"), binomial(link = "logit"))
  form <- as.formula(paste(".y ~", paste(paste0("x", seq_along(preds)), collapse = " + "),
                           "+ (1 | .g)"))
  fit <- lme4::glmer(form, data = dat, family = famobj)
  s   <- summary(fit)

  ll <- as.numeric(logLik(fit))
  fit_rows <- list(
    list("output.col.aic", round(AIC(fit), 3)),
    list("output.col.bic", round(BIC(fit), 3)),
    list("output.glmm.m2ll", round(-2 * ll, 3)),
    list("output.col.deviance", round(deviance(fit), 3)))

  co <- s$coefficients
  fe_rows <- lapply(seq_len(nrow(co)), function(i) {
    b <- co[i, 1]; se <- co[i, 2]
    list(if (i == 1) "output.col.constant" else pred_names[i - 1],
         round(b, 6), round(se, 6), round(co[i, 3], 3), round(co[i, 4], 6),
         round(exp(b), 3))
  })

  vc <- as.data.frame(lme4::VarCorr(fit))
  iv_row <- vc[vc$grp == ".g" & is.na(vc$var2) & vc$var1 == "(Intercept)", , drop = FALSE]
  iv <- if (nrow(iv_row) > 0) iv_row$vcov[1] else NA
  re_rows <- list(list("output.glmm.interceptVar",
                       round(iv, 6), round(sqrt(iv), 6)))

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(titleKey = "output.glmm.fitTitle",
         columns = list("output.col.statistic", "output.col.value"),
         rows = fit_rows, footnoteKey = paste0("output.glmm.depFootnote:", dname)),
    list(titleKey = "output.glmm.fixedTitle",
         columns = list("output.col.model", "output.col.b", "output.col.stdError",
                        "output.col.z", "output.col.sig", "output.col.expB"),
         rows = fe_rows, footnoteKey = NULL),
    list(titleKey = "output.glmm.randomTitle",
         columns = list("output.col.parameter", "output.col.variance", "output.col.stdDev"),
         rows = re_rows, footnoteKey = NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
