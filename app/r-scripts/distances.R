# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# distances.R — Distances / Proximities between variables (SPSS-style).
#
# Params: variables (colIds), varNames, measure ("euclidean"|"sqeuclidean"|
#         "manhattan"|"chebyshev"|"cosine"|"pearson").
# Output: "Proximity Matrix" (variable × variable distance/similarity matrix).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  measure <- if (is.null(params$measure)) "euclidean" else params$measure
  if (length(vars) < 2) sai_error("Distances needs at least two variables")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(df[[c]])))
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  if (nrow(mat) < 2) sai_error("Not enough complete cases")
  M <- t(mat)                                   # rows = variables

  D <- switch(measure,
    sqeuclidean = as.matrix(dist(M, "euclidean"))^2,
    manhattan   = as.matrix(dist(M, "manhattan")),
    chebyshev   = as.matrix(dist(M, "maximum")),
    cosine      = {
      nrm <- sqrt(rowSums(M^2)); (M %*% t(M)) / outer(nrm, nrm)
    },
    pearson     = cor(mat),
    as.matrix(dist(M, "euclidean")))            # default euclidean

  cols <- c("output.col.variable", nm)
  rows <- lapply(seq_along(vars), function(i)
    c(list(nm[i]), lapply(seq_along(vars), function(j) round(D[i, j], 3))))

  progress(100L, "progress.done")
  sai_output(tables = list(list(
    titleKey = "output.distances.title",
    columns = as.list(cols), rows = rows,
    footnoteKey = "output.distances.footnote")))
}, error = function(e) sai_error(conditionMessage(e)))
