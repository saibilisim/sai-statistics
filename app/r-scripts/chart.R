# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# chart.R — Graphs menu v1 (SPSS legacy-dialog-style charts, see
# spss-parity-analysis.md §3.6): Scatter, Bar, Line, Histogram, Boxplot,
# P-P Plot, Q-Q Plot. A single script/dialog, selected via `chartType`.
#
# Params (from JSON):
#   chartType — "scatter" | "bar" | "line" | "histogram" | "boxplot" | "pp" | "qq"
#   xVar, xVarName          — required for scatter/line/pp/qq/histogram/boxplot
#   yVar, yVarName          — required for scatter (numeric Y)
#   groupVar, groupVarName  — optional for bar/line (category)/boxplot (group)
#   options — the chart's Options sub-dialog (ChartDialog.tsx); every field
#             has a default, so a missing block draws the plain chart:
#     scatter   fitLine "none"|"linear"
#     bar       represent "count"|"percent", sortBy "countDesc"|"countAsc"|
#               "alphabetical", showValues
#     line      style "linePlusMarker"|"lineOnly"|"markerOnly",
#               sortBy "alphabetical"|"valueAsc"|"valueDesc" (grouped line)
#     histogram normalCurve, binsMode "auto"|"custom", customBins
#     boxplot   points, boxmean, notched, orientation, sortBy, showLegend
#     pp / qq   detrend (deviations from the reference line, SPSS's
#               "Detrended Normal P-P/Q-Q Plot")
#
# Output: a single Plotly plot. No tables (SPSS legacy chart dialogs are
# chart-only).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

BAR_COLOR <- "#4C78A8"
SOFT_PALETTE <- c(
  "#4C78A8",  # Soft Steel Blue
  "#72B7B2",  # Soft Sage / Teal
  "#E45756",  # Soft Coral
  "#F58518",  # Soft Amber / Peach
  "#54A24B",  # Soft Mint Green
  "#EECA3B",  # Soft Honey
  "#B279A2",  # Soft Lavender / Purple
  "#FF9DA6",  # Soft Rose / Pink
  "#9D755D",  # Soft Warm Taupe
  "#79706E"   # Soft Slate
)

tryCatch({
  progress(10L, "progress.loading")

  chartType <- params$chartType
  if (is.null(chartType)) sai_error("No chart type specified")

  xv_raw <- params$xVar
  xname <- if (is.null(params$xVarName)) xv_raw else params$xVarName
  opts <- if (is.list(params$options)) params$options else list()
  opt <- function(name, default) if (is.null(opts[[name]])) default else opts[[name]]
  # "Alphabetical" category order, but numeric codes in numeric order (2 < 10).
  category_order <- function(values) {
    num <- suppressWarnings(as.numeric(values))
    if (!anyNA(num)) order(num) else order(values)
  }

  progress(50L, "progress.computing")

  if (chartType == "scatter") {
    yv_raw <- params$yVar
    yname <- if (is.null(params$yVarName)) yv_raw else params$yVarName
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("X variable not found")
    if (is.null(yv_raw) || !yv_raw %in% names(df)) sai_error("Y variable not found")
    x <- suppressWarnings(as.numeric(df[[xv_raw]]))
    y <- suppressWarnings(as.numeric(df[[yv_raw]]))
    keep <- !is.na(x) & !is.na(y)
    trace <- list(type = "scatter", mode = "markers", x = as.list(x[keep]), y = as.list(y[keep]),
                  name = sprintf("%s vs %s", yname, xname), marker = list(color = BAR_COLOR))
    traces <- list(trace)
    # Fit line: the least-squares line over the plotted range, R² in its name
    # (SPSS's "Fit Line at Total").
    if (identical(opt("fitLine", "none"), "linear") && sum(keep) >= 2 &&
        length(unique(x[keep])) >= 2) {
      fit <- stats::lm(y[keep] ~ x[keep])
      cf <- stats::coef(fit)
      xr <- range(x[keep])
      r2 <- summary(fit)$r.squared
      traces <- c(traces, list(list(
        type = "scatter", mode = "lines", x = as.list(xr), y = as.list(cf[[1]] + cf[[2]] * xr),
        name = sprintf("R² = %.3f", r2), line = list(color = "#E45756"))))
    }
    layout <- list(xaxis = list(title = list(text = xname)), yaxis = list(title = list(text = yname)),
                   showlegend = length(traces) > 1,
                   margin = list(t = 40, r = 20, b = 40, l = 60))
    plot <- list(titleKey = paste0("output.chart.scatterTitle:", yname, " vs ", xname),
                 type = "plotly", data = list(data = traces, layout = layout))

  } else if (chartType == "bar") {
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("Category variable not found")
    cats <- as.character(df[[xv_raw]])
    cats <- cats[!is.na(cats)]
    tab <- table(cats)
    sort_by <- opt("sortBy", "countDesc")
    tab <- tab[switch(sort_by,
      countAsc = order(as.numeric(tab)),
      alphabetical = category_order(names(tab)),
      order(as.numeric(tab), decreasing = TRUE))]
    percent <- identical(opt("represent", "count"), "percent")
    heights <- if (percent) 100 * as.numeric(tab) / sum(tab) else as.numeric(tab)
    cat_names <- vapply(names(tab), function(cn) resolve_var_name(cn, params$xValueLabels), character(1))
    n_bars <- length(tab)
    bar_colors <- rep_len(SOFT_PALETTE, n_bars)
    trace <- list(type = "bar", x = as.list(unname(cat_names)), y = as.list(heights),
                  name = xname, marker = list(color = as.list(bar_colors)))
    if (isTRUE(opts$showValues)) {
      trace$text <- as.list(if (percent) sprintf("%.1f%%", heights) else format(heights, trim = TRUE))
      trace$textposition <- "outside"
    }
    layout <- list(xaxis = list(title = list(text = xname),
                                # Plotly re-sorts numeric-looking categories; keep ours.
                                type = "category", categoryorder = "array",
                                categoryarray = as.list(unname(cat_names))),
                   yaxis = list(title = list(text = if (percent) "Percent" else "Count")),
                   margin = list(t = 40, r = 20, b = 40, l = 60))
    plot <- list(titleKey = paste0("output.chart.barTitle:", xname), type = "plotly",
                 data = list(data = list(trace), layout = layout))

  } else if (chartType == "line") {
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("Variable not found")
    y <- suppressWarnings(as.numeric(df[[xv_raw]]))
    gcol <- params$groupVar
    style <- opt("style", "linePlusMarker")
    mode_for <- function(default) switch(style, lineOnly = "lines", markerOnly = "markers", default)
    if (!is.null(gcol) && gcol %in% names(df)) {
      gname <- if (is.null(params$groupVarName)) gcol else params$groupVarName
      g <- as.character(df[[gcol]])
      keep <- !is.na(y) & !is.na(g)
      means <- tapply(y[keep], g[keep], mean)
      ord <- switch(opt("sortBy", "alphabetical"),
        valueAsc = order(as.numeric(means)),
        valueDesc = order(as.numeric(means), decreasing = TRUE),
        category_order(names(means)))
      raw_cat_names <- names(means)[ord]
      cat_names <- vapply(raw_cat_names, function(cn) resolve_var_name(cn, params$groupValueLabels), character(1))
      trace <- list(type = "scatter", mode = mode_for("lines+markers"),
                    x = as.list(unname(cat_names)), y = as.list(unname(means)[ord]),
                    name = paste("Mean of", xname), line = list(color = BAR_COLOR),
                    marker = list(color = BAR_COLOR))
      layout <- list(xaxis = list(title = list(text = gname), type = "category",
                                  categoryorder = "array",
                                  categoryarray = as.list(unname(cat_names))),
                     yaxis = list(title = list(text = paste("Mean of", xname))),
                     margin = list(t = 40, r = 20, b = 40, l = 60))
    } else {
      # Case values in case order.
      yv <- y[!is.na(y)]
      trace <- list(type = "scatter", mode = mode_for("lines+markers"),
                    y = as.list(yv), name = xname, line = list(color = BAR_COLOR),
                    marker = list(color = BAR_COLOR))
      layout <- list(xaxis = list(title = list(text = "Case Number")),
                     yaxis = list(title = list(text = xname)),
                     margin = list(t = 40, r = 20, b = 40, l = 60))
    }
    plot <- list(titleKey = paste0("output.chart.lineTitle:", xname), type = "plotly",
                 data = list(data = list(trace), layout = layout))

  } else if (chartType == "histogram") {
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("Variable not found")
    nv <- suppressWarnings(as.numeric(df[[xv_raw]]))
    nv <- nv[!is.na(nv)]
    if (length(nv) < 2) sai_error("Not enough data for a histogram")
    custom_bins <- suppressWarnings(as.integer(opt("customBins", NA)))
    nbins <- if (identical(opt("binsMode", "auto"), "custom") && !is.na(custom_bins) &&
                 custom_bins >= 1) min(custom_bins, 500L) else NULL
    trace <- sai_histogram_trace(nv, name = xname, color = BAR_COLOR, nbins = nbins)
    traces <- list(trace)
    # Normal curve with the sample's mean and SD, scaled to counts per bin
    # (n · bin width · density) so it sits on the bars, as SPSS draws it.
    if (isTRUE(opts$normalCurve) && sd(nv) > 0) {
      bw <- trace$xbins$size
      grid <- seq(min(nv) - bw, max(nv) + bw, length.out = 200)
      traces <- c(traces, list(list(
        type = "scatter", mode = "lines", x = as.list(grid),
        y = as.list(length(nv) * bw * dnorm(grid, mean(nv), sd(nv))),
        name = sprintf("Normal (%.3g, %.3g)", mean(nv), sd(nv)),
        line = list(color = "#E45756"))))
    }
    layout <- list(xaxis = list(title = list(text = xname)),
                   yaxis = list(title = list(text = "Frequency")),
                   showlegend = length(traces) > 1,
                   bargap = 0.02, margin = list(t = 40, r = 20, b = 40, l = 60))
    plot <- list(titleKey = paste0("output.chart.histTitle:", xname), type = "plotly",
                 data = list(data = traces, layout = layout))

  } else if (chartType == "boxplot") {
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("Variable not found")
    y <- suppressWarnings(as.numeric(df[[xv_raw]]))
    gcol <- params$groupVar

    # Options (Boxplot "Options" sub-dialog) — every field has a default so a
    # missing `options` block (or an older cached run) behaves like before.
    opts <- params$options
    boxpoints <- switch(if (is.null(opts$points)) "outliers" else opts$points,
                         none = FALSE, all = "all", "outliers")
    boxmean <- switch(if (is.null(opts$boxmean)) "none" else opts$boxmean,
                       "true" = TRUE, sd = "sd", FALSE)
    notched <- isTRUE(opts$notched)
    horizontal <- identical(opts$orientation, "horizontal")
    sort_by <- if (is.null(opts$sortBy)) "alphabetical" else opts$sortBy

    show_legend <- if (is.null(opts$showLegend)) TRUE else isTRUE(opts$showLegend)

    trace_base <- list(
      type = "box",
      boxpoints = boxpoints,
      boxmean = boxmean,
      notched = notched,
      pointpos = 0,
      jitter = 0.35
    )
    if (horizontal) trace_base$orientation <- "h"

    traces <- list()
    if (!is.null(gcol) && gcol %in% names(df)) {
      g <- as.character(df[[gcol]])
      keep <- !is.na(y) & !is.na(g)
      levels <- sort(unique(g[keep]))
      if (sort_by %in% c("medianAsc", "medianDesc")) {
        meds <- sapply(levels, function(lvl) median(y[keep][g[keep] == lvl]))
        levels <- levels[order(meds, decreasing = (sort_by == "medianDesc"))]
      }
      for (i in seq_along(levels)) {
        lvl <- levels[i]
        vals <- y[keep][g[keep] == lvl]
        lbl <- resolve_var_name(lvl, params$groupValueLabels)
        col <- SOFT_PALETTE[(i - 1) %% length(SOFT_PALETTE) + 1]
        tr <- modifyList(trace_base, list(
          name = lbl,
          marker = list(color = col),
          line = list(color = col)
        ))
        if (horizontal) tr$x <- as.list(vals) else tr$y <- as.list(vals)
        traces <- c(traces, list(tr))
      }
    } else {
      vals <- y[!is.na(y)]
      col <- SOFT_PALETTE[1]
      tr <- modifyList(trace_base, list(
        name = xname,
        marker = list(color = col),
        line = list(color = col)
      ))
      if (horizontal) tr$x <- as.list(vals) else tr$y <- as.list(vals)
      traces <- list(tr)
    }
    gname <- if (is.null(params$groupVarName)) gcol else params$groupVarName
    layout <- if (horizontal) {
      list(xaxis = list(title = list(text = xname)),
           yaxis = if (!is.null(gcol)) list(title = list(text = gname)) else NULL,
           showlegend = show_legend,
           margin = list(t = 40, r = 20, b = 40, l = 60))
    } else {
      list(yaxis = list(title = list(text = xname)),
           xaxis = if (!is.null(gcol)) list(title = list(text = gname)) else NULL,
           showlegend = show_legend,
           margin = list(t = 40, r = 20, b = 40, l = 60))
    }
    plot <- list(titleKey = paste0("output.chart.boxplotTitle:", xname), type = "plotly",
                 data = list(data = traces, layout = layout))

  } else if (chartType == "pp") {
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("Variable not found")
    nv <- suppressWarnings(as.numeric(df[[xv_raw]]))
    nv <- nv[!is.na(nv)]
    n <- length(nv)
    if (n < 3) sai_error("Not enough data for a P-P plot")
    m <- mean(nv); s <- sd(nv)
    ordv <- sort(nv)
    observed_cp <- (seq_len(n) - 0.5) / n
    expected_cp <- pnorm(ordv, mean = m, sd = s)
    if (isTRUE(opts$detrend)) {
      # SPSS's Detrended Normal P-P: observed cum prob against its deviation
      # from the expected one, around a zero line.
      trace <- list(type = "scatter", mode = "markers", x = as.list(observed_cp),
                    y = as.list(observed_cp - expected_cp), name = xname,
                    marker = list(color = BAR_COLOR))
      diag <- list(type = "scatter", mode = "lines", x = list(0, 1), y = list(0, 0),
                   line = list(color = "#999999", dash = "dash"))
      layout <- list(xaxis = list(title = list(text = "Observed Cum Prob"), range = list(0, 1)),
                     yaxis = list(title = list(text = "Deviation from Normal")),
                     showlegend = FALSE, margin = list(t = 40, r = 20, b = 40, l = 60))
    } else {
      trace <- list(type = "scatter", mode = "markers", x = as.list(expected_cp), y = as.list(observed_cp),
                    name = xname, marker = list(color = BAR_COLOR))
      diag <- list(type = "scatter", mode = "lines", x = list(0, 1), y = list(0, 1),
                  line = list(color = "#999999", dash = "dash"))
      layout <- list(xaxis = list(title = list(text = "Expected Cum Prob"), range = list(0, 1)),
                     yaxis = list(title = list(text = "Observed Cum Prob"), range = list(0, 1)),
                     showlegend = FALSE, margin = list(t = 40, r = 20, b = 40, l = 60))
    }
    plot <- list(titleKey = paste0("output.chart.ppTitle:", xname), type = "plotly",
                 data = list(data = list(trace, diag), layout = layout))

  } else if (chartType == "qq") {
    if (is.null(xv_raw) || !xv_raw %in% names(df)) sai_error("Variable not found")
    nv <- suppressWarnings(as.numeric(df[[xv_raw]]))
    nv <- nv[!is.na(nv)]
    n <- length(nv)
    if (n < 3) sai_error("Not enough data for a Q-Q plot")
    m <- mean(nv); s <- sd(nv)
    ordv <- sort(nv)
    pp <- (seq_len(n) - 0.5) / n
    theo <- qnorm(pp, mean = m, sd = s)
    if (isTRUE(opts$detrend)) {
      # SPSS's Detrended Normal Q-Q: each observed value against how far its
      # z-score sits from the expected normal quantile.
      trace <- list(type = "scatter", mode = "markers", x = as.list(ordv),
                    y = as.list((ordv - m) / s - qnorm(pp)), name = xname,
                    marker = list(color = BAR_COLOR))
      diagline <- list(type = "scatter", mode = "lines", x = as.list(range(ordv)), y = list(0, 0),
                       line = list(color = "#999999", dash = "dash"))
      layout <- list(xaxis = list(title = list(text = paste("Observed:", xname))),
                     yaxis = list(title = list(text = "Deviation from Normal")),
                     showlegend = FALSE, margin = list(t = 40, r = 20, b = 40, l = 60))
    } else {
      trace <- list(type = "scatter", mode = "markers", x = as.list(theo), y = as.list(ordv),
                    name = xname, marker = list(color = BAR_COLOR))
      rng <- range(c(theo, ordv))
      diagline <- list(type = "scatter", mode = "lines", x = as.list(rng), y = as.list(rng),
                       line = list(color = "#999999", dash = "dash"))
      layout <- list(xaxis = list(title = list(text = "Theoretical Quantiles")),
                     yaxis = list(title = list(text = paste("Observed:", xname))),
                     showlegend = FALSE, margin = list(t = 40, r = 20, b = 40, l = 60))
    }
    plot <- list(titleKey = paste0("output.chart.qqTitle:", xname), type = "plotly",
                 data = list(data = list(trace, diagline), layout = layout))

  } else {
    sai_error(paste("Unknown chart type:", chartType))
  }

  progress(100L, "progress.done")
  sai_output(plots = list(plot))

}, error = function(e) {
  sai_error(conditionMessage(e))
})
