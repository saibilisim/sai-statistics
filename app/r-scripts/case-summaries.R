# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# case-summaries.R — Reports > Case Summaries (SPSS SUMMARIZE, see
# spss-parity-analysis.md §3.8).
#
# Params (from JSON):
#   variables    — character vector of colIds to list per case
#   varNames     — named list colId -> display name
#   groupVar     — optional colId to break cases into groups
#   groupVarName — display name for groupVar
#   displayCases — show the per-case listing at all (SPSS's "Display cases")
#   subtotals    — end each group's listing block with a "Total" N row plus a
#                  grand Total row (SPSS /FORMAT=TOTAL); plain flat list when off
#   limitCases   — max cases listed, or NULL for "no limit" (SPSS's own default
#                  is the checkbox ON at 100)
#   options      — named list:
#     missing    — "analysis" (default) | "listwise"
#     stats      — named list of booleans: n, mean, median, sd, variance,
#                  seMean, min, max, sum, range
#
# Output: "Case Processing Summary" (Included/Excluded/Total N + % per
# variable), the "Case Summaries" listing (Case Number + group + selected
# variables, limited to limitCases rows, with optional group subtotals) and a
# "Summary" table (the selected statistics per numeric variable, broken by
# group + Total).

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

  gcol <- params$groupVar
  has_group <- !is.null(gcol) && nzchar(gcol) && gcol %in% names(df)
  gname <- if (is.null(params$groupVarName)) gcol else params$groupVarName
  # NULL / absent limitCases means "no limit" (the dialog's checkbox is off).
  limit <- if (is.null(params$limitCases)) NA_integer_ else as.integer(params$limitCases)
  display_cases <- !isFALSE(params$displayCases)
  # SPSS /FORMAT=TOTAL group subtotals in the listing. The dialog opts in
  # explicitly; absent (older saved dialogs, bare fixtures) keeps the plain
  # flat listing this script has always produced.
  subtotals <- isTRUE(params$subtotals)

  opts       <- if (is.null(params$options)) list() else params$options
  stats_opts <- if (is.null(opts$stats)) list() else opts$stats
  # No Statistics selection at all (older saved dialogs) → SPSS's own default
  # summary trio, so behaviour is unchanged for anyone who never opens it.
  if (length(stats_opts) == 0) stats_opts <- list(n = TRUE, mean = TRUE, sd = TRUE)

  # Missing Values: "Exclude cases listwise" drops any case missing on any
  # listed variable (or the grouping variable).
  df <- apply_listwise(df, c(vars, if (has_group) gcol else NULL), params)

  nm <- resolve_var_names(vars, var_names)

  progress(40L, "progress.computing")

  # ── Listing table ────────────────────────────────────────────────────────
  # "Limit cases to first N" is applied to the file in FILE order, and only the
  # cases that survive it are then grouped for display. Doing it the other way
  # round — sorting the whole file by the grouping variable first, then taking
  # the first N — silently drops whole categories: on a real 309-case run
  # broken by cinsiyet, limit 100, it listed 100 cases of cinsiyet=1 and never
  # reached cinsiyet=2, where SPSS listed 48 + 52. Because summary_scope below
  # is these same rows, every statistic in the Summary table was computed on
  # that skewed sample too (verified against manuel-test/spss.htm).
  #
  # order() is stable, so within each group the cases stay in file order, which
  # is what SPSS lists and what First/Last report.
  n_total <- nrow(df)
  n_listed <- if (is.na(limit)) n_total else min(limit, n_total)
  scope_idx <- seq_len(n_listed)
  listed_idx <- if (has_group) scope_idx[order(as.character(df[[gcol]][scope_idx]))] else scope_idx
  limit_active <- n_listed < n_total

  list_cols <- c("output.caseSummaries.caseNumber", if (has_group) gname else NULL,
                 unname(nm))
  build_case_row <- function(i, ridx) {
    row <- list(i)
    if (has_group) row <- c(row, list(resolve_var_name(as.character(df[[gcol]][ridx]), params$groupValueLabels)))
    for (v in vars) row <- c(row, list(df[[v]][ridx]))
    row
  }
  if (has_group && subtotals) {
    # SPSS-style grouped listing: case numbers restart at 1 inside each group,
    # each block ends with a "Total | N | ..." row holding that block's
    # per-variable valid N, and the table closes with a grand Total row.
    #
    # Verified against a real SPSS SUMMARIZE run (309 cases, limit 100,
    # broken by cinsiyet) whose listing read: cases 1..48 then "Total N 48",
    # cases 1..52 then "Total N 52", then a closing "Total N 100". The numbers
    # are recorded here because that export is no longer in the repo.
    gkey <- as.character(df[[gcol]][listed_idx])
    grand_n <- integer(length(vars))
    list_rows <- list()
    for (g in unique(gkey)) {
      sel <- if (is.na(g)) which(is.na(gkey)) else which(!is.na(gkey) & gkey == g)
      g_idx <- listed_idx[sel]
      g_n <- vapply(vars, function(v) sum(!is.na(df[[v]][g_idx])), integer(1), USE.NAMES = FALSE)
      for (j in seq_along(sel)) list_rows <- c(list_rows, list(build_case_row(j, g_idx[j])))
      grand_n <- grand_n + g_n
      list_rows <- c(list_rows, list(c(list("output.col.total", "output.col.n"), as.list(g_n))))
    }
    list_rows <- c(list_rows,
                   list(c(list("output.col.total", "output.col.n"), as.list(grand_n))))
  } else {
    list_rows <- lapply(seq_along(listed_idx), function(i) build_case_row(i, listed_idx[i]))
  }

  # ── Summary table ────────────────────────────────────────────────────────
  # The statistic menu is shared with both Report Summaries procedures
  # (_bootstrap.R sai_summary_stat_defs) so all three label and compute them
  # identically; the Statistics sub-dialog picks which of them appear.
  active_stats <- sai_active_stats(stats_opts)

  # SPSS restricts the whole procedure — not just the listing — to the first N
  # cases when "Limit cases" is on. Summarising the full file here instead
  # (what this script used to do) put two different Ns on one screen: the
  # listing said "first 100 of 309" while the Summary said N = 309.
  summary_scope <- if (limit_active) scope_idx else seq_len(nrow(df))

  # Every variable, not just the numeric ones: SPSS reports N/Minimum/Maximum/
  # First/Last for a string variable too (its Minimum for a name column is the
  # alphabetically first name) and leaves the arithmetic cells blank.
  summarize_group <- function(idx, label) {
    lapply(seq_along(vars), function(k) {
      v <- sai_stat_input(df[[vars[k]]][idx])
      c(list(label, nm[k]), lapply(active_stats, function(s) sai_eval_stat(s, v)))
    })
  }

  summary_rows <- list()
  if (has_group) {
    gvals <- as.character(df[[gcol]])
    for (lvl in sort(unique(gvals[!is.na(gvals)]))) {
      idx <- intersect(which(gvals == lvl), summary_scope)
      if (length(idx) == 0) next
      summary_rows <- c(summary_rows, summarize_group(idx, resolve_var_name(lvl, params$groupValueLabels)))
    }
  }
  summary_rows <- c(summary_rows, summarize_group(summary_scope, "output.col.total"))

  # ── Case Processing Summary ──────────────────────────────────────────────
  # SPSS opens every SUMMARIZE run with this table: per variable, how many of
  # the in-scope cases are Included (valid) vs Excluded (missing). The scope
  # is the same summary_scope the Summary table uses, so the Ns agree with
  # the rest of the output — with "Limit cases" on, Included+Excluded total
  # the limited N, not the file N — as SPSS's own Case Processing Summary
  # did on the 309-case run limited to 100.
  cps_rows <- lapply(seq_along(vars), function(k) {
    x <- df[[vars[k]]][summary_scope]
    n_tot <- length(x)
    n_in <- sum(!is.na(x))
    n_ex <- n_tot - n_in
    pct <- function(n) if (n_tot > 0) round(n / n_tot * 100, 1) else 0
    list(if (has_group) paste0(nm[k], " * ", gname) else nm[k],
         n_in, pct(n_in), n_ex, pct(n_ex), n_tot, pct(n_tot))
  })

  progress(90L, "progress.formatting")

  limit_footnote <- if (limit_active) {
    paste0("output.caseSummaries.limitedFootnote:", n_listed, "|", n_total)
  } else {
    NULL
  }

  tables <- list(list(
    titleKey = "output.caseSummaries.cpsTitle",
    columns = list("output.col.variable",
                   "output.caseSummaries.includedN", "output.caseSummaries.includedPct",
                   "output.caseSummaries.excludedN", "output.caseSummaries.excludedPct",
                   "output.caseSummaries.totalN", "output.caseSummaries.totalPct"),
    rows = cps_rows,
    # Same "Limited to first N cases" footnote SPSS puts on this table.
    footnoteKey = limit_footnote
  ))
  if (display_cases) {
    tables <- c(tables, list(list(
      titleKey = "output.caseSummaries.listTitle",
      columns = as.list(list_cols),
      rows = list_rows,
      footnoteKey = limit_footnote
    )))
  }
  tables <- c(tables, list(list(
    titleKey = "output.caseSummaries.summaryTitle",
    columns = c(list(if (has_group) gname else "output.col.group", "output.col.variable"),
                lapply(active_stats, function(s) s$col)),
    rows = summary_rows,
    # Repeated on the Summary table too: a reader looking only at this table
    # must still be able to tell that N is the restricted N.
    footnoteKey = limit_footnote
  )))

  progress(100L, "progress.done")
  sai_output(tables = tables)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
