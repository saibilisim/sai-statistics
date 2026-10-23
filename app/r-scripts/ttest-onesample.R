# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# ttest-onesample.R — One-Sample T Test (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir — directory containing _bootstrap.R
#   variables   — character vector of test-variable colIds
#   varNames    — named list colId → display name
#   testValue   — number to test the mean against (default 0)
#
# Output: "One-Sample Statistics" (N, Mean, SD, SE Mean) and "One-Sample Test"
#         (t, df, Sig. 2-tailed, Mean Difference, 95% CI of the Difference).

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
  mu        <- if (is.null(params$testValue)) 0 else as.numeric(params$testValue)
  if (length(vars) == 0) sai_error("No test variables specified")

  # Missing Values (MV): "Exclude cases listwise" drops a case if ANY test
  # variable is missing, so every variable in this run uses the same N. Must
  # run before get_weights() so the weight vector stays aligned to df's rows.
  df <- apply_listwise(df, vars, params)

  # Weight Cases (W1): N/mean/sd/seMean, the t-test itself, and the effect
  # size all use weighted N/mean/variance (SPSS frequency-weight semantics).
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  stats_rows  <- list()
  test_rows   <- list()
  effect_rows <- list()
  boot_rows   <- list()
  cnt <- function(x) format_wtd_count(x, w)

  for (v in vars) {
    if (!v %in% names(df)) sai_error(paste("Column not found:", v))
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    x_all <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params)))
    keep  <- !is.na(x_all)
    x  <- x_all[keep]
    wv <- if (is.null(w)) NULL else w[keep]
    n  <- length(x)
    if (n < 2) next

    n_disp <- if (is.null(wv)) n else sum(wv)
    m  <- wtd_mean(x, wv); s <- wtd_sd(x, wv); se <- s / sqrt(n_disp)
    stats_rows <- c(stats_rows, list(list(
      nm, cnt(n_disp), round(m, 6), round(s, 6), round(se, 6))))

    tt    <- wtd_t_one(x, wv, mu = mu)
    mdiff <- m - mu
    test_rows <- c(test_rows, list(list(
      nm,
      round(tt$statistic, 6),
      round(tt$parameter, 3),
      round(tt$p.value, 6),
      round(mdiff, 6),
      round(tt$conf.int[1] - mu, 6),
      round(tt$conf.int[2] - mu, 6))))

    d  <- mdiff / s
    J  <- 1 - 3 / (4 * (n_disp - 1) - 1)
    sed <- sqrt(1 / n_disp + d^2 / (2 * (n_disp - 1)))
    effect_rows <- c(effect_rows,
      list(list(nm, "output.col.cohensD", round(s, 6), round(d, 4),
                round(d - qnorm(0.975) * sed, 4), round(d + qnorm(0.975) * sed, 4))),
      list(list("", "output.col.hedgesG", round(s / J, 6), round(d * J, 4),
                round(d * J - qnorm(0.975) * sed, 4), round(d * J + qnorm(0.975) * sed, 4))))

    # Bootstrapping (BOOT1): bootstrap the mean (case-replication handles an
    # active integer weight — see sai_bootstrap()'s contract).
    boot_df <- data.frame(x = x)
    boot_out <- sai_bootstrap(
      boot_df,
      function(data, indices) c(mean = mean(data$x[indices])),
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

  progress(80L, "progress.computing")

  tables <- list(
    list(
      titleKey    = "output.ttest1.statsTitle",
      columns     = list("output.col.variable", "output.col.n", "output.col.mean",
                         "output.col.stdDeviation", "output.col.seMean"),
      rows        = stats_rows,
      footnoteKey = NULL
    ),
    list(
      titleKey    = paste0("output.ttest1.testTitle:", mu),
      columns     = list("output.col.variable", "output.col.t", "output.col.df",
                         "output.col.sigTwoTailed", "output.col.meanDiff",
                         "output.col.ciLower95", "output.col.ciUpper95"),
      rows        = test_rows,
      footnoteKey = NULL
    ),
    list(
      titleKey    = "output.ttest1.effectTitle",
      columns     = list("output.col.variable", "", "output.col.standardizer",
                         "output.col.pointEstimate", "output.col.ciLower95",
                         "output.col.ciUpper95"),
      rows        = effect_rows,
      footnoteKey = "output.ttest.effectFootnote"
    )
  )

  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.meanTitle",
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
