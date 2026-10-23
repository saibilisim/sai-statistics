# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# gee.R — Generalized Estimating Equations (SPSS Generalized Estimating Equations).
#
# Params: dependent (colId), dependentName, predictors (colIds), subject (colId,
#         cluster id), family ("gaussian"|"poisson"|"binomial"),
#         corstr ("independence"|"exchangeable"|"ar1"), varNames.
# Output: "Model Information" + "Parameter Estimates" (B, Std. Error, Wald χ²,
#         Sig., Exp(B) for log/logit links). Requires the geepack package.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("geepack", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.gee.needsPackage"); quit(save = "no")
  }
  dep   <- params$dependent
  dname <- if (is.null(params$dependentName)) dep else params$dependentName
  preds <- unlist(params$predictors); subj <- params$subject
  var_names <- params$varNames
  fam    <- if (is.null(params$family)) "gaussian" else params$family
  corstr <- if (is.null(params$corstr)) "exchangeable" else params$corstr
  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (is.null(subj) || !subj %in% names(df)) sai_error("Subject variable not found")
  if (length(preds) == 0) sai_error("No predictors specified")
  pred_names <- vapply(preds, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  dat <- data.frame(.y = suppressWarnings(as.numeric(df[[dep]])),
                    .id = df[[subj]])
  for (i in seq_along(preds)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[preds[i]]]))
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  dat <- dat[order(dat$.id), , drop = FALSE]
  if (nrow(dat) <= length(preds) + 2) sai_error("Not enough complete cases")

  progress(40L, "progress.computing")
  famobj <- switch(fam,
    poisson  = poisson(link = "log"),
    binomial = binomial(link = "logit"),
    gaussian(link = "identity"))
  form <- as.formula(paste(".y ~", paste(paste0("x", seq_along(preds)), collapse = " + ")))
  fit  <- geepack::geeglm(form, id = dat$.id, data = dat, family = famobj, corstr = corstr)
  co   <- summary(fit)$coefficients
  exp_link <- fam %in% c("poisson", "binomial")

  info_rows <- list(
    list("output.gee.depVar", dname),
    list("output.gee.distribution", fam),
    list("output.gee.corstr", corstr),
    list("output.gee.subjects", as.character(length(unique(dat$.id)))))

  pe_cols <- list("output.col.model", "output.col.b", "output.col.stdError",
                  "output.col.wald", "output.col.df", "output.col.sig")
  if (exp_link) pe_cols <- c(pe_cols, list("output.col.expB"))
  pe_rows <- lapply(seq_len(nrow(co)), function(i) {
    b <- co[i, 1]; se <- co[i, 2]; wald <- co[i, 3]; sig <- co[i, 4]
    base <- list(if (i == 1) "output.col.constant" else pred_names[i - 1],
                 round(b, 6), round(se, 6), round(wald, 3), 1L, round(sig, 6))
    if (exp_link) base <- c(base, list(round(exp(b), 3)))
    base
  })

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(titleKey = "output.gee.infoTitle",
         columns = list("output.gee.item", "output.col.value"),
         rows = info_rows, footnoteKey = NULL),
    list(titleKey = "output.gee.paramTitle",
         columns = pe_cols, rows = pe_rows, footnoteKey = NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
