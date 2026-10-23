# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# life-tables.R — Actuarial Life Table (SPSS Survival → Life Tables).
#
# Params: time (colId), status (colId, 1 = event/death, 0 = censored),
#         interval (numeric width), maxTime (optional upper bound), varNames.
# Actuarial method: per interval, effective N at risk = entering − withdrawals/2.
# Output: the Life Table (interval start, entering, withdrawn, exposed,
#         terminal events, proportion terminating/surviving, cumulative
#         survival and — as SPSS prints them — its standard error, the
#         probability density, the hazard rate and their standard errors), the
#         Median Survival Time, and the Options sub-dialog's plots.
#
# options: { table (default TRUE), plots: [ "survival" | "logSurvival" |
#            "hazard" | "density" | "oneMinusSurvival" ] }
#
# Density, hazard and the three standard errors use the actuarial (Gehan)
# formulas of the SPSS SURVIVAL algorithm; on the parity fixture they
# reproduce every printed value. The final, open-ended interval uses the
# common width, as SPSS does.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  tcol <- params$time; scol <- params$status
  if (is.null(tcol) || !tcol %in% names(df)) sai_error("Time variable not found")
  if (is.null(scol) || !scol %in% names(df)) sai_error("Status variable not found")
  width <- if (is.null(params$interval)) NULL else as.numeric(params$interval)

  tv <- suppressWarnings(as.numeric(df[[tcol]]))
  sv <- suppressWarnings(as.numeric(df[[scol]]))
  ok <- is.finite(tv) & is.finite(sv) & tv >= 0
  tv <- tv[ok]; sv <- sv[ok]
  if (length(tv) < 2) sai_error("Not enough complete cases")
  maxt <- if (is.null(params$maxTime)) max(tv) else as.numeric(params$maxTime)
  if (is.null(width) || !is.finite(width) || width <= 0) width <- maxt / 10
  status1 <- as.integer(sv != 0)                    # any non-zero = event

  progress(50L, "progress.computing")
  breaks <- seq(0, ceiling(maxt / width) * width, by = width)
  n_start <- length(tv); S <- 1; rows <- list()
  var_sum <- 0                      # running sum of q / (neff p) for the SEs
  pts <- list()                     # per-interval values for plots and median
  opts <- if (is.null(params$options)) list() else params$options
  # SPSS's "THRU maxt BY width" produces the closed intervals up to maxt AND a
  # final open one starting at maxt. Forcing the LAST closed interval open
  # instead swallowed everything at or beyond maxt into it: with censoring at
  # 24, the [18,24) row claimed 23 withdrawals that belong to [24,∞) and its
  # proportion terminating came out .53 against SPSS's .36.
  breaks <- c(breaks, Inf)
  for (i in seq_len(length(breaks) - 1)) {
    lo <- breaks[i]; hi <- breaks[i + 1]
    in_int <- tv >= lo & tv < hi
    d <- sum(in_int & status1 == 1)
    w <- sum(in_int & status1 == 0)
    neff <- n_start - w / 2
    q <- if (neff > 0) d / neff else 0
    p <- 1 - q
    S_prev <- S
    S <- S * p
    f   <- (S_prev - S) / width
    haz <- if (neff > 0) 2 * q / (width * (1 + p)) else 0
    se_f <- if (d > 0 && neff > 0) f * sqrt(var_sum + p / (neff * q)) else 0
    if (neff > 0 && p > 0) var_sum <- var_sum + q / (neff * p)
    se_S <- if (p > 0) S * sqrt(var_sum) else 0
    se_haz <- if (d > 0) haz * sqrt(max(1 - (haz * width / 2)^2, 0) / (neff * q)) else 0
    pts[[length(pts) + 1L]] <- list(lo = lo, S_prev = S_prev, S = S, f = f, haz = haz)
    # The cumulative proportion is the one at the END of this interval, which
    # is what the column has always been labelled ("Cumulative Proportion
    # Surviving at End") and what SPSS prints. The row used to carry the value
    # from BEFORE the interval's deaths were applied, so every row was one
    # interval stale and the first row always read 1.000 — on the parity
    # fixture ours said 1.000 / 0.5917 / 0.4167 where SPSS says
    # 0.59 / 0.42 / 0.30.
    rows <- c(rows, list(list(
      sprintf("%g", lo), as.integer(n_start), as.integer(w), round(neff, 1),
      as.integer(d), round(q, 4), round(p, 4), round(S, 4),
      round(se_S, 4), round(f, 4), round(se_f, 4), round(haz, 4), round(se_haz, 4))))
    n_start <- n_start - d - w
    if (n_start <= 0) break
  }

  # Median Survival Time: linear interpolation inside the interval where the
  # cumulative proportion crosses .5 (SPSS); beyond the last interval when it
  # never does.
  med <- NA_real_
  for (pt in pts) if (pt$S_prev >= 0.5 && pt$S < 0.5) {
    med <- pt$lo + width * (pt$S_prev - 0.5) / (pt$S_prev - pt$S); break
  }
  tables <- list()
  if (!isFALSE(opts$table)) {
    tables[[1]] <- list(
      titleKey = "output.lifetab.title",
      columns = list("output.lifetab.intervalStart", "output.lifetab.entering",
                     "output.lifetab.withdrawn", "output.lifetab.exposed",
                     "output.lifetab.terminal", "output.lifetab.propTerm",
                     "output.lifetab.propSurv", "output.lifetab.cumSurv",
                     "output.lifetab.seCumSurv", "output.lifetab.density",
                     "output.lifetab.seDensity", "output.lifetab.hazard",
                     "output.lifetab.seHazard"),
      rows = rows, footnoteKey = NULL)
    tables[[2]] <- list(
      titleKey = "output.lifetab.medianTitle",
      columns = list("output.lifetab.medianTime"),
      rows = list(list(if (is.na(med)) NULL else round_half_up(med, 2))),
      footnoteKey = if (is.na(med)) "output.lifetab.medianNotReached" else NULL)
  }

  plot_defs <- list(
    survival = list(y = function(pt) pt$S, key = "output.lifetab.plotSurvival", step = TRUE),
    logSurvival = list(y = function(pt) if (pt$S > 0) log(pt$S) else NA, key = "output.lifetab.plotLogSurvival", step = TRUE),
    oneMinusSurvival = list(y = function(pt) 1 - pt$S, key = "output.lifetab.plotOneMinusSurvival", step = TRUE),
    hazard = list(y = function(pt) pt$haz, key = "output.lifetab.plotHazard", step = FALSE),
    density = list(y = function(pt) pt$f, key = "output.lifetab.plotDensity", step = FALSE))
  plots <- list()
  for (pk in intersect(unlist(opts$plots), names(plot_defs))) {
    pd <- plot_defs[[pk]]
    # Cumulative functions are read at each interval's end; rates belong to
    # the interval's midpoint.
    xs <- vapply(pts, function(pt) if (pd$step) pt$lo + width else pt$lo + width / 2, numeric(1))
    ys <- vapply(pts, pd$y, numeric(1))
    if (pd$step) {
      xs <- c(0, xs); ys <- c(switch(pk, survival = 1, 0), ys)
    }
    plots[[length(plots) + 1L]] <- list(
      titleKey = pd$key, type = "plotly",
      data = list(data = list(list(type = "scatter", mode = "lines+markers",
                                   x = as.list(xs), y = as.list(round(ys, 5)),
                                   line = list(color = "#3b6ea5", shape = if (pd$step) "hv" else "linear"))),
                  layout = list(xaxis = list(title = list(text = if (is.null(params$varNames[[tcol]])) tcol else params$varNames[[tcol]])),
                                yaxis = list(title = list(text = "")),
                                showlegend = FALSE, margin = list(t = 40, r = 20, b = 50, l = 60))))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, plots = plots)
}, error = function(e) sai_error(conditionMessage(e)))
