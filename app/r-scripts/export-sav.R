# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# export-sav.R — writes the active dataset to an SPSS .sav file (File >
# Export Data > SPSS).
#
# DuckDB has no .sav writer (its read_stat extension is read-only), so this is
# an R hop like import-metadata.R: main exports the dataset to a temp Parquet
# file (columns = internal colIds, rows in case order) and this script turns
# it into a .sav with haven::write_sav, carrying the Variable View metadata
# SPSS understands: variable labels, value labels, user-missing values
# (discrete and range), print formats (F<width>.<decimals>) and the Data View
# column width (Variable View "Columns").
#
# Not carried: measurement level, role and alignment — haven's writer has no
# API for them, so SPSS assigns its defaults on open.
#
# Params (JSON file path as argv[1]):
#   { parquet: <path>, out: <path>,
#     variables: [ { colId, name, label, type, width, decimals, columns,
#                    valueLabels: { "<code>": "<label>" },
#                    missing: null | { type, discrete?, rangeLow?, rangeHigh? } } ] }
# Output: { ok: true, rows, cols } or { ok: false, error: "<code>", detail }
#         between the __SAI_RESULT__ / __END_RESULT__ markers.

suppressPackageStartupMessages(library(jsonlite))

emit <- function(x) {
  json <- toJSON(x, auto_unbox = TRUE, null = "null")
  cat("\n__SAI_RESULT__", json, "__END_RESULT__\n", sep = "\n")
}

# Value-label codes arrive as JSON object keys (strings); a numeric variable
# needs numeric codes, and haven requires labels of the column's own type.
build_labels <- function(vl, is_num) {
  if (is.null(vl) || length(vl) == 0) return(NULL)
  codes <- names(vl)
  labs <- vapply(vl, function(s) as.character(s), character(1))
  if (is_num) {
    num <- suppressWarnings(as.numeric(codes))
    keep <- !is.na(num)
    if (!any(keep)) return(NULL)
    stats::setNames(num[keep], labs[keep])
  } else {
    stats::setNames(codes, labs)
  }
}

to_spss_column <- function(x, v) {
  is_num <- identical(v$type, "numeric")
  if (is_num) x <- as.numeric(x)
  if (identical(v$type, "string")) x <- as.character(x)

  labels <- if (identical(v$type, "date")) NULL else build_labels(v$valueLabels, is_num)
  na_values <- NULL
  na_range <- NULL
  m <- v$missing
  if (!is.null(m) && !identical(v$type, "date")) {
    disc <- unlist(m$discrete)
    if (length(disc) > 0) {
      na_values <- if (is_num) suppressWarnings(as.numeric(disc)) else as.character(disc)
      na_values <- na_values[!is.na(na_values)]
      # SPSS: at most 3 discrete values, or a range plus one discrete value.
      has_range <- m$type %in% c("range", "range+discrete")
      na_values <- utils::head(na_values, if (has_range) 1 else 3)
      if (length(na_values) == 0) na_values <- NULL
    }
    if (is_num && m$type %in% c("range", "range+discrete") &&
        !is.null(m$rangeLow) && !is.null(m$rangeHigh)) {
      na_range <- c(as.numeric(m$rangeLow), as.numeric(m$rangeHigh))
    }
  }

  # A label that just repeats the name adds nothing in SPSS (import fills it so).
  label <- if (!is.null(v$label) && nzchar(v$label) && !identical(v$label, v$name)) v$label else NULL
  if (!is.null(na_values) || !is.null(na_range)) {
    x <- haven::labelled_spss(x, labels = labels, na_values = na_values,
                              na_range = na_range, label = label)
  } else if (!is.null(labels)) {
    x <- haven::labelled(x, labels = labels, label = label)
  } else if (!is.null(label)) {
    attr(x, "label") <- label
  }

  # Print format for numerics (strings: haven sizes A<n> from the data, so a
  # too-small Variable View width can never truncate values).
  if (is_num) {
    dec <- max(0L, min(16L, as.integer(if (is.null(v$decimals)) 2 else v$decimals)))
    wid <- max(dec + 2L, min(40L, as.integer(if (is.null(v$width)) 8 else v$width)))
    attr(x, "format.spss") <- sprintf("F%d.%d", wid, dec)
  }
  if (!is.null(v$columns) && v$columns >= 1) {
    attr(x, "display_width") <- as.integer(min(255, v$columns))
  }
  x
}

result <- tryCatch(
  {
    args <- commandArgs(trailingOnly = TRUE)
    if (length(args) < 1 || !nzchar(args[1])) stop("No params file path provided")
    params <- fromJSON(paste(readLines(args[1], warn = FALSE, encoding = "UTF-8"), collapse = "\n"),
                       simplifyVector = FALSE)
    if (!requireNamespace("haven", quietly = TRUE)) {
      list(ok = FALSE, error = "haven_missing", detail = "")
    } else if (!requireNamespace("arrow", quietly = TRUE)) {
      list(ok = FALSE, error = "failed", detail = "arrow is not installed")
    } else {
      src <- as.data.frame(arrow::read_parquet(params$parquet))
      vars <- params$variables
      out <- lapply(vars, function(v) to_spss_column(src[[v$colId]], v))
      names(out) <- vapply(vars, function(v) v$name, character(1))
      df <- tibble::as_tibble(out)
      haven::write_sav(df, params$out)
      list(ok = TRUE, rows = nrow(df), cols = ncol(df))
    }
  },
  error = function(e) list(ok = FALSE, error = "failed", detail = conditionMessage(e))
)

emit(result)
