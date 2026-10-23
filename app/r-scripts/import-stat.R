# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# import-stat.R — reads an SPSS (.sav/.zsav/.por), Stata (.dta) or SAS
# (.sas7bdat/.xpt) file with haven and hands it to the importer as Parquet
# plus the metadata the file declares about its variables.
#
# Why haven and not DuckDB's read_stat extension (the previous path, still
# the fallback when R is unavailable):
#   - read_stat turned SPSS user-missing codes (e.g. 9 = "no answer") into
#     NULL and dropped the missing-value definitions — the data changed on
#     import. haven's user_na = TRUE keeps the codes AND their definitions.
#   - read_stat returns data only, so labels needed a second read of the file
#     through `foreign`; haven gives data + labels in one pass.
#   - read_stat is a community extension DuckDB downloads on first use, so an
#     offline machine could not open a .sav at all. haven ships with the
#     bundled R runtime.
#
# Params (JSON file path as argv[1]): { file, out, rScriptsDir }
# Output: { ok: true, rows, variables: [ { name, label, valueLabels, missing,
#           width, decimals, columns } ] }  or  { ok: false, error, detail }
#         between the __SAI_RESULT__ / __END_RESULT__ markers.

suppressPackageStartupMessages(library(jsonlite))

emit <- function(x) {
  json <- toJSON(x, auto_unbox = TRUE, null = "null", digits = NA)
  cat("\n__SAI_RESULT__", json, "__END_RESULT__\n", sep = "\n")
}

result <- tryCatch(
  {
    args <- commandArgs(trailingOnly = TRUE)
    if (length(args) < 1 || !nzchar(args[1])) stop("No params file path provided")
    params <- fromJSON(paste(readLines(args[1], warn = FALSE, encoding = "UTF-8"), collapse = "\n"),
                       simplifyVector = FALSE)
    # invert_labels / column_meta / plain_column — shared with the R console's
    # sai_commit(), which hands data frames to the same importer.
    source(file.path(params$rScriptsDir, "_stat_columns.R"))
    if (!requireNamespace("haven", quietly = TRUE)) {
      list(ok = FALSE, error = "haven_missing", detail = "")
    } else {
      file <- params$file
      ext <- tolower(tools::file_ext(file))
      d <- switch(ext,
        sav = , zsav = haven::read_sav(file, user_na = TRUE),
        por = haven::read_por(file, user_na = TRUE),
        dta = haven::read_dta(file),
        sas7bdat = haven::read_sas(file),
        xpt = haven::read_xpt(file),
        stop("Unsupported file type: ", ext)
      )
      meta <- lapply(names(d), function(nm) column_meta(d[[nm]], nm))
      plain <- as.data.frame(lapply(d, plain_column), stringsAsFactors = FALSE,
                             check.names = FALSE, optional = TRUE)
      names(plain) <- names(d)
      arrow::write_parquet(plain, params$out)
      list(ok = TRUE, rows = nrow(plain), variables = meta)
    }
  },
  error = function(e) list(ok = FALSE, error = "failed", detail = conditionMessage(e))
)

emit(result)
