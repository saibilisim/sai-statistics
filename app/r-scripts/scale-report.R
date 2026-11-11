# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# scale-report.R — Scale Scores Report: subscale (and total) scores from their
# items with reverse scoring, and the tables a survey paper reports for them.
#
# Params: variables (all item colIds), varNames, valueLabels (colId -> value
#   -> label; the first item's labels name the interpretation levels),
#   subscales [{ name, items: [colId] }], reverseItems (colIds),
#   createVars { "score<i>": name, "total": name } (optional), options:
#     score        "mean" (default) | "sum"
#     total        add a total score over every item (default FALSE)
#     scaleMin, scaleMax    response range (default: observed)
#     criterion    1 | 1.5 | 2 — |skewness| and |kurtosis| cut-off for the
#                  normality decision (default 1.5, Tabachnick & Fidell 2013;
#                  1 = Hair et al.; 2 = George & Mallery 2010)
#
# A case gets a subscale score only when all of that subscale's items are
# answered (no silent pro-rating). Skewness / kurtosis are SPSS's G1 / G2 with
# their standard errors; z = statistic / SE is printed as well. The
# correlation table has the subscale means and SDs, Pearson r below the
# diagonal, Cronbach's alpha on it and the two-tailed p above it.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
source(file.path(.params_raw$rScriptsDir, "_reliability_models.R"))
source(file.path(.params_raw$rScriptsDir, "_scale_common.R"))
params <- read_params(); df <- load_data(params)

r2 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 2) else NULL
r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL
r4 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 4) else NULL

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.scale.title")
  opts <- if (is.null(params$options)) list() else params$options
  subs <- Filter(function(s) length(unlist(s$items)) > 0, params$subscales)
  if (!length(subs)) sai_error("Assign items to at least one subscale")
  items <- unique(unlist(lapply(subs, function(s) unlist(s$items))))
  if (!all(items %in% names(df))) sai_error("An item variable was not found in the dataset")
  rev_ids <- intersect(unlist(params$reverseItems), items)
  use_sum <- identical(opts$score, "sum")
  crit <- suppressWarnings(as.numeric(opts$criterion))
  if (!length(crit) || !crit %in% c(1, 1.5, 2)) crit <- 1.5

  raw <- sapply(items, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  if (is.null(dim(raw))) raw <- matrix(raw, ncol = 1, dimnames = list(NULL, items))
  rg <- scale_range(raw, opts); lo <- rg[1]; hi <- rg[2]
  sc <- raw
  for (c in rev_ids) sc[, c] <- reverse_score(sc[, c], lo, hi)

  names_s <- vapply(subs, function(s) as.character(s$name), "")
  sets <- lapply(subs, function(s) unique(unlist(s$items)))
  if (isTRUE(opts$total) && length(subs) > 1) { names_s <- c(names_s, "output.scale.totalScore"); sets <- c(sets, list(items)) }
  score_of <- function(cols) {
    m <- sc[, cols, drop = FALSE]
    ok <- stats::complete.cases(m)
    out <- rep(NA_real_, nrow(m))
    out[ok] <- if (use_sum) rowSums(m[ok, , drop = FALSE]) else rowMeans(m[ok, , drop = FALSE])
    out
  }
  S <- sapply(sets, score_of)
  if (is.null(dim(S))) S <- matrix(S, ncol = 1)
  alphas <- vapply(sets, function(cols) {
    m <- sc[stats::complete.cases(sc[, cols, drop = FALSE]), cols, drop = FALSE]
    if (length(cols) < 2 || nrow(m) < 2) NA_real_ else rel_alpha(m)
  }, 0)
  tables <- list(); notes <- character(0)

  # ── Descriptives and normality ────────────────────────────────────────────
  desc_rows <- lapply(seq_along(sets), function(j) {
    x <- S[, j]; x <- x[!is.na(x)]; n <- length(x)
    sk <- if (n > 2) wtd_skewness(x) else NA; ku <- if (n > 3) wtd_kurtosis(x) else NA
    ses <- if (n > 2) se_skewness(n) else NA; sek <- if (n > 3) se_kurtosis(n) else NA
    list(names_s[j], as.integer(length(sets[[j]])), as.integer(n), r2(mean(x)), r2(stats::sd(x)),
         r2(min(x)), r2(max(x)), r3(sk), r3(ses), r3(ku), r3(sek), r2(sk / ses), r2(ku / sek),
         normal_by(sk, ku, crit))
  })
  tables <- c(tables, list(list(
    titleKey = "output.scale.descTitle",
    columns = list("output.scale.subscale", "output.col.nItems", "output.col.n", "output.col.mean",
                   "output.col.stdDeviation", "output.col.min", "output.col.max", "output.col.skewness",
                   "output.col.seSkewness", "output.col.kurtosis", "output.col.seKurtosis",
                   "output.scale.zSkew", "output.scale.zKurt", "output.scale.normal"),
    rows = desc_rows,
    footnoteKey = paste0("output.scale.normalFootnote:", format(crit), "|",
                         switch(as.character(crit), "1" = "output.scale.refHair",
                                "1.5" = "output.scale.refTabachnick", "output.scale.refGeorge")))))

  # ── Score interpretation (mean scores only) ───────────────────────────────
  labels <- params$valueLabels[[items[1]]]
  if (!use_sum) {
    iv <- score_intervals(lo, hi)
    tables <- c(tables, list(
      list(titleKey = "output.scale.levelTitle",
           columns = list("output.scale.subscale", "output.col.mean", "output.likert.range",
                          "output.likert.level"),
           rows = lapply(seq_along(sets), function(j) {
             m <- mean(S[, j], na.rm = TRUE); l <- interval_of(m, iv, lo)
             list(names_s[j], r2(m),
                  if (is.na(l)) NULL else sprintf("%.2f – %.2f", if (l == 1) iv$lower[l] else iv$lower[l] + 0.01, iv$upper[l]),
                  if (is.na(l)) NULL else option_label(lo + l - 1, labels))
           }),
           footnoteKey = paste0("output.likert.intervalFootnote:", format(hi), "|", format(lo), "|",
                                iv$k, "|", format(round(iv$width, 2), nsmall = 2)))))
  }

  # ── Correlations (APA table) ──────────────────────────────────────────────
  if (ncol(S) > 1) {
    k <- ncol(S)
    rows <- lapply(seq_len(k), function(i) {
      cells <- lapply(seq_len(k), function(j) {
        if (i == j) return(r3(alphas[i]))
        ok <- stats::complete.cases(S[, c(i, j)])
        if (sum(ok) < 3) return(NULL)
        ct <- stats::cor.test(S[ok, i], S[ok, j])
        if (j < i) r3(unname(ct$estimate)) else r4(ct$p.value)
      })
      c(list(names_s[i], r2(mean(S[, i], na.rm = TRUE)), r2(stats::sd(S[, i], na.rm = TRUE))), cells)
    })
    tables <- c(tables, list(list(
      titleKey = "output.scale.corrTitle",
      columns = c(list("output.scale.subscale", "output.col.mean", "output.col.stdDeviation"),
                  as.list(paste0("output.scale.colIndex:", seq_len(k)))),
      rows = lapply(seq_len(k), function(i) { r <- rows[[i]]; r[[1]] <- paste0(i, ". ", names_s[i]); r }),
      footnoteKey = "output.scale.corrFootnote")))
    # A translated total label inside "1. <name>" would not translate: keep
    # the key as its own cell when it is the total row.
    if (identical(names_s[k], "output.scale.totalScore")) tables[[length(tables)]]$rows[[k]][[1]] <- names_s[k]
  }

  # ── Items per subscale (what was scored) ──────────────────────────────────
  nm <- resolve_var_names(items, params$varNames); names(nm) <- items
  tables <- c(tables, list(list(
    titleKey = "output.scale.itemsTitle",
    columns = list("output.scale.subscale", "output.scale.items", "output.col.cronbachAlpha"),
    rows = lapply(seq_along(sets), function(j) list(names_s[j],
      paste(ifelse(sets[[j]] %in% rev_ids, paste0(nm[sets[[j]]], " (R)"), nm[sets[[j]]]), collapse = ", "),
      r3(alphas[j]))),
    footnoteKey = paste0(if (use_sum) "output.scale.scoreSum" else "output.scale.scoreMean",
                         if (length(rev_ids)) "R" else "", ":", format(lo + hi)))))

  # ── Save scores ──────────────────────────────────────────────────────────
  want <- requested_new_vars(params)
  case_vars <- list()
  for (j in seq_along(sets)) {
    key <- if (j > length(subs)) "total" else paste0("score", j)
    if (!is.null(want[[key]]))
      case_vars[[length(case_vars) + 1]] <- sai_case_var(want[[key]], S[, j], df,
        labelKey = if (j > length(subs)) "" else names_s[j], decimals = if (use_sum) 0 else 2)
  }

  progress(95L, "progress.finishing")
  sai_output(tables = tables, notes = notes, caseVars = case_vars)
}, error = function(e) sai_error(conditionMessage(e)))
