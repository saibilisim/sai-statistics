# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# olap-cubes.R — Reports > OLAP Cubes (SPSS OLAP). Summary statistics of one
# or more scale variables broken down by one or more *nested* grouping
# variables, with the selectable cell statistics of SPSS's OLAP Statistics
# sub-dialog.
#
# The cell menu is the shared Reports registry (_bootstrap.R
# sai_summary_stat_defs) — the same keys, names and formulas Case Summaries and
# the two Report Summaries procedures use, so the same statistic never means
# two different things in two dialogs. On top of it OLAP adds the four
# percentage cells that registry cannot express, because each needs a base
# computed outside the cell: % of Total N/Sum (base = the whole cube) and
# % of N/Sum in <grouping variable> (base = the cell's own category of that
# grouping variable, collapsed over the others). Those are SPSS's NPCT/SPCT and
# NPCT(var)/SPCT(var).
#
# Params (from JSON):
#   variables        — character vector of colIds to summarize (Summary
#                      Variable(s))
#   varNames         — named list colId -> display name
#   groupVars        — character vector of colIds, in nesting order (Grouping
#                      Variable(s)); may be empty/absent for overall stats only
#   groupVarNames    — named list colId -> display name (for groupVars)
#   groupValueLabels — named list colId -> (value -> label) map, per grouping
#                      variable (same shape as case-summaries' single map, but
#                      keyed by variable since there can be several)
#   options          — named list:
#     missing        — "analysis" (default) | "listwise"
#     stats          — named list of booleans: the registry's keys plus
#                      pctTotalN, pctTotalSum, pctNIn, pctSumIn
#
# Output: "Case Processing Summary" (Included/Excluded/Total per summary
# variable, SPSS's own opening table for this procedure) followed by the
# "OLAP Cubes" table — one column per grouping variable (the category label
# printed only on the first row of each nested block, SPSS-style row labels
# flattened for the flat table renderer), a Variable column, and one column per
# selected statistic. Cases missing on ANY grouping variable are excluded (SPSS
# excludes them from the whole table); per-variable missing values are dropped
# statistic-by-statistic unless "listwise" is selected.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

# Weight Cases: SPSS's OLAP CUBES honours a case weight; this script does not.
# The shared statistic registry is unweighted by construction (Case Summaries
# and the two Report procedures take no weights), and reusing it here — the
# whole point of the rewrite — means every cell is a plain count/mean/moment.
# Rather than let that pass under the generic "this analysis does not apply
# weighting" warning, the procedure names itself, so a collapsed Output block
# still says WHICH analysis ignored the weight. Emitted only when a weight is
# actually active; see means.R for the weighted (wtd_*) alternative.
sai_weight_unsupported("output.olapCubes.title")

tryCatch({
  progress(10L, "progress.loading")

  vars <- unlist(params$variables); var_names <- params$varNames
  if (length(vars) == 0) sai_error("No variables specified")
  for (v in vars) if (!v %in% names(df)) sai_error(paste("Column not found:", v))

  # Every cell statistic here is arithmetic, so a string summary variable can
  # only produce an empty cube. SPSS rejects one outright; we used to accept it
  # and emit a row of N=0 / Sum=0 with the rest blank, which looks like a
  # finding rather than a refused input. The dialog filters these out, but
  # analysis:run is a generic funnel (syntax, AI, saved dialogs all reach it),
  # so the guard belongs here too.
  non_numeric <- vars[!vapply(vars, function(v) is.numeric(df[[v]]), logical(1))]
  if (length(non_numeric) > 0) {
    sai_error(paste0("output.olapCubes.stringVarError:",
                     paste(resolve_var_names(non_numeric, var_names), collapse = ", ")))
  }

  groups <- if (is.null(params$groupVars)) character(0) else unlist(params$groupVars)
  groups <- groups[nzchar(groups) & groups %in% names(df)]
  has_groups <- length(groups) > 0
  gnames <- resolve_var_names(groups, params$groupVarNames)

  opts       <- if (is.null(params$options)) list() else params$options
  stats_opts <- if (is.null(opts$stats)) list() else opts$stats
  # No Statistics selection at all (older saved dialogs) → SPSS OLAP's own
  # default cell contents (Sum, N, Mean, Std. Deviation, % of Total Sum,
  # % of Total N).
  if (length(stats_opts) == 0) {
    stats_opts <- list(n = TRUE, mean = TRUE, sd = TRUE, sum = TRUE,
                       pctTotalN = TRUE, pctTotalSum = TRUE)
  }

  # Missing Values: "Exclude cases listwise" drops any case missing on any
  # summary or grouping variable.
  df <- apply_listwise(df, c(vars, groups), params)

  # User-defined missing values count as missing here, exactly as SPSS's own
  # Notes table says for this procedure ("user-defined missing values for the
  # dependent and all grouping variables are treated as missing"). Recoding to
  # NA up front means every path below — the Case Processing Summary, the
  # grouping-variable exclusion and each cell — sees the same missingness.
  for (v in unique(c(vars, groups))) df[[v]] <- apply_user_missing(df[[v]], v, params)

  nm <- resolve_var_names(vars, var_names)

  # ── Case Processing Summary ───────────────────────────────────────────────
  # SPSS opens OLAP CUBES with this table, and it is the only place a reader
  # learns that a summary variable lost cases: a cube whose Krea row says
  # N = 308 while its neighbours say 309 gives no clue where the 309th went.
  # Counted against the working file BEFORE the grouping-variable exclusion
  # below (a case dropped for a missing group value is Excluded, not absent),
  # but AFTER listwise deletion, so the Ns agree with the cube itself.
  n_file <- nrow(df)
  group_ok <- rep(TRUE, n_file)
  for (g in groups) group_ok <- group_ok & !is.na(df[[g]])
  cps_pct <- function(n) if (n_file > 0) round(100 * n / n_file, 1) else 0
  cps_rows <- lapply(seq_along(vars), function(k) {
    n_in <- sum(!is.na(df[[vars[k]]]) & group_ok)
    n_ex <- n_file - n_in
    list(paste(c(nm[k], gnames), collapse = " * "),
         n_in, cps_pct(n_in), n_ex, cps_pct(n_ex), n_file, cps_pct(n_file))
  })

  # SPSS excludes from the whole table any case missing on a grouping variable.
  if (has_groups) df <- df[group_ok, , drop = FALSE]

  progress(40L, "progress.computing")

  # ── Cell statistics ───────────────────────────────────────────────────────
  active_stats <- Filter(function(s) isTRUE(stats_opts[[s$key]]), sai_summary_stat_defs())

  # The percentage cells. `base` names what the denominator is: "total" is the
  # whole cube, "group" expands to one column per grouping variable (SPSS's
  # NPCT(var)/SPCT(var), which the dialog offers as a single checkbox because
  # the variables come from the Grouping Variable(s) list).
  pct_defs <- list(
    list(key = "pctTotalN",   col = "output.col.pctTotalN",   base = "total", of = "n"),
    list(key = "pctTotalSum", col = "output.col.pctTotalSum", base = "total", of = "sum"),
    list(key = "pctNIn",      col = "output.col.pctNInVar",   base = "group", of = "n"),
    list(key = "pctSumIn",    col = "output.col.pctSumInVar", base = "group", of = "sum")
  )
  active_pcts <- Filter(function(p) isTRUE(stats_opts[[p$key]]) &&
                          (p$base == "total" || has_groups), pct_defs)
  # Everything unticked would leave a label-only table — fall back to N.
  if (length(active_stats) == 0 && length(active_pcts) == 0) {
    active_stats <- Filter(function(s) s$key == "n", sai_summary_stat_defs())
  }

  # Valid (non-NA) values of one summary variable within a row subset, and the
  # dataset-wide totals the "% of Total" cells are relative to.
  clean_var <- function(v, idx) {
    x <- suppressWarnings(as.numeric(df[[v]][idx]))
    x[!is.na(x)]
  }
  base_of <- function(x) list(n = length(x), sum = sum(x))
  totals <- lapply(vars, function(v) base_of(clean_var(v, seq_len(nrow(df)))))

  # One column per grouping variable per "% … in <var>" checkbox, named after
  # the variable it is a percentage of ("% of N in bulanti").
  pct_columns <- unlist(lapply(active_pcts, function(p) {
    if (p$base == "total") p$col else paste0(p$col, ":", gnames)
  }))

  # Per-summary-variable, per-grouping-variable, per-category bases for the
  # "% … in <var>" cells: a cell's percentage is against its OWN category of
  # that grouping variable, collapsed over every other one.
  gmat <- lapply(groups, function(g) as.character(df[[g]]))
  group_bases <- lapply(seq_along(vars), function(k) {
    lapply(seq_along(groups), function(gi) {
      levels_gi <- unique(gmat[[gi]])
      out <- lapply(levels_gi, function(lv) base_of(clean_var(vars[k], which(gmat[[gi]] == lv))))
      names(out) <- levels_gi
      out
    })
  })

  #' One cell block: the statistics of summary variable k over rows `idx`.
  #' `combo` is the cell's category per grouping variable, or NULL for the
  #' Total row (whose base is the whole cube, so its percentages are 100).
  summarize_cell <- function(idx, k, combo) {
    # File order, not the block's sorted order — First/Last must report the
    # first and last CASE of the cell, which is what SPSS's FIRST/LAST mean.
    v <- sai_stat_input(df[[vars[k]]][sort(idx)])
    cell <- base_of(v$num)
    pct <- function(num, den) {
      if (is.null(den) || !is.finite(den) || den == 0) return(NULL)
      round(100 * num / den, 6)
    }
    # do.call(c, …), never unlist(): an empty cell is NULL (the renderer's blank)
    # and unlist() DROPS NULL components, which would silently shift every later
    # percentage one column to the left.
    pct_cells <- do.call(c, lapply(active_pcts, function(p) {
      if (p$base == "total") return(list(pct(cell[[p$of]], totals[[k]][[p$of]])))
      lapply(seq_along(groups), function(gi) {
        den <- if (is.null(combo)) totals[[k]] else group_bases[[k]][[gi]][[combo[gi]]]
        pct(cell[[p$of]], den[[p$of]])
      })
    }))
    c(lapply(active_stats, function(s) sai_eval_stat(s, v)), pct_cells)
  }

  # Nested grouping: unique combinations in sorted order; the level label is
  # printed only on the block's first row (SPSS's nested row labels, flattened).
  rows <- list()
  if (has_groups) {
    ord <- do.call(order, gmat)
    gord <- lapply(gmat, function(g) g[ord])
    # \r can't appear in a category label, so pasted keys are collision-free.
    combo_key <- do.call(paste, c(gord, sep = "\r"))
    block_start <- which(c(TRUE, combo_key[-1] != combo_key[-length(combo_key)]))
    block_end <- c(block_start[-1] - 1L, length(combo_key))
    for (b in if (length(combo_key) > 0) seq_along(block_start) else integer(0)) {
      idx <- ord[block_start[b]:block_end[b]]
      combo <- vapply(gord, function(g) g[block_start[b]], character(1))
      # A level's label is printed once, on the first row of the block where
      # that level's value changes (SPSS's nested row labels, flattened). A
      # level restarts whenever ANY level above it changes, so "M / a" after
      # "F / b" must reprint "a" even though the previous block also ended in
      # an "a"-less run — comparing only the level's own value would blank it.
      labels <- lapply(seq_along(groups), function(gi) {
        s <- block_start[b]
        unchanged <- s > 1 && all(vapply(
          seq_len(gi), function(gj) gord[[gj]][s] == gord[[gj]][s - 1], logical(1)
        ))
        if (unchanged) return("")
        resolve_var_name(gord[[gi]][s], params$groupValueLabels[[groups[gi]]])
      })
      for (k in seq_along(vars)) {
        row_labels <- if (k == 1) labels else lapply(groups, function(g) "")
        rows <- c(rows, list(c(row_labels, list(nm[k]), summarize_cell(idx, k, combo))))
      }
    }
  } else {
    for (k in seq_along(vars)) {
      rows <- c(rows, list(c(list(nm[k]), summarize_cell(seq_len(nrow(df)), k, NULL))))
    }
  }

  # SPSS's OLAP Cubes is a LAYERED table and its Total layer — every case,
  # ungrouped — is the layer it opens on. Flattened into one table here, that
  # layer becomes a closing Total block. Without it the output only ever showed
  # the parts and never the whole: a manual comparison had SPSS reporting
  # N=309 / Sum=47895 for sira while we printed 237 and 72 with nothing tying
  # them together. Skipped when there are no grouping variables, where the
  # single block above already IS the total.
  if (has_groups) {
    all_idx <- seq_len(nrow(df))
    for (k in seq_along(vars)) {
      label_cells <- c(list("output.col.total"), rep(list(""), length(groups) - 1))
      row_labels <- if (k == 1) label_cells else lapply(groups, function(g) "")
      rows <- c(rows, list(c(row_labels, list(nm[k]), summarize_cell(all_idx, k, NULL))))
    }
  }

  progress(90L, "progress.formatting")

  columns <- c(if (has_groups) as.list(gnames) else list(),
               list("output.col.variable"),
               lapply(active_stats, function(s) s$col),
               as.list(pct_columns))

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(
      # Included/Excluded is SPSS's wording for this table in the procedures
      # that summarise (SUMMARIZE, OLAP CUBES) rather than tabulate, so the
      # column keys are shared with Case Summaries rather than retyped.
      titleKey = "output.cps.title",
      columns = list("output.col.variable",
                     "output.caseSummaries.includedN", "output.caseSummaries.includedPct",
                     "output.caseSummaries.excludedN", "output.caseSummaries.excludedPct",
                     "output.caseSummaries.totalN", "output.caseSummaries.totalPct"),
      rows = cps_rows
    ),
    list(
      titleKey = "output.olapCubes.title",
      columns = columns,
      rows = rows
    )
  ))

}, error = function(e) {
  sai_error(conditionMessage(e))
})
