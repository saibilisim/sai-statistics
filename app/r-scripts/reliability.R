# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# reliability.R — Reliability Analysis (Cronbach's alpha, SPSS-style).
#
# Params: variables (item colIds), varNames, options:
#   model          "alpha" (default) | "split" | "guttman" | "parallel" | "strict" | "omega"
#   interItemCorr  inter-item correlation matrix
#   hotelling, tukey   Hotelling's T² / Tukey's nonadditivity (bool)
#   anova          "none" | "f" | "friedman" | "cochran"   cases x items ANOVA table
#   icc            { enabled, model: oneway|random|mixed, type: consistency|absolute,
#                    ci (percent), testValue }
# The 2026-11 models and statistics live in _reliability_models.R.
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
source(file.path(.params_raw$rScriptsDir, "_reliability_models.R"))

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  if (length(vars) < 2) sai_error("Reliability needs at least two items")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  n_total <- nrow(mat)
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

  extra_note <- character(0)

  # ── Further models (2026-11): Guttman, parallel, strictly parallel, omega ──
  model <- if (is.null(opts$model)) "alpha" else opts$model
  r4 <- function(x) if (is.finite(x)) round(x, 4) else NULL
  model_tables <- list()
  extra_warn <- character(0)
  if (model == "guttman") {
    {
      L <- rel_guttman(mat)
      model_tables <- list(list(
        titleKey = "output.reliability.guttmanTitle",
        columns = list("output.col.statistic", "output.col.value"),
        rows = c(lapply(1:6, function(i) list(paste0("output.reliability.lambda", i), r4(L[i]))),
                 list(list("output.col.nItems", as.integer(k)))),
        footnoteKey = "output.reliability.guttmanFootnote"))
    }
  } else if (model %in% c("parallel", "strict")) {
    P <- rel_parallel(mat, model == "strict")
    model_tables <- list(
      list(titleKey = "output.reliability.fitTitle",
           columns = list("output.col.statistic", "output.col.value"),
           rows = list(list("output.col.chiSquare", r4(P$chi)), list("output.col.df", as.integer(P$df)),
                       list("output.col.sig", r4(P$p)),
                       list("output.reliability.logDetUnconstrained", r4(P$ld_s)),
                       list("output.reliability.logDetConstrained", r4(P$ld_c))),
           footnoteKey = "output.reliability.fitFootnote"),
      list(titleKey = if (model == "strict") "output.reliability.strictStatsTitle"
                      else "output.reliability.parallelStatsTitle",
           columns = list("output.col.statistic", "output.col.value"),
           rows = c(if (model == "strict") list(list("output.reliability.commonMean", r4(P$mean))) else list(),
                    list(list("output.reliability.commonVariance", r4(P$v)),
                         list("output.reliability.trueVariance", r4(P$true)),
                         list("output.reliability.errorVariance", r4(P$error)),
                         list("output.reliability.commonCorr", r4(P$r)),
                         list("output.reliability.scaleReliability", r4(P$rel)))),
           footnoteKey = "output.reliability.mlFootnote"))
  } else if (model == "omega") {
    O <- rel_omega(mat)
    if (is.null(O)) extra_warn <- c(extra_warn, "output.reliability.omegaFailed") else
      model_tables <- list(list(
        titleKey = "output.reliability.omegaTitle",
        columns = list("output.reliability.omega", "output.col.cronbachAlpha", "output.col.nItems"),
        rows = list(list(r4(O$omega), r4(alpha), as.integer(k))),
        footnoteKey = "output.reliability.omegaFootnote"))
  }

  # ── Statistics: Hotelling's T², ANOVA table (F / Friedman / Cochran), ICC ──
  stat_tables <- list()
  tw <- rel_twoway(mat)
  if (isTRUE(opts$hotelling)) {
    if (n <= k) extra_warn <- c(extra_warn, "output.reliability.hotellingN") else {
      h <- tryCatch(rel_hotelling(mat), error = function(e) NULL)
      if (!is.null(h)) stat_tables <- c(stat_tables, list(list(
        titleKey = "output.reliability.hotellingTitle",
        columns = list("output.reliability.hotellingT2", "output.col.f", "output.col.df1",
                       "output.col.df2", "output.col.sig"),
        rows = list(list(r4(h[1]), r4(h[2]), as.integer(h[3]), as.integer(h[4]), r4(h[5]))),
        footnoteKey = NULL)))
    }
  }
  anova_kind <- if (is.null(opts$anova)) "none" else opts$anova
  if (anova_kind == "cochran" && !all(mat %in% c(0, 1))) {
    extra_warn <- c(extra_warn, "output.reliability.cochranBinary"); anova_kind <- "f"
  }
  want_tukey <- isTRUE(opts$tukey)
  if (anova_kind != "none" || want_tukey) {
    dfr <- tw$n - 1; dfc <- tw$k - 1; dfe <- dfr * dfc; dfw <- tw$n * dfc
    Fc <- tw$ms_c / tw$ms_e
    tk <- if (want_tukey) rel_tukey(tw, mat) else NULL
    test_cells <- switch(anova_kind,
      friedman = { fr <- stats::friedman.test(mat); list("output.reliability.friedmanChi", r4(unname(fr$statistic)), r4(fr$p.value)) },
      cochran = { cq <- rel_cochran(mat); list("output.reliability.cochranQ", r4(cq[1]), r4(cq[3])) },
      list("F", r4(Fc), r4(stats::pf(Fc, dfc, dfe, lower.tail = FALSE))))
    row <- function(lbl, ss, df, ms = NULL, stat = NULL, p = NULL)
      list(lbl, r4(ss), as.integer(df), if (is.null(ms)) NULL else r4(ms), stat, p)
    rows <- list(
      row("output.reliability.betweenPeople", tw$ss_r, dfr, tw$ms_r),
      row("output.reliability.withinPeople", tw$ss_w, dfw, tw$ss_w / dfw),
      row("output.reliability.betweenItems", tw$ss_c, dfc, tw$ms_c, test_cells[[2]], test_cells[[3]]),
      row("output.reliability.residual", tw$ss_e, dfe, tw$ms_e))
    if (!is.null(tk)) rows <- c(rows, list(
      row("output.reliability.nonadditivity", tk$ss_n, 1, tk$ss_n, r4(tk$F), r4(tk$p)),
      row("output.reliability.balance", tk$ss_b, tk$df_b, tk$ss_b / tk$df_b)))
    rows <- c(rows, list(row("output.col.total", tw$ss_t, tw$n * tw$k - 1, tw$ss_t / (tw$n * tw$k - 1))))
    stat_tables <- c(stat_tables, list(list(
      titleKey = "output.reliability.anovaTitle",
      columns = list("output.col.source", "output.col.sumSq", "output.col.df",
                     "output.col.mS", test_cells[[1]], "output.col.sig"),
      rows = rows,
      footnoteKey = paste0("output.reliability.anovaFootnote:", format(round(tw$g, 4), nsmall = 4)))))
    if (!is.null(tk)) extra_note <- paste0("output.reliability.tukeyPower:", format(round(tk$power, 4), nsmall = 4))
  }
  icc_opt <- opts$icc
  if (is.list(icc_opt) && isTRUE(icc_opt$enabled)) {
    im <- if (is.null(icc_opt$model)) "mixed" else icc_opt$model
    it <- if (is.null(icc_opt$type)) "consistency" else icc_opt$type
    if (!im %in% c("oneway", "random", "mixed")) im <- "mixed"
    if (!it %in% c("consistency", "absolute")) it <- "consistency"
    ci_lvl <- suppressWarnings(as.numeric(icc_opt$ci)); if (!length(ci_lvl) || is.na(ci_lvl)) ci_lvl <- 95
    tv <- suppressWarnings(as.numeric(icc_opt$testValue)); if (!length(tv) || is.na(tv)) tv <- 0
    I <- rel_icc(tw, im, it, ci_lvl / 100, tv)
    irow <- function(lbl, v) list(lbl, r4(v[1]), r4(v[2]), r4(v[3]), r4(v[4]),
                                  as.integer(v[5]), if (abs(v[6] - round(v[6])) < 1e-9) as.integer(v[6]) else r4(v[6]), r4(v[7]))
    stat_tables <- c(stat_tables, list(list(
      titleKey = "output.reliability.iccTitle",
      columns = list("output.col.statistic", "output.reliability.icc",
                     paste0("output.reliability.iccLower:", ci_lvl),
                     paste0("output.reliability.iccUpper:", ci_lvl),
                     "output.reliability.iccF", "output.col.df1", "output.col.df2", "output.col.sig"),
      rows = list(irow("output.reliability.iccSingle", I$single),
                  irow("output.reliability.iccAverage", I$average)),
      footnoteKey = paste0("output.reliability.iccFootnote:",
                           paste0("output.reliability.iccModel_", im), "|",
                           if (im == "oneway") "output.reliability.iccType_none"
                           else paste0("output.reliability.iccType_", it), "|", format(tv)))))
  }

  # Split-half asked for but not produced: say so. Each half needs at least two
  # items for its own alpha, so a scale of three cannot be split, and silence
  # here would look like the option had simply been ignored.
  warn_keys <- if (identical(opts$model, "split") && k < 4) {
    "output.reliability.warnSplitItems"
  } else {
    character(0)
  }

  # Case Processing Summary: alpha is computed on the listwise-complete cases
  # only, so say how many that is out of how many.
  cps_pct <- function(x) if (n_total > 0) round(x / n_total * 100, 1) else 0
  cps_table <- list(
    titleKey = "output.caseSummaries.cpsTitle",
    columns = list("output.caseSummaries.includedN", "output.caseSummaries.includedPct",
                   "output.caseSummaries.excludedN", "output.caseSummaries.excludedPct",
                   "output.caseSummaries.totalN", "output.caseSummaries.totalPct"),
    rows = list(list(as.integer(n), cps_pct(n), as.integer(n_total - n), cps_pct(n_total - n),
                     as.integer(n_total), cps_pct(n_total))),
    footnoteKey = NULL)

  progress(100L, "progress.done")
  sai_output(warnings = c(warn_keys, extra_warn), notes = extra_note, tables = c(
    list(cps_table),
    if (is.null(split_table)) list() else list(split_table),
    model_tables,
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
    if (is.null(corr_table)) list() else list(corr_table),
    stat_tables))
}, error = function(e) sai_error(conditionMessage(e)))
