# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# correlation-partial.R — Partial Correlations (SPSS-style, Pearson).
#
# Params (from JSON):
#   rScriptsDir — directory containing _bootstrap.R
#   variables   — character vector of colIds to correlate
#   controls    — character vector of control (covariate) colIds
#   varNames    — named list colId → display name
#   options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1): bootstraps
#     each variable-pair's partial correlation via case-resampling of the
#     complete-case matrix (re-regressing out the controls on every resample,
#     not just resampling the precomputed residuals — the correct nonparametric
#     bootstrap for a regression-derived statistic).
#
# Output: a "Correlations" matrix controlling for the covariates, with
#         Correlation / Significance (2-tailed) / df stacked per variable.
#         Cases are handled listwise across variables + controls (as in SPSS).

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
  controls  <- if (is.null(params$controls)) character(0) else unlist(params$controls)
  var_names <- params$varNames
  if (length(vars) < 2) sai_error("Partial correlation needs at least two variables")
  if (length(controls) == 0) sai_error("Partial correlation needs at least one control variable")

  nm_of <- function(c) resolve_var_name(c, var_names)
  names_vec <- vapply(vars, nm_of, character(1), USE.NAMES = FALSE)
  k <- length(controls)

  # Listwise complete cases across the variables and the controls.
  all_ids <- c(vars, controls)
  mat <- sapply(all_ids, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  n   <- nrow(mat)
  dfree <- n - 2 - k
  if (dfree < 1) sai_error("Not enough complete cases for partial correlation")

  Z <- mat[, controls, drop = FALSE]
  zdf <- as.data.frame(Z)
  # Residual of each variable after regressing out the controls.
  resid_of <- function(v) residuals(lm(mat[, v] ~ ., data = zdf))
  resids <- lapply(vars, resid_of)
  names(resids) <- vars

  cols_hdr <- c("", "", names_vec)
  out_rows <- list()
  boot_rows <- list()
  kk <- length(vars)
  mat_df <- as.data.frame(mat)
  for (i in seq_len(kk)) {
    corr_row <- list(names_vec[i], "output.col.pearsonCorr")
    sig_row  <- list("", "output.col.sigTwoTailed")
    df_row   <- list("", "output.col.df")
    for (j in seq_len(kk)) {
      if (i == j) {
        corr_row <- c(corr_row, list(1)); sig_row <- c(sig_row, list(""))
        df_row <- c(df_row, list(0L))
      } else {
        r <- suppressWarnings(cor(resids[[i]], resids[[j]]))
        tval <- r * sqrt(dfree / (1 - r^2))
        pval <- 2 * pt(-abs(tval), dfree)
        corr_row <- c(corr_row, list(round(r, 6)))
        sig_row  <- c(sig_row, list(round(pval, 6)))
        df_row   <- c(df_row, list(as.integer(dfree)))

        # Bootstrapping (BOOT2): upper triangle only (i<j) — the partial
        # correlation is symmetric. Re-regresses out the controls on every
        # resample (not just resampling the precomputed residuals).
        if (j > i) {
          boot_out <- sai_bootstrap(
            mat_df,
            function(data, indices) {
              d <- data[indices, , drop = FALSE]
              zd <- d[, controls, drop = FALSE]
              ri <- residuals(lm(d[[vars[i]]] ~ ., data = zd))
              rj <- residuals(lm(d[[vars[j]]] ~ ., data = zd))
              c(r = suppressWarnings(cor(ri, rj)))
            },
            params
          )
          if (!is.null(boot_out)) {
            for (bo in boot_out) {
              boot_rows <- c(boot_rows, list(list(
                names_vec[i], names_vec[j],
                round(bo$estimate, 6), round(bo$bias, 6), round(bo$se, 6),
                round(bo$ci_lower, 6), round(bo$ci_upper, 6))))
            }
          }
        }
      }
    }
    out_rows <- c(out_rows, list(corr_row), list(sig_row), list(df_row))
  }

  control_lbl <- paste(vapply(controls, nm_of, character(1)), collapse = ", ")

  tables <- list(list(
    titleKey    = "output.partialCorr.title",
    columns     = as.list(cols_hdr),
    rows        = out_rows,
    footnoteKey = paste0("output.partialCorr.controlFootnote:", control_lbl)
  ))
  if (length(boot_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey    = "output.bootstrap.correlationTitle",
      columns     = list("output.col.variable1", "output.col.variable2", "output.col.correlation",
                         "output.bootstrap.bias", "output.bootstrap.stdError",
                         "output.bootstrap.ciLower", "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
