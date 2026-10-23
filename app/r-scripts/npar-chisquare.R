# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-chisquare.R — Chi-Square goodness-of-fit (SPSS-style).
#
# Params: variables (colIds), varNames, options$pMethod. Expected = all
#         categories equal.
# Output: per variable a frequencies table (Category, Observed N, Expected N,
#         Residual) + a "Test Statistics" table (Chi-Square, df, Asymp. Sig.,
#         + optional Monte Carlo Sig.).
#
# Science-over-SPSS (CLAUDE.md §11): the asymptotic χ² p-value is unreliable
# when expected cell counts are small; an optional Monte Carlo estimate
# (base R chisq.test(simulate.p.value=TRUE), same infra as Crosstabs) is
# offered via the shared pMethod option — no extra package required.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  # Weight Cases (W1): observed counts become weighted sums (Σw per category).
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  vars <- unlist(params$variables); var_names <- params$varNames
  if (length(vars) == 0) sai_error("No test variables")

  cnt <- function(x) format_wtd_count(x, w)
  # Global flag: was Monte Carlo requested? (pMethod is dataset-wide, so the
  # Test Statistics column set is consistent across variables.)
  want_mc <- !is.null(params$options$pMethod) &&
             identical(params$options$pMethod$method, "montecarlo")

  tables <- list(); test_rows <- list()
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    x_all  <- as.character(apply_user_missing(df[[v]], v, params))
    keep_v <- !is.na(x_all) & x_all != "NA"
    x  <- x_all[keep_v]
    wv <- if (is.null(w)) NULL else w[keep_v]
    if (length(x) == 0) next
    tab <- if (is.null(wv)) table(x) else tapply(wv, x, sum)
    k <- length(tab); N <- sum(tab)
    exp <- N / k
    freq_rows <- lapply(names(tab), function(cat) list(
      cat, cnt(tab[[cat]]), round(exp, 1), round(tab[[cat]] - exp, 1)))
    freq_rows <- c(freq_rows, list(list("output.col.total", cnt(N), "", "")))
    tables <- c(tables, list(list(
      titleKey = paste0("output.nparChiSq.freqTitle:", nm),
      columns = list("output.col.category", "output.col.observedN",
                     "output.col.expectedN", "output.col.residual"),
      rows = freq_rows, footnoteKey = NULL)))
    chi <- sum((as.numeric(tab) - exp)^2 / exp); dfree <- k - 1
    p <- pchisq(chi, dfree, lower.tail = FALSE)
    # Monte Carlo goodness-of-fit p (chisq.test on the 1D count vector); the
    # shared helper needs integer counts, so it returns NULL for fractional
    # weighted sums (→ blank cell, honest).
    mc <- sai_monte_carlo_chisq(tab, params)
    row <- list(nm, round(chi, 3), dfree, round(p, 6))
    if (want_mc) row <- c(row, list(if (is.null(mc)) NULL else round(mc$p.value, 6)))
    test_rows <- c(test_rows, list(row))
  }
  if (length(test_rows) == 0) sai_error("No data for chi-square test")
  ts_cols <- list("output.col.variable", "output.col.chiSquare", "output.col.df",
                  "output.col.asympSig")
  if (want_mc) ts_cols <- c(ts_cols, list("output.col.monteCarloSig"))
  tables <- c(tables, list(list(
    titleKey = "output.npar.testStatsTitle",
    columns = ts_cols,
    rows = test_rows, footnoteKey = NULL)))

  progress(100L, "progress.done")
  sai_output(tables = tables)
}, error = function(e) sai_error(conditionMessage(e)))
