# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# means.R — Means (group breakdown, SPSS-style).
#
# Params: variables (dependent colIds), varNames, factor (grouping colId),
#         factorName, options$bootstrap.
# Output: per dependent a "Report" table — Mean, N, Std. Deviation per group
#         level, plus a Total row.
#         options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1):
#         bootstraps each group's mean via case-resampling of that group's
#         own rows, same sai_bootstrap() contract as ttest-onesample.R.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  vars <- unlist(params$variables); var_names <- params$varNames
  fvar <- params$factor
  fname <- if (is.null(params$factorName)) fvar else params$factorName
  if (length(vars) == 0) sai_error("No dependent variables")
  if (is.null(fvar) || !fvar %in% names(df)) sai_error("Factor variable not found")

  # Missing Values (MV): listwise drops a case if ANY dependent variable or
  # the factor is missing. Must run before get_weights() so the weight
  # vector stays aligned to df's rows.
  df <- apply_listwise(df, c(vars, fvar), params)

  # Weight Cases (W1): per-group N/Mean/Std. Deviation are weighted.
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  fall <- as.character(apply_user_missing(df[[fvar]], fvar, params))
  cnt <- function(x) format_wtd_count(x, w)

  # ── Cells (SPSS MEANS /CELLS) ───────────────────────────────────────────────
  # The Cells sub-dialog offers more than Mean/N/Std. Deviation, and every one
  # of these is a weighted statistic here: the Weight Cases choke point applies
  # to MEANS, so a cell computed with plain mean()/var() would silently ignore
  # an active weight. Each entry therefore uses the wtd_* helper for its
  # statistic; w = NULL reproduces the unweighted formula exactly.
  #
  # Not the Reports registry (_bootstrap.R sai_summary_stat_defs): that one is
  # unweighted by construction — Case Summaries and the two Report procedures
  # do not take weights — so reusing it here would drop weighting from every
  # cell. Same statistic names and the same i18n column keys, so the two stay
  # readable side by side.
  CELL_DEFS <- list(
    list(key = "mean",     col = "output.col.mean",         f = function(x, ww) wtd_mean(x, ww)),
    list(key = "n",        col = "output.col.n",            f = NULL),
    list(key = "sd",       col = "output.col.stdDeviation", f = function(x, ww) wtd_sd(x, ww)),
    list(key = "median",   col = "output.col.median",       f = function(x, ww) wtd_median(x, ww)),
    list(key = "groupedMedian", col = "output.col.groupedMedian",
         f = function(x, ww) grouped_median(x)),
    list(key = "seMean",   col = "output.col.seMean",
         f = function(x, ww) wtd_sd(x, ww) / sqrt(if (is.null(ww)) length(x) else sum(ww))),
    list(key = "min",      col = "output.col.min",          f = function(x, ww) min(x)),
    list(key = "max",      col = "output.col.max",          f = function(x, ww) max(x)),
    list(key = "range",    col = "output.col.range",        f = function(x, ww) diff(range(x))),
    list(key = "sum",      col = "output.col.sum",          f = function(x, ww) wtd_sum(x, ww)),
    list(key = "variance", col = "output.col.variance",     f = function(x, ww) wtd_var(x, ww)),
    list(key = "kurtosis", col = "output.col.kurtosis",     f = function(x, ww) wtd_kurtosis(x, ww)),
    list(key = "seKurtosis", col = "output.col.seKurtosis",
         f = function(x, ww) se_kurtosis(if (is.null(ww)) length(x) else sum(ww))),
    list(key = "skewness", col = "output.col.skewness",     f = function(x, ww) wtd_skewness(x, ww)),
    list(key = "seSkewness", col = "output.col.seSkewness",
         f = function(x, ww) se_skewness(if (is.null(ww)) length(x) else sum(ww))),
    list(key = "first",    col = "output.col.first",        f = function(x, ww) x[1]),
    list(key = "last",     col = "output.col.last",         f = function(x, ww) x[length(x)])
  )
  cells_opt <- if (is.null(params$options)) NULL else params$options$cells
  # An older dialog (or none at all) sends no cells: keep the three SPSS's own
  # default /CELLS produces, so existing saved analyses render unchanged.
  active_cells <- if (length(cells_opt) == 0) {
    Filter(function(c) c$key %in% c("mean", "n", "sd"), CELL_DEFS)
  } else {
    a <- Filter(function(c) isTRUE(cells_opt[[c$key]]), CELL_DEFS)
    if (length(a) == 0) Filter(function(c) c$key == "n", CELL_DEFS) else a
  }
  cell_values <- function(xs, ws) {
    n_disp <- if (is.null(ws)) length(xs) else sum(ws)
    lapply(active_cells, function(c) {
      if (c$key == "n") return(cnt(n_disp))
      v <- suppressWarnings(c$f(xs, ws))
      if (length(v) != 1 || !is.finite(v)) NULL else round(v, 4)
    })
  }

  tables <- list()
  boot_rows <- list()
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    xv <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params)))
    keep <- !is.na(xv) & !is.na(fall) & fall != "NA"
    x <- xv[keep]; g <- factor(fall[keep])
    wv <- if (is.null(w)) NULL else w[keep]
    if (length(x) == 0) next
    rows <- list()
    for (lvl in levels(g)) {
      idx <- g == lvl
      xs  <- x[idx]
      ws  <- if (is.null(wv)) NULL else wv[idx]
      rows <- c(rows, list(c(
        list(resolve_var_name(lvl, params$factorValueLabels)), cell_values(xs, ws))))

      # Bootstrapping (BOOT2): bootstrap this group's own mean.
      boot_df <- data.frame(x = xs)
      boot_out <- sai_bootstrap(
        boot_df,
        function(data, indices) c(mean = mean(data$x[indices])),
        params, weight = ws
      )
      if (!is.null(boot_out)) {
        for (r in boot_out) {
          boot_rows <- c(boot_rows, list(list(
            paste0(nm, " — ", fname, " = ", resolve_var_name(lvl, params$factorValueLabels)),
            round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
            round(r$ci_lower, 6), round(r$ci_upper, 6))))
        }
      }
    }
    rows <- c(rows, list(c(list("output.col.total"), cell_values(x, wv))))
    tables <- c(tables, list(list(
      titleKey = paste0("output.means.reportTitle:", nm),
      columns = c(list(fname), lapply(active_cells, function(c) c$col)),
      rows = rows, footnoteKey = NULL)))
  }
  if (length(tables) == 0) sai_error("No data for Means report")

  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.meanTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables)
}, error = function(e) sai_error(conditionMessage(e)))
