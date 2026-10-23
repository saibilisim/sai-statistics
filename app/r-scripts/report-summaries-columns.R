# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# report-summaries-columns.R — Reports > Report Summaries in Columns
# (SPSS REPORT with the summary functions in columns).
#
# The mirror of report-summaries.R: there the statistics run DOWN the page and
# each break group takes a block of rows; here each break group is a single
# ROW and the statistics run ACROSS as columns. That compactness is the whole
# point of the procedure — one line per group, which is what makes it readable
# as a report when there are many groups.
#
# The statistic menu, their labels and their formulas are shared with Case
# Summaries and Report Summaries in Rows (_bootstrap.R sai_summary_stat_defs),
# so the same statistic can never mean or be called something different here.
#
# Params (from JSON):
#   variables        — character vector of colIds for the data columns
#   varNames         — named list colId -> display name
#   breakVars        — character vector of colIds, in nesting order (Break
#                      Columns); may be empty for a single report-level row
#   breakVarNames    — named list colId -> display name (for breakVars)
#   breakValueLabels — named list colId -> (value -> label) map, per break
#                      variable
#   grandTotal       — close the report with a report-level row; on by default
#   options          — named list:
#     missing        — "analysis" (default) | "listwise"
#     stats          — named list of booleans, see sai_summary_stat_defs()
#
# Output: one "Report" table. Columns are the break variables followed by one
# column per (data variable × selected statistic), headed "<variable> —
# <statistic>". Rows are the break groups, in nested order, plus the
# report-level row.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  vars <- unlist(params$variables); var_names <- params$varNames
  if (length(vars) == 0) sai_error("No variables specified")
  for (v in vars) if (!v %in% names(df)) sai_error(paste("Column not found:", v))

  breaks <- if (is.null(params$breakVars)) character(0) else unlist(params$breakVars)
  breaks <- breaks[nzchar(breaks) & breaks %in% names(df)]
  has_breaks <- length(breaks) > 0
  bnames <- resolve_var_names(breaks, params$breakVarNames)

  grand_total <- !isFALSE(params$grandTotal)

  opts       <- if (is.null(params$options)) list() else params$options
  stats_opts <- if (is.null(opts$stats)) list() else opts$stats

  # Missing Values: "Exclude cases listwise" drops any case missing on any data
  # or break variable.
  df <- apply_listwise(df, c(vars, breaks), params)

  # M1: honour user-defined missing values in the default "analysis" strategy
  # too — apply_listwise() only consults them when it is actually filtering.
  for (v in c(vars, breaks)) df[[v]] <- apply_user_missing(df[[v]], v, params)

  # SPSS drops from the whole report any case missing on a break variable.
  if (has_breaks) {
    keep <- rep(TRUE, nrow(df))
    for (b in breaks) keep <- keep & !is.na(as.character(df[[b]]))
    df <- df[keep, , drop = FALSE]
  }

  nm <- resolve_var_names(vars, var_names)
  active_stats <- sai_active_stats(stats_opts)

  progress(40L, "progress.computing")

  #' One report line: the break-column cells, then every (variable, statistic)
  #' pair in the same order as the column headers built below.
  summary_row <- function(idx, break_cells) {
    cells <- list()
    for (k in seq_along(vars)) {
      v <- sai_stat_input(df[[vars[k]]][idx])
      for (s in active_stats) cells <- c(cells, list(sai_eval_stat(s, v)))
    }
    c(break_cells, cells)
  }

  n_breaks <- length(breaks)
  rows <- list()

  if (has_breaks) {
    bmat <- lapply(breaks, function(b) as.character(df[[b]]))
    ord <- do.call(order, bmat)
    bord <- lapply(bmat, function(b) b[ord])
    # \r cannot appear in a category label, so pasted keys are collision-free.
    combo_key <- do.call(paste, c(bord, sep = "\r"))
    block_start <- which(c(TRUE, combo_key[-1] != combo_key[-length(combo_key)]))
    block_end <- c(block_start[-1] - 1L, length(combo_key))
    for (b in if (length(combo_key) > 0) seq_along(block_start) else integer(0)) {
      idx <- ord[block_start[b]:block_end[b]]
      # Each group is one row, so unlike the rows report there is no "print the
      # label only on the block's first line" rule — but an outer level still
      # prints only where it changes, which is what makes a nested report
      # readable. A level restarts whenever ANY level above it changes.
      s0 <- block_start[b]
      label_cells <- lapply(seq_along(breaks), function(bi) {
        unchanged <- s0 > 1 && all(vapply(
          seq_len(bi), function(bj) bord[[bj]][s0] == bord[[bj]][s0 - 1], logical(1)
        ))
        if (unchanged) return("")
        resolve_var_name(bord[[bi]][s0], params$breakValueLabels[[breaks[bi]]])
      })
      rows <- c(rows, list(summary_row(idx, label_cells)))
    }
  } else {
    rows <- c(rows, list(summary_row(seq_len(nrow(df)), list())))
  }

  # Report-level row. Skipped without break variables, where the single row
  # above already IS the whole report.
  if (grand_total && has_breaks) {
    total_cells <- c(list("output.col.total"), rep(list(""), n_breaks - 1))
    rows <- c(rows, list(summary_row(seq_len(nrow(df)), total_cells)))
  }

  progress(90L, "progress.formatting")

  # "<variable> — <statistic>": the variable name is user data and the
  # statistic is an i18n key, so the header is emitted as a parameterised key
  # whose second parameter is itself translated (see translateOutputKey).
  stat_columns <- list()
  for (k in seq_along(vars)) {
    for (s in active_stats) {
      stat_columns <- c(stat_columns,
                        list(paste0("output.reportColumns.varStat:", nm[k], "|", s$col)))
    }
  }
  columns <- c(if (has_breaks) as.list(bnames) else list(), stat_columns)

  progress(100L, "progress.done")
  sai_output(tables = list(list(
    titleKey = "output.reportColumns.title",
    columns = columns,
    rows = rows
  )))

}, error = function(e) {
  sai_error(conditionMessage(e))
})
