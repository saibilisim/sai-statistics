# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# likert-items.R — Likert Item Descriptives: the per-item table survey papers
# report, the score-interval interpretation and a diverging stacked bar chart.
#
# Params: variables (item colIds), varNames, valueLabels (colId -> value ->
#   label), reverseItems (colIds), options:
#     scaleMin, scaleMax   response range (default: observed min / max)
#     chart                diverging bar chart (default TRUE)
#
# Frequencies are what respondents answered. For reverse-scored items the
# mean, SD, median, skewness, kurtosis and the interval are computed on the
# reversed scores (min + max - x), so every item reads "higher = more of the
# construct"; the table marks those items. Each item uses its own available
# answers (no listwise deletion — the table describes items, not a scale).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
source(file.path(.params_raw$rScriptsDir, "_scale_common.R"))
params <- read_params(); df <- load_data(params)

r2 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 2) else NULL
r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL

#' Diverging colours: disagree side red-orange, neutral grey, agree side blue.
likert_colors <- function(k) {
  neg <- c("#b2182b", "#d6604d", "#f4a582", "#fddbc7")
  pos <- c("#d1e5f0", "#92c5de", "#4393c3", "#2166ac")
  h <- k %/% 2
  idx <- if (h == 1) 2L else as.integer(round(seq(1, 4, length.out = h)))
  c(neg[idx], if (k %% 2) "#bdbdbd", pos[5L - rev(idx)])
}

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.likert.title")
  vars <- unlist(params$variables)
  if (length(vars) < 1) sai_error("Select at least one item")
  nm <- resolve_var_names(vars, params$varNames)
  opts <- if (is.null(params$options)) list() else params$options
  rev_ids <- unlist(params$reverseItems)
  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  if (is.null(dim(mat))) mat <- matrix(mat, ncol = 1)
  rg <- scale_range(mat, opts); lo <- rg[1]; hi <- rg[2]
  vals <- seq(lo, hi)
  if (length(vals) > 11) sai_error("Likert items need at most 11 response options")
  off <- sum(!is.na(mat) & !(mat %in% vals))
  labels <- params$valueLabels[[vars[1]]]
  iv <- score_intervals(lo, hi)
  notes <- character(0); warns <- character(0)
  if (off > 0) warns <- c(warns, paste0("output.likert.offScale:", off))

  disp <- ifelse(vars %in% rev_ids, paste0(nm, " (R)"), nm)
  pct_rows <- list(); cnt_rows <- list(); stat_rows <- list(); pct_mat <- matrix(0, length(vars), length(vals))
  for (i in seq_along(vars)) {
    x <- mat[, i]; x <- x[!is.na(x)]
    cnt <- vapply(vals, function(v) sum(x == v), 0)
    nn <- sum(cnt)
    pc <- if (nn > 0) 100 * cnt / nn else rep(NA_real_, length(vals))
    pct_mat[i, ] <- pc
    pct_rows[[i]] <- c(list(disp[i]), lapply(pc, function(v) if (is.finite(v)) round(v, 1) else NULL), list(as.integer(nn)))
    cnt_rows[[i]] <- c(list(disp[i]), lapply(cnt, as.integer), list(as.integer(nn)))
    s <- x[x %in% vals]
    if (vars[i] %in% rev_ids) s <- reverse_score(s, lo, hi)
    m <- if (length(s)) mean(s) else NA
    lvl <- interval_of(m, iv, lo)
    stat_rows[[i]] <- list(disp[i], as.integer(length(s)), r2(m), r2(if (length(s) > 1) stats::sd(s) else NA),
                           r2(if (length(s)) stats::median(s) else NA),
                           if (length(s)) wtd_mode(s) else NULL,
                           r3(if (length(s) > 2) wtd_skewness(s) else NA),
                           r3(if (length(s) > 3) wtd_kurtosis(s) else NA),
                           if (is.na(lvl)) NULL else option_label(lo + lvl - 1, labels))
  }
  opt_cols <- lapply(vals, function(v) {
    l <- option_label(v, labels)
    if (identical(l, format(v))) format(v) else paste0(format(v), " – ", l)
  })
  tables <- list(
    list(titleKey = "output.likert.pctTitle",
         columns = c(list("output.col.variable"), opt_cols, list("output.col.n")),
         rows = pct_rows, footnoteKey = "output.likert.pctFootnote"),
    list(titleKey = "output.likert.countTitle",
         columns = c(list("output.col.variable"), opt_cols, list("output.col.n")),
         rows = cnt_rows, footnoteKey = NULL),
    list(titleKey = "output.likert.statsTitle",
         columns = list("output.col.variable", "output.col.n", "output.col.mean", "output.col.stdDeviation",
                        "output.col.median", "output.col.mode", "output.col.skewness", "output.col.kurtosis",
                        "output.likert.level"),
         rows = stat_rows,
         footnoteKey = if (length(intersect(rev_ids, vars))) "output.likert.reverseFootnote" else NULL),
    list(titleKey = "output.likert.intervalTitle",
         columns = list("output.likert.levelNo", "output.likert.range", "output.likert.level"),
         rows = interval_rows(iv, lo, labels),
         footnoteKey = paste0("output.likert.intervalFootnote:", format(hi), "|", format(lo), "|",
                              length(vals), "|", format(round(iv$width, 2), nsmall = 2))))

  plots <- list()
  if (!identical(opts$chart, FALSE)) {
    k <- length(vals); cols <- likert_colors(k); mid <- (k + 1) / 2
    yl <- as.list(rev(disp))
    traces <- lapply(seq_len(k), function(j) {
      p <- pct_mat[, j]
      x <- if (j < mid) -p else if (j > mid) p else p / 2
      list(type = "bar", orientation = "h", name = opt_cols[[j]], x = as.list(rev(x)), y = yl,
           marker = list(color = cols[j]), hovertemplate = paste0(opt_cols[[j]], ": %{customdata:.1f}%<extra></extra>"),
           customdata = as.list(rev(p)), legendrank = j)
    })
    if (k %% 2 == 1) {
      j <- (k + 1) / 2
      traces[[length(traces) + 1]] <- list(type = "bar", orientation = "h", name = opt_cols[[j]],
        x = as.list(rev(-pct_mat[, j] / 2)), y = yl, marker = list(color = cols[j]),
        showlegend = FALSE, hoverinfo = "skip")
    }
    # Negative side stacks from the centre outwards: plot order must run from
    # the option nearest the middle to the extreme.
    neg <- which(seq_len(k) < mid); pos <- which(seq_len(k) > mid)
    ord <- c(if (k %% 2) c(length(traces), (k + 1) / 2) else integer(0), rev(neg), pos)
    traces <- traces[ord]
    plots <- list(list(titleKey = "output.likert.chartTitle", type = "plotly",
      data = list(data = traces, layout = list(
        barmode = "relative",
        xaxis = list(title = list(text = "%"), zeroline = TRUE, ticksuffix = "%"),
        yaxis = list(automargin = TRUE),
        legend = list(orientation = "h", traceorder = "normal"),
        height = max(320, 60 + 32 * length(vars)),
        margin = list(t = 30, r = 20, b = 60, l = 10)))))
  }

  progress(95L, "progress.finishing")
  sai_output(tables = tables, plots = plots, warnings = warns, notes = notes)
}, error = function(e) sai_error(conditionMessage(e)))
