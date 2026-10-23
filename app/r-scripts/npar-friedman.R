# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-friedman.R — Friedman Test (K Related Samples, SPSS-style).
#
# Params: variables (colIds, k related), varNames, options$pMethod,
#         options$pairwise.
# Output: "Ranks" (Mean Rank per variable) + "Test Statistics" (N, Chi-Square,
#         df, Asymp. Sig. [+ Monte Carlo/Exact Sig.]). Listwise complete cases.
#
# Science-over-SPSS (CLAUDE.md §11): optional Monte Carlo / exact p via `coin`
# (base R friedman.test has no exact/MC path); graceful "pMethodNotApplied"
# fallback when coin is absent. Same pattern as npar-kruskal-wallis.R.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  if (length(vars) < 2) sai_error("Friedman needs at least two variables")
  nm <- resolve_var_names(vars, var_names)

  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(df[[c]])))
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  n <- nrow(mat); k <- ncol(mat)
  if (n < 2) sai_error("Not enough complete cases")

  R <- t(apply(mat, 1, rank))            # rank within each row (case)
  mean_ranks <- colMeans(R)
  rank_rows <- lapply(seq_len(k), function(j) list(nm[j], round_half_up(mean_ranks[j], 2)))

  Rj <- colSums(R)
  # Tie-corrected Friedman statistic. The uncorrected form,
  #   (12 / (n·k·(k+1)))·ΣRj² − 3n(k+1),
  # assumes no tied values within a case; with Likert-type items ties are the
  # norm and it is biased DOWNWARD — on the parity fixture it gave 0.517 where
  # SPSS (and base R's own friedman.test) give 0.768, a p of .772 against .681.
  # Denominator is Σ(rank²) − n·k·(k+1)²/4, which collapses to the uncorrected
  # formula when no ranks are tied. Matches stats::friedman.test exactly
  # (verified in tests/r-validation/test-npar-friedman-ties.R).
  expected <- n * (k + 1) / 2
  tie_term <- sum(R^2) - n * k * (k + 1)^2 / 4
  chi <- if (tie_term > 0) (k - 1) * sum((Rj - expected)^2) / tie_term else 0
  dfree <- k - 1
  p <- pchisq(chi, dfree, lower.tail = FALSE)

  # Optional exact / Monte Carlo p via coin (base R friedman.test has neither).
  # coin needs long format: response y, condition factor, subject block factor.
  want_pmethod <- !is.null(params$options$pMethod) &&
    (identical(params$options$pMethod$method, "montecarlo") ||
     identical(params$options$pMethod$method, "exact"))
  pmethod_col <- if (!is.null(params$options$pMethod) &&
                     identical(params$options$pMethod$method, "exact")) {
    "output.col.exactSig"
  } else {
    "output.col.monteCarloSig"
  }
  fr_long <- data.frame(
    y = as.vector(mat),
    condition = factor(rep(seq_len(k), each = n)),
    block = factor(rep(seq_len(n), times = k))
  )
  mc <- sai_coin_pvalue(function(dist) {
    coin::friedman_test(y ~ condition | block, data = fr_long, distribution = dist)
  }, params)

  ts_row  <- list(n, round(chi, 3), dfree, round(p, 6))
  ts_cols <- list("output.col.n", "output.col.chiSquare", "output.col.df",
                  "output.col.asympSig")
  if (want_pmethod) {
    ts_row  <- c(ts_row, list(if (is.null(mc)) NULL else round(mc$p.value, 6)))
    ts_cols <- c(ts_cols, list(pmethod_col))
  }

  tables <- list(
    list(titleKey = "output.npar.ranksTitle",
         columns = list("output.col.variable", "output.col.meanRank"),
         rows = rank_rows, footnoteKey = NULL),
    list(titleKey = "output.npar.testStatsTitle",
         columns = ts_cols,
         rows = list(ts_row),
         footnoteKey = "output.npar.friedmanFootnote")
  )

  # Pairwise comparisons (Dunn-Bonferroni on rank sums, k related samples):
  # same z/Bonferroni logic as Kruskal-Wallis, but using each condition's mean
  # rank across the N subjects (paired design, so every condition has the
  # same N — no per-group ni term).
  if (isTRUE(params$options$pairwise) && k > 2) {
    n_comparisons <- k * (k - 1) / 2
    pw_rows <- list()
    for (i in seq_len(k - 1)) {
      for (j in (i + 1):k) {
        se <- sqrt(k * (k + 1) / (6 * n))
        z <- (mean_ranks[i] - mean_ranks[j]) / se
        p_raw <- 2 * pnorm(-abs(z))
        p_adj <- min(1, p_raw * n_comparisons)
        pw_rows <- c(pw_rows, list(list(
          paste0(nm[i], "-", nm[j]),
          round(mean_ranks[i] - mean_ranks[j], 3),
          round(se, 4), round(z, 3),
          round(p_raw, 6), round(p_adj, 6))))
      }
    }
    tables <- c(tables, list(list(
      titleKey = "output.npar.pairwiseTitle",
      columns = list("output.npar.sample1Sample2", "output.npar.testStat",
                     "output.npar.stdError", "output.npar.stdTestStat",
                     "output.col.sig", "output.npar.adjSig"),
      rows = pw_rows,
      footnoteKey = "output.npar.pairwiseFootnote"
    )))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables)
}, error = function(e) sai_error(conditionMessage(e)))
