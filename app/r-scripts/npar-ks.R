# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-ks.R — One-Sample Kolmogorov-Smirnov (SPSS-style).
#
# Params: variables (colIds), varNames, dist ("normal"|"uniform"|"poisson"|
#         "exponential", default normal).
# Output: per variable N, distribution parameters, Most Extreme Differences
#         (Absolute/Positive/Negative), Kolmogorov-Smirnov Z, Asymp. Sig.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  vars <- unlist(params$variables); var_names <- params$varNames
  # Options ▸ Missing Values (listwise) and Statistics — _bootstrap.R helpers
  # shared by Binomial, One-Sample K-S and Runs.
  df <- npar_listwise(df, NULL, vars, params)$df
  dist <- if (is.null(params$dist)) "normal" else params$dist
  if (length(vars) == 0) sai_error("No test variables")

  # SPSS 26's own "Asymp. Sig. (2-tailed)" on this table is LILLIEFORS-corrected
  # (its footnote says so, and it is capped at .200 with "this is a lower bound
  # of the true significance"). The classical column below is the uncorrected
  # one, which is liberal whenever the parameters come from the sample being
  # tested — CLAUDE.md §11's exception. So both are reported: the SPSS-style
  # classical Z/Sig, and the corrected Sig that SPSS actually prints, as its own
  # column (the "add the scientifically correct value as an extra column"
  # pattern §11 prescribes).
  has_nortest <- dist == "normal" && requireNamespace("nortest", quietly = TRUE)

  rows <- list()
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    # User-missing values used to reach the test as data.
    x  <- suppressWarnings(as.numeric(apply_user_missing(df[[v]], v, params))); x <- x[!is.na(x)]
    n  <- length(x); if (n < 2) next
    xs <- sort(x)
    if (dist == "uniform") {
      Fx <- punif(xs, min(xs), max(xs)); p1 <- min(xs); p2 <- max(xs)
    } else if (dist == "exponential") {
      Fx <- pexp(xs, 1 / mean(xs)); p1 <- mean(xs); p2 <- NA
    } else if (dist == "poisson") {
      Fx <- ppois(xs, mean(xs)); p1 <- mean(xs); p2 <- NA
    } else {
      Fx <- pnorm(xs, mean(xs), sd(xs)); p1 <- mean(xs); p2 <- sd(xs)
    }
    emp_hi <- (seq_len(n)) / n
    emp_lo <- (seq_len(n) - 1) / n
    dPlus  <- max(emp_hi - Fx)
    dMinus <- max(Fx - emp_lo)
    dAbs   <- max(dPlus, dMinus)
    Z <- sqrt(n) * dAbs
    # Two-sided asymptotic Kolmogorov p-value (same series stats::ks.test uses).
    k <- seq_len(100)
    p <- 2 * sum((-1)^(k - 1) * exp(-2 * k^2 * Z^2))
    p <- min(max(p, 0), 1)
    # Lilliefors needs n >= 5 (nortest errors below that) and only makes sense
    # for the normal case, where the parameters were estimated here.
    lil <- if (has_nortest && n >= 5) {
      tryCatch(round(nortest::lillie.test(x)$p.value, 6), error = function(e) NULL)
    } else {
      NULL
    }
    rows <- c(rows, list(list(nm, as.integer(n), round(p1, 4),
      if (is.na(p2)) "" else round(p2, 4),
      round(dAbs, 3), round(dPlus, 3), round(-dMinus, 3), round(Z, 3), round(p, 6), lil)))
  }
  if (length(rows) == 0) sai_error("No data for K-S test")

  # The warning stays only when the correction could NOT be computed (nortest
  # missing): the uncorrected p is then the only one on the table and the user
  # has to know it is liberal. With the column present, the honest number is
  # already in front of them.
  warn_keys <- if (dist == "normal" && !has_nortest) {
    "output.nparKS.lillieforsWarning"
  } else {
    character(0)
  }

  progress(100L, "progress.done")
  desc_tbl <- npar_descriptives_table(df, NULL, vars, var_names, params)
  sai_output(
    tables = c(if (is.null(desc_tbl)) list() else list(desc_tbl), list(list(
      titleKey = "output.nparKS.title",
      columns = c(
        list("output.col.variable", "output.col.n", "output.col.mean",
             "output.col.stdDeviation", "output.col.absDiff", "output.col.posDiff",
             "output.col.negDiff", "output.col.ksZ", "output.col.asympSig"),
        if (has_nortest) list("output.col.lillieforsSig") else list()
      ),
      rows = rows, footnoteKey = "output.nparKS.footnote"))),
    warnings = warn_keys
  )
}, error = function(e) sai_error(conditionMessage(e)))
