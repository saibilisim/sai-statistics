# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# bayes-ttest-onesample.R — Bayesian One-Sample T Test (BayesFactor::ttestBF).
#
# Params: variables (colIds), varNames, testValue (mu), rscale.
# Output: "Bayes Factors" (BF10/BF01/error %) + "Posterior Summary" (effect
#         size δ mean/SD/95% credible interval) + posterior density plot.

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
  mu <- if (is.null(params$testValue)) 0 else as.numeric(params$testValue)
  rscale <- if (is.null(params$rscale)) "medium" else params$rscale
  if (length(cols) == 0) sai_error("No test variables")
  labels <- vapply(cols, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  bf_rows <- list(); post_rows <- list(); plot_obj <- NULL
  progress(40L, "progress.computing")
  for (i in seq_along(cols)) {
    v <- suppressWarnings(as.numeric(df[[cols[i]]])); v <- v[is.finite(v)]
    if (length(v) < 2) next
    # Test mean == mu by shifting to a mu = 0 problem. The Bayes factor is
    # identical, but the posterior δ is then centered on mu (BayesFactor's
    # one-sample posterior otherwise reports the raw standardized mean).
    bf <- BayesFactor::ttestBF(x = v - mu, rscale = rscale)
    eb <- BayesFactor::extractBF(bf); bf10 <- eb$bf[1]; err <- eb$error[1]
    bf_rows <- c(bf_rows, list(list(labels[i], round(bf10, 4), round(1 / bf10, 4),
                                    round(100 * err, 4))))
    ch <- BayesFactor::posterior(bf, iterations = SAI_BAYES_DRAWS, progress = FALSE)
    delta <- as.numeric(ch[, "delta"]); qs <- stats::quantile(delta, c(0.025, 0.975))
    post_rows <- c(post_rows, list(list(labels[i], round(mean(delta), 4), round(sd(delta), 4),
                                        round(qs[1], 4), round(qs[2], 4))))
    if (is.null(plot_obj)) {
      d <- stats::density(delta)
      trace <- list(type = "scatter", mode = "lines", name = "Posterior",
                    x = as.list(round(d$x, 4)), y = as.list(round(d$y, 5)),
                    fill = "tozeroy", line = list(color = "#3b6ea5"))
      layout <- list(xaxis = list(title = list(text = "Effect size (δ)"), zeroline = TRUE),
                     yaxis = list(title = list(text = "Density")),
                     margin = list(t = 40, r = 20, b = 40, l = 60))
      plot_obj <- list(titleKey = "output.bayes.posteriorPlot", type = "plotly",
                       data = list(data = list(trace), layout = layout))
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
           rows = bf_rows, footnoteKey = sai_bf_prior_note(rscale, "ttest")),
      list(titleKey = "output.bayes.postTitle",
           columns = list("output.col.variable", "output.col.mean", "output.col.stdDeviation",
                          "output.col.ciLower95", "output.col.ciUpper95"),
           rows = post_rows, footnoteKey = "output.bayes.deltaFootnote")),
    plots = if (is.null(plot_obj)) list() else list(plot_obj))
}, error = function(e) sai_error(conditionMessage(e)))
