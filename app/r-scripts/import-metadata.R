# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# import-metadata.R — variable labels and value labels from SPSS (.sav/.por)
# and Stata (.dta) files.
#
# Why a separate R hop exists at all: the DuckDB `read_stat` extension we import
# these files with returns the DATA only — it registers a single table function
# and exposes no metadata accessor (checked against duckdb_functions()). So
# every variable label and every value label in a .sav file was silently
# dropped on import, and a 1/2-coded variable arrived with no hint that 1 means
# anything. `foreign` ships with every R installation (recommended package), so
# recovering them costs no new dependency — only one extra read of the file.
#
# Best-effort by construction: the caller (electron/ipc/file-handler/
# stat-metadata.ts) treats *any* failure, including R being absent entirely, as
# "no metadata" and falls back to the value-based inference in
# type-inference.ts. Nothing here is allowed to fail an import.
#
# Params (JSON file path as argv[1]):  { file: <path>, format: "spss"|"stata" }
# Output: { variables: [ { name, label, valueLabels: { "<code>": "<label>" } } ] }
#         between the same __SAI_RESULT__ / __END_RESULT__ markers the analysis
#         scripts use.

suppressPackageStartupMessages(library(jsonlite))

emit <- function(vars) {
  json <- toJSON(list(variables = vars), auto_unbox = TRUE, null = "null")
  cat("\n__SAI_RESULT__", json, "__END_RESULT__\n", sep = "\n")
}

# An empty *named* list so jsonlite writes {} rather than [] — the caller reads
# valueLabels as an object.
empty_labels <- function() structure(list(), names = character(0))

# label.table entries are named numeric vectors whose NAMES are the labels and
# whose VALUES are the codes — the inverse of what we want.
invert_label_table <- function(lt) {
  if (is.null(lt) || length(lt) == 0) return(empty_labels())
  codes <- as.character(unname(lt))
  labels <- as.character(names(lt))
  keep <- !is.na(codes) & nzchar(codes) & !is.na(labels)
  if (!any(keep)) return(empty_labels())
  structure(as.list(labels[keep]), names = codes[keep])
}

read_spss_meta <- function(file) {
  # use.value.labels = FALSE keeps the raw codes so label.table stays intact;
  # use.missings = FALSE stops read.spss from turning declared missing codes
  # into NA, which would hide their labels.
  d <- suppressWarnings(
    foreign::read.spss(file, to.data.frame = FALSE, use.value.labels = FALSE, use.missings = FALSE)
  )
  var_labels <- attr(d, "variable.labels")
  label_table <- attr(d, "label.table")
  lapply(names(d), function(nm) {
    list(
      name = nm,
      label = if (!is.null(var_labels) && nm %in% names(var_labels)) unname(var_labels[[nm]]) else "",
      valueLabels = invert_label_table(if (is.null(label_table)) NULL else label_table[[nm]])
    )
  })
}

read_stata_meta <- function(file) {
  d <- suppressWarnings(foreign::read.dta(file, convert.factors = FALSE))
  # Stata attributes are positional, not named: var.labels lines up with the
  # columns, val.labels names the label SET each column uses, and label.table
  # is keyed by those set names.
  var_labels <- attr(d, "var.labels")
  val_labels <- attr(d, "val.labels")
  label_table <- attr(d, "label.table")
  nms <- names(d)
  lapply(seq_along(nms), function(i) {
    set_name <- if (!is.null(val_labels) && i <= length(val_labels)) val_labels[i] else ""
    lt <- if (!is.null(label_table) && nzchar(set_name)) label_table[[set_name]] else NULL
    list(
      name = nms[i],
      label = if (!is.null(var_labels) && i <= length(var_labels)) var_labels[i] else "",
      valueLabels = invert_label_table(lt)
    )
  })
}

result <- tryCatch(
  {
    args <- commandArgs(trailingOnly = TRUE)
    if (length(args) < 1 || !nzchar(args[1])) stop("No params file path provided")
    params <- fromJSON(paste(readLines(args[1], warn = FALSE), collapse = "\n"),
                       simplifyVector = FALSE)
    file <- params$file
    format <- params$format
    if (is.null(file) || !file.exists(file)) stop("Source file not found")
    if (!requireNamespace("foreign", quietly = TRUE)) stop("foreign is not installed")

    if (identical(format, "spss")) {
      read_spss_meta(file)
    } else if (identical(format, "stata")) {
      read_stata_meta(file)
    } else {
      list()
    }
  },
  # Old .dta versions, compressed .zsav, exotic encodings — foreign refuses
  # plenty of real files, and none of that is a reason to fail the import.
  error = function(e) {
    message("import-metadata: ", conditionMessage(e))
    list()
  }
)

emit(result)
