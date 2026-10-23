# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# roc-analysis.R — ROC Analysis (SPSS 26+ style, single-classifier mode).
# Analyze → Classify → ROC Analysis.
#
# Unlike the classic ROC Curve procedure (roc.R), this adds a Precision-Recall
# curve (with SPSS's two interpolation schemes), an Overall Model Quality
# chart, Precision-Recall coordinate points and per-cutoff classifier
# evaluation metrics (Sensitivity, Specificity, PPV, NPV, Youden's J) alongside
# the AUC table. The ROC arithmetic itself is shared with roc.R through
# _bootstrap.R (roc_compute and friends).
#
# RA4 (spss-parity-findings-2026-07-07 §B5): when 2+ test variables share the
# same state variable/cases (a paired design by construction — every
# classifier is evaluated on the same subjects), an "AUC Comparisons" table
# adds pairwise DeLong tests via pROC::roc.test(method="delong") — the
# standard, battle-tested implementation of DeLong, DeLong & Clarke-Pearson
# (1988)'s nonparametric covariance method; not hand-rolled (CLAUDE.md §11).
# Independent-groups design (different subjects per classifier) is a
# different sample structure this dialog doesn't collect — out of scope.
#
# Params: variables (character vector of test-variable colIds), varNames,
#         stateVar (colId), stateName, stateValue (positive/event value),
#         options:
#           Options sub-dialog: cutoff 'include'|'exclude', direction
#             'larger'|'smaller', distribution 'free'|'negexpo', ciLevel
#             (0-1, default 0.95), userMissingValid (boolean)
#           Display sub-dialog: plotCurve (default TRUE), diagonal (default
#             TRUE), prCurve, prInterp 'tp'|'fp', modelQuality, seCi (default
#             TRUE), coordinates, prCoordinates, metrics, compareAuc (RA4)

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

# Precision-Recall points between consecutive cutoffs. Precision is not
# linear between two ROC points, so joining them with a straight line in PR
# space overstates the area (Davis & Goadrich 2006). The segment is linear in
# (TP, FP) space instead; SPSS offers stepping it one true positive at a time
# ("along the true positives") or one false positive at a time. Steps are
# capped per segment so a heavily weighted table cannot explode the plot.
pr_interpolate <- function(tp, fp, along) {
  rec_tp <- tp[1]; rec_fp <- fp[1]
  for (i in seq_len(length(tp) - 1L)) {
    dtp <- tp[i + 1L] - tp[i]; dfp <- fp[i + 1L] - fp[i]
    m <- ceiling(if (along == "fp") dfp else dtp)
    m <- min(max(m, 1), 200)
    k <- seq_len(m) / m
    rec_tp <- c(rec_tp, tp[i] + dtp * k)
    rec_fp <- c(rec_fp, fp[i] + dfp * k)
  }
  list(tp = rec_tp, fp = rec_fp)
}

tryCatch({
  progress(10L, "progress.loading")

  vars      <- unlist(params$variables)
  var_names <- if (is.null(params$varNames)) list() else params$varNames
  sv        <- params$stateVar
  opts      <- if (is.null(params$options)) list() else params$options
  o         <- roc_read_options(opts)
  want_plot     <- !isFALSE(opts$plotCurve)
  want_diag     <- !isFALSE(opts$diagonal)
  want_pr       <- isTRUE(opts$prCurve)
  pr_along      <- if (identical(opts$prInterp, "fp")) "fp" else "tp"
  want_quality  <- isTRUE(opts$modelQuality)
  want_se       <- !isFALSE(opts$seCi)
  want_coords   <- isTRUE(opts$coordinates)
  want_pr_coord <- isTRUE(opts$prCoordinates)
  want_metrics  <- isTRUE(opts$metrics)
  pos_val <- as.character(params$stateValue)
  ci_pct  <- as.character(round_half_up(o$ci_level * 100, 4))

  if (length(vars) == 0) sai_error("No test variables specified")

  # Listwise across every test variable and the state variable, as SPSS does
  # ("Valid N (listwise)") — which is also what makes the paired DeLong
  # comparison below valid: every classifier is scored on the same cases.
  prep <- roc_prepare(df, vars, sv, params, o)
  positive <- prep$s == pos_val

  stats <- list(); nms <- list()
  metric_tables <- list()
  pr_curves <- list(); pr_auc_rows <- list()
  notes <- character(0)

  for (idx in seq_along(vars)) {
    v  <- vars[idx]
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    x  <- prep$x[[v]]
    if (o$direction == "smaller") x <- -x
    r  <- roc_compute(x, positive, prep$w, o)
    stats[[idx]] <- r; nms[[idx]] <- nm
    np <- r$np; nn <- r$nn; tp <- r$tp; fp <- r$fp
    sens <- tp / np; spec <- 1 - fp / nn
    precision <- ifelse(tp + fp == 0, NA_real_, tp / (tp + fp))
    cut_disp  <- roc_display_cutoff(r$cutoffs, o)

    if (want_pr) {
      ip  <- pr_interpolate(tp, fp, pr_along)
      rec <- ip$tp / np
      # The (0, 0) start has no precision (0/0); SPSS anchors it at 1, and
      # so do the PR coordinates table and this curve.
      pre <- roc_precision(ip$tp, ip$fp)
      col <- roc_palette[((idx - 1) %% length(roc_palette)) + 1]
      pr_curves[[length(pr_curves) + 1L]] <- list(
        type = "scatter", mode = "lines", name = nm,
        x = as.list(rec), y = as.list(pre), line = list(color = col))
      # Area under the interpolated PR curve (trapezoids over recall), with
      # the no-skill baseline (= prevalence) it should be read against.
      pr_auc <- sum(diff(rec) * (head(pre, -1) + tail(pre, -1)) / 2)
      pr_auc_rows[[length(pr_auc_rows) + 1L]] <- list(nm, round_half_up(pr_auc, 3),
                                                      round_half_up(np / (np + nn), 3))
    }

    if (want_metrics) {
      youden <- sens + spec - 1
      best_i <- which.max(youden)
      metric_rows <- lapply(roc_cut_order(r, o), function(i) {
        npv_den <- nn - fp[i] + (np - tp[i])
        list(round_half_up(cut_disp[i], 4), round_half_up(sens[i], 4), round_half_up(spec[i], 4),
             if (is.na(precision[i])) NULL else round_half_up(precision[i], 4),
             if (npv_den == 0) NULL else round_half_up((nn - fp[i]) / npv_den, 4),
             round_half_up(youden[i], 4))
      })
      metric_tables[[length(metric_tables) + 1L]] <- list(
        titleKey = paste0("output.rocAnalysis.metricsTitle:", nm),
        columns = list(roc_cutoff_col(o), "output.col.sensitivity",
                       "output.col.specificity", "output.col.ppv", "output.col.npv",
                       "output.col.youdenJ"),
        rows = metric_rows,
        footnoteKey = paste0("output.rocAnalysis.metricsFootnote:", cut_disp[best_i]))
      if (np / (np + nn) < 0.1) {
        notes <- c(notes, paste0("output.rocAnalysis.imbalanceNote:", nm))
      }
    }
  }

  plots <- list()
  if (want_plot) plots <- c(plots, list(roc_curve_plot(stats, nms, roc_palette, want_diag)))

  if (want_pr) {
    pr_layout <- list(
      xaxis = list(title = list(text = "Recall"), range = list(0, 1)),
      yaxis = list(title = list(text = "Precision"), range = list(0, 1)),
      margin = list(t = 40, r = 20, b = 40, l = 60))
    plots <- c(plots, list(list(
      titleKey = "output.rocAnalysis.prCurveTitle",
      type = "plotly", data = list(data = pr_curves, layout = pr_layout))))
  }

  # Overall Model Quality: SPSS's bar of the lower confidence bound of the
  # area — a classifier whose bound clears 0.5 beats guessing at this
  # confidence level. Falls back to the area itself when no SE exists
  # (a group of a single case).
  if (want_quality) {
    lower <- vapply(stats, function(r) if (is.na(r$lo)) r$auc else r$lo, numeric(1))
    plots <- c(plots, list(list(
      titleKey = "output.rocAnalysis.modelQualityTitle",
      type = "plotly",
      data = list(
        data = list(list(
          type = "bar", orientation = "h",
          x = as.list(round_half_up(lower, 3)), y = as.list(unlist(nms)),
          marker = list(color = ifelse(lower > 0.5, "#3f9142", "#c94040")))),
        layout = list(
          xaxis = list(title = list(text = paste0("AUC ", ci_pct, "% lower bound")),
                       range = list(0, 1)),
          yaxis = list(automargin = TRUE),
          shapes = list(list(type = "line", x0 = 0.5, x1 = 0.5, y0 = 0, y1 = 1,
                             yref = "paper", line = list(color = "#888", dash = "dash"))),
          margin = list(t = 40, r = 20, b = 40, l = 60))))))
    notes <- c(notes, paste0("output.rocAnalysis.modelQualityNote:", ci_pct))
  }

  # RA4: pairwise DeLong AUC comparison (2+ test variables, paired design —
  # every classifier shares the same state variable/subjects). Requires
  # `pROC` (not hand-rolled DeLong covariance, CLAUDE.md §11) and is skipped
  # honestly (with a note, not silently) when weighting is active — pROC's
  # DeLong implementation has no case-weight support, unlike this script's
  # own weighted AUC above.
  compare_tables <- list()
  if (isTRUE(opts$compareAuc) && length(vars) >= 2) {
    if (!is.null(prep$w)) {
      notes <- c(notes, "output.rocAnalysis.compareAucNoWeight")
    } else if (!requireNamespace("pROC", quietly = TRUE)) {
      notes <- c(notes, "output.rocAnalysis.compareAucNoPackage")
    } else {
      resp <- ifelse(positive, "case", "control")
      pdir <- if (o$direction == "smaller") ">" else "<"
      cmp_rows <- list()
      for (a in seq_len(length(vars) - 1)) for (b in (a + 1):length(vars)) {
        roc_a <- tryCatch(pROC::roc(response = resp, predictor = prep$x[[vars[a]]],
                                    levels = c("control", "case"), direction = pdir,
                                    quiet = TRUE), error = function(e) NULL)
        roc_b <- tryCatch(pROC::roc(response = resp, predictor = prep$x[[vars[b]]],
                                    levels = c("control", "case"), direction = pdir,
                                    quiet = TRUE), error = function(e) NULL)
        if (is.null(roc_a) || is.null(roc_b)) next
        rt <- tryCatch(pROC::roc.test(roc_a, roc_b, method = "delong", paired = TRUE,
                                      conf.level = o$ci_level),
                       error = function(e) NULL)
        if (is.null(rt)) next
        cmp_rows <- c(cmp_rows, list(list(
          nms[[a]], nms[[b]], round_half_up(unname(rt$estimate[1] - rt$estimate[2]), 4),
          round_half_up(unname(rt$statistic), 4), round_half_up(rt$p.value, 6),
          round_half_up(rt$conf.int[1], 4), round_half_up(rt$conf.int[2], 4))))
      }
      if (length(cmp_rows) > 0) {
        compare_tables <- list(list(
          titleKey = "output.rocAnalysis.compareTitle",
          columns = list("output.col.variable1", "output.col.variable2",
                         "output.col.aucDifference", "output.col.z", "output.col.asympSig",
                         paste0("output.col.ciLowerPct:", ci_pct),
                         paste0("output.col.ciUpperPct:", ci_pct)),
          rows = cmp_rows,
          footnoteKey = "output.rocAnalysis.compareFootnote"))
      }
    }
  }

  pr_auc_tables <- if (length(pr_auc_rows) > 0) list(list(
    titleKey = "output.rocAnalysis.prAucTitle",
    columns = list("output.col.variable", "output.col.area", "output.col.prBaseline"),
    rows = pr_auc_rows,
    footnoteKey = "output.rocAnalysis.prAucFootnote")) else list()

  cps <- roc_case_summary(params, sv, stats[[1]]$np, stats[[1]]$nn, prep$n_missing, pos_val, o)
  coord_tables <- if (want_coords)
    list(roc_coord_table(stats, nms, o, "output.rocAnalysis.coordsTitle")) else list()
  # SPSS: Precision before Recall, same row order and footnote as the ROC table.
  pr_coord_tables <- if (want_pr_coord) list(roc_coord_block(
    stats, nms, o, "output.rocAnalysis.prCoordsTitle",
    list("output.col.precision", "output.col.recall"),
    function(r, i) list(round_half_up(roc_precision(r$tp[i], r$fp[i]), 3), round_half_up(r$tp[i] / r$np, 3))))
    else list()

  progress(100L, "progress.done")
  sai_output(
    tables = c(list(cps, roc_auc_table(stats, nms, want_se, ci_pct, o, "output.rocAnalysis.aucTitle")), pr_auc_tables,
               coord_tables, pr_coord_tables, metric_tables, compare_tables),
    plots = plots,
    notes = c(roc_common_notes(stats, nms, want_se, ci_pct, o), notes)
  )
}, error = function(e) sai_error(conditionMessage(e)))
