# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# roc.R — ROC Curve analysis (SPSS-style).
#
# Params: variables (character vector of test-variable colIds), varNames,
#         stateVar (colId), stateName, stateValue (value identifying the
#         positive/event group), options:
#           Display (main dialog): plotCurve (default TRUE), diagonal (default
#             TRUE), seCi (default TRUE), coordinates (default FALSE)
#           Options sub-dialog: cutoff 'include'|'exclude', direction
#             'larger'|'smaller', distribution 'free'|'negexpo', ciLevel (0-1),
#             userMissingValid (boolean)
# Output: Case Processing Summary, "Area Under the Curve" (Area, and with
#         seCi: Std. Error, Asymp. Sig., CI) per test variable, a combined ROC
#         curve plot (one line per variable) and an optional "Coordinates of
#         the Curve" table per variable. The arithmetic lives in _bootstrap.R
#         (roc_compute and friends), shared with roc-analysis.R.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  vars      <- unlist(params$variables)
  # Back-compat: earlier single-variable param shape.
  if (length(vars) == 0 && !is.null(params$testVar)) vars <- params$testVar
  var_names <- if (is.null(params$varNames)) list() else params$varNames
  if (length(vars) == 0 && !is.null(params$testName)) {
    var_names <- setNames(list(params$testName), params$testVar)
  }
  sv   <- params$stateVar
  opts <- if (is.null(params$options)) list() else params$options
  o    <- roc_read_options(opts)
  want_plot   <- !isFALSE(opts$plotCurve)
  want_diag   <- !isFALSE(opts$diagonal)
  want_se     <- !isFALSE(opts$seCi)
  want_coords <- isTRUE(opts$coordinates)
  pos_val <- as.character(params$stateValue)
  ci_pct  <- as.character(round_half_up(o$ci_level * 100, 4))

  if (length(vars) == 0) sai_error("No test variables specified")

  # SPSS ROC is listwise across every test variable and the state variable
  # ("Valid N (listwise)"), so every area uses the same cases.
  prep <- roc_prepare(df, vars, sv, params, o)
  positive <- prep$s == pos_val

  stats <- list(); nms <- list()
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    x  <- prep$x[[v]]
    if (o$direction == "smaller") x <- -x
    r  <- roc_compute(x, positive, prep$w, o)
    stats[[length(stats) + 1L]] <- r
    nms[[length(nms) + 1L]] <- nm
  }

  cps <- roc_case_summary(params, sv, stats[[1]]$np, stats[[1]]$nn, prep$n_missing, pos_val, o)
  coord_tables <- if (want_coords) list(roc_coord_table(stats, nms, o)) else list()

  progress(100L, "progress.done")
  sai_output(
    notes = roc_common_notes(stats, nms, want_se, ci_pct, o),
    tables = c(list(cps, roc_auc_table(stats, nms, want_se, ci_pct, o)), coord_tables),
    plots = if (want_plot) list(roc_curve_plot(stats, nms, roc_palette, want_diag)) else list()
  )
}, error = function(e) sai_error(conditionMessage(e)))
