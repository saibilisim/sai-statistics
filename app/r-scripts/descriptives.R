# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# descriptives.R — Descriptive statistics analysis.
#
# Params (from JSON):
#   parquetPath  — path to the exported Parquet dataset
#   rScriptsDir  — directory containing _bootstrap.R
#   variables    — character vector of colIds (e.g. ["col_1", "col_2"])
#   varNames     — named list colId → display name (e.g. { "col_1": "age" })
#   options      — named list of booleans:
#                    mean, sum, sd, variance, range, min, max, seMean,
#                    kurtosis, skewness
#   options$bootstrap — BOOT2 (spss-parity-findings-2026-07-07 §B1): bootstraps
#     the mean per variable, same sai_bootstrap() pattern as ttest-onesample.R
#     (SPSS supports Mean/SD/Variance/Skewness/Kurtosis for Descriptives; this
#     first pass covers Mean only — the most commonly requested). SPSS rule:
#     bootstrap and Split File are mutually exclusive — honoured below by
#     skipping bootstrap (with an honest warning) whenever a split is active.
#   splitVariable/splitVariableName — active Split File colId/name (B2),
#                    injected by analysis-handler.ts when set
#
# Output: one summary table with one row per variable, plus a final
# "Valid N (listwise)" row — cases valid on ALL variables (SPSS parity).

suppressPackageStartupMessages(library(jsonlite))

# 1. Read raw params first (before bootstrap) so we can find rScriptsDir
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(
  paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
  simplifyVector = FALSE
)

# 2. Source bootstrap (defines read_params, load_data, sai_output, etc.)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))

# 3. Load typed params and data
params <- read_params()
df     <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  variables <- unlist(params$variables)
  var_names <- params$varNames   # named list: colId -> display name
  opts      <- params$options

  if (length(variables) == 0) {
    sai_error("No variables specified for descriptive statistics")
  }

  # Determine which statistic columns to include
  include_mean     <- isTRUE(opts$mean)
  include_sum      <- isTRUE(opts$sum)
  include_sd       <- isTRUE(opts$sd)
  include_variance <- isTRUE(opts$variance)
  include_range    <- isTRUE(opts$range)
  include_min      <- isTRUE(opts$min)
  include_max      <- isTRUE(opts$max)
  include_se_mean  <- isTRUE(opts$seMean)
  include_kurtosis <- isTRUE(opts$kurtosis)
  include_skewness <- isTRUE(opts$skewness)

  # Build column i18n key list (Variable + N always included)
  col_keys <- c("output.col.variable", "output.col.n")
  if (include_mean)     col_keys <- c(col_keys, "output.col.mean")
  if (include_sum)      col_keys <- c(col_keys, "output.col.sum")
  if (include_sd)       col_keys <- c(col_keys, "output.col.sd")
  if (include_variance) col_keys <- c(col_keys, "output.col.variance")
  if (include_range)    col_keys <- c(col_keys, "output.col.range")
  if (include_min)      col_keys <- c(col_keys, "output.col.min")
  if (include_max)      col_keys <- c(col_keys, "output.col.max")
  if (include_se_mean)  col_keys <- c(col_keys, "output.col.seMean")
  if (include_skewness) col_keys <- c(col_keys, "output.col.skewness", "output.col.skewSE")
  if (include_kurtosis) col_keys <- c(col_keys, "output.col.kurtosis", "output.col.kurtSE")

  progress(30L, "progress.computing")

  # Split File (B2): loop over split groups (a single unlabeled group when no
  # split variable is active, so this is a no-op structurally for the common
  # case). Weight Cases resolves per group — SPSS applies weighting within
  # each split group's own computation.
  split_groups <- get_split_groups(df, params)
  split_name   <- if (!is.null(params$splitVariableName)) params$splitVariableName else params$splitVariable
  all_tables   <- list()
  boot_rows    <- list()

  # SPSS rule: bootstrap and Split File are mutually exclusive. When both are
  # active, skip the bootstrap call entirely (rather than bootstrap per
  # split group, which SPSS does not do) — sai_output()'s existing
  # "bootstrapNotApplied" honesty warning fires naturally since
  # .sai_bootstrap_requested was already set in read_params() but nothing
  # ever calls sai_bootstrap() in that case.
  split_active <- !is.null(params$splitVariable) && nzchar(params$splitVariable)

  for (grp in split_groups) {
    df_g <- grp$df
    .gw  <- get_weights(df_g, params)
    df_g <- .gw$df
    w    <- .gw$w

    # ── Build rows ─────────────────────────────────────────────────────────────
    rows <- vector("list", length(variables))

    # Listwise-complete case mask across ALL variables — ANDed per variable
    # below, then reported as the final "Valid N (listwise)" row (SPSS parity).
    complete <- rep(TRUE, nrow(df_g))

    for (i in seq_along(variables)) {
      col_id   <- variables[i]
      var_name <- if (!is.null(var_names[[col_id]])) var_names[[col_id]] else col_id

      if (!col_id %in% names(df_g)) {
        sai_error(paste("Column not found in dataset:", col_id))
      }

      vals   <- suppressWarnings(as.numeric(apply_user_missing(df_g[[col_id]], col_id, params)))
      n      <- sum(!is.na(vals))              # raw valid-row count — guards below
      n_disp <- if (is.null(w)) n else round(sum(w[!is.na(vals)]), 6)
      complete <- complete & !is.na(vals)

      row <- list(var_name, n_disp)

      if (include_mean)     row <- c(row, list(if (n > 0) round(wtd_mean(vals, w), 6) else NA))
      if (include_sum)      row <- c(row, list(if (n > 0) round(wtd_sum(vals, w), 6) else NA))
      if (include_sd)       row <- c(row, list(if (n > 1) round(wtd_sd(vals, w), 6) else NA))
      if (include_variance) row <- c(row, list(if (n > 1) round(wtd_var(vals, w), 6) else NA))
      if (include_range)    row <- c(row, list(if (n > 0) round(diff(range(vals, na.rm = TRUE)), 6) else NA))
      if (include_min)      row <- c(row, list(if (n > 0) round(min(vals,  na.rm = TRUE), 6) else NA))
      if (include_max)      row <- c(row, list(if (n > 0) round(max(vals,  na.rm = TRUE), 6) else NA))
      if (include_se_mean)  row <- c(row, list(if (n > 1) round(wtd_sd(vals, w) / sqrt(n_disp), 6) else NA))
      if (include_skewness) row <- c(row,
        list(if (n > 2) round(wtd_skewness(vals, w), 6) else NA),
        list(if (n > 2) round(se_skewness(n_disp), 6) else NA))
      if (include_kurtosis) row <- c(row,
        list(if (n > 3) round(wtd_kurtosis(vals, w), 6) else NA),
        list(if (n > 3) round(se_kurtosis(n_disp), 6) else NA))

      rows[[i]] <- row

      if (!split_active && include_mean) {
        boot_df <- data.frame(x = vals[!is.na(vals)])
        boot_w  <- if (is.null(w)) NULL else w[!is.na(vals)]
        boot_out <- sai_bootstrap(
          boot_df,
          function(data, indices) c(mean = mean(data$x[indices])),
          params, weight = boot_w
        )
        if (!is.null(boot_out)) {
          # split_title() is for titleKeys (i18n), not plain cell values —
          # the group label is appended directly here instead.
          row_label <- if (is.null(grp$label)) var_name else
            paste0(var_name, " [", split_name, " = ",
                   resolve_var_name(grp$label, params$splitValueLabels), "]")
          for (r in boot_out) {
            boot_rows <- c(boot_rows, list(list(
              row_label, round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
              round(r$ci_lower, 6), round(r$ci_upper, 6))))
          }
        }
      }
    }

    # Final row: Valid N (listwise) — cases valid on every variable. Only the
    # N column carries a value; the remaining statistic cells stay empty
    # (rendered as SPSS's dot). With weights this is the weighted complete-case
    # count, consistent with the per-variable N above.
    n_listwise  <- if (is.null(w)) sum(complete) else round(sum(w[complete]), 6)
    valid_n_row <- list("output.descriptives.validN", n_listwise)
    if (length(col_keys) > 2L) {
      valid_n_row <- c(valid_n_row, rep(list(NA), length(col_keys) - 2L))
    }
    rows <- c(rows, list(valid_n_row))

    all_tables <- c(all_tables, list(list(
      titleKey    = split_title(
        "output.descriptives.title", split_name, grp$label, params$splitValueLabels
      ),
      columns     = as.list(col_keys),
      rows        = rows,
      footnoteKey = NULL
    )))
  }

  if (length(boot_rows) > 0) {
    all_tables <- c(all_tables, list(list(
      titleKey    = "output.bootstrap.meanTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  progress(90L, "progress.formatting")
  progress(100L, "progress.done")
  sai_output(tables = all_tables)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
