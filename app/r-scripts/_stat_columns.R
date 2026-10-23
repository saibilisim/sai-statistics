# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# _stat_columns.R — shared column helpers for handing an R data frame to the
# app's importer as Parquet + per-variable metadata (labels, value labels,
# user-missing, print format).
#
# Sourced by:
#   • import-stat.R  — .sav/.dta/.sas files read with haven
#   • _r_console.R   — sai_commit(): a data frame from the R console becomes a
#                      new dataset (Faz T3)
# Both feed the same importer (stat-metadata.ts schema), so a factor from the
# console arrives exactly like a labelled SPSS variable: numeric codes plus
# value labels.

empty_named <- function() structure(list(), names = character(0))

# base R only has %||% from 4.4; the bundled runtime may be older.
`%||%` <- function(a, b) if (is.null(a)) b else a

# labels attr: named vector, NAMES = label text, VALUES = codes → { code: label }
invert_labels <- function(lab) {
  if (is.null(lab) || length(lab) == 0) return(empty_named())
  codes <- if (is.numeric(lab)) format(unname(lab), scientific = FALSE, trim = TRUE, drop0trailing = TRUE)
           else as.character(unname(lab))
  keep <- !is.na(codes) & !is.na(names(lab))
  if (!any(keep)) return(empty_named())
  structure(as.list(as.character(names(lab)[keep])), names = codes[keep])
}

# SPSS print format "F8.2" / "A20" / "DATE11" → width + decimals.
parse_format <- function(fmt) {
  if (is.null(fmt) || !nzchar(fmt)) return(list(width = NULL, decimals = NULL))
  m <- regmatches(fmt, regexec("^[A-Za-z]+([0-9]+)(?:\\.([0-9]+))?$", fmt, perl = TRUE))[[1]]
  if (length(m) == 0) return(list(width = NULL, decimals = NULL))
  list(width = as.integer(m[2]), decimals = if (nzchar(m[3])) as.integer(m[3]) else 0L)
}

column_meta <- function(x, name) {
  lab <- attr(x, "label", exact = TRUE)
  na_values <- attr(x, "na_values", exact = TRUE)
  na_range <- attr(x, "na_range", exact = TRUE)
  missing <- NULL
  if (length(na_values) > 0 || length(na_range) == 2) {
    has_range <- length(na_range) == 2 && all(is.finite(na_range))
    disc <- if (length(na_values) > 0) as.list(unname(na_values)) else NULL
    missing <- if (has_range) {
      c(list(type = if (length(disc) > 0) "range+discrete" else "range",
             rangeLow = na_range[1], rangeHigh = na_range[2]),
        if (length(disc) > 0) list(discrete = disc) else list())
    } else if (length(disc) > 0) {
      list(type = "discrete", discrete = disc)
    } else NULL
  }
  fmt <- parse_format(attr(x, "format.spss", exact = TRUE) %||% attr(x, "format.stata", exact = TRUE) %||% "")
  dw <- attr(x, "display_width", exact = TRUE)
  list(
    name = name,
    label = if (is.null(lab)) "" else as.character(lab)[1],
    valueLabels = invert_labels(attr(x, "labels", exact = TRUE)),
    missing = missing,
    width = fmt$width,
    decimals = fmt$decimals,
    columns = if (is.null(dw) || is.na(dw) || dw < 1) NULL else as.integer(dw)
  )
}

# Strip haven classes but KEEP the stored codes (user-missing 9 stays 9);
# times (hms) become seconds, which is how SPSS stores TIME values too.
plain_column <- function(x) {
  if (inherits(x, "hms")) return(as.numeric(x))
  if (inherits(x, "haven_labelled")) x <- unclass(x)
  attributes(x) <- attributes(x)[intersect(names(attributes(x)), c("class", "tzone"))]
  if (is.character(x)) x[!is.na(x) & x == ""] <- NA  # SPSS blank string = empty
  x
}

# A plain R column as the importer understands it (console data frames):
#   factor  → integer codes 1..k + value labels (the SPSS way; ordered or not)
#   logical → 0/1
#   POSIXlt → POSIXct · list/complex → text
# A `label` attribute (e.g. from labelled/Hmisc) is kept as the variable label.
as_stat_column <- function(x) {
  lab <- attr(x, "label", exact = TRUE)
  out <- if (is.factor(x)) {
    lv <- levels(x)
    structure(as.integer(x), labels = stats::setNames(seq_along(lv), lv))
  } else if (is.logical(x)) {
    as.integer(x)
  } else if (inherits(x, "POSIXlt")) {
    as.POSIXct(x)
  } else if (is.list(x) || is.complex(x)) {
    vapply(x, function(v) paste(format(v), collapse = ", "), "")
  } else {
    x
  }
  if (!is.null(lab)) attr(out, "label") <- lab
  out
}
