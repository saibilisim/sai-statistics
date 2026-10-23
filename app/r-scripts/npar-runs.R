# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-runs.R — Runs Test (SPSS-style).
#
# Params: variables (colIds), varNames, cutPoint ("median"|"mean"),
#         options$pMethod (method="exact" to add an Exact Sig. column).
# Output: per variable Test Value, cases below/at-or-above, Total, Number of
#         Runs, Z, Asymp. Sig. (2-tailed) [+ Exact Sig.]. Normal approximation
#         plus (science-over-SPSS, CLAUDE.md §11) the true Wald-Wolfowitz
#         exact distribution via the `randtests` package (base R has no runs
#         test at all, exact or otherwise) — package-gated, honest
#         "pMethodNotApplied" fallback when randtests is absent.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  # Options ▸ Missing Values (listwise) and Statistics — _bootstrap.R helpers
  # shared by Binomial, One-Sample K-S and Runs.
  df <- npar_listwise(df, NULL, vars, params)$df
  cut_kind <- if (is.null(params$cutPoint)) "median" else params$cutPoint
  if (length(vars) == 0) sai_error("No test variables")

  want_exact <- !is.null(params$options$pMethod) &&
    identical(params$options$pMethod$method, "exact")
  if (want_exact) .sai_pmethod_requested <<- TRUE
  have_randtests <- want_exact && requireNamespace("randtests", quietly = TRUE)

  rows <- list()
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    # User-missing values used to reach the test as data.
    x  <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params))); x <- x[!is.na(x)]
    if (length(x) < 2) next
    cut <- if (cut_kind == "mean") mean(x) else median(x)
    ge  <- x >= cut                    # TRUE = at or above the cut point
    n1  <- sum(!ge); n2 <- sum(ge); N <- n1 + n2
    if (n1 == 0 || n2 == 0) next
    runs <- 1 + sum(ge[-1] != ge[-N])  # count of runs
    mu   <- 2 * n1 * n2 / N + 1
    va   <- 2 * n1 * n2 * (2 * n1 * n2 - N) / (N^2 * (N - 1))
    Z    <- (runs - mu) / sqrt(va)
    p    <- 2 * pnorm(-abs(Z))
    row  <- list(nm, round(cut, 3), as.integer(n1), as.integer(n2),
      as.integer(N), as.integer(runs), round(Z, 3), round(p, 6))
    if (want_exact) {
      pExact <- if (have_randtests) {
        tryCatch({
          rt <- randtests::runs.test(as.numeric(ge), threshold = 0.5, pvalue = "exact")
          .sai_pmethod_applied <<- TRUE
          rt$p.value
        }, error = function(e) NA_real_)
      } else NA_real_
      row <- c(row, list(if (is.na(pExact)) NULL else round(pExact, 6)))
    }
    rows <- c(rows, list(row))
  }
  if (length(rows) == 0) sai_error("Runs test needs variation around the cut point")

  ts_cols <- list("output.col.variable", "output.col.testValue", "output.col.casesLt",
                  "output.col.casesGe", "output.col.total", "output.col.numRuns",
                  "output.col.z", "output.col.asympSig")
  if (want_exact) ts_cols <- c(ts_cols, list("output.col.exactSig"))

  progress(100L, "progress.done")
  desc_tbl <- npar_descriptives_table(df, NULL, vars, var_names, params)
  sai_output(tables = c(if (is.null(desc_tbl)) list() else list(desc_tbl), list(list(
    titleKey = "output.nparRuns.title",
    columns = ts_cols,
    rows = rows, footnoteKey = NULL))))
}, error = function(e) sai_error(conditionMessage(e)))
