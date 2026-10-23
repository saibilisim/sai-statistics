# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# frequencies.R — Frequency table analysis (SPSS-style).
#
# Params (from JSON):
#   parquetPath  — path to the exported Parquet dataset
#   rScriptsDir  — directory containing _bootstrap.R
#   variables    — character vector of colIds
#   varNames     — named list colId → display name
#   options      — named list:
#     showTable  — boolean: emit a frequency table per variable
#     order      — frequency-table row order: "ascending" (by value, the SPSS
#                  default) | "descending" | "ascFreq" | "descFreq"
#     statistics — named list of booleans:
#                    mean, median, mode, sd, variance, range,
#                    min, max, semean, quartiles, percentiles,
#                    skewness, kurtosis
#                  plus two non-boolean entries:
#                    customPercentiles — numeric vector of user-entered
#                      percentiles (empty → the fixed 5/10/25/50/75/90/95 list)
#                    cutPoints — integer N: emit the N-1 percentiles that cut
#                      the distribution into N equal groups (NULL = off)
#   splitVariable/splitVariableName — active Split File colId/name (B2),
#                    injected by analysis-handler.ts when set
#
# Output: multiple tables (one frequency table per variable + one statistics
#         table per variable, when requested).

suppressPackageStartupMessages(library(jsonlite))

# 1. Read raw params before sourcing bootstrap
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)

# 2. Source bootstrap
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

# 3. Load params and data
params <- read_params()
df     <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  variables  <- unlist(params$variables)
  var_names  <- params$varNames
  opts       <- params$options
  show_table <- isTRUE(opts$showTable)
  stats_opts <- if (is.null(opts$statistics)) list() else opts$statistics
  chart_opts <- if (is.null(opts$charts)) list() else opts$charts
  chart_type <- if (is.null(chart_opts$type)) "none" else chart_opts$type
  show_normal <- isTRUE(chart_opts$showNormalCurve)
  # Frequency-table row order (Format sub-dialog); absent/unknown → the SPSS
  # default, ascending by value.
  order_opt  <- if (is.null(opts$order)) "ascending" else as.character(opts$order)

  # Single accent colour (kept in sync with the UI theme accent).
  BAR_COLOR    <- "#3b6ea5"
  NORMAL_COLOR <- "#c62828"

  if (length(variables) == 0) {
    sai_error("No variables specified for frequencies analysis")
  }

  # ── Plotly chart builder ─────────────────────────────────────────────────────
  # Builds a hand-constructed Plotly spec { data:[traces], layout:{} } per
  # variable. No ggplot/plotly R packages required — only jsonlite. as.list()
  # forces JSON arrays even for length-1 axes (auto_unbox would otherwise emit
  # a scalar and break Plotly).
  build_chart <- function(raw_vals, var_name, type, normal, chart_w = NULL) {
    valid_vals <- raw_vals[!is.na(raw_vals)]
    if (length(valid_vals) == 0) return(NULL)
    valid_w <- if (is.null(chart_w)) NULL else chart_w[!is.na(raw_vals)]

    layout_base <- list(
      title  = list(text = var_name),
      margin = list(t = 40, r = 20, b = 50, l = 60)
    )

    if (type == "barChart" || type == "pieChart") {
      # Weight Cases: bar/pie counts are weighted sums (SPSS shows weighted
      # frequencies here too). The histogram branch below stays unweighted —
      # Plotly's client-side binning has no per-point weight option.
      if (is.null(valid_w)) {
        freq_tbl <- sort(table(valid_vals), decreasing = TRUE)
        cats     <- names(freq_tbl)
        cnts     <- as.integer(freq_tbl)
      } else {
        agg  <- sort(tapply(valid_w, valid_vals, sum), decreasing = TRUE)
        cats <- names(agg)
        cnts <- round(as.numeric(agg), 6)
      }

      if (type == "barChart") {
        trace <- list(
          type   = "bar",
          x      = as.list(cats),
          y      = as.list(cnts),
          marker = list(color = BAR_COLOR)
        )
        layout <- c(layout_base, list(
          xaxis = list(title = list(text = var_name), type = "category"),
          yaxis = list(title = list(text = "Frequency")),
          bargap = 0.15
        ))
        return(list(data = list(trace), layout = layout))
      }

      # pieChart
      trace <- list(
        type   = "pie",
        labels = as.list(cats),
        values = as.list(cnts),
        textinfo = "label+percent"
      )
      return(list(data = list(trace), layout = layout_base))
    }

    if (type == "histogram") {
      num_vals <- suppressWarnings(as.numeric(valid_vals))
      nv <- num_vals[!is.na(num_vals)]
      if (length(nv) < 2) return(NULL)

      rng      <- range(nv)
      nbins    <- max(1L, nclass.Sturges(nv))
      binwidth <- (rng[2] - rng[1]) / nbins
      if (!is.finite(binwidth) || binwidth <= 0) binwidth <- 1

      hist_trace <- list(
        type    = "histogram",
        x       = as.list(nv),
        marker  = list(color = BAR_COLOR),
        opacity = 0.85,
        name    = "Frequency",
        xbins   = list(start = rng[1], end = rng[2] + binwidth, size = binwidth)
      )
      traces <- list(hist_trace)

      # Overlay a count-scaled normal curve: density * N * binwidth.
      if (isTRUE(normal)) {
        mu    <- mean(nv)
        sigma <- sd(nv)
        if (is.finite(sigma) && sigma > 0) {
          xs <- seq(rng[1], rng[2], length.out = 100)
          ys <- dnorm(xs, mu, sigma) * length(nv) * binwidth
          norm_trace <- list(
            type = "scatter",
            mode = "lines",
            x    = as.list(xs),
            y    = as.list(ys),
            line = list(color = NORMAL_COLOR, width = 2),
            name = "Normal"
          )
          traces <- list(hist_trace, norm_trace)
        }
      }

      layout <- c(layout_base, list(
        xaxis    = list(title = list(text = var_name)),
        yaxis    = list(title = list(text = "Frequency")),
        bargap   = 0.02,
        showlegend = isTRUE(normal)
      ))
      return(list(data = traces, layout = layout))
    }

    NULL
  }

  all_tables <- list()
  all_plots  <- list()
  warn_keys  <- character(0)
  n_vars     <- length(variables)

  # Split File (B2): loop over split groups (a single unlabeled group when no
  # split variable is active — structurally a no-op for the common case).
  # Weight Cases resolves per group, same as descriptives.R.
  split_groups <- get_split_groups(df, params)
  split_name   <- if (!is.null(params$splitVariableName)) params$splitVariableName else params$splitVariable

  for (grp in split_groups) {
    df_g <- grp$df
    .gw  <- get_weights(df_g, params)
    df_g <- .gw$df
    w    <- .gw$w

    for (i in seq_along(variables)) {
      col_id   <- variables[i]
      var_name <- if (!is.null(var_names[[col_id]])) var_names[[col_id]] else col_id
      progress(as.integer(10 + 80 * (i - 1) / n_vars), "progress.computing")

      if (!col_id %in% names(df_g)) {
        sai_error(paste("Column not found in dataset:", col_id))
      }

      raw_vals <- apply_user_missing(df_g[[col_id]], col_id, params)
      n_total  <- if (is.null(w)) length(raw_vals) else sum(w)
      n_miss   <- if (is.null(w)) sum(is.na(raw_vals)) else sum(w[is.na(raw_vals)])
      n_valid  <- n_total - n_miss

      # ── Frequency table ────────────────────────────────────────────────────────
      if (show_table) {
        # Tabulate non-missing values (weighted: each case contributes its
        # weight instead of 1 — SPSS frequency-weight semantics).
        valid_vals <- raw_vals[!is.na(raw_vals)]
        if (is.null(w)) {
          freq_tbl <- table(valid_vals)
          values   <- names(freq_tbl)
          counts   <- as.integer(freq_tbl)
        } else {
          valid_w  <- w[!is.na(raw_vals)]
          agg      <- tapply(valid_w, valid_vals, sum)
          values   <- names(agg)
          counts   <- round(as.numeric(agg), 6)
        }
        # Row order: table()/tapply() already return categories ascending by
        # value — the SPSS default, which Cumulative % depends on. The Format
        # sub-dialog can switch to descending values or count-based ordering
        # (ties keep the value order).
        ord <- switch(order_opt,
          descending = rev(seq_along(values)),
          ascFreq    = order(counts, seq_along(values)),
          descFreq   = order(-counts, seq_along(values)),
          seq_along(values)  # "ascending" or anything unrecognized
        )
        values <- values[ord]
        counts <- counts[ord]
        # Decimals (M2): display each category using the variable's own
        # Variable View precision (no-op for string categories or variables
        # without a decimals spec).
        values <- vapply(values, function(v) format_decimals(v, col_id, params), character(1))

        # Percent of total (including missing)
        pct      <- if (n_total > 0) round(counts / n_total * 100, 1) else rep(0, length(counts))
        # Valid percent (excluding missing)
        valid_pct <- if (n_valid > 0) round(counts / n_valid * 100, 1) else rep(0, length(counts))
        # Cumulative valid percent — accumulated on the UNROUNDED percentages
        # and rounded once, as SPSS does. Summing the already-rounded column
        # let the rounding error pile up: age ended at 100.1 instead of 100.0.
        cum_pct  <- if (n_valid > 0) round(cumsum(counts / n_valid * 100), 1) else rep(0, length(counts))

        freq_rows <- vector("list", length(values))
        for (j in seq_along(values)) {
          freq_rows[[j]] <- list(values[j], counts[j], pct[j], valid_pct[j], cum_pct[j])
        }

        # "Valid Total" row
        valid_total_row <- list(
          "output.freq.validTotal",
          n_valid,
          if (n_total > 0) round(n_valid / n_total * 100, 1) else 0,
          100.0,
          100.0
        )

        # "Missing" block (MV4): when the variable has a user-missing spec,
        # break it down into one row per distinct user-missing value (same
        # weighted-tabulation approach as the Valid block above) plus a
        # "System" row for genuine system-missing — matching SPSS, which
        # never lumps a coded missing value (e.g. 99) and true system-missing
        # into a single "Missing" row. No spec → unchanged single-row
        # behavior (identical to before this change).
        spec <- params$missingValues[[col_id]]
        if (!is.null(spec)) {
          raw_orig <- df_g[[col_id]]
          umask    <- user_missing_mask(raw_orig, col_id, params)
          sys_mask <- is.na(raw_orig)

          if (is.null(w)) {
            user_vals <- raw_orig[umask]
            if (length(user_vals) > 0) {
              u_tbl  <- sort(table(user_vals), decreasing = FALSE)
              u_vals <- names(u_tbl)
              u_cnts <- as.integer(u_tbl)
            } else {
              u_vals <- character(0)
              u_cnts <- integer(0)
            }
            n_sys <- sum(sys_mask)
          } else {
            user_w <- w[umask]
            if (length(user_w) > 0) {
              u_agg  <- sort(tapply(user_w, raw_orig[umask], sum), decreasing = FALSE)
              u_vals <- names(u_agg)
              u_cnts <- round(as.numeric(u_agg), 6)
            } else {
              u_vals <- character(0)
              u_cnts <- numeric(0)
            }
            n_sys <- sum(w[sys_mask])
          }
          u_vals <- vapply(u_vals, function(v) format_decimals(v, col_id, params), character(1))

          missing_rows <- vector("list", length(u_vals))
          for (k in seq_along(u_vals)) {
            cnt <- u_cnts[k]
            missing_rows[[k]] <- list(
              u_vals[k], cnt,
              if (n_total > 0) round(cnt / n_total * 100, 1) else 0,
              NULL, NULL
            )
          }
          missing_rows <- c(missing_rows, list(list(
            "output.freq.system", n_sys,
            if (n_total > 0) round(n_sys / n_total * 100, 1) else 0,
            NULL, NULL
          )))
        } else {
          missing_rows <- list(list(
            "output.freq.missing", n_miss,
            if (n_total > 0) round(n_miss / n_total * 100, 1) else 0,
            NULL, NULL
          ))
        }

        # "Total" row
        total_row <- list(
          "output.freq.total",
          n_total,
          100.0,
          NULL,
          NULL
        )

        all_rows <- c(freq_rows, list(valid_total_row), missing_rows, list(total_row))

        freq_table <- list(
          titleKey    = split_title(
            paste0("output.frequencies.tableTitle:", var_name), split_name, grp$label,
            params$splitValueLabels
          ),
          columns     = list(
            "output.col.value",
            "output.col.frequency",
            "output.col.percent",
            "output.col.validPct",
            "output.col.cumPct"
          ),
          rows        = all_rows,
          footnoteKey = NULL
        )
        all_tables <- c(all_tables, list(freq_table))
      }

      # ── Statistics table ───────────────────────────────────────────────────────
      num_vals <- suppressWarnings(as.numeric(raw_vals))
      # "Cut points for N equal groups" is a number, not a checkbox, so it has
      # to be counted here too — otherwise selecting only cut points produced
      # no Statistics table at all.
      cut_n_req <- suppressWarnings(as.integer(stats_opts$cutPoints))
      has_cut   <- length(cut_n_req) == 1 && !is.na(cut_n_req) && cut_n_req >= 2
      has_stats <- any(unlist(lapply(stats_opts, isTRUE))) || has_cut

      if (has_stats) {
        stat_col_keys  <- list("output.col.statistic", "output.col.value")
        stat_rows <- list()

        # Weight Cases: n_num is the RAW valid-row count (guards "is there any
        # data at all"); n_num_w is the weighted N (Σw) used inside formulas —
        # this is what SPSS calls N under WEIGHT.
        n_num   <- sum(!is.na(num_vals))
        n_num_w <- if (is.null(w)) n_num else sum(w[!is.na(num_vals)])

        # Numeric statistics are only meaningful when EVERY non-missing value
        # survives as.numeric(). SPSS knows the column's declared type and
        # simply leaves the Statistics table blank for a string variable; we
        # only see the coercion, so we detect the same situation from it.
        # Without this guard a mixed column (e.g. "3.4" next to the category
        # "3,4,5") reported a mean/sum computed over just the subset that
        # happened to parse, while the Valid row above still showed the full
        # categorical N — an internally inconsistent table (Sum/Mean did not
        # even agree with each other's N).
        #
        # Deliberate deviation from SPSS (CLAUDE.md §11, "istatistik doğruluğu >
        # SPSS taklidi"): Mode is kept, because it reads `raw_vals` categorically
        # and the most frequent category of a string variable is a perfectly
        # well-defined statistic. SPSS blanks it only because it blanks the
        # whole table.
        if (n_num < sum(!is.na(raw_vals))) {
          n_num <- 0L  # every `n_num > k` guard below now fails → numeric rows omitted
          warn_keys <- c(warn_keys, paste0("output.freq.warnNonNumericStats:", var_name))
        }

        if (isTRUE(stats_opts$mean) && n_num > 0) {
          stat_rows <- c(stat_rows, list(list("output.stat.mean", round(wtd_mean(num_vals, w), 6))))
        }
        if (isTRUE(stats_opts$median) && n_num > 0) {
          stat_rows <- c(stat_rows, list(list("output.stat.median", round(wtd_median(num_vals, w), 6))))
        }
        if (isTRUE(stats_opts$mode)) {
          m <- wtd_mode(raw_vals, w)
          stat_rows <- c(stat_rows, list(list("output.stat.mode", if (is.na(m)) NULL else as.character(m))))
        }
        if (isTRUE(stats_opts$sum) && n_num > 0) {
          stat_rows <- c(stat_rows, list(list("output.stat.sum", round(wtd_sum(num_vals, w), 6))))
        }
        if (isTRUE(stats_opts$sd) && n_num > 1) {
          stat_rows <- c(stat_rows, list(list("output.stat.sd", round(wtd_sd(num_vals, w), 6))))
        }
        if (isTRUE(stats_opts$variance) && n_num > 1) {
          stat_rows <- c(stat_rows, list(list("output.stat.variance", round(wtd_var(num_vals, w), 6))))
        }
        if (isTRUE(stats_opts$range) && n_num > 0) {
          stat_rows <- c(stat_rows, list(list("output.stat.range", round(diff(range(num_vals, na.rm = TRUE)), 6))))
        }
        if (isTRUE(stats_opts$min) && n_num > 0) {
          stat_rows <- c(stat_rows, list(list("output.stat.min", round(min(num_vals, na.rm = TRUE), 6))))
        }
        if (isTRUE(stats_opts$max) && n_num > 0) {
          stat_rows <- c(stat_rows, list(list("output.stat.max", round(max(num_vals, na.rm = TRUE), 6))))
        }
        if (isTRUE(stats_opts$semean) && n_num > 1) {
          stat_rows <- c(stat_rows, list(list("output.stat.seMean",
            round(wtd_sd(num_vals, w) / sqrt(n_num_w), 6))))
        }
        if (isTRUE(stats_opts$cv) && n_num > 1) {
          .cv_mean <- wtd_mean(num_vals, w)
          .cv_val  <- if (is.finite(.cv_mean) && .cv_mean != 0) {
            round(wtd_sd(num_vals, w) / .cv_mean * 100, 6)
          } else {
            NULL
          }
          stat_rows <- c(stat_rows, list(list("output.stat.cv", .cv_val)))
        }
        # Percentile rows are emitted once per distinct percentile: Quartiles
        # ({25,50,75}), the Percentiles list and cut points overlap, and SPSS
        # never repeats a percentile row.
        pct_emitted <- numeric(0)
        if (isTRUE(stats_opts$quartiles) && n_num > 0) {
          q <- wtd_quantile(num_vals, w, probs = c(0.25, 0.50, 0.75))
          stat_rows <- c(stat_rows,
            list(list("output.stat.q1",  round(q[[1]], 6))),
            list(list("output.stat.q2",  round(q[[2]], 6))),
            list(list("output.stat.q3",  round(q[[3]], 6)))
          )
          pct_emitted <- c(pct_emitted, 25, 50, 75)
        }
        # SPSS's "Percentile(s):" list — a free list the user builds by hand.
        # The checkbox alone (no entries) keeps the old fixed default list, so
        # existing saved dialogs/syntax behave exactly as before.
        if (isTRUE(stats_opts$percentiles) && n_num > 0) {
          custom <- unlist(stats_opts$customPercentiles)
          pcts <- if (length(custom) > 0) {
            sort(unique(as.numeric(custom)))
          } else {
            c(5, 10, 25, 50, 75, 90, 95)
          }
          # 0 and 100 are valid percentiles (the minimum and the maximum) and
          # wtd_quantile computes both correctly — weighted included, where the
          # cumulative-weight branches clamp to x[1] / x[n]. The old
          # `> 0 & < 100` filter silently discarded them even though the
          # dialog's own input accepts min=0 max=100, so a user asking for
          # percentile 0 got no row and no explanation.
          pcts <- pcts[is.finite(pcts) & pcts >= 0 & pcts <= 100]
          if (length(pcts) > 0) {
            q <- wtd_quantile(num_vals, w, probs = pcts / 100)
            for (pi in seq_along(pcts)) {
              if (any(abs(pct_emitted - pcts[pi]) < 1e-9)) next
              pct_emitted <- c(pct_emitted, pcts[pi])
              stat_rows <- c(stat_rows,
                list(list(paste0("output.stat.pct", format(pcts[pi], trim = TRUE)),
                          round(q[[pi]], 6))))
            }
          }
        }
        # SPSS's "Cut points for [N] equal groups": the N-1 percentiles that
        # split the distribution into N equally sized groups (N = 4 reproduces
        # the quartiles).
        if (has_cut && n_num > 0) {
          cut_p <- seq_len(cut_n_req - 1L) / cut_n_req
          q     <- wtd_quantile(num_vals, w, probs = cut_p)
          for (pi in seq_along(cut_p)) {
            cp <- round(cut_p[pi] * 100, 4)
            if (any(abs(pct_emitted - cp) < 1e-9)) next
            pct_emitted <- c(pct_emitted, cp)
            stat_rows <- c(stat_rows, list(list(
              paste0("output.stat.pct", format(cp, trim = TRUE)),
              round(q[[pi]], 6))))
          }
        }
        # Distribution (SPSS "Distribution" group): Skewness/Kurtosis, each
        # paired with its Std. Error row — same helpers/formula as Descriptives.
        if (isTRUE(stats_opts$skewness) && n_num > 2) {
          stat_rows <- c(stat_rows,
            list(list("output.stat.skewness", round(wtd_skewness(num_vals, w), 6))),
            list(list("output.stat.seSkew",   round(se_skewness(n_num_w), 6))))
        }
        if (isTRUE(stats_opts$kurtosis) && n_num > 3) {
          stat_rows <- c(stat_rows,
            list(list("output.stat.kurtosis", round(wtd_kurtosis(num_vals, w), 6))),
            list(list("output.stat.seKurt",   round(se_kurtosis(n_num_w), 6))))
        }

        # Always include N and Missing counts
        stat_rows <- c(
          list(
            list("output.stat.nValid",   n_valid),
            list("output.stat.nMissing", n_miss)
          ),
          stat_rows
        )

        if (length(stat_rows) > 0) {
          stats_table <- list(
            titleKey    = split_title(
              paste0("output.frequencies.statsTitle:", var_name), split_name, grp$label,
              params$splitValueLabels
            ),
            columns     = stat_col_keys,
            rows        = stat_rows,
            footnoteKey = NULL
          )
          all_tables <- c(all_tables, list(stats_table))
        }
      }

      # ── Chart ────────────────────────────────────────────────────────────────────
      if (!is.null(chart_type) && chart_type != "none") {
        spec <- build_chart(raw_vals, var_name, chart_type, show_normal, chart_w = w)
        if (!is.null(spec)) {
          all_plots <- c(all_plots, list(list(
            titleKey = split_title(
              paste0("output.frequencies.chartTitle:", var_name), split_name, grp$label,
              params$splitValueLabels
            ),
            type     = "plotly",
            data     = spec
          )))
        }
      }
    }
  }

  progress(100L, "progress.done")
  sai_output(tables = all_tables, plots = all_plots, warnings = unique(warn_keys))

}, error = function(e) {
  sai_error(conditionMessage(e))
})
