# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# item-analysis.R — Item Analysis for scale development and achievement tests.
#
# Params: variables (item colIds), varNames, options:
#   groupPercent   size of the upper / lower groups, percent of cases (default 27)
#
# Output:
#   Item Statistics      N, mean, SD, corrected item-total correlation, alpha if
#                        item deleted, floor and ceiling (% of answers at the
#                        lowest / highest value any item takes)
#   Upper-Lower Groups   per item: lower and upper group means, difference and
#                        the independent-samples t test (Welch). The groups are
#                        the top and bottom `groupPercent`% of cases ordered by
#                        total score (Kelley 1939); with equal group sizes the
#                        Welch and Student t statistics coincide, only the df
#                        differ, so Welch costs nothing and is safe when the
#                        group variances differ.
#   Difficulty / Discrimination (0/1 items only) — p = proportion correct,
#                        D = p(upper) - p(lower), with Ebel's (1965) bands for D.
# Cases are used listwise.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
source(file.path(.params_raw$rScriptsDir, "_reliability_models.R"))
params <- read_params(); df <- load_data(params)

r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL
r4 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 4) else NULL

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.itemAnalysis.title")
  vars <- unlist(params$variables)
  if (length(vars) < 2) sai_error("Item analysis needs at least two items")
  nm <- resolve_var_names(vars, params$varNames)
  opts <- if (is.null(params$options)) list() else params$options
  pct <- suppressWarnings(as.numeric(opts$groupPercent))
  if (!length(pct) || is.na(pct) || pct <= 0 || pct > 50) pct <- 27

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  n_total <- nrow(mat)
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  n <- nrow(mat); k <- ncol(mat)
  g <- floor(n * pct / 100 + 0.5)
  if (g < 2) sai_error("Not enough complete cases for upper and lower groups")

  total <- rowSums(mat)
  alpha <- rel_alpha(mat)
  lo_val <- min(mat); hi_val <- max(mat)
  warns <- character(0); notes <- character(0)

  # ── Item statistics ────────────────────────────────────────────────────────
  rit <- numeric(k); adel <- numeric(k)
  rows <- lapply(seq_len(k), function(i) {
    rest <- total - mat[, i]
    rit[i] <<- stats::cor(mat[, i], rest)
    adel[i] <<- if (k > 2) rel_alpha(mat[, -i, drop = FALSE]) else NA_real_
    list(nm[i], as.integer(n), r3(mean(mat[, i])), r3(stats::sd(mat[, i])), r3(rit[i]),
         r3(adel[i]), round(100 * mean(mat[, i] == lo_val), 1), round(100 * mean(mat[, i] == hi_val), 1))
  })
  tables <- list(list(
    titleKey = "output.itemAnalysis.itemStatsTitle",
    columns = list("output.col.variable", "output.col.n", "output.col.mean", "output.col.stdDeviation",
                   "output.col.corrItemTotal", "output.col.alphaDel",
                   paste0("output.itemAnalysis.floor:", format(lo_val)),
                   paste0("output.itemAnalysis.ceiling:", format(hi_val))),
    rows = rows,
    footnoteKey = paste0("output.itemAnalysis.alphaFootnote:", format(round(alpha, 3), nsmall = 3))))
  low_r <- nm[is.finite(rit) & rit < 0.30]
  if (length(low_r)) notes <- c(notes, paste0("output.itemAnalysis.lowItemTotal:", paste(low_r, collapse = ", ")))
  up_a <- nm[is.finite(adel) & adel > alpha]
  if (length(up_a)) notes <- c(notes, paste0("output.itemAnalysis.alphaRises:", paste(up_a, collapse = ", ")))

  # ── Upper / lower groups ───────────────────────────────────────────────────
  # Order by total, ties in dataset order; the top g and bottom g cases form
  # the groups. If the cut falls inside a run of tied totals, which tied cases
  # join is arbitrary — said in a note rather than hidden.
  ord <- order(-total, seq_len(n))
  up <- ord[seq_len(g)]; lw <- ord[(n - g + 1):n]
  if (g < n && total[ord[g]] == total[ord[g + 1]]) notes <- c(notes, "output.itemAnalysis.tiesAtCut")
  if (n - g >= 1 && total[ord[n - g + 1]] == total[ord[n - g]]) notes <- unique(c(notes, "output.itemAnalysis.tiesAtCut"))
  ul_rows <- lapply(seq_len(k), function(i) {
    a <- mat[lw, i]; b <- mat[up, i]
    tt <- if (stats::var(a) + stats::var(b) > 0)
      stats::t.test(b, a, var.equal = FALSE) else NULL
    list(nm[i], r3(mean(a)), r3(mean(b)), r3(mean(b) - mean(a)),
         if (is.null(tt)) NULL else r3(unname(tt$statistic)),
         if (is.null(tt)) NULL else r3(unname(tt$parameter)),
         if (is.null(tt)) NULL else r4(tt$p.value))
  })
  tables <- c(tables, list(list(
    titleKey = paste0("output.itemAnalysis.ulTitle:", format(pct)),
    columns = list("output.col.variable", "output.itemAnalysis.lowerMean", "output.itemAnalysis.upperMean",
                   "output.itemAnalysis.difference", "output.col.t", "output.col.df", "output.col.sig"),
    rows = ul_rows,
    footnoteKey = paste0("output.itemAnalysis.ulFootnote:", g, "|", format(min(total[lw])), "|",
                         format(max(total[lw])), "|", format(min(total[up])), "|", format(max(total[up]))))))
  bad_ul <- nm[vapply(ul_rows, function(r) is.null(r[[7]]) || r[[7]] >= 0.05, TRUE)]
  if (length(bad_ul)) notes <- c(notes, paste0("output.itemAnalysis.ulNotSig:", paste(bad_ul, collapse = ", ")))

  # ── Dichotomous items: difficulty and discrimination ──────────────────────
  if (all(mat %in% c(0, 1))) {
    band <- function(d) if (d >= 0.40) "output.itemAnalysis.dVeryGood" else if (d >= 0.30)
      "output.itemAnalysis.dGood" else if (d >= 0.20) "output.itemAnalysis.dMarginal" else
      "output.itemAnalysis.dPoor"
    dd_rows <- lapply(seq_len(k), function(i) {
      p <- mean(mat[, i]); pu <- mean(mat[up, i]); pl <- mean(mat[lw, i]); D <- pu - pl
      list(nm[i], r3(p), r3(pu), r3(pl), r3(D), r3(rit[i]), band(D))
    })
    tables <- c(tables, list(list(
      titleKey = "output.itemAnalysis.difficultyTitle",
      columns = list("output.col.variable", "output.itemAnalysis.difficulty", "output.itemAnalysis.pUpper",
                     "output.itemAnalysis.pLower", "output.itemAnalysis.discrimination",
                     "output.col.corrItemTotal", "output.itemAnalysis.dBand"),
      rows = dd_rows,
      footnoteKey = "output.itemAnalysis.difficultyFootnote")))
    tables <- c(tables, list(list(
      titleKey = "output.itemAnalysis.testStatsTitle",
      columns = list("output.col.statistic", "output.col.value"),
      rows = list(list("output.itemAnalysis.meanDifficulty", r3(mean(colMeans(mat)))),
                  list("output.itemAnalysis.kr20", r3(alpha)),
                  list("output.col.mean", r3(mean(total))), list("output.col.stdDeviation", r3(stats::sd(total)))),
      footnoteKey = NULL)))
  }
  if (n < n_total) notes <- c(notes, paste0("output.itemAnalysis.listwise:", n_total - n))

  progress(95L, "progress.finishing")
  sai_output(tables = tables, warnings = warns, notes = notes)
}, error = function(e) sai_error(conditionMessage(e)))
