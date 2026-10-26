# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-kruskal-wallis.R — Tests for Several Independent Samples (SPSS-style).
#
# Params: variables (colIds), varNames, factor, factorName, factorValueLabels,
#         options$testType — { kruskalWallis (default TRUE), median,
#           jonckheereTerpstra } booleans, matching SPSS's "Test Type" group,
#         options$pairwise, options$pMethod (Kruskal-Wallis only — base R has
#           no exact/Monte-Carlo path for the other two here),
#         options$descriptives, options$quartiles — SPSS's Options "Statistics"
#           checkboxes; like npar-mann-whitney.R, split BY GROUP (+ Total) so
#           the summary is actually useful next to a k-sample comparison
#           instead of SPSS's own pooled-all-cases row,
#         options$missing — "analysis" (test-by-test, default) or "listwise".
#
# Output per test type (only the ones requested):
#   Kruskal-Wallis H: "Ranks" (N, Mean Rank per group) + "Test Statistics"
#     (Chi-Square=H, df, Asymp. Sig. [+ Monte Carlo/Exact Sig.]), tie-corrected.
#   Median: "Frequencies" (count above / at-or-below the overall median per
#     group) + "Test Statistics" (N, Median, Chi-Square, df, Asymp. Sig.) — a
#     Pearson chi-square on the resulting 2 x k table, no continuity
#     correction (matches SPSS, which only applies Yates to true 2x2 tables
#     elsewhere, never here).
#   Jonckheere-Terpstra: "Test Statistics" (N, Levels, Observed/Mean/SD J-T
#     statistic, Std. J-T Statistic, Asymp. Sig.) — the standard tie-corrected
#     normal approximation (Hollander & Wolfe), computed pairwise via the SAME
#     rank-based Mann-Whitney U as npar-mann-whitney.R (efficient and already
#     validated there), not brute-force pair enumeration. Groups are ordered
#     by the factor's own NUMERIC value — order is the whole point of this
#     test, unlike Kruskal-Wallis/Median where group order is cosmetic.
# Plus an optional "Descriptive Statistics" table (Statistics checkboxes) and
# optional Dunn-Bonferroni pairwise comparisons (K-W only, unchanged).
#
# Science-over-SPSS (CLAUDE.md §11): base R has no exact/Monte-Carlo path for
# K-sample rank tests, so an optional Monte Carlo or exact p-value is offered
# for Kruskal-Wallis via the `coin` package (sai_coin_pvalue); when coin is
# absent the honest "pMethodNotApplied" warning fires instead of a silent
# fallback. Median/J-T have no such path here (SPSS itself only offers
# Monte Carlo/Exact for K-W and Median, not J-T; Median's exact path needs a
# multi-way permutation test this script does not implement — the asymptotic
# chi-square is reported, same as SPSS's own default).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars  <- unlist(params$variables); var_names <- params$varNames
  fvar  <- params$factor
  fname <- if (is.null(params$factorName)) fvar else params$factorName
  if (length(vars) == 0) sai_error("No test variables")
  if (is.null(fvar) || !fvar %in% names(df)) sai_error("Factor variable not found")

  opts <- if (is.null(params$options)) list() else params$options
  tt   <- if (is.null(opts$testType)) list() else opts$testType
  want_kw  <- !isFALSE(tt$kruskalWallis)
  want_med <- isTRUE(tt$median)
  want_jt  <- isTRUE(tt$jonckheereTerpstra)
  if (!want_kw && !want_med && !want_jt) sai_error("Select at least one test type")
  want_desc  <- isTRUE(opts$descriptives)
  want_quart <- isTRUE(opts$quartiles)

  # Missing Values (MV): SPSS's NPar Tests dialog offers "Exclude cases
  # test by test" (default — each variable's own valid cases, current
  # per-variable `keep` mask below) vs "Exclude cases listwise" (drop a case
  # if ANY test variable or the factor is missing, before any per-variable
  # computation — same apply_listwise() contract as anova-oneway.R).
  df <- apply_listwise(df, c(vars, fvar), params)
  fall <- as.character(df[[fvar]])

  # Groups ordered by the factor's own NUMERIC value when every level parses
  # as a number (the usual case for an SPSS-style coded grouping variable);
  # falls back to the default (alphabetical) order otherwise. Only
  # Jonckheere-Terpstra's result actually depends on this order — Kruskal-
  # Wallis/Median are order-agnostic — but using ONE order everywhere keeps
  # the Ranks/Frequencies tables' row order consistent across test types.
  ordered_levels <- function(g) {
    lv <- levels(g)
    num <- suppressWarnings(as.numeric(lv))
    if (!anyNA(num)) lv[order(num)] else lv
  }

  rank_rows <- list(); test_rows <- list(); pairwise_tables <- list()
  med_freq_rows <- list(); med_test_rows <- list()
  jt_test_rows <- list()
  desc_rows <- list()

  want_pairwise <- isTRUE(opts$pairwise)
  want_pmethod  <- want_kw && !is.null(opts$pMethod) &&
    (identical(opts$pMethod$method, "montecarlo") || identical(opts$pMethod$method, "exact"))
  pmethod_col <- if (!is.null(opts$pMethod) && identical(opts$pMethod$method, "exact")) {
    "output.col.exactSig"
  } else {
    "output.col.monteCarloSig"
  }

  summary_cells <- function(xs) {
    q <- wtd_quantile(xs, probs = c(0.25, 0.5, 0.75))
    c(list(length(xs)),
      if (want_desc) list(round_half_up(mean(xs), 3),
                          round_half_up(if (length(xs) > 1) sd(xs) else NA_real_, 3),
                          round_half_up(min(xs), 3)),
      if (want_quart) list(round_half_up(q[1], 3), round_half_up(q[2], 3),
                           round_half_up(q[3], 3)),
      if (want_desc) list(round_half_up(max(xs), 3)),
      if (want_quart) list(round_half_up(q[3] - q[1], 3)))
  }

  any_computed <- FALSE
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    xv <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params)))
    keep <- !is.na(xv) & !is.na(fall) & fall != "NA"
    x <- xv[keep]; g <- factor(fall[keep])
    if (nlevels(g) < 2 || length(x) <= nlevels(g)) next
    g <- factor(g, levels = ordered_levels(g))
    lvls <- levels(g); k <- length(lvls)
    any_computed <- TRUE

    if (want_desc || want_quart) {
      desc_rows <- c(desc_rows, list(c(list(nm, "output.col.total"), summary_cells(x))))
      for (lvl in lvls) {
        desc_rows <- c(desc_rows, list(c(
          list("", resolve_var_name(lvl, params$factorValueLabels)), summary_cells(x[g == lvl]))))
      }
    }

    # ── Kruskal-Wallis H ─────────────────────────────────────────────────
    if (want_kw) {
      r <- rank(x); N <- length(x)
      for (lvl in lvls) {
        idx <- g == lvl
        rank_rows <- c(rank_rows, list(list(
          if (lvl == lvls[1]) nm else "", resolve_var_name(lvl, params$factorValueLabels),
          sum(idx), round_half_up(mean(r[idx]), 2))))
      }
      rank_rows <- c(rank_rows, list(list("", "output.col.total", N, "")))
      H0 <- (12 / (N * (N + 1))) * sum(tapply(r, g, sum)^2 / tapply(r, g, length)) - 3 * (N + 1)
      tct <- table(r); H <- H0 / (1 - sum(tct^3 - tct) / (N^3 - N))
      dfree <- k - 1
      p <- pchisq(H, dfree, lower.tail = FALSE)
      kw_data <- data.frame(x = x, g = g)
      mc <- sai_coin_pvalue(function(dist) {
        coin::kruskal_test(x ~ g, data = kw_data, distribution = dist)
      }, params)
      ts_row <- list(nm, round(H, 3), dfree, round(p, 6))
      if (want_pmethod) ts_row <- c(ts_row, list(if (is.null(mc)) NULL else round(mc$p.value, 6)))
      test_rows <- c(test_rows, list(ts_row))

      # Pairwise comparisons (Dunn-Bonferroni, SPSS's own post hoc for
      # Kruskal-Wallis): each pair's mean-rank difference tested via a
      # pooled-N pairwise z, then Bonferroni-adjusted for all k(k-1)/2 pairs.
      if (want_pairwise && k > 2) {
        ni <- tapply(r, g, length); mean_r <- tapply(r, g, mean)
        n_comparisons <- k * (k - 1) / 2
        pw_rows <- list()
        for (i in seq_len(k - 1)) {
          for (j in (i + 1):k) {
            # Tie-corrected variance of a rank sum (same correction as H above).
            se <- sqrt((N * (N + 1) / 12 - sum(tct^3 - tct) / (12 * (N - 1))) *
                         (1 / ni[lvls[i]] + 1 / ni[lvls[j]]))
            z <- (mean_r[lvls[i]] - mean_r[lvls[j]]) / se
            p_raw <- 2 * pnorm(-abs(z))
            p_adj <- min(1, p_raw * n_comparisons)
            pw_rows <- c(pw_rows, list(list(
              paste0(resolve_var_name(lvls[i], params$factorValueLabels), "-",
                     resolve_var_name(lvls[j], params$factorValueLabels)),
              round(unname(mean_r[lvls[i]] - mean_r[lvls[j]]), 3),
              round(unname(se), 4), round(unname(z), 3),
              round(p_raw, 6), round(p_adj, 6))))
          }
        }
        pairwise_tables <- c(pairwise_tables, list(list(
          titleKey = paste0("output.npar.pairwiseTitle:", nm),
          columns = list("output.npar.sample1Sample2", "output.npar.testStat",
                         "output.npar.stdError", "output.npar.stdTestStat",
                         "output.col.sig", "output.npar.adjSig"),
          rows = pw_rows, footnoteKey = "output.npar.pairwiseFootnote")))
      }
    }

    # ── Median test ──────────────────────────────────────────────────────
    if (want_med) {
      med <- median(x)
      above <- x > med
      if (any(above) && any(!above)) {
        for (lvl in lvls) {
          idx <- g == lvl
          med_freq_rows <- c(med_freq_rows, list(list(
            if (lvl == lvls[1]) nm else "", resolve_var_name(lvl, params$factorValueLabels),
            sum(idx & above), sum(idx & !above))))
        }
        tab <- table(g, above)
        ct <- suppressWarnings(chisq.test(tab, correct = FALSE))
        med_test_rows <- c(med_test_rows, list(list(
          nm, length(x), round(med, 6), round(unname(ct$statistic), 3),
          unname(ct$parameter), round(ct$p.value, 6))))
      }
    }

    # ── Jonckheere-Terpstra ──────────────────────────────────────────────
    # J = sum over ordered pairs i<j of the Mann-Whitney U(i,j) (count of
    # group-j values exceeding group-i values, ties contributing 0.5 via the
    # average-rank mechanism) — computed the same rank-based way as
    # npar-mann-whitney.R's own U, which is O(n log n) per pair rather than
    # an O(n_i*n_j) pairwise comparison matrix.
    if (want_jt) {
      N <- length(x)
      n_i <- as.numeric(table(g))
      J <- 0
      for (i in seq_len(k - 1)) {
        xi <- x[g == lvls[i]]
        for (j in (i + 1):k) {
          xj <- x[g == lvls[j]]
          pooled <- c(xi, xj)
          rk <- rank(pooled)
          nj <- length(xj)
          Rj <- sum(rk[(length(xi) + 1):(length(xi) + nj)])
          J <- J + (Rj - nj * (nj + 1) / 2)
        }
      }
      EJ <- (N^2 - sum(n_i^2)) / 4
      tt_tab <- table(x); tg <- as.numeric(tt_tab)
      term1 <- N * (N - 1) * (2 * N + 5) -
               sum(n_i * (n_i - 1) * (2 * n_i + 5)) -
               sum(tg * (tg - 1) * (2 * tg + 5))
      varJ <- term1 / 72
      if (N > 2) {
        varJ <- varJ + (sum(n_i * (n_i - 1) * (n_i - 2)) * sum(tg * (tg - 1) * (tg - 2))) /
          (36 * N * (N - 1) * (N - 2))
      }
      varJ <- varJ + (sum(n_i * (n_i - 1)) * sum(tg * (tg - 1))) / (8 * N * (N - 1))
      Z <- if (varJ > 0) (J - EJ) / sqrt(varJ) else NA_real_
      p <- if (is.na(Z)) NA_real_ else 2 * pnorm(-abs(Z))
      jt_test_rows <- c(jt_test_rows, list(list(
        nm, N, k, round(J, 3), round(EJ, 3), round(sqrt(max(varJ, 0)), 3),
        round(Z, 3), round(p, 6))))
    }
  }
  if (!any_computed) sai_error("Not enough data for the selected test(s)")

  progress(90L, "progress.computing")

  tables <- list()
  if (want_kw && length(test_rows) > 0) {
    tables <- c(tables, list(
      list(titleKey = "output.npar.ranksTitle",
           columns = list("output.col.variable", fname, "output.col.n", "output.col.meanRank"),
           rows = rank_rows, footnoteKey = NULL),
      list(titleKey = "output.npar.testStatsTitle",
           columns = if (want_pmethod) {
             list("output.col.variable", "output.col.chiSquare", "output.col.df",
                  "output.col.asympSig", pmethod_col)
           } else {
             list("output.col.variable", "output.col.chiSquare", "output.col.df", "output.col.asympSig")
           },
           rows = test_rows, footnoteKey = paste0("output.npar.factorFootnote:", fname))
    ), pairwise_tables)
  }
  if (want_med && length(med_test_rows) > 0) {
    tables <- c(tables, list(
      list(titleKey = "output.npar.medianFreqTitle",
           columns = list("output.col.variable", fname, "output.npar.aboveMedian",
                          "output.npar.atOrBelowMedian"),
           rows = med_freq_rows, footnoteKey = NULL),
      list(titleKey = "output.npar.medianTestTitle",
           columns = list("output.col.variable", "output.col.n", "output.col.median",
                          "output.col.chiSquare", "output.col.df", "output.col.asympSig"),
           rows = med_test_rows, footnoteKey = paste0("output.npar.factorFootnote:", fname))
    ))
  }
  if (want_jt && length(jt_test_rows) > 0) {
    tables <- c(tables, list(
      list(titleKey = "output.npar.jtTestTitle",
           columns = list("output.col.variable", "output.col.n", "output.npar.levels",
                          "output.npar.jtObserved", "output.npar.jtMean", "output.npar.jtSD",
                          "output.npar.jtStd", "output.col.asympSig"),
           rows = jt_test_rows, footnoteKey = paste0("output.npar.factorFootnote:", fname))
    ))
  }
  if (length(desc_rows) > 0) {
    desc_cols <- c(list("output.col.variable", fname, "output.col.n"),
      if (want_desc) list("output.col.mean", "output.col.sd", "output.col.min"),
      if (want_quart) list("output.col.p25", "output.col.median", "output.col.p75"),
      if (want_desc) list("output.col.max"),
      if (want_quart) list("output.col.iqr"))
    tables <- c(list(list(
      titleKey = "output.npar.descriptivesTitle", columns = desc_cols, rows = desc_rows,
      footnoteKey = paste0("output.npar.groupingFootnote:", fname)
    )), tables)
  }

  progress(100L, "progress.done")
  sai_output(tables = tables)
}, error = function(e) sai_error(conditionMessage(e)))
