# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# mds.R — Multidimensional Scaling (classical/metric, SPSS ALSCAL/PROXSCAL-style).
#
# Params: variables (colIds, treated as objects), varNames, dimensions (2|3).
# Objects = variables; proximity = Euclidean distance between standardized
# variable vectors. cmdscale() finds a low-dimensional coordinate configuration.
# Output: "Stress and Fit Measures" (Stress-I, RSQ), "Final Coordinates"
#         (object × dimension) and a 2-D configuration scatter plot.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  cols <- unlist(params$variables); var_names <- params$varNames
  ndim <- if (is.null(params$dimensions)) 2L else as.integer(params$dimensions)
  if (length(cols) < 3) sai_error("MDS needs at least 3 objects (variables)")
  labels <- vapply(cols, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))

  mat <- sapply(cols, function(c) suppressWarnings(as.numeric(df[[c]])))
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  if (nrow(mat) < 3) sai_error("Not enough complete cases")
  # Standardize each variable so scale differences don't dominate proximities.
  z <- scale(mat)
  D <- dist(t(z))                                  # distances between variables

  progress(50L, "progress.computing")
  ndim <- max(2L, min(ndim, length(cols) - 1L))
  mds  <- cmdscale(D, k = ndim, eig = TRUE)
  pts  <- mds$points
  dhat <- dist(pts)
  dv <- as.numeric(D); dh <- as.numeric(dhat)
  stress1 <- sqrt(sum((dv - dh)^2) / sum(dv^2))
  rsq <- suppressWarnings(cor(dv, dh))^2
  if (!is.finite(rsq)) rsq <- NA

  fit_rows <- list(
    list("output.mds.stress1", round(stress1, 5)),
    list("output.mds.rsq", round(rsq, 5)))

  dim_cols <- lapply(seq_len(ncol(pts)), function(d) paste0("output.mds.dim:", d))
  coord_rows <- lapply(seq_len(nrow(pts)), function(i)
    c(list(labels[i]), lapply(seq_len(ncol(pts)), function(d) round(pts[i, d], 4))))

  trace <- list(
    type = "scatter", mode = "markers+text", name = "MDS",
    x = as.list(round(pts[, 1], 4)), y = as.list(round(pts[, 2], 4)),
    text = as.list(labels), textposition = "top center",
    marker = list(color = "#3b6ea5", size = 9))
  layout <- list(
    xaxis = list(title = list(text = "Dimension 1"), zeroline = TRUE),
    yaxis = list(title = list(text = "Dimension 2"), zeroline = TRUE),
    margin = list(t = 40, r = 20, b = 40, l = 60))

  progress(100L, "progress.done")
  sai_output(
    tables = list(
      list(titleKey = "output.mds.fitTitle",
           columns = list("output.col.statistic", "output.col.value"),
           rows = fit_rows, footnoteKey = NULL),
      list(titleKey = "output.mds.coordTitle",
           columns = c(list("output.col.object"), dim_cols),
           rows = coord_rows, footnoteKey = NULL)),
    plots = list(list(
      titleKey = "output.mds.plotTitle",
      type = "plotly", data = list(data = list(trace), layout = layout))))
}, error = function(e) sai_error(conditionMessage(e)))
