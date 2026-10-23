# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# reliability.R — Reliability Analysis (Cronbach's alpha, SPSS-style).
#
# Params: variables (item colIds), varNames.
# Output: "Reliability Statistics" (Cronbach's Alpha, N of Items [+ Std. Error,
#         95% CI when the `psych` package is available — SPSS 27+ parity]) +
#         "Item-Total Statistics" (Scale Mean / Variance if Item Deleted,
#         Corrected Item-Total Correlation, Cronbach's Alpha if Item Deleted).
#         Cases handled listwise.
#
# An earlier hand-computation audit flagged this script's hand-rolled alpha
# as untested/high-risk. Verified (2026-07-07) against psych::alpha() directly —
# byte-identical for alpha, corrected item-total correlation (r.drop), and
# alpha-if-item-deleted (see tests/r-validation/test-reliability.R) — so the
# manual formula stays (no bug to fix), but the alpha's Std. Error/95% CI
# (Feldt et al. method) is now sourced from psych::alpha() rather than
# hand-deriving a Feldt confidence interval, since `psych` is already a
# required/bundled package (CLAUDE.md §11 "eşleşen paket varsa kullan").

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  if (length(vars) < 2) sai_error("Reliability needs at least two items")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  n <- nrow(mat); k <- ncol(mat)
  if (n < 2) sai_error("Not enough complete cases")

  cron <- function(m) {
    kk <- ncol(m)
    kk / (kk - 1) * (1 - sum(apply(m, 2, var)) / var(rowSums(m)))
  }
  alpha <- cron(mat)
  total <- rowSums(mat)

  item_rows <- list()
  for (i in seq_len(k)) {
    rest <- total - mat[, i]
    a_del <- if (k > 2) cron(mat[, -i, drop = FALSE]) else NA_real_
    item_rows <- c(item_rows, list(list(
      nm[i], round(mean(rest), 4), round(var(rest), 4),
      round(cor(mat[, i], rest), 4),
      if (is.na(a_del)) "" else round(a_del, 4))))
  }

  # Alpha's Std. Error / 95% CI (Feldt et al.) via psych::alpha() — see header
  # comment. Silently omitted (columns absent) if psych is ever unavailable,
  # rather than hand-deriving the Feldt formula.
  ase <- NA_real_; ci_lo <- NA_real_; ci_hi <- NA_real_
  if (requireNamespace("psych", quietly = TRUE)) {
    pa <- tryCatch(suppressWarnings(psych::alpha(mat, warnings = FALSE)), error = function(e) NULL)
    if (!is.null(pa)) {
      ase   <- pa$total$ase
      ci_lo <- pa$feldt$lower.ci$raw_alpha
      ci_hi <- pa$feldt$upper.ci$raw_alpha
    }
  }
  have_ci <- !is.na(ase) && !is.na(ci_lo) && !is.na(ci_hi)
  stats_cols <- list("output.col.cronbachAlpha", "output.col.nItems")
  stats_row  <- list(round(alpha, 4), as.integer(k))
  if (have_ci) {
    stats_cols <- c(stats_cols, list("output.col.stdError", "output.col.ciLower95", "output.col.ciUpper95"))
    stats_row  <- c(stats_row, list(round(ase, 4), round(ci_lo, 4), round(ci_hi, 4)))
  }

  # Inter-Item Correlation Matrix (SPSS Statistics panel option) — plain
  # Pearson correlations among the items, symmetric k×k table.
  opts <- if (is.null(params$options)) list() else params$options
  corr_table <- NULL
  if (isTRUE(opts$interItemCorr)) {
    R <- cor(mat)
    corr_rows <- lapply(seq_len(k), function(i)
      c(list(nm[i]), lapply(seq_len(k), function(j) round(R[i, j], 3))))
    corr_table <- list(
      titleKey = "output.reliability.interItemCorrTitle",
      columns = c(list("output.col.variable"), as.list(nm)),
      rows = corr_rows, footnoteKey = NULL)
  }

  # ── Split-half model (SPSS RELIABILITY /MODEL=SPLIT) ────────────────────────
  # A different model, not an extra statistic: the scale is cut in two and the
  # halves' agreement estimates the whole test's reliability. SPSS splits by
  # item order, the first ceiling(k/2) items against the rest, so an odd item
  # count gives the larger half to part 1 — which is why the two Spearman-Brown
  # variants (equal and unequal length) are both reported.
  split_table <- NULL
  if (identical(opts$model, "split") && k >= 4) {
    n1 <- ceiling(k / 2)
    p1 <- mat[, seq_len(n1), drop = FALSE]
    p2 <- mat[, (n1 + 1):k, drop = FALSE]
    s1 <- rowSums(p1); s2 <- rowSums(p2)
    r12 <- cor(s1, s2)
    v1 <- var(s1); v2 <- var(s2); vt <- var(s1 + s2)
    n2 <- k - n1
    # Spearman-Brown for a split into unequal parts: the equal-length formula
    # 2r/(1+r) is the special case L = 1/2 of
    #   r / (2L(1-L) + r(1 - 2L(1-L))),  L = n1/k.
    L <- n1 / k
    sb_equal   <- 2 * r12 / (1 + r12)
    sb_unequal <- r12 / (2 * L * (1 - L) + r12 * (1 - 2 * L * (1 - L)))
    # Guttman's split-half (Rulon's formula): 2(1 - (s1^2 + s2^2)/st^2). Uses
    # the parts' variances rather than their correlation, so it does not assume
    # the halves are equally variable.
    guttman <- 2 * (1 - (v1 + v2) / vt)
    split_rows <- list(
      list("output.reliability.alphaPart1", round(cron(p1), 4)),
      list("output.reliability.nItemsPart1", as.integer(n1)),
      list("output.reliability.alphaPart2", round(cron(p2), 4)),
      list("output.reliability.nItemsPart2", as.integer(n2)),
      list("output.reliability.nItemsTotal", as.integer(k)),
      list("output.reliability.corrBetweenForms", round(r12, 4)),
      list("output.reliability.sbEqual", round(sb_equal, 4)),
      list("output.reliability.sbUnequal", round(sb_unequal, 4)),
      list("output.reliability.guttman", round(guttman, 4))
    )
    split_table <- list(
      titleKey = "output.reliability.splitTitle",
      columns = list("output.col.statistic", "output.col.value"),
      rows = split_rows,
      # Which items landed in which half is the one thing a reader cannot infer
      # from the numbers, and it changes all of them.
      footnoteKey = paste0("output.reliability.splitFootnote:",
                           paste(nm[seq_len(n1)], collapse = ", "), "|",
                           paste(nm[(n1 + 1):k], collapse = ", "))
    )
  }

  # Split-half asked for but not produced: say so. Each half needs at least two
  # items for its own alpha, so a scale of three cannot be split, and silence
  # here would look like the option had simply been ignored.
  warn_keys <- if (identical(opts$model, "split") && k < 4) {
    "output.reliability.warnSplitItems"
  } else {
    character(0)
  }

  progress(100L, "progress.done")
  sai_output(warnings = warn_keys, tables = c(
    if (is.null(split_table)) list() else list(split_table),
    list(
    list(titleKey = "output.reliability.statsTitle",
         columns = stats_cols,
         rows = list(stats_row), footnoteKey = NULL),
    list(titleKey = "output.reliability.itemTotalTitle",
         columns = list("output.col.variable", "output.col.scaleMeanDel",
                        "output.col.scaleVarDel", "output.col.corrItemTotal",
                        "output.col.alphaDel"),
         rows = item_rows, footnoteKey = NULL),
    # Scale Statistics: mean, variance, SD of the total scale score + N of items.
    list(titleKey = "output.reliability.scaleStatsTitle",
         columns = list("output.col.mean", "output.col.variance",
                        "output.col.stdDeviation", "output.col.nItems"),
         rows = list(list(round(mean(total), 4), round(var(total), 4),
                          round(sd(total), 4), as.integer(k))),
         footnoteKey = NULL)),
    if (is.null(corr_table)) list() else list(corr_table)))
}, error = function(e) sai_error(conditionMessage(e)))
