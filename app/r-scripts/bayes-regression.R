# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# bayes-regression.R — Bayesian Linear Regression (BayesFactor::lmBF).
#
# Params: dependent (colId), dependentName, independents (colIds), varNames,
#         rscale (Cauchy scale on standardized coefficients).
# Output: "Bayes Factors" (full model vs intercept-only: BF10/BF01/error %) and
#         "Posterior Summary" (each coefficient: mean/SD/95% credible interval).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("BayesFactor", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.bayes.needsPackage"); quit(save = "no")
  }
  mcmc_note <- sai_bayes_seed(params)
  dep <- params$dependent; preds <- unlist(params$independents); var_names <- params$varNames
  rscale <- if (is.null(params$rscale)) "medium" else params$rscale
  if (is.null(dep) || !dep %in% names(df)) sai_error("Dependent variable not found")
  if (length(preds) == 0) sai_error("No predictors specified")
  pred_names <- vapply(preds, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  dat <- data.frame(.y = suppressWarnings(as.numeric(df[[dep]])))
  for (i in seq_along(preds)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[preds[i]]]))
  dat <- dat[stats::complete.cases(dat) & apply(is.finite(as.matrix(dat)), 1, all), , drop = FALSE]
  if (nrow(dat) <= length(preds) + 1) sai_error("Not enough complete cases")

  progress(40L, "progress.computing")
  form <- as.formula(paste(".y ~", paste(paste0("x", seq_along(preds)), collapse = " + ")))
  bf <- BayesFactor::lmBF(form, data = dat, rscaleCont = rscale, progress = FALSE)
  eb <- BayesFactor::extractBF(bf); bf10 <- eb$bf[1]; err <- eb$error[1]
  bf_rows <- list(list("output.bayes.fullModel", round(bf10, 4), round(1 / bf10, 4),
                       round(100 * err, 4)))

  ch <- BayesFactor::posterior(bf, iterations = SAI_BAYES_DRAWS, progress = FALSE)
  cn <- colnames(ch)
  post_rows <- list()
  for (i in seq_along(preds)) {
    nm <- paste0("x", i)
    if (!(nm %in% cn)) next
    s <- as.numeric(ch[, nm]); qs <- stats::quantile(s, c(0.025, 0.975))
    post_rows <- c(post_rows, list(list(pred_names[i], round(mean(s), 6), round(sd(s), 6),
                                        round(qs[1], 6), round(qs[2], 6))))
  }

  progress(100L, "progress.done")
  sai_output(
    notes = mcmc_note,
    tables = list(
    list(titleKey = "output.bayes.bfTitle",
         columns = list("output.col.variable", "output.bayes.bf10", "output.bayes.bf01",
                        "output.bayes.errorPct"),
         rows = bf_rows, footnoteKey = sai_bf_prior_note(rscale, "lmCont")),
    list(titleKey = "output.bayes.postTitle",
         columns = list("output.col.model", "output.col.mean", "output.col.stdDeviation",
                        "output.col.ciLower95", "output.col.ciUpper95"),
         rows = post_rows, footnoteKey = "output.bayes.coefFootnote")))
}, error = function(e) sai_error(conditionMessage(e)))
