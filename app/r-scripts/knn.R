# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# knn.R — Nearest Neighbor classification (SPSS-style, via class::knn.cv).
#
# Params: groupVar, groupName, groupValueLabels (raw code -> value label,
#   optional), independents (colIds), varNames,
#   options$k — number of neighbors (default 5).
#
# Method: predictors are min-max normalized to [0,1] (SPSS's Nearest Neighbor
# normalizes scale features the same way — its "adjusted normalized" differs
# only by a uniform factor, which leaves Euclidean neighborhoods unchanged;
# verified case-by-case against SPSS 26's saved predictions, 117/117).
# Classification uses leave-one-out cross-validation (class::knn.cv) rather
# than resubstitution (predicting each case with a model that includes that
# same case) — resubstitution accuracy is optimistically biased for a
# pure-memorization method like KNN, and LOOCV is also what SPSS's own
# training-sample classification does: it never counts the case as its own
# neighbor (CLAUDE.md §11 "istatistik doğruluğu > SPSS taklidi").
#
# Output: "Model Summary" (N, k) and "Classification" (confusion matrix:
# observed vs predicted, with Percent Correct per row + an Overall Percent
# row) — same table shape as SPSS's own Nearest Neighbor Classification
# Table.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("class", quietly = TRUE)) {
    sai_output(tables = list(), warnings = list("output.knn.needsPackage")); quit(save = "no")
  }

  gvar <- params$groupVar
  indeps <- unlist(params$independents); var_names <- params$varNames
  opts <- if (is.null(params$options)) list() else params$options
  k <- if (!is.null(opts$k)) as.integer(opts$k) else 5L

  if (is.null(gvar) || !gvar %in% names(df)) sai_error("Grouping variable not found")
  if (length(indeps) == 0) sai_error("No independent variables specified")
  if (is.na(k) || k < 1) sai_error("k must be a positive integer")

  dat <- data.frame(.g = factor(as.character(df[[gvar]])))
  for (i in seq_along(indeps)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[indeps[i]]]))
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  n <- nrow(dat)
  if (nlevels(droplevels(dat$.g)) < 2) sai_error("Need at least 2 categories in the target variable")
  dat$.g <- droplevels(dat$.g)
  if (k >= n) sai_error("k must be smaller than the number of complete cases")

  Xraw <- dat[, -1, drop = FALSE]
  # Min-max [0,1] per predictor (see header). A constant predictor would
  # produce NaN (division by 0 range) — drop it rather than silently
  # propagating NaN into the distance calculation.
  col_min <- vapply(Xraw, min, numeric(1))
  col_rng <- vapply(Xraw, function(x) diff(range(x)), numeric(1))
  if (any(col_rng == 0)) {
    Xraw <- Xraw[, col_rng > 0, drop = FALSE]
    col_min <- col_min[col_rng > 0]; col_rng <- col_rng[col_rng > 0]
  }
  if (ncol(Xraw) == 0) sai_error("All predictors have zero variance")
  X <- scale(Xraw, center = col_min, scale = col_rng)
  g <- dat$.g

  # Tie-breaking among equidistant neighbors is random in class::knn.cv() —
  # fixed seed for reproducible output on the same input (same convention
  # as kmeans.R's random-restart seed).
  set.seed(1)
  pred <- class::knn.cv(X, g, k = k)

  # `lvls` indexes the raw factor levels (table() needs the actual codes);
  # `lvls_disp` is the same order resolved through groupValueLabels for
  # display, so a labelled target (e.g. "Male"/"Female") doesn't show as
  # "1"/"2" in the Classification table.
  lvls <- levels(g)
  lvls_disp <- resolve_var_names(lvls, params$groupValueLabels)
  tab <- table(actual = g, predicted = pred)[lvls, lvls, drop = FALSE]

  class_rows <- lapply(seq_along(lvls), function(i) {
    lv <- lvls[i]
    row_counts <- as.integer(tab[lv, ])
    row_total <- sum(row_counts)
    pct_correct <- if (row_total > 0) round(tab[lv, lv] / row_total * 100, 1) else 0
    c(list(lvls_disp[i]), as.list(row_counts), list(pct_correct))
  })
  overall_pct <- round(sum(diag(tab)) / sum(tab) * 100, 1)
  overall_row <- c(list("output.knn.overallRow"), lapply(seq_along(lvls), function(i) NULL),
                    list(overall_pct))
  class_rows <- c(class_rows, list(overall_row))

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(titleKey = "output.knn.modelSummaryTitle",
         columns = list("output.col.statistic", "output.col.value"),
         rows = list(
           list("output.col.n", as.integer(n)),
           list("output.knn.kValue", as.integer(k))
         ),
         footnoteKey = NULL),
    list(titleKey = "output.knn.classTitle",
         columns = c(list("output.col.observed"), as.list(lvls_disp), list("output.knn.percentCorrect")),
         rows = class_rows,
         footnoteKey = "output.knn.classFootnote")))
}, error = function(e) sai_error(conditionMessage(e)))
