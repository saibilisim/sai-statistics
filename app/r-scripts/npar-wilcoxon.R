# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-wilcoxon.R — Wilcoxon Signed-Rank (2 Related Samples, SPSS-style).
#
# Params: var1 (colIds), var2 (colIds, zipped), varNames,
#         options$continuityCorrection (default FALSE).
# Output: "Ranks" (Negative/Positive Ranks, Ties, Total: N, Mean Rank, Sum) +
#         "Test Statistics" (Z, Asymp. Sig. 2-tailed, Exact Sig.). Z from the
#         normal approx — tie-corrected, no continuity term, as SPSS computes
#         it (the ±0.5 correction of R's wilcox.test default is opt-in); Exact
#         Sig. from base R stats::wilcox.test(exact=TRUE) when valid (no ties
#         among the nonzero |differences| and n < 50) — science-over-SPSS
#         policy (CLAUDE.md §11), same as npar-mann-whitney.R.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  v1 <- unlist(params$var1); v2 <- unlist(params$var2); var_names <- params$varNames
  npairs <- min(length(v1), length(v2))
  if (npairs == 0) sai_error("No variable pairs")
  nm_of <- function(c) resolve_var_name(c, var_names)

  # Missing Values (MV): "Exclude cases test by test" (default — each pair's
  # own `ok` mask below, independent of other pairs) vs "Exclude cases
  # listwise" (drop a case if it's missing on ANY variable across ANY pair —
  # not just the pair currently being tested). Same contract as
  # npar-kruskal-wallis.R / anova-oneway.R.
  df <- apply_listwise(df, union(v1, v2), params)
  want_cc <- isTRUE(params$options$continuityCorrection)

  rank_rows <- list(); test_rows <- list()
  for (i in seq_len(npairs)) {
    a <- v1[i]; b <- v2[i]
    pair <- paste0(nm_of(b), " - ", nm_of(a))   # SPSS: var2 - var1
    xa <- suppressWarnings(as.numeric(df[[a]])); xb <- suppressWarnings(as.numeric(df[[b]]))
    ok <- !is.na(xa) & !is.na(xb)
    d  <- xb[ok] - xa[ok]
    # Subtracting two decimal values in binary floating point turns genuine
    # ties into near-ties: on the parity fixture |post-pre| produced
    # 1.8399999999999892 and 1.8400000000000034 for two cases that are tied at
    # 1.84, one negative and one positive. Ranking them as distinct moved half
    # a rank between the two sign groups (sums 1312/5709 instead of SPSS's
    # 1312.5/5708.5) and shifted Z. Snap to a precision no real measurement
    # carries before deciding what counts as a tie.
    d  <- round(d, 10)
    nz <- d[d != 0]; nties <- sum(d == 0)
    if (length(nz) < 1) next
    r  <- rank(abs(nz))
    negN <- sum(nz < 0); posN <- sum(nz > 0)
    negSum <- sum(r[nz < 0]); posSum <- sum(r[nz > 0])
    rank_rows <- c(rank_rows,
      list(list(pair, "output.col.negRanks", negN,
                if (negN > 0) round_half_up(negSum / negN, 2) else 0, round_half_up(negSum, 2))),
      list(list("", "output.col.posRanks", posN,
                if (posN > 0) round_half_up(posSum / posN, 2) else 0, round_half_up(posSum, 2))),
      list(list("", "output.col.ties", nties, "", "")),
      list(list("", "output.col.total", length(d), "", "")))
    nn <- length(nz)
    Tstat <- min(negSum, posSum)
    tct <- table(r); tie <- sum(tct^3 - tct)
    muT <- nn * (nn + 1) / 4
    sigma <- sqrt(nn * (nn + 1) * (2 * nn + 1) / 24 - tie / 48)
    z_num <- Tstat - muT
    if (want_cc && z_num != 0) z_num <- z_num - sign(z_num) * 0.5
    Z <- z_num / sigma
    p <- 2 * pnorm(-abs(Z))

    # Exact p: base R's signed-rank exact distribution is valid only with no
    # ties among the nonzero |differences| and n < 50 (its `exact=TRUE`
    # preconditions). wilcox.test(paired=TRUE) drops zero differences itself,
    # matching our `nz`. Gate on the same conditions; blank otherwise.
    exact_ok <- nn < 50 && !any(duplicated(abs(nz)))
    pExact <- if (exact_ok) {
      tryCatch(
        suppressWarnings(wilcox.test(xb[ok], xa[ok], paired = TRUE, exact = TRUE)$p.value),
        error = function(e) NA_real_
      )
    } else NA_real_

    test_rows <- c(test_rows, list(list(pair, round(Z, 3), round(p, 6),
      if (is.na(pExact)) NULL else round(pExact, 6))))
  }
  if (length(test_rows) == 0) sai_error("Not enough paired data")

  progress(100L, "progress.done")
  sai_output(tables = list(
    list(titleKey = "output.npar.ranksTitle",
         columns = list("output.col.variable", "output.col.group", "output.col.n",
                        "output.col.meanRank", "output.col.sumRanks"),
         rows = rank_rows, footnoteKey = NULL),
    list(titleKey = "output.npar.testStatsTitle",
         columns = list("output.col.variable", "output.col.z", "output.col.asympSig",
                        "output.col.exactSig"),
         rows = test_rows, footnoteKey = "output.npar.wilcoxonFootnote")
  ))
}, error = function(e) sai_error(conditionMessage(e)))
