# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _bootstrap.R — Shared helpers sourced by every analysis script.
#
# This file defines helper functions only; it performs NO side effects on load.
# Each analysis script sources this file after reading its own params so it can
# pass rScriptsDir to source().
#
# Output contract:
#   tables  — list of table objects:  { titleKey, columns, rows, footnoteKey? }
#   plots   — list of plot objects:   { titleKey, type, data }
#   warnings — character vector of i18n keys
#   notes    — character vector of i18n keys
#
# Result is written to stdout between __SAI_RESULT__ / __END_RESULT__ markers.
# Progress lines go to STDERR: PROGRESS:{pct}:{key}

# Ensure user-installed packages (~/R/library/<R major.minor>) are on the
# search path. This handles the case where packages were installed without
# write access to the system library (e.g. R installed via apt without sudo for
# site-library). One folder per R minor version, same as r-user-library.ts: a
# package built for another R version must never be loaded.
# Best effort: the app already puts this folder on R_LIBS (r-bridge.ts), so
# this is only needed outside it. A customer's home path made dir.exists()
# fail with "file name conversion problem -- name too long?" (2026-10-11),
# which aborted every analysis before it started — never again.
try(local({
  user_lib <- file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = "."))
  # Compare normalized paths: path.expand("~") keeps backslashes on Windows,
  # while .libPaths() is all-forward-slash, so a raw %in% never matched and
  # user_lib was prepended even when already present (shadowing newer libs).
  norm <- function(p) normalizePath(p, winslash = "/", mustWork = TRUE)
  if (dir.exists(user_lib) && !(norm(user_lib) %in% norm(.libPaths()))) {
    .libPaths(c(user_lib, .libPaths()))
  }
}), silent = TRUE)

suppressPackageStartupMessages({
  library(jsonlite)
  library(arrow)
})

# ── I/O helpers ───────────────────────────────────────────────────────────────

#' Read the params JSON file whose path is in commandArgs.
read_params <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 1 || !nzchar(args[1])) {
    stop("No params file path provided as first command-line argument")
  }
  params_file <- args[1]
  raw <- readLines(params_file, warn = FALSE)
  params <- fromJSON(paste(raw, collapse = "\n"), simplifyVector = FALSE)

  # Weight Cases (W1): every script calls read_params(), so recording the
  # request here (not inside get_weights()) means sai_output() can warn
  # honestly even for scripts that never call get_weights() at all — no
  # per-script code needed for the ~40 analyses that don't weight yet.
  if (!is.null(params$weightVariable) && nzchar(params$weightVariable)) {
    .sai_weight_requested <<- TRUE
  }

  # Missing Values (M1): same honesty pattern as weight — recorded here (not
  # inside apply_user_missing()) so sai_output() can warn even for scripts
  # that never call apply_user_missing() at all.
  if (!is.null(params$missingValues) && length(params$missingValues) > 0) {
    .sai_missing_requested <<- TRUE
  }

  # Missing Values strategy (MV): same honesty pattern — recorded here so
  # sai_output() can warn even for scripts that never call apply_listwise().
  if (!is.null(params$options) && identical(params$options$missing, "listwise")) {
    .sai_missing_opt_requested <<- TRUE
  }

  # Bootstrapping (BOOT1): same honesty pattern — recorded here so
  # sai_output() can warn even for scripts that never call sai_bootstrap().
  if (!is.null(params$options$bootstrap) && isTRUE(params$options$bootstrap$enabled)) {
    .sai_bootstrap_requested <<- TRUE
  }

  # Exact/Monte Carlo p-values (EXACT1): same honesty pattern — recorded here
  # so sai_output() can warn even for scripts that never call
  # sai_monte_carlo_chisq().
  if (!is.null(params$options$pMethod) && identical(params$options$pMethod$method, "montecarlo")) {
    .sai_pmethod_requested <<- TRUE
  }

  # Split File (B2): same honesty pattern — recorded here so sai_output() can
  # warn even for scripts that never call get_split_groups().
  if (!is.null(params$splitVariable) && nzchar(params$splitVariable)) {
    .sai_split_requested <<- TRUE
  }

  # New variables (NV1): same honesty pattern — the user asked a dialog to
  # create case-level columns, so if the script never calls sai_case_var()
  # sai_output() says so rather than letting the request evaporate silently.
  if (length(requested_new_vars(params)) > 0) {
    .sai_case_vars_requested <<- TRUE
  }

  params
}

# ── New variables from an analysis (NV1) ──────────────────────────────────────
# A dialog sends params$createVars as { <slotKey>: "<user's variable name>" };
# an empty or absent name means "don't create this one". The script computes
# the vector, calls sai_case_var(), and sai_output() carries the result to
# electron/ipc/db-handler/case-var-handlers.ts, which adds the column exactly
# the way Transform > Compute Variable does. Nothing is written to disk here:
# despite SPSS calling this panel "Save", it only ever produced dataset
# columns, so the project does not use that word (roadmap ★11).
.sai_case_vars_requested <- FALSE
.sai_case_vars_applied <- FALSE

#' Which case-variable slots the dialog actually asked for.
#' @param params parsed params from read_params()
#' @return named LIST: slotKey -> requested variable name.
#'   A list, not a named character vector, so a script can test an unrequested
#'   slot with `want[["survival"]]` and get NULL. On a character vector that
#'   same expression raises "subscript out of bounds", which inside a script's
#'   tryCatch surfaces as a failed analysis — i.e. asking for ONE of four
#'   columns would kill the whole run. Caught by tests/r-validation.
requested_new_vars <- function(params) {
  spec <- params$createVars
  if (is.null(spec) || length(spec) == 0) {
    return(list())
  }
  nm <- unlist(spec, use.names = TRUE)
  nm <- nm[!is.na(nm) & nzchar(nm)]
  as.list(nm)
}

#' The dataset row number of each row of `df`, for carrying into a model frame.
#'
#' `__row_idx` is DuckDB's 0-based positional key and rides along in the Parquet
#' export (`SELECT *`), so a script that builds its own model frame only has to
#' copy this column across before it deletes incomplete cases. The fallback is
#' for the r-validation harness, which hands scripts a hand-built frame: there
#' positional order IS the dataset order, which is exactly what `__row_idx`
#' means for an unfiltered load_data() frame.
#'
#' WARNING — never put this column in a frame a DOT FORMULA is fitted on.
#' `y ~ .` enrols every other column as a predictor, so the row number silently
#' becomes an explanatory variable and every coefficient shifts. Adding it to
#' discriminant.R's frame did exactly that; the fix is an explicit predictor
#' list. Every script that carries the row index today builds its formula
#' explicitly; any script that still fits `~ .` must do the same BEFORE it
#' starts carrying it.
row_index_of <- function(df) {
  idx <- df[["__row_idx"]]
  if (is.null(idx)) seq_len(nrow(df)) - 1L else as.integer(idx)
}

#' Build one case-variable entry for sai_output(caseVars=).
#'
#' @param name    the variable name the user typed (from requested_new_vars())
#' @param values  one value per row of `rows_df` — the model's per-case output
#' @param rows_df the data frame the values were computed FROM, still carrying
#'   `__row_idx`. This is the whole point: an analysis drops cases (listwise
#'   missing, weight/split filters), so `values` is indexed over the analysis's
#'   rows, not the dataset's. Passing the subset the model actually used lets
#'   each value keep the dataset row it belongs to; guessing the alignment
#'   instead puts numbers on the wrong cases with nothing looking wrong.
#' @param labelKey optional i18n key stored as the variable label
sai_case_var <- function(name, values, rows_df, labelKey = "",
                         type = "numeric", measure = "scale", decimals = 3) {
  idx <- rows_df[["__row_idx"]]
  if (is.null(idx)) {
    stop("sai_case_var(): rows_df has no __row_idx column — pass the data frame ",
         "returned by load_data() (or a row-subset of it), not a rebuilt one")
  }
  if (length(values) != length(idx)) {
    stop(sprintf("sai_case_var(%s): %d values for %d rows", name, length(values), length(idx)))
  }
  # Drop everything unwritable in ONE pass: NA for strings, and for numbers
  # anything not finite. NaN/Inf are not representable in JSON (they arrive as
  # the string "Inf" and would poison a DOUBLE column), and a case whose value
  # is infinite — a Kaplan-Meier hazard where S(t) has reached 0, say — is
  # honestly blank in Data View rather than fabricated. Rows left out simply
  # keep the NULL the new column starts with, which is the same thing the
  # cases dropped by listwise deletion get.
  vals <- if (identical(type, "string")) as.character(values) else
    suppressWarnings(as.numeric(values))
  keep <- if (identical(type, "string")) !is.na(vals) else is.finite(vals)
  vals <- vals[keep]
  .sai_case_vars_applied <<- TRUE
  list(
    name = unname(name),
    label = labelKey,
    type = type,
    measure = measure,
    decimals = as.integer(decimals),
    values = as.list(vals),
    rowIndex = as.list(as.integer(idx[keep]))
  )
}

#' Load the dataset from the Parquet file specified in params$parquetPath.
load_data <- function(params) {
  path <- params$parquetPath
  if (is.null(path) || !nzchar(path)) {
    stop("params$parquetPath is missing or empty")
  }
  as.data.frame(read_parquet(path))
}

#' Emit a progress event to STDERR.
#' @param pct   Integer 0–100
#' @param key   i18n message key (e.g. "progress.computing")
progress <- function(pct, key) {
  cat(sprintf("PROGRESS:%d:%s\n", as.integer(pct), key), file = stderr())
}

# ── Weight Cases (W1) ──────────────────────────────────────────────────────────
# SPSS-style case weighting: WEIGHT BY sets a frequency-weight variable for the
# whole dataset; electron/ipc/analysis-handler.ts injects it into every
# analysis:run as params$weightVariable. A script opts in by calling
# get_weights() and using the returned (possibly row-filtered) data frame and
# weight vector in its own formulas. Scripts that don't call it stay exactly
# as before — sai_output() below appends an honest "not applied" warning
# whenever a weight was requested but never consumed, so silence never means
# "weighting worked" (CLAUDE.md's own bar: a silently-ignored weight is
# exactly the "yanlış p-değeri" class of bug the project treats as critical).
.sai_weight_requested <- FALSE
.sai_weight_applied <- FALSE
# Set by sai_weight_unsupported() below: the i18n title key of a procedure that
# KNOWS it has no weighted implementation, so its warning can name itself.
.sai_weight_procedure <- NULL

#' Declare that this procedure has no weighted implementation.
#'
#' The generic warning ("this analysis does not currently apply weighting") is
#' honest but anonymous, and a reader with several blocks in the Output view
#' cannot tell WHICH analysis it belongs to once the block is collapsed. A
#' procedure that has consciously not implemented weighting says so by name.
#' Call it unconditionally at the top of the script: nothing is emitted unless
#' a weight is actually active for the run.
#' @param title_key the procedure's own i18n title key (e.g.
#'   "output.olapCubes.title") — translateOutputKey() resolves a parameter that
#'   itself starts with "output." recursively, so the name arrives translated.
sai_weight_unsupported <- function(title_key) {
  .sai_weight_procedure <<- title_key
}

#' Resolve the active case-weight column (if any) into a numeric weight
#' vector, dropping rows with NA/zero/negative weight (SPSS excludes these
#' cases from weighted analyses). Returns list(df=, w=); `w` is NULL when no
#' weight is active for this run — callers should fall back to their
#' unweighted computation in that case.
#' @param df     data frame already loaded via load_data()
#' @param params the parsed params list from read_params()
get_weights <- function(df, params) {
  wcol <- params$weightVariable
  if (is.null(wcol) || !nzchar(wcol)) {
    return(list(df = df, w = NULL))
  }
  if (!(wcol %in% names(df))) {
    sai_error(sprintf("Weight column not found: %s", wcol))
  }
  w_all <- suppressWarnings(as.numeric(df[[wcol]]))
  keep <- !is.na(w_all) & w_all > 0
  if (!any(keep)) {
    sai_error(
      "No cases remain after applying case weights (all weights are missing, zero, or negative)"
    )
  }
  .sai_weight_applied <<- TRUE
  list(df = df[keep, , drop = FALSE], w = w_all[keep])
}

# ── Missing Values (M1) ─────────────────────────────────────────────────────────
# SPSS-style user-defined missing values: Variable View's "Missing" field marks
# specific discrete values and/or a numeric range as missing for a variable,
# and SPSS excludes those cases from statistics by default (same as system
# missing/NA). electron/ipc/analysis-handler.ts injects a colId -> MissingValues
# map into params$missingValues for every variable that has a spec defined.
# A script opts in by calling apply_user_missing(x, colId, params) on each
# column it reads and using the returned (recoded-to-NA) vector — same
# opt-in/honesty contract as get_weights(): scripts that don't call it stay
# exactly as before, and sai_output() below appends an honest "not applied"
# warning whenever any variable had a missing spec but no column in this run
# was ever passed through apply_user_missing().
.sai_missing_requested <- FALSE
.sai_missing_applied <- FALSE
# TRUE as soon as the script routes ANY column through apply_user_missing() —
# proof it honors the missing-values contract. Distinguishes "this script
# ignores missing specs" (warn) from "the specs are on variables not involved
# in this analysis" (no warning — SPSS doesn't warn there either).
.sai_missing_checked <- FALSE

#' Recode a column's user-defined-missing values to NA (SPSS-style: excluded
#' from statistics by default, same treatment as system-missing). No-op if
#' `colId` has no missing spec in params$missingValues.
#' @param x     the column vector, already extracted from the data frame
#' @param colId the variable's colId (e.g. "col_3") — the same identifier
#'              used to index the data frame and params$varNames
#' @param params the parsed params list from read_params()
apply_user_missing <- function(x, colId, params) {
  .sai_missing_checked <<- TRUE
  spec <- params$missingValues[[colId]]
  if (is.null(spec)) return(x)
  .sai_missing_applied <<- TRUE
  type <- spec$type

  if (!is.null(spec$discrete) && length(spec$discrete) > 0 &&
      type %in% c("discrete", "range+discrete")) {
    # Compare as character so numeric/string JSON round-tripping (e.g. 99 vs
    # "99") never causes a silent miss.
    disc_chr <- as.character(unlist(spec$discrete))
    x[as.character(x) %in% disc_chr] <- NA
  }

  if (!is.null(spec$rangeLow) && !is.null(spec$rangeHigh) &&
      type %in% c("range", "range+discrete")) {
    x_num <- suppressWarnings(as.numeric(x))
    in_range <- !is.na(x_num) & x_num >= spec$rangeLow & x_num <= spec$rangeHigh
    x[in_range] <- NA
  }

  x
}

#' Which positions of `x` are user-defined-missing (per `colId`'s spec),
#' evaluated against the ORIGINAL (pre-NA-conversion) values — so a caller
#' can still tell each user-missing value apart (e.g. Frequencies' Missing
#' block showing "99" and "System" as separate rows) after
#' apply_user_missing() has already collapsed both into plain NA elsewhere.
#' Positions already system-missing (NA in `x`) are never flagged here — a
#' value can't be both. Deliberately duplicates apply_user_missing()'s small
#' discrete/range matching logic instead of refactoring it to share this
#' helper: apply_user_missing() is called by 19 scripts, and this project's
#' R suite can't be run end-to-end in every environment (arrow package
#' dependency) — an independent, narrowly-scoped helper is safer than a
#' shared-code refactor that can't be fully regression-tested here (MV4).
#' @return logical vector, same length as `x`
user_missing_mask <- function(x, colId, params) {
  spec <- params$missingValues[[colId]]
  n <- length(x)
  if (is.null(spec)) return(rep(FALSE, n))
  type <- spec$type
  mask <- rep(FALSE, n)

  if (!is.null(spec$discrete) && length(spec$discrete) > 0 &&
      type %in% c("discrete", "range+discrete")) {
    disc_chr <- as.character(unlist(spec$discrete))
    mask <- mask | (as.character(x) %in% disc_chr)
  }

  if (!is.null(spec$rangeLow) && !is.null(spec$rangeHigh) &&
      type %in% c("range", "range+discrete")) {
    x_num <- suppressWarnings(as.numeric(x))
    mask <- mask | (!is.na(x_num) & x_num >= spec$rangeLow & x_num <= spec$rangeHigh)
  }

  mask & !is.na(x)
}

# ── Missing Values strategy (MV) ────────────────────────────────────────────────
# SPSS's "Exclude cases analysis by analysis" (default) vs "Exclude cases
# listwise" dialog radio. Analysis-by-analysis is what every script already
# does (its own per-variable/per-pair `!is.na()` filter) — no code needed for
# that branch. Listwise means: if ANY of the variables involved in this
# analysis is missing (system OR user-defined) for a case, drop that case
# from every variable/table in the run. Same opt-in/honesty contract as
# get_weights()/apply_user_missing(): a script calls apply_listwise() only
# when params$options$missing == "listwise"; sai_output() warns if the option
# was requested but the script never consumed it.
.sai_missing_opt_requested <- FALSE
.sai_missing_opt_applied <- FALSE

#' Row-filter `df` to complete cases across `colIds` when the caller's
#' Missing Values option is set to "listwise". No-op (returns df unchanged)
#' for the default "analysis" strategy. Columns are first run through
#' apply_user_missing() so user-defined missing values count toward the
#' listwise deletion too (same as SPSS).
#' @param df     data frame (already loaded via load_data(), pre-get_weights())
#' @param colIds character vector of colIds involved in this analysis
#' @param params the parsed params list from read_params()
apply_listwise <- function(df, colIds, params) {
  strategy <- params$options$missing
  if (is.null(strategy) || !identical(strategy, "listwise")) return(df)
  .sai_missing_opt_applied <<- TRUE
  keep <- rep(TRUE, nrow(df))
  for (colId in colIds) {
    if (!colId %in% names(df)) next
    v <- apply_user_missing(df[[colId]], colId, params)
    keep <- keep & !is.na(v)
  }
  df[keep, , drop = FALSE]
}

# ── Decimals (M2) ────────────────────────────────────────────────────────────────
# SPSS applies a numeric variable's Decimals setting to its own raw values when
# they're displayed in an output table (e.g. Frequencies' "Value" column) —
# display formatting only, never the precision of computed statistics (those
# already have their own fixed formatting downstream in
# src/lib/output-format.ts). electron/ipc/analysis-handler.ts injects a
# colId -> decimals map into params$variableDecimals for every numeric
# variable. Unlike weight/missing there's no "requested but not applied"
# honesty warning here — this is a pure display nicety, not a correctness
# concern, so scripts that don't call it just keep showing full precision.

#' Format a single raw category/value label using its variable's Decimals
#' setting. Values that don't parse as numeric (genuine string categories,
#' or a variable with no decimals spec) are returned unchanged.
#' @param label the value label as produced by table()/tapply names (character)
#' @param colId the variable's colId (e.g. "col_3")
#' @param params the parsed params list from read_params()
format_decimals <- function(label, colId, params) {
  d <- params$variableDecimals[[colId]]
  if (is.null(d)) return(label)
  num <- suppressWarnings(as.numeric(label))
  if (is.na(num)) return(label)
  sprintf(paste0("%.", as.integer(d), "f"), num)
}

# ── Variable-name resolution ────────────────────────────────────────────────────
# `params$varNames` maps colId -> the user-facing variable name (never sent by
# colId alone, since a table/plot must show "age", not "col_3"). Falls back to
# the colId itself when a name is missing (defensive; shouldn't happen with a
# well-formed params payload).

#' Resolve a single colId to its display name.
#' @param colId     the variable's colId (e.g. "col_3")
#' @param var_names named list/vector, colId -> display name (params$varNames)
resolve_var_name <- function(colId, var_names) {
  if (is.null(var_names) || length(var_names) == 0) return(as.character(colId))
  s_col <- as.character(colId)
  if (!is.null(var_names[[s_col]])) return(as.character(var_names[[s_col]]))
  if (grepl("^[0-9]+\\.0+$", s_col)) {
    int_col <- sub("\\.0+$", "", s_col)
    if (!is.null(var_names[[int_col]])) return(as.character(var_names[[int_col]]))
  } else if (!is.na(suppressWarnings(as.numeric(s_col)))) {
    dot_col <- paste0(s_col, ".0")
    if (!is.null(var_names[[dot_col]])) return(as.character(var_names[[dot_col]]))
  }
  s_col
}

#' Vectorized resolve_var_name() over a character vector of colIds.
#' @param colIds    character vector of colIds
#' @param var_names named list/vector, colId -> display name (params$varNames)
resolve_var_names <- function(colIds, var_names) {
  # vapply()/USE.NAMES defaults to using a character `X` as the result's
  # names — every caller then indexes single elements out of this (nm[i])
  # and drops them straight into a row list(), where a named length-1
  # vector's name attribute survives and corrupts jsonlite's serialisation
  # (a plain string becomes a one-key object, failing the output schema).
  # unname() so callers never have to remember to do it themselves.
  unname(vapply(colIds, resolve_var_name, character(1), var_names = var_names))
}

# ── Plot-trace helpers ──────────────────────────────────────────────────────────
# Shared by explore.R ("Analyze > Explore" histograms) and chart.R ("Graphs"
# menu histogram) so both bin identically and never drift apart.

#' Builds a Plotly histogram trace using Sturges' rule bin width (the same
#' default SPSS's own histogram uses).
#' @param nv    numeric vector, already NA-filtered (length >= 2)
#' @param name  trace name shown in the plot editor's Variables & Series tab
#'              and the exported legend — typically the variable's display
#'              label (resolve_var_name()/params$xVarName), NULL to omit
#' @param color marker fill color — callers keep their own BAR_COLOR constant
#'              so each menu's chart family keeps its own palette
sai_histogram_trace <- function(nv, name = NULL, color = "#4C78A8", nbins = NULL) {
  rng      <- range(nv)
  nbins    <- if (is.null(nbins)) max(1L, nclass.Sturges(nv)) else max(1L, as.integer(nbins))
  binwidth <- (rng[2] - rng[1]) / nbins
  if (!is.finite(binwidth) || binwidth <= 0) binwidth <- 1
  trace <- list(
    type = "histogram", x = as.list(nv),
    marker = list(color = color), opacity = 0.85,
    xbins = list(start = rng[1], end = rng[2] + binwidth, size = binwidth)
  )
  if (!is.null(name)) trace$name <- name
  trace
}

# ── Weighted-statistics helpers ────────────────────────────────────────────────
# Shared by frequencies.R / descriptives.R / explore.R / means.R / anova-oneway.R.
# Every helper accepts `w = NULL` and then reproduces the exact unweighted base-R
# computation — so a script can route ALL its numeric stats through these
# unconditionally without branching on whether weighting is active.
#
# SPSS frequency-weight convention: a case with weight k counts as k cases, so
# N becomes W = sum(w), and variance/skewness/kurtosis use (W-1)-style
# denominators exactly as the unweighted formulas use (n-1).

#' Formats an already-computed case count for display: unweighted counts are
#' exact integers, weighted counts are fractional sums-of-weights (a case with
#' weight 2.5 contributes 2.5 to a category tally) rounded to avoid float noise.
format_wtd_count <- function(x, w = NULL) {
  if (is.null(w)) return(as.integer(x))
  round(x, 6)
}

#' Weighted mean: sum(w*x)/sum(w).
wtd_mean <- function(x, w = NULL) {
  if (is.null(w)) return(mean(x, na.rm = TRUE))
  ok <- !is.na(x) & !is.na(w)
  if (!any(ok)) return(NA_real_)
  sum(w[ok] * x[ok]) / sum(w[ok])
}

#' Weighted sum: sum(w*x) — the SPSS "weighted total" (a case with weight k
#' contributes k*x, as if it were k identical cases).
wtd_sum <- function(x, w = NULL) {
  if (is.null(w)) return(sum(x, na.rm = TRUE))
  ok <- !is.na(x) & !is.na(w)
  sum(w[ok] * x[ok])
}

#' Weighted (sample) variance, W-1 denominator.
wtd_var <- function(x, w = NULL) {
  if (is.null(w)) return(var(x, na.rm = TRUE))
  ok <- !is.na(x) & !is.na(w)
  x <- x[ok]; w <- w[ok]
  wsum <- sum(w)
  if (wsum <= 1) return(NA_real_)
  m <- sum(w * x) / wsum
  sum(w * (x - m)^2) / (wsum - 1)
}

#' Weighted standard deviation.
wtd_sd <- function(x, w = NULL) {
  if (is.null(w)) return(sd(x, na.rm = TRUE))
  v <- wtd_var(x, w)
  if (is.na(v) || v < 0) return(NA_real_)
  sqrt(v)
}

#' Percentiles by SPSS's HAVERAGE rule — the "Weighted Average (Definition 1)"
#' its FREQUENCIES and EXAMINE tables are labelled with, and its default for
#' /PERCENTILES. Position the p-th percentile at tc = p*(W+1) on the cumulative
#' weight scale and interpolate between the cases straddling it; with unit
#' weights this is exactly R's quantile(type = 6).
#'
#' The previous version had two defects, both found by tests/spss-parity
#' against a real SPSS run (age, n = 120, p = 0.90: SPSS 63.9, ours 63.1):
#'   1. the unweighted branch delegated to quantile()'s DEFAULT type 7
#'      (h = 1+(n-1)p), which is R's convention, not SPSS's;
#'   2. the weighted branch used a third rule again (cumsum(w) - w/2), so the
#'      same data gave different percentiles depending only on whether a weight
#'      variable happened to be set — with w = 1 it returned 63.5 where the
#'      unweighted branch returned 63.1.
#' Quartiles and the median are unaffected by the change (type 6 and type 7
#' coincide at p = 0.5, and tied integer data hides the difference elsewhere),
#' which is precisely why this survived so long.
wtd_quantile <- function(x, w = NULL, probs = c(0.25, 0.5, 0.75)) {
  ok <- if (is.null(w)) !is.na(x) else !is.na(x) & !is.na(w)
  x  <- x[ok]
  wv <- if (is.null(w)) NULL else w[ok]
  if (length(x) == 0) return(rep(NA_real_, length(probs)))
  ord <- order(x)
  x   <- x[ord]
  wv  <- if (is.null(wv)) rep(1, length(x)) else wv[ord]
  cw  <- cumsum(wv)
  n   <- length(x)
  totw <- cw[n]
  vapply(probs, function(p) {
    tc <- p * (totw + 1)
    if (!is.finite(tc) || tc <= 1) return(x[1])
    if (tc >= totw) return(x[n])
    k <- floor(tc); g <- tc - k
    # Smallest case index whose cumulative weight reaches k (and k+1).
    i1 <- min(findInterval(k, cw, left.open = TRUE) + 1L, n)
    i2 <- min(findInterval(k + 1, cw, left.open = TRUE) + 1L, n)
    (1 - g) * x[i1] + g * x[i2]
  }, numeric(1))
}

wtd_median <- function(x, w = NULL) {
  if (is.null(w)) return(median(x, na.rm = TRUE))
  unname(wtd_quantile(x, w, probs = 0.5))
}

#' Round half AWAY FROM ZERO, the way SPSS displays numbers. R's round() uses
#' banker's rounding (half to even), so a value landing exactly on the boundary
#' comes out one digit lower: the Friedman mean rank 2.925 printed as 2.92
#' where SPSS prints 2.93. Only the tie case differs — everything else is
#' identical to round().
#'
#' The epsilon is not cosmetic: 2.925 * 100 is 292.49999999999994 in binary, so
#' floor(z + 0.5) alone would still answer 292. It is scaled with the magnitude
#' so it stays below the last kept digit.
#'
#' Use for values that are DISPLAYED. Rounding that feeds a computation (weight
#' counts to integers, guards against float noise) should keep plain round().
round_half_up <- function(x, digits = 0) {
  z <- abs(x) * 10^digits
  eps <- pmax(1e-9, abs(z) * 1e-12)
  sign(x) * floor(z + 0.5 + eps) / 10^digits
}

#' SPSS's 5% trimmed mean: trims EXACTLY 5% of the cases at each end, giving
#' the boundary case the fractional part of its weight. R's mean(trim = 0.05)
#' drops floor(n * 0.05) whole cases instead — with n = 117 it removes 5 where
#' 5.85 are called for and the boundary case counts in full, which shifts both
#' EXAMINE's "5% Trimmed Mean" and ONEWAY's Levene "based on trimmed mean"
#' (score: .916 against SPSS's .912) off SPSS.
#'
#' No weighted form: SPSS trims by case count, not cumulative weight, and no
#' settled weighted-frequency definition exists — callers that carry weights
#' compute this unweighted and say so (explore.R's weight note).
trimmed_mean_5 <- function(x) {
  x <- sort(x)
  nn <- length(x)
  w5 <- nn * 0.05
  k <- floor(w5)
  if (nn - 2 * k < 2) return(mean(x))
  r5 <- w5 - k
  inner <- if (k + 2 <= nn - k - 1) sum(x[(k + 2):(nn - k - 1)]) else 0
  ((1 - r5) * (x[k + 1] + x[nn - k]) + inner) / (nn - 2 * w5)
}

#' Weighted mode: value with the largest summed weight (ties broken by
#' which.max's first-match rule, same as the unweighted tabulate() approach).
#' Returns the value as a length-1 vector of x's original type when
#' unweighted, or as a character when weighted (tapply names) — callers
#' already stringify the mode for display either way.
wtd_mode <- function(x, w = NULL) {
  if (is.null(w)) {
    x <- x[!is.na(x)]
    if (length(x) == 0) return(NA)
    ux <- unique(x)
    return(ux[which.max(tabulate(match(x, ux)))])
  }
  ok <- !is.na(x)
  x <- x[ok]; w <- w[ok]
  if (length(x) == 0) return(NA)
  agg <- tapply(w, x, sum)
  names(agg)[which.max(agg)]
}

#' Weighted skewness — SPSS's adjusted Fisher-Pearson skewness (matches the
#' canonical G1 statistic: G1 = sqrt(n(n-1))/(n-2) * m3/m2^1.5 using biased
#' population moments m2/m3; expressed here via the *unbiased* sample sd s
#' (wtd_sd, n-1 denominator) as G1 = n^2/((n-1)(n-2)) * m3/s^3 — verified
#' against this identity numerically (see tests/r-validation/test-descriptives.R
#' and spss-parity-findings-2026-07-07.md, which caught a wrong prior formula
#' here that used (n-1)^1.5 instead of n^2 in the numerator and blew up for
#' large n). w = NULL reproduces the unweighted case (W = n).
wtd_skewness <- function(x, w = NULL) {
  ok <- if (is.null(w)) !is.na(x) else !is.na(x) & !is.na(w)
  x <- x[ok]
  wv <- if (is.null(w)) NULL else w[ok]
  n <- if (is.null(wv)) length(x) else sum(wv)
  if (n < 3) return(NA_real_)
  m  <- wtd_mean(x, wv)
  m3 <- if (is.null(wv)) mean((x - m)^3) else sum(wv * (x - m)^3) / n
  s  <- wtd_sd(x, wv)
  if (s == 0 || is.na(s)) return(NA_real_)
  (n^2 / ((n - 1) * (n - 2))) * (m3 / s^3)
}

#' Weighted kurtosis — SPSS's adjusted Fisher excess kurtosis (canonical G2:
#' G2 = [(n-1)/((n-2)(n-3))] * [(n+1)*g2 + 6], g2 = m4/m2^2-3 with biased
#' moments; expressed via unbiased s as
#' G2 = n^2(n+1)/((n-1)(n-2)(n-3)) * m4/s^4 - 3(n-1)^2/((n-2)(n-3)) — same
#' fix/verification as wtd_skewness() above (prior formula used (n-1)^2
#' instead of n^2 and was wildly wrong for even moderate n).
wtd_kurtosis <- function(x, w = NULL) {
  ok <- if (is.null(w)) !is.na(x) else !is.na(x) & !is.na(w)
  x <- x[ok]
  wv <- if (is.null(w)) NULL else w[ok]
  n <- if (is.null(wv)) length(x) else sum(wv)
  if (n < 4) return(NA_real_)
  m  <- wtd_mean(x, wv)
  m4 <- if (is.null(wv)) mean((x - m)^4) else sum(wv * (x - m)^4) / n
  s  <- wtd_sd(x, wv)
  if (s == 0 || is.na(s)) return(NA_real_)
  (n^2 * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * (m4 / s^4) -
    3 * (n - 1)^2 / ((n - 2) * (n - 3))
}

#' Standard error of skewness/kurtosis (SPSS formulas, unweighted N). Shared
#' by descriptives.R/frequencies.R/explore.R/normality.R — same formula each
#' previously duplicated locally.
se_skewness <- function(n) {
  if (n < 3) return(NA_real_)
  sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
}
se_kurtosis <- function(n) {
  if (n < 4) return(NA_real_)
  ses <- se_skewness(n)
  sqrt(4 * (n^2 - 1) * ses^2 / ((n - 3) * (n + 5)))
}

#' The note every Bayesian analysis prints under its table: which Cauchy prior
#' width produced the Bayes factor.
#'
#' A Bayes factor is not a property of the data alone — it moves with the prior
#' width, and two programs with the same prior FAMILY still disagree if they
#' default to different widths. Ours default to BayesFactor's "medium"; other
#' packages default to r = 1. Nothing here is wrong either way, but a reader
#' comparing two outputs cannot tell which they are looking at unless the number
#' is on the page, so it is.
#'
#' The named settings map to DIFFERENT numbers per test family — "medium" is
#' 0.707 for a t test but 0.354 for a regression coefficient — which is exactly
#' why the note prints the value and not the label. Values below are
#' BayesFactor's documented ones, each verified against the package by running
#' the named setting and the number side by side.
#'
#' @param rscale the dialog's setting: "medium"|"wide"|"ultrawide", or a number
#' @param family which BayesFactor argument it feeds
#' @return an i18n note key carrying the label and the numeric width
sai_bf_prior_note <- function(rscale, family = c("ttest", "correlation",
                                                 "anovaFixed", "lmCont")) {
  family <- match.arg(family)
  named <- switch(family,
    ttest       = c(medium = sqrt(2) / 2, wide = 1,           ultrawide = sqrt(2)),
    correlation = c(medium = 1 / 3,       wide = 1 / sqrt(3), ultrawide = 1),
    anovaFixed  = c(medium = 1 / 2,       wide = sqrt(2) / 2, ultrawide = 1),
    lmCont      = c(medium = sqrt(2) / 4, wide = 1 / 2,       ultrawide = sqrt(2) / 2)
  )
  if (is.character(rscale) && rscale %in% names(named)) {
    label <- paste0("output.bayes.scale", toupper(substring(rscale, 1, 1)),
                    substring(rscale, 2))
    value <- unname(named[[rscale]])
  } else {
    value <- suppressWarnings(as.numeric(rscale))
    if (!is.finite(value)) return(character(0))
    label <- "output.bayes.scaleCustom"
  }
  # The label is itself an i18n key: translateOutputKey() resolves a parameter
  # that starts with "output." recursively, so the setting's name arrives in the
  # user's language instead of as the English word the dialog stores.
  paste0("output.bayes.priorFootnote:", label, "|", format(round(value, 4), nsmall = 0))
}

#' Fix the random stream for a Bayesian analysis and return the output note.
#'
#' BayesFactor::posterior() draws MCMC samples; unseeded, the same data gave
#' posterior means and credible intervals 1-9% apart from one run to the next
#' (measured 2026-10-10, 13 results in the R comparison suite). SPSS's rule is
#' a fixed default seed (2000000) that the user can change; same here — the
#' default makes every run reproducible, params$seed overrides it. Called
#' before the Bayes factor too, so its own sampling-based estimates (anovaBF's
#' error %) are reproducible as well.
#'
#' @return note key carrying the draw count and the seed actually used
SAI_BAYES_DRAWS <- 10000L
sai_bayes_seed <- function(params) {
  seed <- suppressWarnings(as.integer(params$seed))
  if (length(seed) != 1L || is.na(seed)) seed <- 2000000L
  set.seed(seed)
  paste0("output.bayes.mcmcNote:", SAI_BAYES_DRAWS, "|", seed)
}

#' Standard error of the AUC under the nonparametric (distribution-free)
#' assumption, exactly as the SPSS ROC / ROC ANALYSIS algorithms define it:
#'
#'   SE = sqrt( (A(1-A) + (n+ - 1)(Q1 - A²) + (n- - 1)(Q2 - A²)) / (n+ n-) )
#'
#' with Q1 and Q2 estimated from the data (Bamber 1975 / Hanley & McNeil's
#' form, not their exponential shortcut). For each test value t,
#'   Q1 = Σ_t neg(t) · (a² + a·b + b²/3) / (n- n+²),  a = #pos > t, b = #pos = t
#'   Q2 = Σ_t pos(t) · (c² + c·d + d²/3) / (n+ n-²),  c = #neg < t, d = #neg = t
#' — a tie block contributes the integral of the squared count across the
#' block (the ROC curve runs diagonally through it), not the ½-weighted count.
#'
#' Pinned against SPSS twice: the worked example in the SPSS 29 algorithms
#' manual (ROC ANALYSIS §2.1.6, SE = 0.183) and a 294-case clinical dataset
#' with three heavily tied scores, where it reproduces every printed SE and
#' every interval bound. The DeLong structural-component variance this
#' replaced agreed on untied data but drifted on ties (INR: .0570 vs SPSS's
#' .057 with bounds .711/.935 instead of .712/.934), because it averages the
#' ½-weighted components rather than integrating through the tie block.
#'
#' Hanley & McNeil's exponential shortcut (Q1 = A/(2-A), Q2 = 2A²/(1+A)) is
#' DISTRIBUTION(NEGEXPO) — auc_binegexp_se() — and only the user's choice.
#'
#' Case weights act as frequency counts throughout, so an integer-weighted
#' frame gives the same SE as the replicated one. O(n log n).
#'
#' @param x        numeric scores, NA-free, already sign-flipped if the
#'                 direction is "smaller"
#' @param positive logical, TRUE for the positive (state) group
#' @param w        optional case weights, same length as `x`
#' @return the standard error, or NA_real_ when it is undefined
auc_nonparametric_se <- function(x, positive, w = NULL) {
  ws <- if (is.null(w)) rep(1, length(x)) else w
  np <- sum(ws[positive]); nn <- sum(ws[!positive])
  if (np <= 0 || nn <= 0) return(NA_real_)
  idx <- match(x, sort(unique(x)))
  pos_at <- as.numeric(rowsum(ws * positive, idx))
  neg_at <- as.numeric(rowsum(ws * !positive, idx))
  pos_above <- rev(cumsum(rev(pos_at))) - pos_at
  neg_below <- cumsum(neg_at) - neg_at
  A  <- sum(neg_at * (pos_above + 0.5 * pos_at)) / (np * nn)
  Q1 <- sum(neg_at * (pos_above^2 + pos_above * pos_at + pos_at^2 / 3)) / (nn * np^2)
  Q2 <- sum(pos_at * (neg_below^2 + neg_below * neg_at + neg_at^2 / 3)) / (np * nn^2)
  v  <- (A * (1 - A) + (np - 1) * (Q1 - A^2) + (nn - 1) * (Q2 - A^2)) / (np * nn)
  if (!is.finite(v) || v < 0) NA_real_ else sqrt(v)
}

# ── ROC shared core (roc.R + roc-analysis.R) ────────────────────────────────
# The ROC Curve and ROC Analysis dialogs share SPSS's Options sub-dialog
# (Classification / Test Direction / Parameters for Standard Error of Area /
# Missing Values) and the same per-variable arithmetic. Both scripts call the
# helpers below so one area can never come out differently by dialog — the
# drift auc_nonparametric_se() above was created to end.

#' Normalize the Options sub-dialog payload. Absent keys fall back to SPSS's
#' defaults (CUTOFF(INCLUDE) TESTPOS(LARGE) DISTRIBUTION(FREE) CI(95)
#' MISSING=EXCLUDE), so older syntax/test payloads keep their meaning.
roc_read_options <- function(opts) {
  ci <- suppressWarnings(as.numeric(opts$ciLevel))
  if (length(ci) != 1 || is.na(ci) || ci <= 0 || ci >= 1) ci <- 0.95
  list(
    direction          = if (identical(opts$direction, "smaller")) "smaller" else "larger",
    cutoff_include     = !identical(opts$cutoff, "exclude"),
    distribution       = if (identical(opts$distribution, "negexpo")) "negexpo" else "free",
    ci_level           = ci,
    user_missing_valid = isTRUE(opts$userMissingValid)
  )
}

#' Standard error of the AUC under the bi-negative exponential assumption
#' (Hanley & McNeil 1982) — SPSS's DISTRIBUTION(NEGEXPO). Only offered as the
#' user's explicit choice; the default stays the assumption-free nonparametric SE
#' (see auc_nonparametric_se() for why it is not the default).
auc_binegexp_se <- function(A, np, nn) {
  q1 <- A / (2 - A); q2 <- 2 * A^2 / (1 + A)
  v <- (A * (1 - A) + (np - 1) * (q1 - A^2) + (nn - 1) * (q2 - A^2)) / (np * nn)
  if (!is.finite(v) || v < 0) NA_real_ else sqrt(v)
}

#' Everything one test variable contributes: AUC, its SE / interval / Asymp.
#' Sig., and the TP/FP counts at every cutoff.
#'
#' Cutoffs follow SPSS: the midpoint between consecutive distinct values, plus
#' sentinels one unit beyond the extremes. The ROC curve is drawn through the
#' cutoff points rather than case by case, so a block of tied scores becomes
#' the diagonal segment it should be instead of a staircase whose shape
#' depends on row order.
#'
#' @param x        scores, NA-free, already sign-flipped for TESTPOS(SMALL)
#' @param positive logical, TRUE for the positive actual state
#' @param w        optional case weights aligned to x
#' @param o        roc_read_options() result
roc_compute <- function(x, positive, w, o) {
  ws <- if (is.null(w)) rep(1, length(x)) else w
  np <- sum(ws[positive]); nn <- sum(ws[!positive])
  if (np <= 0 || nn <= 0) sai_error("State value must split cases into two groups")

  # Mann-Whitney U -> AUC. Unweighted: O(n log n) rank formula. Weighted: a
  # positive/negative pair counts wp * wn times (a case of weight k acts as k
  # cases) — O(np*nn), fine for the aggregated tables weighting is used for.
  if (is.null(w)) {
    r   <- rank(x)
    auc <- (sum(r[positive]) - np * (np + 1) / 2) / (np * nn)
  } else {
    xp <- x[positive]; xn <- x[!positive]
    auc <- sum(outer(ws[positive], ws[!positive]) *
                 (outer(xp, xn, ">") + 0.5 * outer(xp, xn, "=="))) / (np * nn)
  }

  se <- if (o$distribution == "negexpo") auc_binegexp_se(auc, np, nn)
        else auc_nonparametric_se(x, positive, w)
  # Significance under H0: area = 0.5. Both assumptions reduce to the same
  # null variance (Hanley-McNeil's Q1 = Q2 = 1/3 at A = 0.5 gives exactly
  # (np + nn + 1) / (12 np nn)), so one formula serves both.
  se0 <- sqrt((np + nn + 1) / (12 * np * nn))
  p   <- 2 * pnorm(-abs((auc - 0.5) / se0))
  # qnorm, not the textbook 1.96: SPSS uses the exact quantile and the
  # difference shows at the printed precision.
  z  <- qnorm(1 - (1 - o$ci_level) / 2)
  lo <- max(0, auc - z * se); hi <- min(1, auc + z * se)

  uniq <- sort(unique(x), decreasing = TRUE)
  cutoffs <- if (length(uniq) > 1)
    c(uniq[1] + 1, (uniq[-length(uniq)] + uniq[-1]) / 2, uniq[length(uniq)] - 1)
  else c(uniq[1] + 1, uniq[1] - 1)
  tp <- fp <- numeric(length(cutoffs))
  for (i in seq_along(cutoffs)) {
    # CUTOFF(INCLUDE): a case AT the cutoff is classified positive. With
    # midpoint cutoffs no case sits exactly on one, so the counts agree either
    # way (as in SPSS); the choice decides the column heading SPSS prints.
    pred_pos <- if (o$cutoff_include) x >= cutoffs[i] else x > cutoffs[i]
    tp[i] <- sum(ws[pred_pos & positive])
    fp[i] <- sum(ws[pred_pos & !positive])
  }

  list(auc = auc, se = se, p = p, lo = lo, hi = hi, np = np, nn = nn,
       cutoffs = cutoffs, tp = tp, fp = fp,
       # SPSS's tie warning: a score shared by a positive and a negative case.
       ties = any(x[positive] %in% x[!positive]))
}

#' The cutoff a user reads: un-flipped for TESTPOS(SMALL).
roc_display_cutoff <- function(cut, o) if (o$direction == "smaller") -cut else cut

#' Column heading for the cutoff column — SPSS words it by direction and by
#' whether the cutoff itself counts as positive.
roc_cutoff_col <- function(o) {
  if (o$direction == "smaller") {
    if (o$cutoff_include) "output.col.positiveIfLe" else "output.col.positiveIfLt"
  } else {
    if (o$cutoff_include) "output.col.positiveIfGe" else "output.col.positiveIfGt"
  }
}

#' Prepare the analysis frame the way SPSS ROC does: listwise across every
#' test variable and the state variable ("Valid N (listwise)"), with
#' user-missing values either excluded (default) or, with
#' MISSING=INCLUDE, treated as valid. Returns the cleaned columns plus the
#' Case Processing Summary counts.
roc_prepare <- function(df, vars, sv, params, o) {
  for (v in vars) if (!v %in% names(df)) sai_error(paste("Column not found:", v))
  if (is.null(sv) || !sv %in% names(df)) sai_error("State variable not found")
  # Always listwise, so an explicit "listwise" request is honored, not ignored.
  if (identical(params$options$missing, "listwise")) .sai_missing_opt_applied <<- TRUE
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w
  um <- function(x, col) {
    if (o$user_missing_valid) { .sai_missing_checked <<- TRUE; x }
    else apply_user_missing(x, col, params)
  }
  s_all <- as.character(um(df[[sv]], sv))
  s_all[!is.na(s_all) & trimws(s_all) == ""] <- NA
  xs <- lapply(vars, function(v) suppressWarnings(as.numeric(um(df[[v]], v))))
  names(xs) <- vars
  keep <- !is.na(s_all)
  for (x in xs) keep <- keep & !is.na(x)
  wt <- if (is.null(w)) rep(1, length(keep)) else w
  list(
    s = s_all[keep],
    x = lapply(xs, function(x) x[keep]),
    w = if (is.null(w)) NULL else w[keep],
    n_missing = sum(wt[!keep])
  )
}

#' SPSS's Case Processing Summary for ROC: positive / negative counts (Σw
#' under weighting), Missing and Total, and the footnote that names the
#' positive state (by its value label when one exists) and the test direction.
#' The heading is the state variable's label, as SPSS prints it.
roc_case_summary <- function(params, sv, np, nn, n_missing, pos_val, o) {
  state_head <- params$stateLabel
  if (is.null(state_head) || !nzchar(state_head)) state_head <- params$stateName
  if (is.null(state_head) || !nzchar(state_head)) state_head <- sv
  rows <- list(list("output.roc.positive", round_half_up(np, 3)),
               list("output.roc.negative", round_half_up(nn, 3)))
  if (n_missing > 0) rows <- c(rows, list(list("output.roc.missing", round_half_up(n_missing, 3))))
  rows <- c(rows, list(list("output.roc.total", round_half_up(np + nn + n_missing, 3))))
  pos_label <- resolve_var_name(pos_val, params$stateValueLabels)
  dir_key <- if (o$direction == "smaller") "output.roc.dirSmallerNote" else "output.roc.dirLargerNote"
  list(
    titleKey = "output.roc.cpsTitle",
    columns = list(paste0("output.roc.stateCol:", state_head), "output.roc.validNListwise"),
    rows = rows,
    footnoteKey = paste0("output.roc.cpsFootnote:", gsub("|", "/", pos_label, fixed = TRUE),
                         "|", dir_key))
}

#' The Area Under the Curve table, with or without SPSS's "Standard error and
#' confidence interval" columns. ROC Analysis titles it "Area Under the ROC
#' Curve" (title_key), ROC Curve "Area Under the Curve". With SE/CI the
#' footnote names the assumption and the null hypothesis, as SPSS's a/b do.
roc_auc_table <- function(stats_by_var, names_by_var, se_ci, ci_pct, o,
                          title_key = "output.roc.aucTitle") {
  rows <- lapply(seq_along(stats_by_var), function(i) {
    r <- stats_by_var[[i]]
    if (se_ci) list(names_by_var[[i]], round_half_up(r$auc, 3), round_half_up(r$se, 3), round_half_up(r$p, 6),
                    round_half_up(r$lo, 3), round_half_up(r$hi, 3))
    else list(names_by_var[[i]], round_half_up(r$auc, 3))
  })
  columns <- if (se_ci)
    list("output.col.testResultVar", "output.col.area", "output.col.stdError",
         "output.col.asympSig",
         paste0("output.col.ciLowerPct:", ci_pct), paste0("output.col.ciUpperPct:", ci_pct))
  else list("output.col.testResultVar", "output.col.area")
  list(titleKey = title_key, columns = columns, rows = rows,
       footnoteKey = if (se_ci) {
         if (o$distribution == "negexpo") "output.roc.aucFootnoteNegexp"
         else "output.roc.aucFootnote"
       } else NULL)
}

#' Notes every ROC run carries: which SE the interval used (when one was
#' printed) and SPSS's tie warning, naming every tied variable.
roc_common_notes <- function(stats_by_var, names_by_var, se_ci, ci_pct, o) {
  notes <- character(0)
  if (se_ci) {
    notes <- c(notes, paste0(if (o$distribution == "negexpo") "output.roc.seMethodNoteNegexp:"
                             else "output.rocAnalysis.seMethodNote:", ci_pct))
  }
  tied <- unlist(names_by_var[vapply(stats_by_var, function(r) isTRUE(r$ties), logical(1))])
  if (length(tied) > 0) notes <- c(notes, paste0("output.roc.tiesNote:", paste(tied, collapse = ", ")))
  notes
}

#' ROC curve plot (one line per variable), optionally with the diagonal.
roc_curve_plot <- function(stats_by_var, names_by_var, palette, diagonal) {
  traces <- lapply(seq_along(stats_by_var), function(i) {
    r <- stats_by_var[[i]]
    list(type = "scatter", mode = "lines", name = names_by_var[[i]],
         x = as.list(r$fp / r$nn), y = as.list(r$tp / r$np),
         line = list(color = palette[((i - 1) %% length(palette)) + 1]))
  })
  if (diagonal) {
    traces <- c(traces, list(list(
      type = "scatter", mode = "lines", name = "Reference", showlegend = FALSE,
      x = as.list(c(0, 1)), y = as.list(c(0, 1)),
      line = list(color = "#888", dash = "dash"))))
  }
  list(titleKey = "output.roc.curveTitle", type = "plotly",
       data = list(data = traces, layout = list(
         xaxis = list(title = list(text = "1 - Specificity"), range = list(0, 1)),
         yaxis = list(title = list(text = "Sensitivity"), range = list(0, 1)),
         margin = list(t = 40, r = 20, b = 40, l = 60))))
}

#' Row order SPSS prints coordinates in: ascending by the cutoff the user
#' reads (min - 1 first, max + 1 last), whichever the test direction.
roc_cut_order <- function(r, o) order(roc_display_cutoff(r$cutoffs, o))

#' One coordinates table for every test variable, laid out as SPSS does: the
#' variable name on its first row only, rows ascending by cutoff, and the
#' footnote that explains where the cutoffs come from. `cols` builds the
#' statistic cells for cutoff index i of result r.
roc_coord_block <- function(stats_by_var, names_by_var, o, title_key, stat_cols, cols) {
  rows <- list()
  for (k in seq_along(stats_by_var)) {
    r <- stats_by_var[[k]]
    ord <- roc_cut_order(r, o)
    for (j in seq_along(ord)) {
      i <- ord[j]
      rows[[length(rows) + 1L]] <- c(
        list(if (j == 1) names_by_var[[k]] else "",
             round_half_up(roc_display_cutoff(r$cutoffs[i], o), 4)),
        cols(r, i))
    }
  }
  list(titleKey = title_key,
       columns = c(list("output.col.testResultVar", roc_cutoff_col(o)), stat_cols),
       rows = rows,
       footnoteKey = "output.roc.cutoffFootnote")
}

#' SPSS's "Coordinates of the Curve" (ROC Curve) / "Coordinates of the ROC
#' Curve" (ROC Analysis).
roc_coord_table <- function(stats_by_var, names_by_var, o, title_key = "output.roc.coordsTitle") {
  roc_coord_block(stats_by_var, names_by_var, o, title_key,
                  list("output.col.sensitivity", "output.col.oneMinusSpecificity"),
                  function(r, i) list(round_half_up(r$tp[i] / r$np, 3), round_half_up(r$fp[i] / r$nn, 3)))
}

#' Precision at a cutoff. Where nothing is classified positive (TP + FP = 0,
#' the cutoff above the maximum) precision is 0/0; SPSS prints 1 there — the
#' usual convention that anchors the PR curve at (recall 0, precision 1).
roc_precision <- function(tp, fp) ifelse(tp + fp == 0, 1, tp / (tp + fp))

roc_palette <- c("#3b6ea5", "#e07b39", "#3f9142", "#a3419b", "#c94040", "#3aa6a6")

#' The Options sub-dialog of SPSS's one-sample nonparametric tests (Binomial,
#' One-Sample K-S, Runs): Missing Values "Exclude cases listwise" drops a case
#' missing on ANY test variable, keeping an already-computed weight vector in
#' step. "Test-by-test" (the default) changes nothing — each test already uses
#' its own available cases.
#' @return list(df, w)
npar_listwise <- function(df, w, vars, params) {
  if (!identical(params$options$missing, "listwise")) return(list(df = df, w = w))
  .sai_missing_opt_applied <<- TRUE
  keep <- rep(TRUE, nrow(df))
  for (v in vars) if (v %in% names(df)) keep <- keep & !is.na(apply_user_missing(df[[v]], v, params))
  list(df = df[keep, , drop = FALSE], w = if (is.null(w)) NULL else w[keep])
}

#' SPSS NPAR TESTS /STATISTICS DESCRIPTIVES QUARTILES for one-sample tests:
#' N, Mean, Std. Deviation, Minimum, Maximum (descriptives) and the 25th,
#' 50th and 75th percentiles (quartiles), per test variable, on the cases that
#' variable has. Weighted under Weight Cases. NULL when neither is requested.
npar_descriptives_table <- function(df, w, vars, var_names, params) {
  want_desc <- isTRUE(params$options$descriptives)
  want_quart <- isTRUE(params$options$quartiles)
  if (!want_desc && !want_quart) return(NULL)
  rows <- lapply(vars, function(v) {
    x <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params)))
    ok <- !is.na(x); wv <- if (is.null(w)) NULL else w[ok]; x <- x[ok]
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    n <- if (is.null(wv)) length(x) else sum(wv)
    q <- if (length(x)) wtd_quantile(x, wv, probs = c(0.25, 0.5, 0.75)) else rep(NA_real_, 3)
    c(list(nm, round_half_up(n, 3)),
      if (want_desc) list(round_half_up(wtd_mean(x, wv), 3), round_half_up(wtd_sd(x, wv), 3),
                          round_half_up(min(x), 3), round_half_up(max(x), 3)),
      if (want_quart) list(round_half_up(q[1], 3), round_half_up(q[2], 3), round_half_up(q[3], 3)))
  })
  list(titleKey = "output.npar.descriptivesTitle",
       columns = c(list("output.col.variable", "output.col.n"),
                   if (want_desc) list("output.col.mean", "output.col.stdDeviation",
                                       "output.col.min", "output.col.max"),
                   if (want_quart) list("output.col.p25", "output.col.median", "output.col.p75")),
       rows = rows, footnoteKey = NULL)
}

#' Box's Test of Equality of Covariance Matrices, as SPSS computes it (SPSS
#' Statistics Algorithms, Appendix J): M = (n - g) log|S| - sum (n_i - 1)
#' log|S_i| over the cells with a non-singular covariance matrix, and the F
#' approximation f1 = (g-1) r (r+1) / 2, f2 = (f1 + 2) / |tau - (1 - rho)^2|,
#' F = M (rho - f1 / f2) / f1. Used by GLM Multivariate and GLM Repeated
#' Measures (Options ▸ Homogeneity tests).
#'
#' @param Y    numeric matrix, one column per dependent / level variable
#' @param cell factor, the design cell of each row
#' @param w    optional frequency weights
#' @return list(table, skipped) — table is NULL when fewer than two cells
#'         have a usable covariance matrix; skipped counts the left-out cells
sai_box_m <- function(Y, cell, w = NULL) {
  r <- ncol(Y); wv <- if (is.null(w)) rep(1, nrow(Y)) else w
  covs_i <- list(); ns <- numeric(0); skipped <- 0L
  for (idx in split(seq_len(nrow(Y)), cell, drop = TRUE)) {
    ni <- sum(wv[idx])
    if (ni <= r) { skipped <- skipped + 1L; next }
    Yi <- Y[idx, , drop = FALSE]; wi <- wv[idx]
    mi <- colSums(Yi * wi) / sum(wi)
    Si <- crossprod((Yi - rep(mi, each = nrow(Yi))) * sqrt(wi)) / (ni - 1)
    if (!is.finite(det(Si)) || det(Si) <= 0) { skipped <- skipped + 1L; next }
    covs_i[[length(covs_i) + 1L]] <- Si; ns <- c(ns, ni)
  }
  g <- length(covs_i)
  if (g < 2) return(list(table = NULL, skipped = skipped))
  N <- sum(ns)
  Sp <- Reduce(`+`, Map(function(S, ni) (ni - 1) * S, covs_i, ns)) / (N - g)
  M <- (N - g) * log(det(Sp)) - sum(mapply(function(S, ni) (ni - 1) * log(det(S)), covs_i, ns))
  c1 <- (sum(1 / (ns - 1)) - 1 / (N - g)) * (2 * r^2 + 3 * r - 1) / (6 * (r + 1) * (g - 1))
  c2 <- (sum(1 / (ns - 1)^2) - 1 / (N - g)^2) * (r - 1) * (r + 2) / (6 * (g - 1))
  f1 <- (g - 1) * r * (r + 1) / 2
  f2 <- (f1 + 2) / abs(c2 - c1^2)
  Fb <- M * ((1 - c1) - f1 / f2) / f1
  list(skipped = skipped, table = list(
    titleKey = "output.glmMulti.boxTitle",
    columns = list("output.col.boxM", "output.col.f", "output.col.df1", "output.col.df2",
                   "output.col.sig"),
    rows = list(list(round_half_up(M, 3), round_half_up(Fb, 3), round_half_up(f1, 0),
                     round_half_up(f2, 3), round(pf(Fb, f1, f2, lower.tail = FALSE), 6))),
    footnoteKey = "output.glmMulti.boxFootnote"))
}

# ── Summary statistics registry (the Reports procedures) ────────────────────
# Case Summaries, Report Summaries in Rows and Report Summaries in Columns all
# offer the same statistic menu, so the definitions live here once instead of
# being retyped in three scripts that would then drift apart in which
# statistics they offer, what they call them, and how they compute them.
#
# The order below is SPSS's own output order, verified against a real SPSS 26
# Case Summaries export (manuel-test/spss.htm): N, Mean, Median, Std. Error of
# Mean, Sum, Minimum, Maximum, Range, First, Last, Std. Deviation, Variance,
# Kurtosis, Std. Error of Kurtosis, Skewness, Std. Error of Skewness, with
# Harmonic/Geometric Mean appended (SPSS's /CELLS takes HARMONIC and GEOMETRIC
# for all three procedures and for OLAP CUBES, which shares this menu).
#
# The percentage cells (SPCT/NPCT and their SPCT(var)/NPCT(var) forms) are NOT
# here: every statistic in this registry is a function of one variable's values
# alone, while a percentage needs a base computed outside the cell. OLAP Cubes
# defines those four itself — see olap-cubes.R.
#
#' SPSS's "Grouped Median".
#'
#' Recovered by running SPSS 26 itself (Production Facility, headless) on a
#' dataset whose tie structure was chosen to separate the candidate
#' definitions — see tests/r-validation/test-grouped-median-2026-08.R for the
#' cases and the numbers SPSS returned.
#'
#' It is NOT the textbook "class width" formula, which is why fitting one to
#' SPSS's output kept failing: two datasets with an identical median class,
#' identical cumulative-below and identical class frequency still get different
#' answers (1,1,1,2,2,2,3,3,3,3 -> 2.142857 but 1,1,1,2,2,2,3,3,3,4 ->
#' 2.166667), so no choice of width can reproduce both.
#'
#' What SPSS actually does: plot each distinct value against its MID-cumulative
#' proportion (cum_{i-1} + cum_i) / 2n, then read off the value at proportion
#' 0.5 by linear interpolation between neighbouring points. The frequency of
#' the class *above* the median therefore matters, which is what the class-width
#' family cannot express.
#'
#' Degenerates to the plain median when every value is distinct — matching what
#' SPSS returned for the all-distinct columns in the manual comparisons.
grouped_median <- function(x) {
  x <- x[!is.na(x)]
  n <- length(x)
  if (n == 0) return(NA_real_)
  tab <- table(x)
  vals <- as.numeric(names(tab))
  if (length(vals) == 1) return(vals[1])
  cum <- cumsum(as.numeric(tab))
  mid <- (c(0, cum[-length(cum)]) + cum) / (2 * n)
  # A single value can hold more than half the weight; then it IS the answer.
  if (0.5 <= mid[1]) return(vals[1])
  if (0.5 >= mid[length(mid)]) return(vals[length(vals)])
  k <- which(mid >= 0.5)[1]
  vals[k - 1] + (0.5 - mid[k - 1]) / (mid[k] - mid[k - 1]) * (vals[k] - vals[k - 1])
}

#' Extreme of a character vector, ordered case-insensitively like SPSS. R's own
#' sort puts every uppercase name before every lowercase one, which made SPSS's
#' Minimum ("ahmet arı", in a column that also holds "HALİL KARA")
#' unreachable.
#'
#' PLATFORM-DEPENDENT LIMIT — order() collates through LC_COLLATE, and how good
#' that is varies by build:
#'   * Windows 10+/macOS: the OS locale gives real collation (measured here
#'     under LC_COLLATE="Turkish_Türkiye.utf8": "şule han" sorts before
#'     "zerrin yazgan", i.e. the Turkish alphabet's ş-between-s-and-t rule) — we
#'     match SPSS;
#'   * the bundled Linux runtime has no ICU and runs under LC_COLLATE=C, where
#'     ordering is by code point and U+015F sorts after 'z' — there SPSS's
#'     Maximum "zerrin yazgan" comes out as "şule han".
#' An earlier note here claimed a Turkish locale on Windows switches to
#' codepage 1254 and mangles UTF-8; that was true of pre-4.2 R, but current R
#' on Windows uses UTF-8 locales and collates correctly. Closing the remaining
#' Linux gap means shipping stringi/ICU in the runtime. Affects only the
#' Minimum/Maximum of string variables whose extremes differ by a non-ASCII
#' letter. Pinned by test-case-summaries-spss-2026-08.R, which probes the
#' collation rather than assuming either behaviour.
sai_str_extreme <- function(vals, which = c("min", "max")) {
  which <- match.arg(which)
  if (length(vals) == 0) return(NULL)
  ord <- order(tolower(as.character(vals)))
  vals[if (which == "min") ord[1] else ord[length(ord)]]
}

#' Bundle one variable's values into the shape every statistic below expects:
#' `vals` are the valid values in FILE order (First/Last/Minimum/Maximum need
#' the originals, which may be strings) and `num` is their numeric coercion.
sai_stat_input <- function(raw) {
  vals <- raw[!is.na(raw)]
  num <- suppressWarnings(as.numeric(vals))
  list(vals = vals, num = num[!is.na(num)], numeric = is.numeric(raw))
}

#' The statistic menu. Each entry:
#'   key       checkbox id in params$options$stats
#'   col       i18n key for the column (in columns) or row (in rows) label
#'   stringOk  TRUE when the statistic is also defined for a string variable —
#'             SPSS reports N/Minimum/Maximum/First/Last for those and leaves
#'             the arithmetic ones blank
#'   min_n     smallest N the statistic is defined for
#'   f         function(v) using sai_stat_input()'s shape
sai_summary_stat_defs <- function() list(
  list(key = "n",          col = "output.col.n",          stringOk = TRUE,  min_n = 0,
       f = function(v) length(v$vals)),
  list(key = "mean",       col = "output.col.mean",       stringOk = FALSE, min_n = 1,
       f = function(v) mean(v$num)),
  list(key = "median",     col = "output.col.median",     stringOk = FALSE, min_n = 1,
       f = function(v) stats::median(v$num)),
  list(key = "groupedMedian", col = "output.col.groupedMedian", stringOk = FALSE, min_n = 1,
       f = function(v) grouped_median(v$num)),
  list(key = "seMean",     col = "output.col.seMean",     stringOk = FALSE, min_n = 2,
       f = function(v) stats::sd(v$num) / sqrt(length(v$num))),
  list(key = "sum",        col = "output.col.sum",        stringOk = FALSE, min_n = 0,
       f = function(v) sum(v$num)),
  list(key = "min",        col = "output.col.min",        stringOk = TRUE,  min_n = 1,
       f = function(v) if (v$numeric) min(v$num) else sai_str_extreme(v$vals, "min")),
  list(key = "max",        col = "output.col.max",        stringOk = TRUE,  min_n = 1,
       f = function(v) if (v$numeric) max(v$num) else sai_str_extreme(v$vals, "max")),
  list(key = "range",      col = "output.col.range",      stringOk = FALSE, min_n = 1,
       f = function(v) diff(range(v$num))),
  list(key = "first",      col = "output.col.first",      stringOk = TRUE,  min_n = 1,
       f = function(v) v$vals[1]),
  list(key = "last",       col = "output.col.last",       stringOk = TRUE,  min_n = 1,
       f = function(v) v$vals[length(v$vals)]),
  list(key = "sd",         col = "output.col.sd",         stringOk = FALSE, min_n = 2,
       f = function(v) stats::sd(v$num)),
  list(key = "variance",   col = "output.col.variance",   stringOk = FALSE, min_n = 2,
       f = function(v) stats::var(v$num)),
  list(key = "kurtosis",   col = "output.col.kurtosis",   stringOk = FALSE, min_n = 4,
       f = function(v) wtd_kurtosis(v$num)),
  list(key = "seKurtosis", col = "output.col.seKurtosis", stringOk = FALSE, min_n = 4,
       f = function(v) se_kurtosis(length(v$num))),
  list(key = "skewness",   col = "output.col.skewness",   stringOk = FALSE, min_n = 3,
       f = function(v) wtd_skewness(v$num)),
  list(key = "seSkewness", col = "output.col.seSkewness", stringOk = FALSE, min_n = 3,
       f = function(v) se_skewness(length(v$num))),
  # SPSS's HARMONIC/GEOMETRIC cells. Both are undefined once a value is zero or
  # negative (1/0, log of a non-positive number), and SPSS leaves the cell empty
  # rather than printing Inf or NaN — NULL is this registry's empty cell.
  list(key = "harmonic",   col = "output.col.harmonic",   stringOk = FALSE, min_n = 1,
       f = function(v) if (any(v$num <= 0)) NULL else length(v$num) / sum(1 / v$num)),
  list(key = "geometric",  col = "output.col.geometric",  stringOk = FALSE, min_n = 1,
       f = function(v) if (any(v$num <= 0)) NULL else exp(mean(log(v$num))))
)

#' Which statistics the dialog asked for, in the registry's (SPSS's) order.
#' An empty selection falls back to `fallback` so an older saved dialog still
#' produces a table; everything unticked falls back to N so the table is never
#' just labels.
sai_active_stats <- function(stats_opts, fallback = c("n", "mean", "sd")) {
  defs <- sai_summary_stat_defs()
  if (length(stats_opts) == 0) {
    return(Filter(function(s) s$key %in% fallback, defs))
  }
  active <- Filter(function(s) isTRUE(stats_opts[[s$key]]), defs)
  if (length(active) == 0) active <- Filter(function(s) s$key == "n", defs)
  active
}

#' Evaluate one statistic for one variable's values. Returns NULL — which the
#' renderer shows as SPSS's empty cell — when the statistic does not apply to
#' this variable's type or there are too few valid cases for it.
sai_eval_stat <- function(s, v) {
  if (!s$stringOk && !v$numeric) return(NULL)
  n <- if (v$numeric) length(v$num) else length(v$vals)
  if (n < s$min_n) return(NULL)
  out <- s$f(v)
  if (is.null(out) || length(out) != 1) return(NULL)
  if (is.na(out)) return(NULL)
  if (is.numeric(out)) round(out, 6) else as.character(out)
}

# ── Weighted t-tests ────────────────────────────────────────────────────────
# base R's t.test() has no `weights=` argument, so these reimplement the
# standard t formulas directly on weighted mean/variance/N (W = sum(w)) —
# SPSS frequency-weight semantics. w = NULL reproduces stats::t.test()'s own
# statistic/df/p-value/CI exactly (verified against t.test() directly).

#' One-sample / paired t-test core. For paired tests, pass the per-case
#' difference vector as `x` (see ttest-paired.R).
#' @return list(statistic, parameter, p.value, estimate, stderr, conf.int, n)
wtd_t_one <- function(x, w = NULL, mu = 0, conf_level = 0.95) {
  ok <- if (is.null(w)) !is.na(x) else !is.na(x) & !is.na(w)
  x  <- x[ok]
  wv <- if (is.null(w)) NULL else w[ok]
  n  <- if (is.null(wv)) length(x) else sum(wv)
  m  <- wtd_mean(x, wv)
  se <- wtd_sd(x, wv) / sqrt(n)
  df <- n - 1
  t  <- (m - mu) / se
  p  <- 2 * pt(-abs(t), df)
  tcrit <- qt(1 - (1 - conf_level) / 2, df)
  list(
    statistic = t, parameter = df, p.value = p, estimate = m, stderr = se,
    conf.int = c(m - tcrit * se, m + tcrit * se), n = n
  )
}

#' Independent two-sample t-test core (pooled or Welch).
#' @return list(statistic, parameter, p.value, estimate=c(m1,m2), stderr,
#'   conf.int (of the mean difference), n1, n2)
wtd_t_two <- function(x1, w1, x2, w2, var_equal = TRUE, conf_level = 0.95) {
  ok1 <- if (is.null(w1)) !is.na(x1) else !is.na(x1) & !is.na(w1)
  ok2 <- if (is.null(w2)) !is.na(x2) else !is.na(x2) & !is.na(w2)
  x1 <- x1[ok1]; x2 <- x2[ok2]
  wv1 <- if (is.null(w1)) NULL else w1[ok1]
  wv2 <- if (is.null(w2)) NULL else w2[ok2]
  n1 <- if (is.null(wv1)) length(x1) else sum(wv1)
  n2 <- if (is.null(wv2)) length(x2) else sum(wv2)
  m1 <- wtd_mean(x1, wv1); m2 <- wtd_mean(x2, wv2)
  v1 <- wtd_var(x1, wv1);  v2 <- wtd_var(x2, wv2)
  mdiff <- m1 - m2

  if (var_equal) {
    sp2 <- ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2)
    se  <- sqrt(sp2 * (1 / n1 + 1 / n2))
    df  <- n1 + n2 - 2
  } else {
    se <- sqrt(v1 / n1 + v2 / n2)
    df <- (v1 / n1 + v2 / n2)^2 / ((v1 / n1)^2 / (n1 - 1) + (v2 / n2)^2 / (n2 - 1))
  }
  t <- mdiff / se
  p <- 2 * pt(-abs(t), df)
  tcrit <- qt(1 - (1 - conf_level) / 2, df)
  list(
    statistic = t, parameter = df, p.value = p, estimate = c(m1, m2), stderr = se,
    conf.int = c(mdiff - tcrit * se, mdiff + tcrit * se), n1 = n1, n2 = n2,
    var1 = v1, var2 = v2
  )
}

#' Weighted Pearson correlation + significance test (used by ttest-paired.R's
#' Correlations table). w = NULL reproduces cor.test(x, y)$estimate/p.value.
#' @return list(estimate, p.value, n)
wtd_cor_test <- function(x, y, w = NULL) {
  ok <- if (is.null(w)) !is.na(x) & !is.na(y) else !is.na(x) & !is.na(y) & !is.na(w)
  x <- x[ok]; y <- y[ok]
  wv <- if (is.null(w)) NULL else w[ok]
  n <- if (is.null(wv)) length(x) else sum(wv)
  mx <- wtd_mean(x, wv); my <- wtd_mean(y, wv)
  if (is.null(wv)) {
    cov_xy <- sum((x - mx) * (y - my))
    vx <- sum((x - mx)^2); vy <- sum((y - my)^2)
  } else {
    cov_xy <- sum(wv * (x - mx) * (y - my))
    vx <- sum(wv * (x - mx)^2); vy <- sum(wv * (y - my)^2)
  }
  r <- cov_xy / sqrt(vx * vy)
  t <- r * sqrt(n - 2) / sqrt(1 - r^2)
  p <- 2 * pt(-abs(t), n - 2)
  list(estimate = r, p.value = p, n = n)
}

#' Weighted Welch (unequal-variance) one-way ANOVA — generalizes
#' oneway.test(x ~ g, var.equal = FALSE): per-group n/mean/var become
#' weighted (Σw / weighted mean / weighted variance); w = NULL reproduces
#' oneway.test()'s own F/df2/p-value exactly.
#' @param x numeric vector, g factor/character grouping vector (same length as x)
wtd_welch_anova <- function(x, g, w = NULL) {
  g <- as.character(g)
  lvls <- unique(g); k <- length(lvls)
  ni <- numeric(k); mi <- numeric(k); vi <- numeric(k)
  for (i in seq_len(k)) {
    idx <- g == lvls[i]
    xs <- x[idx]
    ws <- if (is.null(w)) NULL else w[idx]
    ni[i] <- if (is.null(ws)) length(xs) else sum(ws)
    mi[i] <- wtd_mean(xs, ws)
    vi[i] <- wtd_var(xs, ws)
  }
  wi   <- ni / vi
  W    <- sum(wi)
  xbar <- sum(wi * mi) / W
  num  <- sum(wi * (mi - xbar)^2) / (k - 1)
  s    <- sum((1 - wi / W)^2 / (ni - 1))
  Fv   <- num / (1 + (2 * (k - 2) / (k^2 - 1)) * s)
  df1  <- k - 1
  df2  <- (k^2 - 1) / (3 * s)
  list(statistic = Fv, df1 = df1, df2 = df2, p.value = pf(Fv, df1, df2, lower.tail = FALSE))
}

# ── Bootstrapping (BOOT1) ────────────────────────────────────────────────────
# SPSS's Bootstrap sub-dialog (IBM_SPSS_Bootstrapping.pdf): resamples cases
# with replacement B times, recomputes the statistic(s) each time, and adds
# Bias/Std. Error/CI columns to the procedure's own table. Same enrichedParams
# choke point as weight/missing: the dialog's <BootstrapSection> writes
# params$options$bootstrap = {enabled, samples, seed, ciLevel, ciType,
# stratify?}; a script opts in by calling sai_bootstrap() with a `statistic`
# function and merging the returned per-term rows into its own table. Scripts
# that don't call it stay exactly as before — sai_output() appends an honest
# "not applied" warning whenever bootstrap was requested but never consumed.
.sai_bootstrap_requested <- FALSE
.sai_bootstrap_applied <- FALSE

#' Bootstrap bias/SE/CI for one or more statistics, via the `boot` package
#' (an R "recommended" package bundled with every R installation — same
#' category as survival/MASS/nnet/nlme already required by setup.R).
#'
#' SPSS rules applied here (IBM_SPSS_Bootstrapping.pdf): (1) bootstrap forces
#' listwise deletion — callers must pass a `df` already restricted to
#' complete cases on the variables `statistic` reads (e.g. via
#' apply_listwise()/na.omit before calling); (2) non-integer case weights are
#' rejected (return NULL silently; sai_output()'s honesty warning covers it)
#' — integer weights are honoured by case-replication (a weight-k case
#' becomes k identical rows), matching SPSS's own frequency-weight semantics;
#' (3) stratified sampling resamples within `params$options$bootstrap$stratify`
#' groups instead of across the whole dataset.
#'
#' @param df        data frame, already listwise-complete for the variables
#'                  `statistic` uses
#' @param statistic function(data, indices) -> named numeric vector; computes
#'                  the point estimate(s) on data[indices, , drop = FALSE]
#' @param params    parsed params list from read_params()
#' @param weight    optional numeric weight vector, same length/row-order as
#'                  df (already resolved via get_weights()); NULL if no
#'                  active case weight
#' @return NULL if bootstrap isn't requested/enabled, the `boot` package is
#'   unavailable, or weights are non-integer; otherwise a list of per-term
#'   rows: list(term=, estimate=, bias=, se=, ci_lower=, ci_upper=)
sai_bootstrap <- function(df, statistic, params, weight = NULL) {
  opt <- params$options$bootstrap
  if (is.null(opt) || !isTRUE(opt$enabled)) return(NULL)

  if (!is.null(weight)) {
    non_integer <- any(abs(weight - round(weight)) > 1e-8, na.rm = TRUE)
    if (non_integer) return(NULL)
    reps <- pmax(as.integer(round(weight)), 0L)
    idx  <- rep(seq_len(nrow(df)), reps)
    df   <- df[idx, , drop = FALSE]
  }

  if (!requireNamespace("boot", quietly = TRUE)) return(NULL)

  n_samples <- if (!is.null(opt$samples)) as.integer(opt$samples) else 1000L
  ci_level  <- if (!is.null(opt$ciLevel)) as.numeric(opt$ciLevel) / 100 else 0.95
  ci_type   <- if (!is.null(opt$ciType) && identical(opt$ciType, "bca")) "bca" else "perc"

  # Fixed default seed (SPSS's own default, as sai_bayes_seed) → reproducible runs.
  set.seed(sai_default_seed(opt$seed))

  strata <- NULL
  strata_col <- opt$stratify
  if (!is.null(strata_col) && nzchar(strata_col) && strata_col %in% names(df)) {
    strata <- as.factor(df[[strata_col]])
  }

  boot_out <- tryCatch(
    if (is.null(strata)) {
      boot::boot(data = df, statistic = statistic, R = n_samples)
    } else {
      boot::boot(data = df, statistic = statistic, R = n_samples, strata = strata)
    },
    error = function(e) NULL
  )
  if (is.null(boot_out) || any(!is.finite(boot_out$t0))) return(NULL)

  term_names <- names(boot_out$t0)
  if (is.null(term_names)) term_names <- paste0("t", seq_along(boot_out$t0))
  ci_type_key <- if (ci_type == "bca") "bca" else "percent"

  rows <- lapply(seq_along(boot_out$t0), function(i) {
    est  <- unname(boot_out$t0[i])
    ti   <- boot_out$t[, i]
    ti   <- ti[is.finite(ti)]
    bias <- if (length(ti) > 0) mean(ti) - est else NA_real_
    se   <- if (length(ti) > 1) stats::sd(ti) else NA_real_
    ci <- tryCatch({
      ci_obj <- boot::boot.ci(boot_out, conf = ci_level, type = ci_type, index = i)
      unname(ci_obj[[ci_type_key]][4:5])
    }, error = function(e) c(NA_real_, NA_real_))
    list(term = term_names[i], estimate = est, bias = bias, se = se,
         ci_lower = ci[1], ci_upper = ci[2])
  })

  .sai_bootstrap_applied <<- TRUE
  rows
}

# ── Exact / Monte Carlo p-values (EXACT1) ───────────────────────────────────
# SPSS's Exact Tests module (IBM_SPSS_Exact_Tests.pdf): besides the default
# asymptotic p-value, Crosstabs/Nonparametric procedures offer a Monte Carlo
# p-value estimated by resampling random tables with the observed margins
# fixed — recommended when expected cell counts are small/sparse/unbalanced.
# Same choke-point/opt-in/honesty pattern as sai_bootstrap(): the dialog's
# pMethod option writes params$options$pMethod = {method, samples, seed}; a
# script opts in via sai_monte_carlo_chisq(); scripts that don't stay exactly
# as before, and sai_output() appends an honest "not applied" warning if the
# option was requested but never consumed.
.sai_pmethod_requested <- FALSE
.sai_pmethod_applied <- FALSE

#' Monte Carlo p-value for a Pearson chi-square test of independence, via
#' base R's own `simulate.p.value = TRUE` (resamples random r×c tables with
#' the observed margins fixed — the same "resample from the reference set"
#' idea IBM_SPSS_Exact_Tests.pdf describes for its Monte Carlo method).
#' @param tab    a table()/matrix of counts
#' @param params parsed params list (reads params$options$pMethod =
#'               {method: "montecarlo", samples, seed})
#' @return NULL if not requested/enabled or the simulation errors; otherwise
#'   list(p.value=, samples=)
sai_monte_carlo_chisq <- function(tab, params) {
  opt <- params$options$pMethod
  if (is.null(opt) || !identical(opt$method, "montecarlo")) return(NULL)
  .sai_pmethod_requested <<- TRUE

  B <- if (!is.null(opt$samples)) as.integer(opt$samples) else 10000L
  set.seed(sai_default_seed(opt$seed))

  p <- tryCatch(
    suppressWarnings(stats::chisq.test(tab, correct = FALSE, simulate.p.value = TRUE, B = B))$p.value,
    error = function(e) NULL
  )
  if (is.null(p)) return(NULL)
  .sai_pmethod_applied <<- TRUE
  list(p.value = p, samples = B)
}

#' Exact / Monte Carlo p-value for a rank test via the `coin` package — the
#' cases base R cannot do itself: exact-with-ties, or Monte Carlo resampling
#' for K-sample rank tests (Kruskal-Wallis, Friedman). Science-over-SPSS
#' policy (CLAUDE.md §11): where R's base default has no exact/MC path, use a
#' battle-tested permutation package rather than hand-roll the network/
#' permutation algorithm.
#'
#' Same opt-in/honesty contract as sai_monte_carlo_chisq(): reads
#' params$options$pMethod = {method: "montecarlo"|"exact", samples, seed};
#' returns NULL (→ sai_output()'s "pMethodNotApplied" warning) when not
#' requested, when `coin` is not installed, or when the computation errors
#' (e.g. exact infeasible for the design). Never mislabels a fallback.
#'
#' @param builder function(distribution) → a coin test object, e.g.
#'   function(d) coin::kruskal_test(x ~ g, distribution = d)
#' @param params  parsed params list
#' @return NULL, or list(p.value=, method=, samples=)
sai_coin_pvalue <- function(builder, params) {
  opt <- params$options$pMethod
  if (is.null(opt) ||
      !(identical(opt$method, "montecarlo") || identical(opt$method, "exact"))) {
    return(NULL)
  }
  .sai_pmethod_requested <<- TRUE
  if (!requireNamespace("coin", quietly = TRUE)) return(NULL)

  B    <- if (!is.null(opt$samples)) as.integer(opt$samples) else 10000L
  seed <- sai_default_seed(opt$seed)

  p <- tryCatch({
    if (!is.null(seed)) set.seed(seed)
    dist <- if (identical(opt$method, "exact")) {
      coin::exact()
    } else {
      # coin >= 1.3 renamed the resample-count arg B → nresample; the
      # tryCatch turns an old-coin signature mismatch into a graceful
      # "not applied" fallback rather than a hard error.
      coin::approximate(nresample = B)
    }
    as.numeric(coin::pvalue(builder(dist)))
  }, error = function(e) NULL)

  if (is.null(p) || is.na(p)) return(NULL)
  .sai_pmethod_applied <<- TRUE
  list(p.value = p, method = opt$method, samples = B)
}

# ── Split File (B2) ────────────────────────────────────────────────────────────
# SPSS-style Split File: Data → Split File sets a grouping variable; every
# subsequent analysis repeats its output once per distinct group value.
# electron/ipc/analysis-handler.ts injects the active colId into every
# analysis:run as params$splitVariable. A script opts in by calling
# get_split_groups(df, params) and looping over the returned groups instead of
# computing once on the whole df — same opt-in/honesty pattern as
# get_weights()/apply_user_missing() (see W1/M1 comments above): scripts that
# don't opt in keep working exactly as before, and sai_output() appends an
# honest "not applied" warning whenever a split was requested but never
# consumed (initial wave: descriptives.R/frequencies.R; SPLIT3 backlog covers
# the rest — see spss-parity-findings-2026-07-07.md).
.sai_split_requested <- FALSE
.sai_split_applied <- FALSE

#' Split `df` into one sub-data-frame per distinct value of the active split
#' variable (missing values on the split variable are dropped — SPSS excludes
#' them from all split groups). Returns a single group (label = NULL, the
#' unmodified df) when no split variable is active, so callers can always
#' loop over the result uniformly.
#' @param df     data frame (already loaded via load_data())
#' @param params parsed params list (reads params$splitVariable)
#' The seed a resampling procedure uses: the user's when given, else SPSS's
#' default 2000000, so the same data always gives the same Monte Carlo /
#' bootstrap result (the seed field in the dialogs stays an override).
sai_default_seed <- function(seed) {
  s <- suppressWarnings(as.integer(seed))
  if (length(s) != 1L || is.na(s)) 2000000L else s
}

#' Distinct values in a display order that respects numeric codes: "1", "2",
#' "10" instead of the lexical "1", "10", "2". Falls back to plain sorting as
#' soon as one value is not a number.
sai_sorted_levels <- function(vals) {
  u <- unique(as.character(vals[!is.na(vals)]))
  num <- suppressWarnings(as.numeric(u))
  if (length(u) > 0 && !anyNA(num)) u[order(num)] else sort(u)
}

#' @return list of list(label = <character or NULL>, df = <data.frame>)
get_split_groups <- function(df, params) {
  scol <- params$splitVariable
  if (is.null(scol) || !nzchar(scol) || !(scol %in% names(df))) {
    return(list(list(label = NULL, df = df)))
  }
  .sai_split_applied <<- TRUE
  vals <- as.character(df[[scol]])
  keep <- !is.na(vals)
  lvls <- sai_sorted_levels(vals[keep])
  lapply(lvls, function(lvl) list(label = lvl, df = df[keep & vals == lvl, , drop = FALSE]))
}

#' Append a Split File group label to an already-built titleKey, SPSS-style.
#' No-op when label is NULL (no split active). The renderer's
#' translateOutputKey() (src/lib/output-format.ts) treats everything after a
#' titleKey's first ":" as the {{name}} interpolation value, so:
#'   - titleKey WITH a ":" (e.g. "output.x.tableTitle:varname", i18n template
#'     "{{name}} — Table") — the group label is folded into that same
#'     {{name}} value: "varname [group = A] — Table".
#'   - titleKey WITHOUT one (e.g. "output.x.title", a static string with no
#'     {{name}} placeholder) — the label would otherwise be silently dropped,
#'     so the key itself is redirected to "<key>Split", which must have its
#'     own "{{name}}"-templated i18n entry (see output.descriptives.titleSplit
#'     for the pattern).
#' @param title_key     already-built titleKey (with or without a ":" suffix)
#' @param split_name    display name of the split variable
#' @param label         the group's raw value (character) or NULL
#' @param value_labels  optional value->label map (params$splitValueLabels) —
#'                      when the split variable has value labels defined,
#'                      shows e.g. "cinsiyet = Kadın" instead of
#'                      "cinsiyet = 0" (same resolve_var_name() reuse as the
#'                      independent t-test's groupValueLabels).
split_title <- function(title_key, split_name, label, value_labels = NULL) {
  if (is.null(label)) return(title_key)
  tag <- paste0(split_name, " = ", resolve_var_name(label, value_labels))
  if (grepl(":", title_key, fixed = TRUE)) {
    paste0(title_key, " [", tag, "]")
  } else {
    paste0(title_key, "Split:", tag)
  }
}

#' Serialise analysis output and print to stdout between result markers.
#' @param tables   list of table objects (see contract above)
#' @param plots    list of plot objects
#' @param warnings character vector of i18n warning keys
#' @param notes    character vector of i18n note keys
sai_output <- function(tables = list(), plots = list(),
                       warnings = character(0), notes = character(0),
                       caseVars = list(), modelXml = NULL) {
  if (.sai_weight_requested && !.sai_weight_applied) {
    warnings <- c(warnings, if (is.null(.sai_weight_procedure)) {
      "output.warn.weightNotApplied"
    } else {
      paste0("output.warn.weightNotSupported:", .sai_weight_procedure)
    })
  }
  if (.sai_missing_requested && !.sai_missing_applied && !.sai_missing_checked) {
    warnings <- c(warnings, "output.warn.missingNotApplied")
  }
  if (.sai_missing_opt_requested && !.sai_missing_opt_applied) {
    warnings <- c(warnings, "output.warn.missingOptionNotApplied")
  }
  if (.sai_bootstrap_requested && !.sai_bootstrap_applied) {
    warnings <- c(warnings, "output.warn.bootstrapNotApplied")
  }
  if (.sai_pmethod_requested && !.sai_pmethod_applied) {
    warnings <- c(warnings, "output.warn.pMethodNotApplied")
  }
  if (.sai_split_requested && !.sai_split_applied) {
    warnings <- c(warnings, "output.warn.splitNotApplied")
  }
  if (.sai_case_vars_requested && !.sai_case_vars_applied) {
    warnings <- c(warnings, "output.warn.newVarsNotApplied")
  }
  # A table's columns must reach JSON as an array. One named element (e.g. a
  # vapply over colIds) makes toJSON write an object, and the app rejects the
  # whole result (glm-repeated descriptives, 2026-10-11) — strip names here
  # once for every script.
  tables <- lapply(tables, function(tb) {
    if (is.list(tb) && !is.null(tb$columns)) tb$columns <- unname(as.list(tb$columns))
    tb
  })
  result <- list(
    success  = TRUE,
    tables   = tables,
    plots    = plots,
    caseVars = caseVars,
    warnings = as.list(warnings),
    notes    = as.list(notes)
  )
  if (!is.null(modelXml)) result$modelXml <- modelXml
  # digits = NA disables jsonlite's default digits=4 rounding (which is 4
  # DECIMAL PLACES, not significant figures — e.g. 0.0000123456 silently
  # serialises to 0). Scripts already round() to their intended precision;
  # without this, that precision (and small p-values) is silently truncated
  # a second time here. Caught by tests/r-validation/.
  json <- toJSON(result, auto_unbox = TRUE, na = "null", null = "null", force = TRUE, digits = NA)
  cat("\n__SAI_RESULT__", json, "__END_RESULT__\n", sep = "\n")
}

#' Print an error result and exit with status 1.
#' @param msg Human-readable error message. Shown to the user: job-manager
#'   parses this marker's `error` field on non-zero exit and displays it in
#'   the Output view's error block (previously only stderr was surfaced,
#'   which for sai_error holds nothing but PROGRESS lines → blank error).
sai_error <- function(msg) {
  result <- list(
    success  = FALSE,
    tables   = list(),
    plots    = list(),
    warnings = list(),
    notes    = list(),
    error    = msg
  )
  json <- toJSON(result, auto_unbox = TRUE, na = "null", null = "null", force = TRUE, digits = NA)
  cat("\n__SAI_RESULT__", json, "__END_RESULT__\n", sep = "\n")
  quit(save = "no", status = 1)
}
