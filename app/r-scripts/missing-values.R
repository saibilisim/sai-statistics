# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# missing-values.R — Missing Value Analysis (SPSS Analyze → Missing Value Analysis).
#
# Params: variables (colIds, numeric), varNames.
# Output: "Univariate Statistics" (N, Mean, Std. Deviation, Missing Count,
#         Missing Percent per variable) and "Little's MCAR Test" (Chi-Square,
#         df, Sig.). MCAR test uses EM estimation of the MVN mean/covariance.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

# EM estimation of mean & covariance for multivariate normal with missing data.
em_mvn <- function(X, maxit = 200L, tol = 1e-6) {
  n <- nrow(X); p <- ncol(X)
  mu <- colMeans(X, na.rm = TRUE)
  S <- stats::cov(X, use = "pairwise.complete.obs"); S[is.na(S)] <- 0
  diag(S)[diag(S) <= 0] <- 1
  for (it in seq_len(maxit)) {
    T1 <- numeric(p); T2 <- matrix(0, p, p)
    for (i in seq_len(n)) {
      o <- which(!is.na(X[i, ])); m <- which(is.na(X[i, ]))
      xi <- numeric(p); cc <- matrix(0, p, p); xi[o] <- X[i, o]
      if (length(m) > 0) {
        if (length(o) > 0) {
          beta <- S[m, o, drop = FALSE] %*% solve(S[o, o, drop = FALSE])
          xi[m] <- mu[m] + beta %*% (X[i, o] - mu[o])
          cc[m, m] <- S[m, m, drop = FALSE] - beta %*% S[o, m, drop = FALSE]
        } else { xi[m] <- mu[m]; cc[m, m] <- S[m, m, drop = FALSE] }
      }
      T1 <- T1 + xi; T2 <- T2 + outer(xi, xi) + cc
    }
    mu_new <- T1 / n; S_new <- T2 / n - outer(mu_new, mu_new)
    done <- max(abs(mu_new - mu)) < tol && max(abs(S_new - S)) < tol
    mu <- mu_new; S <- S_new
    if (done) break
  }
  list(mu = mu, S = S)
}

tryCatch({
  progress(10L, "progress.loading")
  cols <- unlist(params$variables); var_names <- params$varNames
  if (length(cols) < 2) sai_error("Missing Value Analysis needs at least 2 variables")
  labels <- vapply(cols, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))
  # User-missing values are missing here too (they used to be read as data).
  X <- sapply(cols, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  X <- as.matrix(X); n <- nrow(X); p <- ncol(X)

  progress(40L, "progress.computing")
  uni_rows <- lapply(seq_len(p), function(j) {
    v <- X[, j]; nv <- sum(!is.na(v)); nm <- sum(is.na(v))
    list(labels[j], as.integer(nv),
         if (nv > 0) round(mean(v, na.rm = TRUE), 4) else NULL,
         if (nv > 1) round(sd(v, na.rm = TRUE), 4) else NULL,
         as.integer(nm), round(100 * nm / n, 1))
  })

  # Little's MCAR test via EM.
  warn <- character(0); mcar_rows <- list()
  mcar <- tryCatch({
    fit <- em_mvn(X); mu <- fit$mu; S <- fit$S
    R <- !is.na(X)
    patt <- apply(R, 1L, function(r) paste(as.integer(r), collapse = ""))
    d2 <- 0; dfree <- 0
    for (pk in unique(patt)) {
      idx <- which(patt == pk); o <- which(R[idx[1], ])
      if (length(o) == 0) next
      nj <- length(idx)
      xbar <- colMeans(X[idx, o, drop = FALSE])
      dd <- xbar - mu[o]
      d2 <- d2 + nj * as.numeric(t(dd) %*% solve(S[o, o, drop = FALSE]) %*% dd)
      dfree <- dfree + length(o)
    }
    dfree <- dfree - p
    if (dfree < 1) NULL
    else list(round(d2, 3), as.integer(dfree),
              round(pchisq(d2, dfree, lower.tail = FALSE), 6))
  }, error = function(e) NULL)
  if (is.null(mcar)) warn <- "output.missing.mcarUnavailable"
  else mcar_rows <- list(mcar)

  tables <- list(list(
    titleKey = "output.missing.uniTitle",
    columns = list("output.missing.variable", "output.col.n", "output.col.mean",
                   "output.col.stdDeviation", "output.missing.count",
                   "output.missing.percent"),
    rows = uni_rows, footnoteKey = NULL))
  if (length(mcar_rows) > 0) {
    tables <- c(tables, list(list(
      titleKey = "output.missing.mcarTitle",
      columns = list("output.col.chiSquare", "output.col.df", "output.col.sig"),
      rows = mcar_rows, footnoteKey = NULL)))
  }

  # ── SPSS MVA options ────────────────────────────────────────────────────────
  # options: { estimation: ["listwise","pairwise","em","regression"],
  #            tTests, mismatch, minPercent (default 5), patterns (tabulated) }
  opts <- if (is.null(params$options)) list() else params$options
  est <- unlist(opts$estimation)
  r3 <- function(x) if (is.na(x)) NULL else round_half_up(x, 4)
  min_pct <- suppressWarnings(as.numeric(opts$minPercent))
  if (length(min_pct) != 1 || is.na(min_pct)) min_pct <- 5

  # Summary of Estimated Means / Standard Deviations — one row per method,
  # one column per variable (SPSS's layout). "All Values" uses every
  # available value of the variable.
  pw_tbl <- NULL; em_cor_tbl <- NULL
  if (length(est)) {
    mean_rows <- list(c(list("output.missing.allValues"), lapply(seq_len(p), function(j) r3(mean(X[, j], na.rm = TRUE)))))
    sd_rows   <- list(c(list("output.missing.allValues"), lapply(seq_len(p), function(j) r3(sd(X[, j], na.rm = TRUE)))))
    cc <- stats::complete.cases(X)
    if ("listwise" %in% est) {
      if (sum(cc) >= 2) {
        mean_rows <- c(mean_rows, list(c(list("output.missing.listwise"), lapply(seq_len(p), function(j) r3(mean(X[cc, j]))))))
        sd_rows   <- c(sd_rows, list(c(list("output.missing.listwise"), lapply(seq_len(p), function(j) r3(sd(X[cc, j]))))))
      } else warn <- c(warn, "output.missing.listwiseEmpty")
    }
    if ("em" %in% est) {
      fit_em <- tryCatch(em_mvn(X), error = function(e) NULL)
      if (is.null(fit_em)) warn <- c(warn, "output.missing.emFailed") else {
        # EM's maximum-likelihood covariance (divisor n).
        sd_em <- sqrt(diag(fit_em$S))
        mean_rows <- c(mean_rows, list(c(list("output.missing.em"), lapply(fit_em$mu, r3))))
        sd_rows   <- c(sd_rows, list(c(list("output.missing.em"), lapply(sd_em, r3))))
        Rem <- stats::cov2cor(fit_em$S)
        em_cor_tbl <- list(
          titleKey = "output.missing.emCorTitle",
          columns = c(list("output.col.variable"), as.list(labels)),
          rows = lapply(seq_len(p), function(i) c(list(labels[i]), lapply(Rem[i, ], r3))),
          footnoteKey = if (length(mcar_rows)) paste0("output.missing.mcarFootnote:",
            mcar[[1]], "|", mcar[[2]], "|", mcar[[3]]) else NULL)
      }
    }
    if ("regression" %in% est) {
      # Regression estimation, "Estimation Adjustment: None": each missing
      # value is replaced by its prediction from the case's observed
      # variables, the regressions estimated on the complete cases.
      if (sum(cc) > p) {
        mu_l <- colMeans(X[cc, , drop = FALSE]); S_l <- stats::cov(X[cc, , drop = FALSE])
        Xr <- X
        for (i in which(!cc)) {
          o <- which(!is.na(X[i, ])); m <- which(is.na(X[i, ]))
          Xr[i, m] <- if (length(o)) mu_l[m] + S_l[m, o, drop = FALSE] %*% solve(S_l[o, o, drop = FALSE], X[i, o] - mu_l[o])
                      else mu_l[m]
        }
        mean_rows <- c(mean_rows, list(c(list("output.missing.regression"), lapply(seq_len(p), function(j) r3(mean(Xr[, j]))))))
        sd_rows   <- c(sd_rows, list(c(list("output.missing.regression"), lapply(seq_len(p), function(j) r3(sd(Xr[, j]))))))
      } else warn <- c(warn, "output.missing.regressionNotComputed")
    }
    if ("pairwise" %in% est) {
      Cp <- stats::cor(X, use = "pairwise.complete.obs")
      pw_tbl <- list(
        titleKey = "output.missing.pairwiseCorTitle",
        columns = c(list("output.col.variable"), as.list(labels)),
        rows = lapply(seq_len(p), function(i) c(list(labels[i]), lapply(Cp[i, ], r3))),
        footnoteKey = NULL)
    }
    tables <- c(tables, list(
      list(titleKey = "output.missing.meansSummaryTitle",
           columns = c(list("output.missing.method"), as.list(labels)), rows = mean_rows, footnoteKey = NULL),
      list(titleKey = "output.missing.sdSummaryTitle",
           columns = c(list("output.missing.method"), as.list(labels)), rows = sd_rows, footnoteKey = NULL)))
    if (!is.null(pw_tbl)) tables <- c(tables, list(pw_tbl))
    if (!is.null(em_cor_tbl)) tables <- c(tables, list(em_cor_tbl))
  }

  # Separate Variance t Tests (Descriptives ▸ t tests with groups formed by
  # indicator variables): for each variable missing in at least minPercent
  # of cases, Welch t tests of every other variable between the cases where
  # it is present and where it is missing.
  if (isTRUE(opts$tTests)) {
    trows <- list()
    for (i in seq_len(p)) {
      miss <- is.na(X[, i])
      if (100 * mean(miss) < min_pct || all(miss)) next
      first <- TRUE
      for (j in seq_len(p)) if (j != i) {
        a <- X[!miss, j]; b <- X[miss, j]; a <- a[!is.na(a)]; b <- b[!is.na(b)]
        tt <- if (length(a) >= 2 && length(b) >= 2) tryCatch(stats::t.test(a, b), error = function(e) NULL) else NULL
        trows[[length(trows) + 1L]] <- list(if (first) labels[i] else "", labels[j],
          if (is.null(tt)) NULL else round_half_up(unname(tt$statistic), 3),
          if (is.null(tt)) NULL else round_half_up(unname(tt$parameter), 1),
          if (is.null(tt)) NULL else round(tt$p.value, 6),
          length(a), length(b),
          if (length(a)) r3(mean(a)) else NULL, if (length(b)) r3(mean(b)) else NULL)
        first <- FALSE
      }
    }
    if (length(trows)) tables <- c(tables, list(list(
      titleKey = "output.missing.tTestTitle",
      columns = list("output.missing.indicator", "output.col.variable", "output.col.t", "output.col.df",
                     "output.missing.p2tail", "output.missing.nPresent", "output.missing.nMissing",
                     "output.missing.meanPresent", "output.missing.meanMissing"),
      rows = trows, footnoteKey = paste0("output.missing.tTestFootnote:", min_pct))))
  }

  # Percent Mismatch of Indicator Variables: % of cases where one variable
  # is missing and the other present; the diagonal is % missing.
  if (isTRUE(opts$mismatch)) {
    M <- is.na(X)
    mm <- sapply(seq_len(p), function(j) sapply(seq_len(p), function(i)
      if (i == j) 100 * mean(M[, i]) else 100 * mean(M[, i] != M[, j])))
    tables <- c(tables, list(list(
      titleKey = "output.missing.mismatchTitle",
      columns = c(list("output.col.variable"), as.list(labels)),
      rows = lapply(seq_len(p), function(i) c(list(labels[i]), lapply(mm[i, ], function(v) round_half_up(v, 1)))),
      footnoteKey = "output.missing.mismatchFootnote")))
  }

  # Tabulated Patterns: every distinct missing-data pattern with its count,
  # most frequent first; "X" marks a variable missing in the pattern.
  if (isTRUE(opts$patterns)) {
    key <- apply(is.na(X), 1L, function(r) paste(as.integer(r), collapse = ""))
    tab <- sort(table(key), decreasing = TRUE)
    prow <- lapply(names(tab), function(k) {
      bits <- as.integer(strsplit(k, "")[[1]])
      c(list(as.integer(tab[[k]])), lapply(bits, function(b) if (b == 1) "X" else ""))
    })
    tables <- c(tables, list(list(
      titleKey = "output.missing.patternsTitle",
      columns = c(list("output.missing.nCases"), as.list(labels)),
      rows = prow, footnoteKey = "output.missing.patternsFootnote")))
  }

  progress(100L, "progress.done")
  sai_output(tables = tables, warnings = warn)
}, error = function(e) sai_error(conditionMessage(e)))
