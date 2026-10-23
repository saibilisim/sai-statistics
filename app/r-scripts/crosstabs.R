# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# crosstabs.R — Crosstabulation analysis (SPSS-style).
#
# Params (from JSON):
#   parquetPath  — path to the exported Parquet dataset
#   rScriptsDir  — directory containing _bootstrap.R
#   rows         — character vector of row-variable colIds
#   rowNames     — named list colId → display name
#   cols         — character vector of column-variable colIds
#   colNames     — named list colId → display name
#   options      — named list:
#     cells — { observed, expected, rowPct, colPct, totalPct }
#     stats — { chisquare }
#
# Output: for each row × column pair, a Count crosstabulation (+ optional
#         expected / percentage tables) and a Chi-Square Tests table.

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

  # Weight Cases (W1): weighted counts flow through table→chi-square/measures
  # naturally since `tab` is built via xtabs(w ~ ...) instead of table(...) —
  # everything downstream (row/col totals, chi-square, phi/Cramer's V,
  # ordinal Tau/gamma/Somers' d, kappa, risk estimates) derives from `tab`.
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  rows_ids  <- unlist(params$rows)
  cols_ids  <- unlist(params$cols)
  row_names <- params$rowNames
  col_names <- params$colNames
  opts      <- params$options
  cells     <- if (is.null(opts$cells)) list() else opts$cells
  stats     <- if (is.null(opts$stats)) list() else opts$stats

  if (length(rows_ids) == 0 || length(cols_ids) == 0) {
    sai_error("Crosstabs requires at least one row and one column variable")
  }

  all_tables <- list()
  warn_keys  <- character(0)
  n_pairs    <- length(rows_ids) * length(cols_ids)
  pair_i     <- 0L
  # SPSS opens Crosstabs with a single Case Processing Summary listing every
  # variable pair (Valid / Missing / Total N and %). Rows accumulate through
  # the pair loop and the table is prepended once all pairs are known.
  cps_rows   <- list()

  for (r_id in rows_ids) {
    if (!r_id %in% names(df)) sai_error(paste("Row column not found:", r_id))
    r_name <- if (!is.null(row_names[[r_id]])) row_names[[r_id]] else r_id

    for (c_id in cols_ids) {
      if (!c_id %in% names(df)) sai_error(paste("Column not found:", c_id))
      c_name <- if (!is.null(col_names[[c_id]])) col_names[[c_id]] else c_id
      pair_i <- pair_i + 1L
      progress(as.integer(10 + 80 * (pair_i - 1) / n_pairs), "progress.computing")

      r_col <- apply_user_missing(df[[r_id]], r_id, params)
      c_col <- apply_user_missing(df[[c_id]], c_id, params)
      keep <- !is.na(r_col) & !is.na(c_col)
      rv <- as.character(r_col)[keep]
      cv <- as.character(c_col)[keep]
      wv <- if (is.null(w)) NULL else w[keep]

      # Case Processing Summary row for this pair: a case is Valid when it is
      # present on BOTH variables (the same `keep` mask the crosstab uses), so
      # the Ns here always reconcile with the tables below.
      cps_tot   <- length(keep)
      cps_valid <- if (is.null(w)) sum(keep) else round(sum(w[keep]), 6)
      cps_all   <- if (is.null(w)) cps_tot else round(sum(w), 6)
      cps_pct   <- function(n) if (cps_all > 0) round(n / cps_all * 100, 1) else 0
      cps_rows  <- c(cps_rows, list(list(
        paste0(r_name, " * ", c_name),
        cps_valid, cps_pct(cps_valid),
        cps_all - cps_valid, cps_pct(cps_all - cps_valid),
        cps_all, cps_pct(cps_all)
      )))

      if (length(rv) == 0) next

      tab <- if (is.null(wv)) table(rv, cv) else xtabs(wv ~ rv + cv)
      # Cell/margin/grand counts display as integers when unweighted (exact,
      # matches prior behaviour byte-for-byte); weighted counts are real-
      # valued sums of weights, so they round instead of truncating.
      cnt <- function(x) format_wtd_count(x, wv)
      # Fisher's exact / McNemar require genuinely discrete counts — only
      # meaningful when unweighted or when the active weight happens to
      # produce whole-number cell sums.
      discrete_counts <- is.null(wv) || all(abs(tab - round(tab)) < 1e-9)
      r_levels <- rownames(tab)
      c_levels <- colnames(tab)
      # Display labels: value labels (SPSS "Defined Labels") when the
      # variable has them, else the raw code — resolved separately from
      # r_levels/c_levels so tab[i, j] indexing (which relies on the raw
      # rownames/colnames order) stays untouched.
      r_levels_disp <- resolve_var_names(r_levels, params$rowValueLabels[[r_id]])
      c_levels_disp <- resolve_var_names(c_levels, params$colValueLabels[[c_id]])
      row_tot  <- rowSums(tab)
      col_tot  <- colSums(tab)
      grand    <- sum(tab)
      exp_mat  <- outer(as.numeric(row_tot), as.numeric(col_tot)) / grand
      title_name <- paste0(r_name, " × ", c_name)

      # ── Combined crosstabulation (SPSS-style) ─────────────────────────────────
      # One table per row×column pair. Each selected cell statistic (Count,
      # Expected Count, % within Row/Column/Total) is stacked as a sub-row under
      # every row level, labelled in a dedicated measure column. The row-level
      # value is shown only on the first sub-row (blank thereafter), mirroring
      # SPSS's vertical merge.
      #
      # A "measure" = label key + how to compute the body cell, the right-edge
      # row total, the bottom-edge column total, and the grand-corner value.
      measures <- list()
      add_measure <- function(key, cell, rowtot, coltot, grand_val) {
        measures[[length(measures) + 1L]] <<- list(
          key = key, cell = cell, rowtot = rowtot, coltot = coltot, grand = grand_val
        )
      }

      if (!isFALSE(cells$observed)) add_measure(
        "output.crosstabs.cellCount",
        function(i, j) cnt(tab[i, j]),
        function(i) cnt(row_tot[i]),
        function(j) cnt(col_tot[j]),
        cnt(grand)
      )
      if (isTRUE(cells$expected)) add_measure(
        "output.crosstabs.cellExpected",
        function(i, j) round(exp_mat[i, j], 1),
        function(i) cnt(row_tot[i]),
        function(j) cnt(col_tot[j]),
        cnt(grand)
      )
      if (isTRUE(cells$rowPct)) add_measure(
        "output.crosstabs.cellRowPct",
        function(i, j) round(tab[i, j] / row_tot[i] * 100, 1),
        function(i) 100.0,
        function(j) round(col_tot[j] / grand * 100, 1),
        100.0
      )
      if (isTRUE(cells$colPct)) add_measure(
        "output.crosstabs.cellColPct",
        function(i, j) round(tab[i, j] / col_tot[j] * 100, 1),
        function(i) round(row_tot[i] / grand * 100, 1),
        function(j) 100.0,
        100.0
      )
      if (isTRUE(cells$totalPct)) add_measure(
        "output.crosstabs.cellTotalPct",
        function(i, j) round(tab[i, j] / grand * 100, 1),
        function(i) round(row_tot[i] / grand * 100, 1),
        function(j) round(col_tot[j] / grand * 100, 1),
        100.0
      )
      # Residuals are only meaningful inside the body; SPSS leaves their margins
      # blank, so the row/column totals and grand corner return "".
      if (isTRUE(cells$unstdResid)) add_measure(
        "output.crosstabs.cellResid",
        function(i, j) round(tab[i, j] - exp_mat[i, j], 1),
        function(i) "", function(j) "", ""
      )
      if (isTRUE(cells$stdResid)) add_measure(
        "output.crosstabs.cellStdResid",
        function(i, j) round((tab[i, j] - exp_mat[i, j]) / sqrt(exp_mat[i, j]), 1),
        function(i) "", function(j) "", ""
      )
      if (isTRUE(cells$adjResid)) add_measure(
        "output.crosstabs.cellAdjResid",
        function(i, j) {
          denom <- sqrt(exp_mat[i, j] * (1 - row_tot[i] / grand) * (1 - col_tot[j] / grand))
          if (denom == 0) 0 else round((tab[i, j] - exp_mat[i, j]) / denom, 1)
        },
        function(i) "", function(j) "", ""
      )
      # Always show at least the counts if nothing is selected.
      if (length(measures) == 0) add_measure(
        "output.crosstabs.cellCount",
        function(i, j) cnt(tab[i, j]),
        function(i) cnt(row_tot[i]),
        function(j) cnt(col_tot[j]),
        cnt(grand)
      )

      # Header: row-var name, blank measure column, column levels, Total.
      cols_hdr <- c(r_name, "", c_levels_disp, "output.col.total")
      out_rows <- list()

      # One block of sub-rows per row level.
      for (i in seq_along(r_levels)) {
        for (m in seq_along(measures)) {
          meas <- measures[[m]]
          lvl  <- if (m == 1L) r_levels_disp[i] else ""
          row  <- list(lvl, meas$key)
          for (j in seq_along(c_levels)) row <- c(row, list(meas$cell(i, j)))
          row <- c(row, list(meas$rowtot(i)))
          out_rows <- c(out_rows, list(row))
        }
      }
      # Bottom Total block.
      for (m in seq_along(measures)) {
        meas <- measures[[m]]
        lvl  <- if (m == 1L) "output.col.total" else ""
        row  <- list(lvl, meas$key)
        for (j in seq_along(c_levels)) row <- c(row, list(meas$coltot(j)))
        row <- c(row, list(meas$grand))
        out_rows <- c(out_rows, list(row))
      }

      all_tables <- c(all_tables, list(list(
        titleKey    = paste0("output.crosstabs.crosstabTitle:", title_name),
        columns     = as.list(cols_hdr),
        rows        = out_rows,
        footnoteKey = NULL
      )))

      # Numeric view of the data — needed for Linear-by-Linear Association,
      # correlations, eta and the numeric (rather than alphabetical) ordering
      # of ordinal categories. Computed here (not just in the ordinal-measures
      # block below) so the Chi-Square Tests table can use it too.
      rnum       <- suppressWarnings(as.numeric(rv))
      cnum       <- suppressWarnings(as.numeric(cv))
      numeric_ok <- !any(is.na(rnum)) && !any(is.na(cnum))

      # ── Chi-Square Tests ──────────────────────────────────────────────────────
      if (isTRUE(stats$chisquare) && nrow(tab) >= 2 && ncol(tab) >= 2) {
        ct    <- suppressWarnings(chisq.test(tab, correct = FALSE))
        df_v  <- as.integer(ct$parameter)
        pear  <- round(as.numeric(ct$statistic), 6)
        pearp <- round(ct$p.value, 6)
        is2x2 <- nrow(tab) == 2 && ncol(tab) == 2

        obs <- as.numeric(tab)
        exp <- as.numeric(ct$expected)
        nz  <- obs > 0 & exp > 0
        g2  <- 2 * sum(obs[nz] * log(obs[nz] / exp[nz]))
        g2p <- pchisq(g2, df_v, lower.tail = FALSE)

        # Exact/Monte Carlo p-values (EXACT1): optional Monte Carlo estimate
        # of the Pearson chi-square p-value, alongside the default asymptotic
        # one — SPSS recommends this when expected cell counts are small.
        mc <- sai_monte_carlo_chisq(tab, params)
        has_mc <- !is.null(mc)

        # SPSS gives a 2×2 table two extra columns — Exact Sig. (2-sided) and
        # Exact Sig. (1-sided) — that only Fisher's row fills in; every other
        # row leaves them blank. Rows are built at their natural width below
        # and padded out to the table's full width in one pass at the end.
        has_exact <- is2x2 && discrete_counts

        # Helper: pad a row to 5 columns (adds a trailing NULL Monte Carlo Sig.
        # cell) when the table has an MC column but this row has no MC value.
        pad_row <- function(row) if (has_mc) c(row, list(NULL)) else row

        chisq_rows <- list(if (has_mc) {
          list("output.col.pearsonChiSq", pear, df_v, pearp, round(mc$p.value, 6))
        } else {
          list("output.col.pearsonChiSq", pear, df_v, pearp)
        })

        # Continuity Correction (Yates): SPSS reports this for every 2×2 table
        # by default, alongside Pearson — a separate chisq.test(correct=TRUE).
        if (is2x2) {
          cct <- suppressWarnings(chisq.test(tab, correct = TRUE))
          chisq_rows <- c(chisq_rows, list(pad_row(list(
            "output.col.continuityCorrection",
            round(as.numeric(cct$statistic), 6), as.integer(cct$parameter),
            round(cct$p.value, 6)
          ))))
        }

        chisq_rows <- c(chisq_rows, list(pad_row(list(
          "output.col.likelihoodRatio", round(g2, 6), df_v, round(g2p, 6)
        ))))

        # Fisher's exact test — exact for 2×2, Fisher–Freeman–Halton for larger
        # tables. Large tables can exceed the default workspace, so fall back to
        # a Monte-Carlo estimate if the exact computation fails. Requires
        # genuinely discrete counts — skipped (with a warning) for a weight
        # that produces fractional cell sums.
        if (discrete_counts) {
          pf <- tryCatch(
            fisher.test(tab, workspace = 2e7)$p.value,
            error = function(e) tryCatch(
              fisher.test(tab, simulate.p.value = TRUE, B = 20000)$p.value,
              error = function(e2) NA_real_
            )
          )
          if (!is.na(pf)) {
            # Fisher's p is EXACT, not asymptotic, so it belongs in the Exact
            # Sig. column — putting it under "Asymp. Sig." (what this script
            # used to do) mislabels it, and left the Value/df cells looking
            # like the test had simply failed to produce them.
            #
            # The 1-sided companion, which SPSS prints beside it for 2×2
            # tables, is the one-tailed probability in the direction of the
            # observed association — i.e. the smaller of the two one-sided
            # tests (verified against SPSS: 2-sided .155 / 1-sided .094 on the
            # 106/141/33/29 table in manuel-test/).
            if (has_exact) {
              p1 <- tryCatch(
                min(fisher.test(tab, alternative = "less")$p.value,
                    fisher.test(tab, alternative = "greater")$p.value),
                error = function(e) NA_real_
              )
              chisq_rows <- c(chisq_rows, list(c(
                list("output.col.fisherExact", NULL, NULL, NULL),
                if (has_mc) list(NULL) else NULL,
                list(round(pf, 6), if (is.na(p1)) NULL else round(p1, 6))
              )))
            } else {
              chisq_rows <- c(chisq_rows, list(
                pad_row(list("output.col.fisherExact", NULL, NULL, round(pf, 6)))))
            }
          }
        } else {
          warn_keys <- c(warn_keys, "output.crosstabs.warnExactWeighted")
        }

        # Linear-by-Linear Association (Mantel-Haenszel): SPSS reports this
        # when both variables are quantitative (numeric). χ² = (N−1)·r².
        if (numeric_ok && stats::sd(rnum) > 0 && stats::sd(cnum) > 0) {
          r_ll  <- suppressWarnings(cor(rnum, cnum))
          ll    <- (grand - 1) * r_ll^2
          ll_p  <- pchisq(ll, 1, lower.tail = FALSE)
          chisq_rows <- c(chisq_rows, list(pad_row(list(
            "output.col.linearByLinear", round(ll, 6), 1L, round(ll_p, 6)
          ))))
        }

        # McNemar test (2×2 paired nominal): exact binomial on the discordant
        # cells b and c — same discreteness requirement as Fisher's exact.
        #
        # McNemar compares the SAME trait measured twice, so both variables must
        # carry identical category sets — otherwise "b" and "c" are not
        # discordant pairs of one trait and the p-value is meaningless. SPSS
        # enforces exactly this ("Both variables must have identical values of
        # categories." — its own footnote c) and prints a dot. Without the check
        # a cross of e.g. symptom{0,1} × sex{1,2} silently produced a highly
        # "significant" p, which is a false positive, not a near-miss.
        if (isTRUE(stats$mcnemar) && nrow(tab) == 2 && ncol(tab) == 2 && discrete_counts) {
          if (identical(sort(rownames(tab)), sort(colnames(tab)))) {
            b <- tab[1, 2]; cc <- tab[2, 1]
            mp <- min(1, 2 * pbinom(min(b, cc), b + cc, 0.5))
            mcnemar_row <- pad_row(list("output.col.mcnemar", NULL, NULL, round(mp, 6)))
            chisq_rows <- c(chisq_rows, list(mcnemar_row))
          } else {
            # Keep the row (so the user sees the test was asked for) but leave
            # it empty, exactly like SPSS, and say why in a warning.
            chisq_rows <- c(chisq_rows, list(pad_row(list(
              "output.col.mcnemar", NULL, NULL, NULL
            ))))
            warn_keys <- c(warn_keys, "output.crosstabs.warnMcnemarCategories")
          }
        }

        n_valid_row <- pad_row(list("output.col.nValidCases", cnt(grand), NULL, NULL))
        chisq_rows <- c(chisq_rows, list(n_valid_row))

        # SPSS-style footnote: how many (and what %) of cells have an expected
        # count below 5, plus the minimum expected count.
        n_lt5   <- sum(exp < 5)
        pct_lt5 <- round(n_lt5 / length(exp) * 100, 1)
        min_exp <- round(min(exp), 2)
        foot    <- paste0("output.crosstabs.chiSqFootnote:",
                          n_lt5, "|", pct_lt5, "|", min_exp)

        chisq_cols <- c(
          list("output.col.statistic", "output.col.value", "output.col.df",
               "output.col.sig"),
          if (has_mc) list("output.col.monteCarloSig") else NULL,
          if (has_exact) list("output.col.exactSig2", "output.col.exactSig1") else NULL
        )

        # Rows are built at whatever width each test needed; square them off so
        # every row has one cell per column.
        chisq_rows <- lapply(chisq_rows, function(r) {
          if (length(r) < length(chisq_cols)) {
            r <- c(r, rep(list(NULL), length(chisq_cols) - length(r)))
          }
          r
        })

        all_tables <- c(all_tables, list(list(
          titleKey    = paste0("output.crosstabs.chiSqTitle:", title_name),
          columns     = chisq_cols,
          rows        = chisq_rows,
          footnoteKey = foot
        )))
      }

      # ── Association measures (Symmetric & Directional) ────────────────────────
      want_nominal <- isTRUE(stats$phiCramer) || isTRUE(stats$contingency)
      want_ordinal <- isTRUE(stats$gamma) || isTRUE(stats$taub) ||
                      isTRUE(stats$tauc)  || isTRUE(stats$somersd)
      want_corr    <- isTRUE(stats$correlations)
      want_eta     <- isTRUE(stats$eta)

      sym_rows <- list()  # Symmetric Measures
      dir_rows <- list()  # Directional Measures
      n2x2     <- nrow(tab) >= 2 && ncol(tab) >= 2

      # rnum/cnum/numeric_ok are computed earlier (used by the Chi-Square
      # Tests table's Linear-by-Linear Association row too).

      # Nominal measures derived from Pearson chi-square.
      if (want_nominal && n2x2) {
        ct2  <- suppressWarnings(chisq.test(tab, correct = FALSE))
        chi2 <- as.numeric(ct2$statistic)
        psig <- round(ct2$p.value, 6)
        mdim <- min(nrow(tab), ncol(tab))
        if (isTRUE(stats$phiCramer)) {
          # sqrt(chi2/N) is |phi| — fine for r×c, but for a 2×2 table SPSS
          # reports a SIGNED phi, whose sign is that of (ad − bc) and tells the
          # reader the direction of the association (the ordinal measures below
          # already carry a sign, so an unsigned phi sitting among them read as
          # a contradiction). Beyond 2×2 the sign is undefined and SPSS shows
          # the magnitude, same as here.
          phi_val <- sqrt(chi2 / grand)
          if (nrow(tab) == 2 && ncol(tab) == 2) {
            phi_val <- phi_val * sign(tab[1, 1] * tab[2, 2] - tab[1, 2] * tab[2, 1])
          }
          sym_rows <- c(sym_rows,
            list(list("output.col.nominal", "output.col.phi",
                      round(phi_val, 6), psig)),
            list(list("output.col.nominal", "output.col.cramersV",
                      round(sqrt(chi2 / (grand * (mdim - 1))), 6), psig)))
        }
        if (isTRUE(stats$contingency)) {
          sym_rows <- c(sym_rows, list(list(
            "output.col.nominal", "output.col.contingency",
            round(sqrt(chi2 / (chi2 + grand)), 6), psig)))
        }
      } else if (want_nominal) {
        warn_keys <- c(warn_keys, "output.crosstabs.warnNominal2x2")
      }

      # ── Nominal-by-nominal DIRECTIONAL measures ───────────────────────────────
      # Lambda / Goodman & Kruskal tau / Uncertainty coefficient are all
      # proportional-reduction-in-error measures: each says how much better you
      # predict the dependent variable once you know the independent one. SPSS
      # prints a symmetric version plus one per direction, so each ticked option
      # contributes three rows to Directional Measures.
      if ((isTRUE(stats$lambda) || isTRUE(stats$uncertainty)) && n2x2) {
        rt_n <- rowSums(tab); ct_n <- colSums(tab)
        dep_row <- paste0("output.crosstabs.dependent:", r_name)
        dep_col <- paste0("output.crosstabs.dependent:", c_name)

        if (isTRUE(stats$lambda)) {
          # Lambda (Guttman): errors predicting the dependent without the
          # independent (its modal category) vs. with it (each slice's mode).
          sum_max_r <- sum(apply(tab, 2, max))   # predict ROW var from column
          sum_max_c <- sum(apply(tab, 1, max))   # predict COLUMN var from row
          max_r <- max(rt_n); max_c <- max(ct_n)
          lam_row <- if (grand - max_r > 0) (sum_max_r - max_r) / (grand - max_r) else 0
          lam_col <- if (grand - max_c > 0) (sum_max_c - max_c) / (grand - max_c) else 0
          lam_den <- 2 * grand - max_r - max_c
          lam_sym <- if (lam_den > 0)
            (sum_max_r + sum_max_c - max_r - max_c) / lam_den else 0
          dir_rows <- c(dir_rows,
            list(list("output.col.lambda", "output.col.symmetric", round(lam_sym, 6), NULL)),
            list(list("output.col.lambda", dep_row, round(lam_row, 6), NULL)),
            list(list("output.col.lambda", dep_col, round(lam_col, 6), NULL)))

          # Goodman & Kruskal tau: the same PRE idea, but errors are counted by
          # proportional (rather than modal) prediction, so it is asymmetric
          # only — SPSS prints no symmetric row for it.
          #
          # tau(row dependent) = (sum_j (sum_i n_ij^2 / n_.j) - sum_i n_i.^2/N)
          #                    / (N - sum_i n_i.^2/N)
          tau_of <- function(m, dep_tot, ind_tot) {
            num <- sum(vapply(seq_along(ind_tot), function(j) {
              if (ind_tot[j] > 0) sum(m[, j]^2) / ind_tot[j] else 0
            }, numeric(1)))
            base <- sum(dep_tot^2) / grand
            den <- grand - base
            if (den > 0) (num - base) / den else 0
          }
          tau_row <- tau_of(tab, rt_n, ct_n)               # row var dependent
          tau_col <- tau_of(t(tab), ct_n, rt_n)            # column var dependent
          dir_rows <- c(dir_rows,
            list(list("output.col.gkTau", dep_row, round(tau_row, 6), NULL)),
            list(list("output.col.gkTau", dep_col, round(tau_col, 6), NULL)))
        }

        if (isTRUE(stats$uncertainty)) {
          # Uncertainty coefficient (Theil's U): the entropy analogue — the
          # share of the dependent's uncertainty explained by the independent.
          ent <- function(counts) {
            p <- counts[counts > 0] / grand
            -sum(p * log(p))
          }
          hr <- ent(rt_n); hc <- ent(ct_n); hrc <- ent(as.numeric(tab))
          info <- hr + hc - hrc                 # mutual information
          u_row <- if (hr > 0) info / hr else 0  # row var dependent
          u_col <- if (hc > 0) info / hc else 0  # column var dependent
          u_sym <- if ((hr + hc) > 0) 2 * info / (hr + hc) else 0
          # The likelihood-ratio chi-square tests all three against zero: under
          # independence 2*N*info ~ chi2 with (R-1)(C-1) df.
          u_df  <- (nrow(tab) - 1) * (ncol(tab) - 1)
          u_sig <- round(pchisq(2 * grand * info, u_df, lower.tail = FALSE), 6)
          dir_rows <- c(dir_rows,
            list(list("output.col.uncertainty", "output.col.symmetric", round(u_sym, 6), u_sig)),
            list(list("output.col.uncertainty", dep_row, round(u_row, 6), u_sig)),
            list(list("output.col.uncertainty", dep_col, round(u_col, 6), u_sig)))
        }
      } else if (isTRUE(stats$lambda) || isTRUE(stats$uncertainty)) {
        warn_keys <- c(warn_keys, "output.crosstabs.warnNominal2x2")
      }

      # Ordinal measures via concordant/discordant pair counts. The shared
      # significance is the tie-corrected Kendall normal approximation under
      # independence (identical to stats::cor.test(method="kendall")) — a valid
      # test that the measure equals zero.
      if (want_ordinal && n2x2) {
        tab_o <- if (numeric_ok) table(factor(rnum), factor(cnum)) else tab
        Ro <- nrow(tab_o); Co <- ncol(tab_o)
        rt_o <- rowSums(tab_o); ct_o <- colSums(tab_o)
        P <- 0; Q <- 0
        for (i in seq_len(Ro)) for (j in seq_len(Co)) {
          cc2 <- 0; dd2 <- 0
          if (i < Ro && j < Co) cc2 <- cc2 + sum(tab_o[(i + 1):Ro, (j + 1):Co])
          if (i > 1  && j > 1)  cc2 <- cc2 + sum(tab_o[1:(i - 1), 1:(j - 1)])
          if (i < Ro && j > 1)  dd2 <- dd2 + sum(tab_o[(i + 1):Ro, 1:(j - 1)])
          if (i > 1  && j < Co) dd2 <- dd2 + sum(tab_o[1:(i - 1), (j + 1):Co])
          P <- P + tab_o[i, j] * cc2; Q <- Q + tab_o[i, j] * dd2
        }
        P <- P / 2; Q <- Q / 2; S <- P - Q
        T0 <- grand * (grand - 1) / 2
        T1 <- sum(rt_o * (rt_o - 1) / 2)
        T2 <- sum(ct_o * (ct_o - 1) / 2)
        v0 <- grand * (grand - 1) * (2 * grand + 5)
        vt <- sum(rt_o * (rt_o - 1) * (2 * rt_o + 5))
        vu <- sum(ct_o * (ct_o - 1) * (2 * ct_o + 5))
        v1 <- sum(rt_o * (rt_o - 1)) * sum(ct_o * (ct_o - 1)) /
              (2 * grand * (grand - 1))
        v2 <- sum(rt_o * (rt_o - 1) * (rt_o - 2)) *
              sum(ct_o * (ct_o - 1) * (ct_o - 2)) /
              (9 * grand * (grand - 1) * (grand - 2))
        var0 <- (v0 - vt - vu) / 18 + v1 + v2
        osig <- if (var0 > 0) round(2 * pnorm(-abs(S / sqrt(var0))), 6) else NULL

        if (isTRUE(stats$taub)) {
          taub <- if ((T0 - T1) > 0 && (T0 - T2) > 0)
            S / sqrt((T0 - T1) * (T0 - T2)) else 0
          sym_rows <- c(sym_rows, list(list(
            "output.col.ordinal", "output.col.kendallTaub", round(taub, 6), osig)))
        }
        if (isTRUE(stats$tauc)) {
          mm   <- min(Ro, Co)
          tauc <- if (mm > 1) 2 * mm * S / (grand^2 * (mm - 1)) else 0
          sym_rows <- c(sym_rows, list(list(
            "output.col.ordinal", "output.col.kendallTauc", round(tauc, 6), osig)))
        }
        if (isTRUE(stats$gamma)) {
          gamma <- if ((P + Q) > 0) (P - Q) / (P + Q) else 0
          sym_rows <- c(sym_rows, list(list(
            "output.col.ordinal", "output.col.gamma", round(gamma, 6), osig)))
        }
        if (isTRUE(stats$somersd)) {
          d_sym <- if (((T0 - T1) + (T0 - T2)) > 0)
            2 * S / ((T0 - T1) + (T0 - T2)) else 0
          d_row <- if ((T0 - T2) > 0) S / (T0 - T2) else 0  # row var dependent
          d_col <- if ((T0 - T1) > 0) S / (T0 - T1) else 0  # column var dependent
          dir_rows <- c(dir_rows,
            list(list("output.col.somersd", "output.col.symmetric",
                      round(d_sym, 6), osig)),
            list(list("output.col.somersd", paste0("output.crosstabs.dependent:", r_name),
                      round(d_row, 6), osig)),
            list(list("output.col.somersd", paste0("output.crosstabs.dependent:", c_name),
                      round(d_col, 6), osig)))
        }
        if (!numeric_ok) warn_keys <- c(warn_keys, "output.crosstabs.warnOrdinalOrder")
      } else if (want_ordinal) {
        warn_keys <- c(warn_keys, "output.crosstabs.warnOrdinal2x2")
      }

      # Correlations: Spearman (ordinal) + Pearson's R (interval). Need numeric,
      # non-constant variables.
      if (want_corr) {
        if (numeric_ok && length(rnum) > 2 &&
            stats::sd(rnum) > 0 && stats::sd(cnum) > 0) {
          pr <- suppressWarnings(cor.test(rnum, cnum, method = "pearson"))
          sp <- suppressWarnings(cor.test(rnum, cnum, method = "spearman", exact = FALSE))
          sym_rows <- c(sym_rows,
            list(list("output.col.ordinal", "output.col.spearman",
                      round(as.numeric(sp$estimate), 6), round(sp$p.value, 6))),
            list(list("output.col.interval", "output.col.pearsonR",
                      round(as.numeric(pr$estimate), 6), round(pr$p.value, 6))))
        } else {
          warn_keys <- c(warn_keys, "output.crosstabs.warnCorrNumeric")
        }
      }

      # Cohen's Kappa (agreement) — only for square tables with matching
      # row/column categories. When it is requested and the categories do not
      # match, say so: an implementation that pairs the categories by position
      # instead would print a number here, and silence is the one response that
      # leaves the user unable to tell which happened. Same channel as
      # warnMcnemarCategories, which is the identical situation.
      if (isTRUE(stats$kappa) &&
          !(nrow(tab) == ncol(tab) && all(rownames(tab) == colnames(tab)))) {
        warn_keys <- c(warn_keys, "output.crosstabs.warnKappaCategories")
      }
      if (isTRUE(stats$kappa) && nrow(tab) == ncol(tab) && all(rownames(tab) == colnames(tab))) {
        po <- sum(diag(tab)) / grand
        pr <- rowSums(tab) / grand; pc <- colSums(tab) / grand
        pe <- sum(pr * pc)
        if (pe < 1) {
          kap <- (po - pe) / (1 - pe)
          se0 <- sqrt(pe + pe^2 - sum(pr * pc * (pr + pc))) / ((1 - pe) * sqrt(grand))
          ksig <- if (se0 > 0) round(2 * pnorm(-abs(kap / se0)), 6) else NULL
          sym_rows <- c(sym_rows, list(list(
            "output.col.agreement", "output.col.kappa", round(kap, 6), ksig)))
        }
      }

      # Eta (nominal × interval, directional): the interval variable is the
      # dependent; reported once with each variable taken as dependent.
      if (want_eta) {
        if (numeric_ok) {
          # Weight Cases: each group's contribution to SSB uses its weighted
          # mean and summed weight in place of length()/mean(); w = NULL
          # reproduces the original unweighted formula exactly.
          eta_of <- function(y, g, weight = NULL) {
            gm <- wtd_mean(y, weight)
            if (is.null(weight)) {
              sst <- sum((y - gm)^2)
              if (sst == 0) return(0)
              ssb <- sum(tapply(y, g, function(v) length(v) * (mean(v) - gm)^2))
            } else {
              sst <- sum(weight * (y - gm)^2)
              if (sst == 0) return(0)
              idx_by_g <- split(seq_along(y), g)
              ssb <- sum(vapply(idx_by_g, function(idx) {
                sum(weight[idx]) * (wtd_mean(y[idx], weight[idx]) - gm)^2
              }, numeric(1)))
            }
            sqrt(ssb / sst)
          }
          dir_rows <- c(dir_rows,
            list(list("output.col.eta", paste0("output.crosstabs.dependent:", r_name),
                      round(eta_of(rnum, cv, wv), 6), NULL)),
            list(list("output.col.eta", paste0("output.crosstabs.dependent:", c_name),
                      round(eta_of(cnum, rv, wv), 6), NULL)))
        } else {
          warn_keys <- c(warn_keys, "output.crosstabs.warnEtaNumeric")
        }
      }

      if (length(sym_rows) > 0) {
        sym_rows <- c(sym_rows,
          list(list("", "output.col.nValidCases", cnt(grand), NULL)))
        all_tables <- c(all_tables, list(list(
          titleKey    = paste0("output.crosstabs.symTitle:", title_name),
          columns     = list("", "", "output.col.value", "output.col.approxSig"),
          rows        = sym_rows,
          footnoteKey = "output.crosstabs.measuresFootnote"
        )))
      }
      if (length(dir_rows) > 0) {
        dir_rows <- c(dir_rows,
          list(list("", "output.col.nValidCases", cnt(grand), NULL)))
        all_tables <- c(all_tables, list(list(
          titleKey    = paste0("output.crosstabs.dirTitle:", title_name),
          columns     = list("", "", "output.col.value", "output.col.approxSig"),
          rows        = dir_rows,
          footnoteKey = "output.crosstabs.measuresFootnote"
        )))
      }

      # Risk Estimate (2×2): odds ratio + relative risks with 95% CIs.
      if (isTRUE(stats$risk) && nrow(tab) == 2 && ncol(tab) == 2 && all(tab > 0)) {
        a <- tab[1, 1]; b <- tab[1, 2]; cc <- tab[2, 1]; d <- tab[2, 2]
        or  <- (a * d) / (b * cc)
        sel <- sqrt(1 / a + 1 / b + 1 / cc + 1 / d)
        r1  <- (a / (a + b)) / (cc / (cc + d))   # cohort, column 1
        se1 <- sqrt(b / (a * (a + b)) + d / (cc * (cc + d)))
        r2  <- (b / (a + b)) / (d / (cc + d))    # cohort, column 2
        se2 <- sqrt(a / (b * (a + b)) + cc / (d * (cc + d)))
        # qnorm(0.975) is the exact 95% quantile SPSS uses (see roc.R).
        .z95 <- qnorm(0.975)
        ci <- function(est, se) list(round(est * exp(-.z95 * se), 3), round(est * exp(.z95 * se), 3))
        risk_rows <- list(
          list("output.col.oddsRatio", round(or, 3), ci(or, sel)[[1]], ci(or, sel)[[2]]),
          list(paste0("output.crosstabs.cohort:", c_levels_disp[1]), round(r1, 3),
               ci(r1, se1)[[1]], ci(r1, se1)[[2]]),
          list(paste0("output.crosstabs.cohort:", c_levels_disp[2]), round(r2, 3),
               ci(r2, se2)[[1]], ci(r2, se2)[[2]]),
          list("output.col.nValidCases", cnt(grand), NULL, NULL))
        all_tables <- c(all_tables, list(list(
          titleKey    = paste0("output.crosstabs.riskTitle:", title_name),
          columns     = list("", "output.col.value", "output.col.ciLower95",
                             "output.col.ciUpper95"),
          rows        = risk_rows, footnoteKey = NULL)))
      }
    }
  }

  # Case Processing Summary goes first, ahead of every pair's own tables.
  if (length(cps_rows) > 0) {
    all_tables <- c(list(list(
      titleKey = "output.cps.title",
      columns  = list("", "output.cps.validN", "output.cps.validPct",
                      "output.cps.missingN", "output.cps.missingPct",
                      "output.cps.totalN", "output.cps.totalPct"),
      rows     = cps_rows
    )), all_tables)
  }

  progress(100L, "progress.done")
  sai_output(tables = all_tables, warnings = unique(warn_keys))

}, error = function(e) {
  sai_error(conditionMessage(e))
})
