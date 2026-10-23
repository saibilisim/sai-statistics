# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# ttest-independent.R — Independent-Samples T Test (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir — directory containing _bootstrap.R
#   variables   — character vector of test-variable colIds
#   varNames    — named list colId → display name
#   groupVar    — grouping-variable colId
#   groupName   — display name of the grouping variable
#   group1      — value defining group 1
#   group2      — value defining group 2
#   options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1): bootstraps
#     the mean difference via simple case-resampling of the pooled (x, group)
#     rows, same sai_bootstrap() helper/contract as ttest-onesample.R.
#
# Output: "Group Statistics" and "Independent Samples Test" (Levene's test for
#         equality of variances + t-test with equal/unequal variance rows).

suppressPackageStartupMessages(library(jsonlite))

.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

params <- read_params()
df     <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  vars      <- unlist(params$variables)
  var_names <- params$varNames
  gvar      <- params$groupVar
  gname     <- if (is.null(params$groupName)) gvar else params$groupName
  g1        <- as.character(params$group1)
  g2        <- as.character(params$group2)

  if (length(vars) == 0) sai_error("No test variables specified")
  if (is.null(gvar) || !gvar %in% names(df)) sai_error("Grouping variable not found")

  # Missing Values (MV): listwise drops a case if ANY test variable or the
  # grouping variable is missing. Must run before get_weights() so the
  # weight vector stays aligned to df's rows.
  df <- apply_listwise(df, c(vars, gvar), params)

  # Weight Cases (W1): group N/mean/sd/seMean, Levene's test, the t-test
  # itself, and the effect-size pooled SD all become weighted (SPSS
  # frequency-weight semantics, W = sum(w) in place of case count).
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  # Levene's test for equality of variances (mean-based, as in SPSS): one-way
  # ANOVA on the absolute deviations from each group mean. Weighted: each
  # group's SS uses its weighted mean and Σw in place of length()/mean().
  levene <- function(x, g, wt = NULL) {
    if (is.null(wt)) {
      z <- abs(x - ave(x, g, FUN = mean))
    } else {
      grp_means <- tapply(seq_along(x), g, function(idx) wtd_mean(x[idx], wt[idx]))
      z <- abs(x - grp_means[as.character(g)])
    }
    grp <- factor(g)
    k   <- nlevels(grp)
    n   <- if (is.null(wt)) length(z) else sum(wt)
    if (k < 2 || n <= k) return(list(F = NA_real_, p = NA_real_))
    zbar <- wtd_mean(z, wt)
    if (is.null(wt)) {
      ssb <- sum(tapply(z, grp, function(v) length(v) * (mean(v) - zbar)^2))
      ssw <- sum(tapply(z, grp, function(v) sum((v - mean(v))^2)))
    } else {
      idx_by_g <- split(seq_along(z), grp)
      ssb <- sum(vapply(idx_by_g, function(idx) {
        sum(wt[idx]) * (wtd_mean(z[idx], wt[idx]) - zbar)^2
      }, numeric(1)))
      ssw <- sum(vapply(idx_by_g, function(idx) {
        sum(wt[idx] * (z[idx] - wtd_mean(z[idx], wt[idx]))^2)
      }, numeric(1)))
    }
    dfb  <- k - 1; dfw <- n - k
    Fv   <- (ssb / dfb) / (ssw / dfw)
    list(F = Fv, p = pf(Fv, dfb, dfw, lower.tail = FALSE))
  }

  stats_rows  <- list()
  test_rows   <- list()
  effect_rows <- list()
  boot_rows   <- list()

  gcol_all <- as.character(apply_user_missing(df[[gvar]], gvar, params))
  cnt <- function(x) format_wtd_count(x, w)

  for (v in vars) {
    if (!v %in% names(df)) sai_error(paste("Column not found:", v))
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    xv <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params)))

    keep <- !is.na(xv) & (gcol_all == g1 | gcol_all == g2)
    x <- xv[keep]; g <- gcol_all[keep]
    wv <- if (is.null(w)) NULL else w[keep]
    x1 <- x[g == g1]; x2 <- x[g == g2]
    w1 <- if (is.null(wv)) NULL else wv[g == g1]
    w2 <- if (is.null(wv)) NULL else wv[g == g2]
    if (length(x1) < 2 || length(x2) < 2) next

    for (gg in list(list(g1, x1, w1), list(g2, x2, w2))) {
      lab <- gg[[1]]; xs <- gg[[2]]; ws <- gg[[3]]
      n_disp <- if (is.null(ws)) length(xs) else sum(ws)
      # SPSS shows the group's own value label (e.g. "Female") under a column
      # headed by the grouping variable's name — not "groupingVar = 1" — so the
      # cell resolves the raw value against the same colId -> label map
      # resolve_var_name() already uses for variable names (params$groupValueLabels
      # is a value->label map here, not colId->name, but the lookup shape matches).
      stats_rows <- c(stats_rows, list(list(
        nm, resolve_var_name(lab, params$groupValueLabels), cnt(n_disp),
        round(wtd_mean(xs, ws), 6), round(wtd_sd(xs, ws), 6),
        round(wtd_sd(xs, ws) / sqrt(n_disp), 6))))
    }

    lev <- levene(x, g, wv)
    tt_eq <- wtd_t_two(x1, w1, x2, w2, var_equal = TRUE)
    tt_we <- wtd_t_two(x1, w1, x2, w2, var_equal = FALSE)
    mdiff <- tt_eq$estimate[1] - tt_eq$estimate[2]

    test_rows <- c(test_rows, list(list(
      nm, "output.col.equalAssumed",
      round(lev$F, 6), round(lev$p, 6),
      round(tt_eq$statistic, 6), round(tt_eq$parameter, 3),
      round(tt_eq$p.value, 6), round(mdiff, 6),
      round(tt_eq$stderr, 6),
      round(tt_eq$conf.int[1], 6), round(tt_eq$conf.int[2], 6))))
    test_rows <- c(test_rows, list(list(
      "", "output.col.equalNotAssumed",
      NULL, NULL,
      round(tt_we$statistic, 6), round(tt_we$parameter, 3),
      round(tt_we$p.value, 6), round(mdiff, 6),
      round(tt_we$stderr, 6),
      round(tt_we$conf.int[1], 6), round(tt_we$conf.int[2], 6))))

    n1 <- tt_eq$n1; n2 <- tt_eq$n2
    pooled <- sqrt(((n1 - 1) * tt_eq$var1 + (n2 - 1) * tt_eq$var2) / (n1 + n2 - 2))
    d   <- mdiff / pooled
    J   <- 1 - 3 / (4 * (n1 + n2) - 9)
    sed <- sqrt((n1 + n2) / (n1 * n2) + d^2 / (2 * (n1 + n2)))
    effect_rows <- c(effect_rows,
      list(list(nm, "output.col.cohensD", round(pooled, 6), round(d, 4),
                round(d - qnorm(0.975) * sed, 4), round(d + qnorm(0.975) * sed, 4))),
      list(list("", "output.col.hedgesG", round(pooled / J, 6), round(d * J, 4),
                round(d * J - qnorm(0.975) * sed, 4), round(d * J + qnorm(0.975) * sed, 4))))

    # Bootstrapping (BOOT2): simple case-resampling of the pooled (x, g) rows
    # — SPSS's own default sampling method — then the mean difference on each
    # resample. Integer-weight case-replication handled by sai_bootstrap()
    # itself (weight param); a resampled row keeps its own group label, so
    # weighting and grouping stay consistent together.
    boot_df <- data.frame(x = x, g = g, stringsAsFactors = FALSE)
    boot_out <- sai_bootstrap(
      boot_df,
      function(data, indices) {
        d <- data[indices, , drop = FALSE]
        c(diff = mean(d$x[d$g == g1]) - mean(d$x[d$g == g2]))
      },
      params, weight = wv
    )
    if (!is.null(boot_out)) {
      for (r in boot_out) {
        boot_rows <- c(boot_rows, list(list(
          nm, round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
          round(r$ci_lower, 6), round(r$ci_upper, 6))))
      }
    }
  }

  if (length(test_rows) == 0) sai_error("Not enough data in the two groups")
  progress(80L, "progress.computing")

  tables <- list(
    list(
      # Title and the group column's own header name the grouping variable —
      # SPSS shows the same info via the column header alone (e.g. "Participant
      # sex"); doing both here makes it unambiguous which variable was used to
      # split the sample even when only the title is visible (collapsed table).
      titleKey    = paste0("output.ttestInd.groupStatsTitle:", gname),
      columns     = list("output.col.variable", gname, "output.col.n",
                         "output.col.mean", "output.col.stdDeviation", "output.col.seMean"),
      rows        = stats_rows,
      footnoteKey = NULL
    ),
    list(
      titleKey    = paste0("output.ttestInd.testTitle:", gname),
      columns     = list("output.col.variable", "", "output.col.leveneF",
                         "output.col.leveneSig", "output.col.t", "output.col.df",
                         "output.col.sigTwoTailed", "output.col.meanDiff",
                         "output.col.seDiff", "output.col.ciLower95", "output.col.ciUpper95"),
      rows        = test_rows,
      footnoteKey = "output.ttestInd.leveneFootnote"
    ),
    list(
      titleKey    = "output.ttestInd.effectTitle",
      columns     = list("output.col.variable", "", "output.col.standardizer",
                         "output.col.pointEstimate", "output.col.ciLower95",
                         "output.col.ciUpper95"),
      rows        = effect_rows,
      footnoteKey = "output.ttest.effectFootnote"
    )
  )

  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.diffTitle",
      columns     = list("output.col.variable", "output.col.meanDiff", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
