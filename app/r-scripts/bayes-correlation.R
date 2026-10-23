# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# bayes-correlation.R — Bayesian Pearson Correlation (BayesFactor::correlationBF).
#
# Params: variables (colIds), varNames, rscale. Output: "Bayes Factors"
# (each variable pair: BF10/BF01/error %) + "Posterior Summary" (ρ mean/SD/95%
# credible interval).

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
  cols <- unlist(params$variables); var_names <- params$varNames
  rscale <- if (is.null(params$rscale)) "medium" else params$rscale
  if (length(cols) < 2) sai_error("Correlation needs at least 2 variables")
  nm <- function(c) resolve_var_name(c, var_names)

  bf_rows <- list(); post_rows <- list()
  progress(40L, "progress.computing")
  for (i in seq_len(length(cols) - 1)) {
    for (j in (i + 1):length(cols)) {
      a <- suppressWarnings(as.numeric(df[[cols[i]]])); b <- suppressWarnings(as.numeric(df[[cols[j]]]))
      ok <- is.finite(a) & is.finite(b); a <- a[ok]; b <- b[ok]
      if (length(a) < 3) next
      lbl <- paste0(nm(cols[i]), " – ", nm(cols[j]))
      bf <- BayesFactor::correlationBF(y = a, x = b, rscale = rscale)
      eb <- BayesFactor::extractBF(bf); bf10 <- eb$bf[1]; err <- eb$error[1]
      bf_rows <- c(bf_rows, list(list(lbl, round(bf10, 4), round(1 / bf10, 4), round(100 * err, 4))))
      ch <- BayesFactor::posterior(bf, iterations = SAI_BAYES_DRAWS, progress = FALSE)
      rho <- as.numeric(ch[, "rho"]); qs <- stats::quantile(rho, c(0.025, 0.975))
      post_rows <- c(post_rows, list(list(lbl, round(mean(rho), 4), round(sd(rho), 4),
                                          round(qs[1], 4), round(qs[2], 4))))
    }
  }
  if (length(bf_rows) == 0) sai_error("Not enough data")

  progress(100L, "progress.done")
  sai_output(
    notes = mcmc_note,
    tables = list(
    list(titleKey = "output.bayes.bfTitle",
         columns = list("output.col.variable", "output.bayes.bf10", "output.bayes.bf01",
                        "output.bayes.errorPct"),
         rows = bf_rows, footnoteKey = sai_bf_prior_note(rscale, "correlation")),
    list(titleKey = "output.bayes.postTitle",
         columns = list("output.col.variable", "output.col.mean", "output.col.stdDeviation",
                        "output.col.ciLower95", "output.col.ciUpper95"),
         rows = post_rows, footnoteKey = "output.bayes.rhoFootnote")))
}, error = function(e) sai_error(conditionMessage(e)))
