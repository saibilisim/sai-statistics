# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# report-summaries.R — Reports > Report Summaries in Rows (SPSS REPORT with
# /SUMMARY lines, i.e. "summaries in rows").
#
# The distinguishing layout: the data variables are COLUMNS and the summary
# statistics are ROWS, one statistic per row, repeated inside every break
# group. That is the mirror image of Case Summaries' Summary table (variables
# in rows, statistics in columns) and of OLAP Cubes (one row per variable per
# cell) — which is exactly why SPSS ships it as a separate procedure rather
# than an option on the others.
#
# Params (from JSON):
#   variables        — character vector of colIds for the data columns
#   varNames         — named list colId -> display name
#   breakVars        — character vector of colIds, in nesting order (Break
#                      Columns); may be empty for a report-level summary only
#   breakVarNames    — named list colId -> display name (for breakVars)
#   breakValueLabels — named list colId -> (value -> label) map, per break
#                      variable (same shape as olap-cubes' groupValueLabels)
#   displayCases     — list the individual cases above each group's summary
#                      lines (SPSS's "Display cases"); off by default, because
#                      a report of summaries is the point of the procedure
#   grandTotal       — close the report with a report-level summary block
#                      (SPSS's report-level /SUMMARY); on by default
#   limitCases       — max cases listed per report, or NULL for "no limit".
#                      Only bounds the LISTING; the summary lines always see
#                      every in-scope case (unlike Case Summaries, where SPSS
#                      restricts the whole procedure — REPORT does not).
#   options          — named list:
#     missing        — "analysis" (default) | "listwise"
#     stats          — named list of booleans: n, mean, median, sd, variance,
#                      seMean, min, max, sum, range
#
# Output: one "Report" table. Columns are the break variables, a Statistic
# column, then one column per data variable. A break level's label is printed
# only on the first row of its block (SPSS's nested break labels, flattened for
# the flat table renderer); the Statistic column holds the case number on
# listing rows and the statistic's name on summary rows.

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

  display_cases <- isTRUE(params$displayCases)
  grand_total <- !isFALSE(params$grandTotal)
  limit <- if (is.null(params$limitCases)) NA_integer_ else as.integer(params$limitCases)

  opts       <- if (is.null(params$options)) list() else params$options
  stats_opts <- if (is.null(opts$stats)) list() else opts$stats
  # No Statistics selection at all (older saved dialogs) -> the summary lines
  # SPSS's REPORT dialog ticks for you.
  if (length(stats_opts) == 0) stats_opts <- list(n = TRUE, mean = TRUE, sd = TRUE)

  # Missing Values: "Exclude cases listwise" drops any case missing on any data
  # or break variable.
  df <- apply_listwise(df, c(vars, breaks), params)

  # M1: honour user-defined missing values in the default "analysis" strategy
  # too — apply_listwise() only consults them when it is actually filtering.
  # Without this the report would count a -99 as a real salary.
  for (v in c(vars, breaks)) df[[v]] <- apply_user_missing(df[[v]], v, params)

  # SPSS drops from the whole report any case missing on a break variable —
  # there is no group for it to sit in.
  if (has_breaks) {
    keep <- rep(TRUE, nrow(df))
    for (b in breaks) keep <- keep & !is.na(as.character(df[[b]]))
    df <- df[keep, , drop = FALSE]
  }

  nm <- resolve_var_names(vars, var_names)

  progress(40L, "progress.computing")

  # The statistic menu is shared with Case Summaries and Report Summaries in
  # Columns (_bootstrap.R sai_summary_stat_defs), so all three offer the same
  # statistics, label them identically and compute them the same way. The
  # Statistics sub-dialog picks which of them become summary lines.
  active_stats <- sai_active_stats(stats_opts)

  n_breaks <- length(breaks)
  blank_breaks <- rep(list(""), n_breaks)

  #' One summary line: the break-column cells, the statistic's name, then the
  #' statistic evaluated on each data variable over `idx`.
  summary_row <- function(idx, s, break_cells) {
    values <- lapply(vars, function(v) sai_eval_stat(s, sai_stat_input(df[[v]][idx])))
    c(break_cells, list(s$col), values)
  }

  #' One listing line: the case's own value in every data column. `case_no`
  #' restarts at 1 in each break group, as SPSS numbers report lines.
  case_row <- function(ridx, case_no, break_cells) {
    c(break_cells, list(case_no), lapply(vars, function(v) df[[v]][ridx]))
  }

  #' A whole block: optional listing lines, then the summary lines. `label_cells`
  #' is printed on the block's first row only; every later row leaves the break
  #' columns blank so the nesting reads as an indent.
  build_block <- function(idx, label_cells, listed) {
    out <- list()
    first <- TRUE
    # Label cells for the next row: the group's labels once, blanks thereafter.
    next_cells <- function() {
      if (!first) return(blank_breaks)
      first <<- FALSE
      label_cells
    }
    if (display_cases) {
      for (j in seq_along(listed)) {
        out <- c(out, list(case_row(listed[j], j, next_cells())))
      }
    }
    for (s in active_stats) out <- c(out, list(summary_row(idx, s, next_cells())))
    out
  }

  # SPSS's "Display cases" limit bounds the printed listing across the whole
  # report, not per group — a 100-case limit on a 5-group report lists 100
  # lines in total, not 500. Budget it down as the blocks are built.
  remaining <- if (is.na(limit)) .Machine$integer.max else max(0L, limit)
  n_listed <- 0L
  n_listable <- 0L

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
      # A level's label prints once, on the first row of the block where that
      # level's value changes. A level restarts whenever ANY level above it
      # changes, so "M / a" following "F / a" must reprint "a" — comparing only
      # the level's own value would blank it (the bug olap-cubes had).
      label_cells <- lapply(seq_along(breaks), function(bi) {
        s <- block_start[b]
        unchanged <- s > 1 && all(vapply(
          seq_len(bi), function(bj) bord[[bj]][s] == bord[[bj]][s - 1], logical(1)
        ))
        if (unchanged) return("")
        resolve_var_name(bord[[bi]][s], params$breakValueLabels[[breaks[bi]]])
      })
      n_listable <- n_listable + length(idx)
      listed <- if (display_cases) utils::head(idx, remaining) else integer(0)
      remaining <- remaining - length(listed)
      n_listed <- n_listed + length(listed)
      rows <- c(rows, build_block(idx, label_cells, listed))
    }
  } else {
    all_idx <- seq_len(nrow(df))
    n_listable <- length(all_idx)
    listed <- if (display_cases) utils::head(all_idx, remaining) else integer(0)
    remaining <- remaining - length(listed)
    n_listed <- n_listed + length(listed)
    # No break columns: the single block needs no label cells.
    rows <- c(rows, build_block(all_idx, blank_breaks, listed))
  }

  # Report-level summary. Skipped when there are no break variables, since the
  # single block above already IS the whole report — printing it twice would
  # just repeat the same numbers under a "Total" heading.
  if (grand_total && has_breaks) {
    total_cells <- c(list("output.col.total"), rep(list(""), n_breaks - 1))
    first <- TRUE
    for (s in active_stats) {
      cells <- if (first) total_cells else blank_breaks
      first <- FALSE
      rows <- c(rows, list(summary_row(seq_len(nrow(df)), s, cells)))
    }
  }

  progress(90L, "progress.formatting")

  columns <- c(if (has_breaks) as.list(bnames) else list(),
               list("output.col.statistic"),
               as.list(unname(nm)))

  # Say so when the listing was cut short, rather than letting the report look
  # like the whole file.
  notes <- list()
  if (display_cases && n_listed < n_listable) {
    notes <- list(paste0("output.reportSummaries.limitNote:", n_listed, "|", n_listable))
  }

  progress(100L, "progress.done")
  sai_output(
    tables = list(list(
      titleKey = "output.reportSummaries.title",
      columns = columns,
      rows = rows
    )),
    notes = notes
  )

}, error = function(e) {
  sai_error(conditionMessage(e))
})
