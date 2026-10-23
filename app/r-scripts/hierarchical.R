# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# hierarchical.R — Hierarchical Cluster (SPSS-style).
#
# Params: variables (colIds), varNames, method ("ward.D2"|"average"|"complete"|
#         "single"), clusters (membership cut, default 0 = none).
# Output: "Agglomeration Schedule" (Stage, clusters combined, coefficient) +
#         a dendrogram plot; when clusters >= 2, also a "Cluster Membership"
#         table (cutree).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  method <- if (is.null(params$method)) "ward.D2" else params$method
  k <- suppressWarnings(as.integer(params$clusters)); if (length(k) == 0 || is.na(k)) k <- 0L
  if (length(vars) < 1) sai_error("Hierarchical cluster needs at least one variable")

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(df[[c]])))
  # Which dataset rows survive the listwise deletion, kept for NV1 (roadmap
  # ★11) — `mat` is a matrix and cannot carry __row_idx as a column.
  keep_rows <- stats::complete.cases(mat)
  mat <- mat[keep_rows, , drop = FALSE]
  n <- nrow(mat)
  if (n < 3 || n > 200) sai_error("Hierarchical cluster supports 3–200 cases")
  if (k != 0L && (k < 2L || k > n - 1L)) sai_error("Cluster count must be between 2 and N-1")

  hc <- hclust(dist(mat), method = method)

  # Cluster membership table (only when a cut is requested via `clusters`).
  memb_tables <- list()
  if (k >= 2L) {
    memb <- stats::cutree(hc, k = k)
    memb_rows <- lapply(seq_len(n), function(i)
      list(as.integer(i), as.integer(memb[i])))
    memb_tables <- list(list(titleKey = "output.hier.membershipTitle",
      columns = list("output.col.case", "output.col.cluster"),
      rows = memb_rows, footnoteKey = NULL))
  }

  # Agglomeration schedule: each stage merges two clusters (negative = case,
  # positive = a previous stage), with the merge coefficient (height).
  sched_rows <- list()
  for (i in seq_len(nrow(hc$merge))) {
    a <- hc$merge[i, 1]; b <- hc$merge[i, 2]
    c1 <- if (a < 0) -a else a; c2 <- if (b < 0) -b else b
    sched_rows <- c(sched_rows, list(list(as.integer(i), as.integer(c1),
      as.integer(c2), round(hc$height[i], 3))))
  }

  # Dendrogram coordinates: draw the U-shape for each merge.
  xpos <- numeric(n); xpos[hc$order] <- seq_len(n)
  node_x <- numeric(nrow(hc$merge))
  gx <- function(m) if (m < 0) xpos[-m] else node_x[m]
  gh <- function(m) if (m < 0) 0 else hc$height[m]
  xs <- c(); ys <- c()
  for (i in seq_len(nrow(hc$merge))) {
    a <- hc$merge[i, 1]; b <- hc$merge[i, 2]
    xa <- gx(a); xb <- gx(b); ha <- gh(a); hb <- gh(b); h <- hc$height[i]
    node_x[i] <- (xa + xb) / 2
    xs <- c(xs, xa, xa, xb, xb, NA); ys <- c(ys, ha, h, h, hb, NA)
  }
  dendro <- list(type = "scatter", mode = "lines", showlegend = FALSE,
                 x = as.list(xs), y = as.list(ys), line = list(color = "#3b6ea5"))
  layout <- list(title = list(text = ""), xaxis = list(title = list(text = "Case"),
                 showticklabels = FALSE),
                 yaxis = list(title = list(text = "Distance")),
                 margin = list(t = 30, r = 20, b = 30, l = 50))

  progress(100L, "progress.done")
  # ── New variables (NV1) ────────────────────────────────────────────────────
  # Only meaningful once a cut has been chosen: without `clusters` there is no
  # membership to write, and inventing one would be guessing for the user.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0 && !is.null(want[["cluster"]]) && k >= 2) {
    case_df <- data.frame(.i = seq_len(nrow(mat)))
    case_df[["__row_idx"]] <- row_index_of(df)[keep_rows]
    case_vars[[1L]] <- sai_case_var(
      want[["cluster"]], as.integer(stats::cutree(hc, k = k)), case_df,
      labelKey = "output.hier.newVar.cluster", measure = "nominal", decimals = 0)
  }

  sai_output(
    caseVars = case_vars,
    tables = c(list(list(titleKey = "output.hier.scheduleTitle",
      columns = list("output.col.stage", "output.col.cluster1", "output.col.cluster2",
                     "output.col.coefficient"),
      rows = sched_rows, footnoteKey = NULL)), memb_tables),
    plots = list(list(titleKey = "output.hier.dendroTitle", type = "plotly",
      data = list(data = list(dendro), layout = layout))))
}, error = function(e) sai_error(conditionMessage(e)))
