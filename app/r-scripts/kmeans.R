# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# kmeans.R — K-Means Cluster (SPSS-style).
#
# Params: variables (colIds), varNames, clusters (k, default 2),
#   initialCenters (optional list of k numeric vectors, one row per cluster —
#   starts Lloyd/Hartigan-Wong from those points instead of random restarts;
#   used by the SPSS-parity run, which pins QUICK CLUSTER's /INITIAL to the
#   same values so the two deterministic runs can be compared).
# Output: "Final Cluster Centers" (variable × cluster) + "Number of Cases in
#         each Cluster".

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  k <- if (is.null(params$clusters)) 2L else as.integer(params$clusters)
  if (length(vars) < 1) sai_error("K-Means needs at least one variable")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(df[[c]])))
  # Which dataset rows survive the listwise deletion, kept for NV1 (roadmap
  # ★11) — `mat` is a matrix and cannot carry __row_idx as a column.
  keep_rows <- stats::complete.cases(mat)
  mat <- mat[keep_rows, , drop = FALSE]
  if (nrow(mat) <= k) sai_error("Not enough complete cases for the requested clusters")

  init <- params$initialCenters
  if (!is.null(init)) {
    centers <- do.call(rbind, lapply(init, as.numeric))
    if (!is.matrix(centers) || nrow(centers) != k || ncol(centers) != length(vars))
      sai_error("initialCenters must give one row per cluster and one value per variable")
    # Lloyd's batch algorithm: assignment of every case, then centre update —
    # the same iteration SPSS's METHOD=KMEANS(NOUPDATE) performs, so runs with
    # pinned initial centres reproduce SPSS's solution exactly.
    km <- kmeans(mat, centers = centers, iter.max = 50, algorithm = "Lloyd")
  } else {
    set.seed(1)
    km <- kmeans(mat, centers = k, nstart = 10, iter.max = 50, algorithm = "Lloyd")
  }

  km_warn <- if (identical(as.integer(km$ifault), 2L)) "output.kmeans.notConverged" else character(0)
  ctr_cols <- c("output.col.variable", paste0("output.kmeans.clusterHdr:", seq_len(k)))
  ctr_rows <- lapply(seq_along(vars), function(i)
    c(list(nm[i]), lapply(seq_len(k), function(cl) round(km$centers[cl, i], 3))))
  size_rows <- lapply(seq_len(k), function(cl)
    list(paste0("output.kmeans.clusterHdr:", cl), as.integer(km$size[cl])))
  size_rows <- c(size_rows, list(list("output.col.total", as.integer(sum(km$size)))))

  progress(100L, "progress.done")
  # ── New variables (NV1) ────────────────────────────────────────────────────
  # Cluster membership is the single most re-used piece of output in the app:
  # it exists to become a grouping variable for the NEXT analysis (an ANOVA
  # across clusters, a crosstab against a known label). Distance to the case's
  # own centre comes with it, because that is how you find the cases the
  # clustering fits worst.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    case_df <- data.frame(.i = seq_len(nrow(mat)))
    case_df[["__row_idx"]] <- row_index_of(df)[keep_rows]
    if (!is.null(want[["cluster"]])) {
      # Nominal, not scale: cluster 2 is not "twice" cluster 1, and a dialog
      # that pre-filters by measure should never offer it as a covariate.
      case_vars[[length(case_vars) + 1L]] <- sai_case_var(
        want[["cluster"]], as.integer(km$cluster), case_df,
        labelKey = "output.kmeans.newVar.cluster", measure = "nominal", decimals = 0)
    }
    if (!is.null(want[["distance"]])) {
      dist_own <- sqrt(rowSums((mat - km$centers[km$cluster, , drop = FALSE])^2))
      case_vars[[length(case_vars) + 1L]] <- sai_case_var(
        want[["distance"]], dist_own, case_df,
        labelKey = "output.kmeans.newVar.distance", decimals = 5)
    }
  }

  sai_output(caseVars = case_vars, warnings = km_warn, tables = list(
    list(titleKey = "output.kmeans.centersTitle",
         columns = as.list(ctr_cols), rows = ctr_rows, footnoteKey = NULL),
    list(titleKey = "output.kmeans.sizesTitle",
         columns = list("output.col.cluster", "output.col.n"),
         rows = size_rows, footnoteKey = NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
