# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# bayes-anova.R — Bayesian One-Way ANOVA (BayesFactor::anovaBF).
#
# Params: variables (dependent colIds), varNames, factor (colId), factorName,
#         rscale (Cauchy scale on fixed effects). Output: "Bayes Factors" — per
#         dependent, BF10 (factor model vs null) / BF01 / error %.

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
  invisible(sai_bayes_seed(params)) # anovaBF error % is sampling-based; no posterior here, so no note
  cols <- unlist(params$variables); var_names <- params$varNames
  fac <- params$factor; rscale <- if (is.null(params$rscale)) "medium" else params$rscale
  if (length(cols) == 0) sai_error("No dependent variables")
  if (is.null(fac) || !fac %in% names(df)) sai_error("Factor not found")
  labels <- vapply(cols, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  gf <- factor(df[[fac]])
  bf_rows <- list()
  progress(40L, "progress.computing")
  for (i in seq_along(cols)) {
    y <- suppressWarnings(as.numeric(df[[cols[i]]]))
    ok <- is.finite(y) & !is.na(gf); dat <- data.frame(y = y[ok], g = droplevels(gf[ok]))
    if (nlevels(dat$g) < 2 || nrow(dat) < 3) next
    bf <- BayesFactor::anovaBF(y ~ g, data = dat, rscaleFixed = rscale, progress = FALSE)
    eb <- BayesFactor::extractBF(bf); bf10 <- eb$bf[1]; err <- eb$error[1]
    bf_rows <- c(bf_rows, list(list(labels[i], round(bf10, 4), round(1 / bf10, 4),
                                    round(100 * err, 4))))
  }
  if (length(bf_rows) == 0) sai_error("Not enough data")

  progress(100L, "progress.done")
  sai_output(tables = list(list(
    titleKey = "output.bayes.bfTitle",
    columns = list("output.col.variable", "output.bayes.bf10", "output.bayes.bf01",
                   "output.bayes.errorPct"),
    rows = bf_rows, footnoteKey = sai_bf_prior_note(rscale, "anovaFixed"))))
}, error = function(e) sai_error(conditionMessage(e)))
