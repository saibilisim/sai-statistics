# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# ttest-paired.R — Paired-Samples T Test (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir — directory containing _bootstrap.R
#   var1        — character vector of first-of-pair colIds
#   var2        — character vector of second-of-pair colIds (zipped with var1)
#   varNames    — named list colId → display name
#   options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1): bootstraps
#     the mean of the paired difference (x - y), same sai_bootstrap() pattern
#     as ttest-onesample.R.
#
# Output: "Paired Samples Statistics", "Paired Samples Correlations" and
#         "Paired Samples Test" (paired differences + t, df, Sig. 2-tailed).

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

  v1        <- unlist(params$var1)
  v2        <- unlist(params$var2)
  var_names <- params$varNames
  npairs    <- min(length(v1), length(v2))
  if (npairs == 0) sai_error("No variable pairs specified")

  # Missing Values (MV): listwise drops a case if ANY variable across ALL
  # pairs is missing (not just the current pair) — must run before
  # get_weights() so the weight vector stays aligned to df's rows.
  df <- apply_listwise(df, unique(c(v1, v2)), params)

  # Weight Cases (W1): N/mean/sd/seMean, the correlation, the paired t-test,
  # and the effect size all use weighted N/mean/variance.
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  nm_of <- function(c) resolve_var_name(c, var_names)
  cnt   <- function(x) if (is.null(w)) as.integer(x) else round(x, 6)

  stats_rows  <- list()
  corr_rows   <- list()
  test_rows   <- list()
  effect_rows <- list()
  boot_rows   <- list()

  for (i in seq_len(npairs)) {
    a <- v1[i]; b <- v2[i]
    if (!a %in% names(df) || !b %in% names(df)) sai_error("Pair column not found")
    na <- nm_of(a); nb <- nm_of(b)
    pair_lbl <- paste0(na, " - ", nb)

    xa <- suppressWarnings(as.numeric(apply_user_missing(df[[a]], a, params)))
    xb <- suppressWarnings(as.numeric(apply_user_missing(df[[b]], b, params)))
    ok <- !is.na(xa) & !is.na(xb)
    x  <- xa[ok]; y <- xb[ok]
    wv <- if (is.null(w)) NULL else w[ok]
    n  <- length(x)
    if (n < 2) next
    n_disp <- if (is.null(wv)) n else sum(wv)

    stats_rows <- c(stats_rows,
      list(list(na, round(wtd_mean(x, wv), 6), cnt(n_disp), round(wtd_sd(x, wv), 6),
                round(wtd_sd(x, wv) / sqrt(n_disp), 6))),
      list(list(nb, round(wtd_mean(y, wv), 6), cnt(n_disp), round(wtd_sd(y, wv), 6),
                round(wtd_sd(y, wv) / sqrt(n_disp), 6))))

    r <- wtd_cor_test(x, y, wv)
    corr_rows <- c(corr_rows, list(list(
      pair_lbl, cnt(n_disp), round(r$estimate, 6), round(r$p.value, 6))))

    d   <- x - y
    md  <- wtd_mean(d, wv); sdd <- wtd_sd(d, wv); sed <- sdd / sqrt(n_disp)
    tt  <- wtd_t_one(d, wv, mu = 0)
    test_rows <- c(test_rows, list(list(
      pair_lbl, round(md, 6), round(sdd, 6), round(sed, 6),
      round(tt$conf.int[1], 6), round(tt$conf.int[2], 6),
      round(tt$statistic, 6), round(tt$parameter, 3),
      round(tt$p.value, 6))))

    dd  <- md / sdd
    J   <- 1 - 3 / (4 * (n_disp - 1) - 1)
    sedd <- sqrt(1 / n_disp + dd^2 / (2 * (n_disp - 1)))
    effect_rows <- c(effect_rows,
      list(list(pair_lbl, "output.col.cohensD", round(sdd, 6), round(dd, 4),
                round(dd - qnorm(0.975) * sedd, 4), round(dd + qnorm(0.975) * sedd, 4))),
      list(list("", "output.col.hedgesG", round(sdd / J, 6), round(dd * J, 4),
                round(dd * J - qnorm(0.975) * sedd, 4), round(dd * J + qnorm(0.975) * sedd, 4))))

    # Bootstrapping (BOOT2): bootstrap the mean of the paired difference.
    boot_df <- data.frame(d = d)
    boot_out <- sai_bootstrap(
      boot_df,
      function(data, indices) c(mean = mean(data$d[indices])),
      params, weight = wv
    )
    if (!is.null(boot_out)) {
      for (r2 in boot_out) {
        boot_rows <- c(boot_rows, list(list(
          pair_lbl, round(r2$estimate, 6), round(r2$bias, 6), round(r2$se, 6),
          round(r2$ci_lower, 6), round(r2$ci_upper, 6))))
      }
    }
  }

  if (length(test_rows) == 0) sai_error("Not enough paired data")
  progress(80L, "progress.computing")

  tables <- list(
    list(
      titleKey    = "output.ttestPaired.statsTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.col.n",
                         "output.col.stdDeviation", "output.col.seMean"),
      rows        = stats_rows,
      footnoteKey = NULL
    ),
    list(
      titleKey    = "output.ttestPaired.corrTitle",
      columns     = list("output.col.variable", "output.col.n",
                         "output.col.correlation", "output.col.sig"),
      rows        = corr_rows,
      footnoteKey = NULL
    ),
    list(
      titleKey    = "output.ttestPaired.testTitle",
      columns     = list("output.col.variable", "output.col.mean",
                         "output.col.stdDeviation", "output.col.seMean",
                         "output.col.ciLower95", "output.col.ciUpper95",
                         "output.col.t", "output.col.df", "output.col.sigTwoTailed"),
      rows        = test_rows,
      footnoteKey = NULL
    ),
    list(
      titleKey    = "output.ttestPaired.effectTitle",
      columns     = list("output.col.variable", "", "output.col.standardizer",
                         "output.col.pointEstimate", "output.col.ciLower95",
                         "output.col.ciUpper95"),
      rows        = effect_rows,
      footnoteKey = "output.ttest.effectFootnote"
    )
  )

  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.pairedDiffTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.bootstrap.bias",
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
