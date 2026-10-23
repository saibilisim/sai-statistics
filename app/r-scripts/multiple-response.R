# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# multiple-response.R — Multiple Response Frequencies (multiple-dichotomy set).
#
# Params: variables (colIds, each a 0/1 dichotomy for one category),
#         countedValue (value that means "selected", default 1), varNames.
# Output: "$set Frequencies" — per variable: N (responses), Percent of
#         responses, Percent of cases; plus a Total row.
#   Percent of cases denominator = cases with ≥1 non-missing value in the set.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  cols <- unlist(params$variables); var_names <- params$varNames
  counted <- if (is.null(params$countedValue)) 1 else as.numeric(params$countedValue)
  if (length(cols) < 2) sai_error("Multiple response needs at least 2 variables")
  labels <- vapply(cols, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  progress(50L, "progress.computing")
  M <- sapply(cols, function(c) suppressWarnings(as.numeric(df[[c]])))
  M <- as.matrix(M)
  counts <- colSums(M == counted, na.rm = TRUE)
  total_resp <- sum(counts)
  # "Percent of Cases" is out of the cases that SELECTED at least one category,
  # not out of every case with data. SPSS's own Case Summary calls the former
  # the valid N for a dichotomy group ("Dichotomy group tabulated at value 1")
  # and counts the rest as missing. Using all non-missing cases put the
  # denominator at 120 instead of 61 and halved every percentage — d1 read
  # 31.7% where SPSS says 62.3%, and the Total 87.5% where SPSS says 172.1%
  # (a multiple-response total is expected to exceed 100%; ours could not).
  valid_cases <- sum(rowSums(M == counted, na.rm = TRUE) > 0)
  if (total_resp == 0) sai_error("No responses match the counted value")

  rows <- lapply(seq_along(cols), function(i) list(
    labels[i], as.integer(counts[i]),
    round(100 * counts[i] / total_resp, 1),
    round(100 * counts[i] / valid_cases, 1)))
  rows <- c(rows, list(list(
    "output.mr.total", as.integer(total_resp), 100.0,
    round(100 * total_resp / valid_cases, 1))))

  progress(100L, "progress.done")
  sai_output(tables = list(list(
    titleKey = "output.mr.title",
    columns = list("output.mr.category", "output.col.n", "output.mr.pctResponses",
                   "output.mr.pctCases"),
    rows = rows, footnoteKey = paste0("output.mr.casesFootnote:", valid_cases))))
}, error = function(e) sai_error(conditionMessage(e)))
