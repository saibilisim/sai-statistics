# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# correlation.R — Bivariate Correlations (SPSS-style).
#
# Params (from JSON):
#   rScriptsDir — directory containing _bootstrap.R
#   variables   — character vector of colIds
#   varNames    — named list colId → display name
#   methods     — { pearson, spearman, kendall } booleans
#   options$missing — "pairwise" (default, SPSS's own default here) or
#     "listwise" (MV3, spss-parity-findings-2026-07-07 §B3): when listwise,
#     a case missing on ANY selected variable is dropped from every cell, so
#     every matrix cell shares the same N (matches SPSS's listwise behaviour).
#   options$oneTailed — halves the two-tailed p (SPSS's own convention: it
#     assumes the observed sign is the hypothesised direction, not an actual
#     directional test with a chosen alternative).
#   options$flagSignificant — default TRUE (matches SPSS's own default):
#     appends *(p<.05) / **(p<.01) to the printed correlation value. This is
#     a print convention, so — like SPSS's own asterisks — the flagged cell is
#     a formatted STRING and does not participate in the user's decimal-
#     separator/precision Preferences the way a plain numeric cell does.
#   options$meansAndSD — adds a "Descriptive Statistics" table (Mean, Std.
#     Deviation, N per variable, each variable's own non-missing N).
#   options$crossProduct — adds "Sum of Squares and Cross-products" and
#     "Covariance" rows to the Pearson matrix only (rank coefficients have no
#     cross-product-deviation concept, so Spearman/Kendall are unaffected).
#   options$bootstrap — BOOT2 (§B1): bootstraps each variable-pair's
#     correlation coefficient via case-resampling of the pair's own complete
#     cases (so pairwise-vs-listwise missing handling is respected per pair).
#
# Output: one "Correlations" matrix per selected coefficient. Each variable's
#         row block stacks Correlation / Sig. (1- or 2-tailed) / N (+ SS&CP /
#         Covariance for Pearson when requested), computed pairwise by default
#         (or listwise, per options$missing).

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

  vars      <- unlist(params$variables)
  var_names <- params$varNames
  methods   <- if (is.null(params$methods)) list() else params$methods
  opts      <- if (is.null(params$options)) list() else params$options
  if (length(vars) < 2) sai_error("Correlation needs at least two variables")

  one_tailed <- isTRUE(opts$oneTailed)
  flag_sig   <- if (is.null(opts$flagSignificant)) TRUE else isTRUE(opts$flagSignificant)
  want_desc  <- isTRUE(opts$meansAndSD)
  want_xprod <- isTRUE(opts$crossProduct)
  sig_label  <- if (one_tailed) "output.col.sigOneTailed" else "output.col.sigTwoTailed"

  # MV3: listwise drops any case missing on ANY selected variable up front,
  # so every cell shares one N (pairwise, the default, keeps each cell's own
  # N as before — no-op here, per-pair NA filtering happens in the loop).
  if (identical(params$options$missing, "listwise")) {
    df <- apply_listwise(df, vars, params)
  }

  names_vec <- vapply(vars, function(c)
    if (!is.null(var_names[[c]])) var_names[[c]] else c, character(1))
  mats <- lapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  k    <- length(vars)

  # Formats like the client's own default formatNumber (3dp, trailing zeros
  # trimmed, dot separator) — see options$flagSignificant above for why a
  # flagged cell can't defer to the client's own (decimal-separator-aware)
  # formatter the way a plain numeric cell does.
  fmt_num <- function(v, decimals = 3) {
    s <- sprintf(paste0("%.", decimals, "f"), v)
    sub("\\.?0+$", "", s)
  }
  flag_corr <- function(v, p) {
    if (is.na(v)) return(NULL)
    # 3dp matches OUTPUT_DECIMALS, the client's own default display precision
    # for a plain numeric cell — a flagged cell is text, so it has to bake
    # that precision in itself instead of leaving it to the renderer.
    s <- fmt_num(v, 3)
    if (flag_sig && !is.na(p)) {
      if (p < 0.01) s <- paste0(s, "**")
      else if (p < 0.05) s <- paste0(s, "*")
    }
    s
  }

  # default to Pearson if nothing chosen
  want <- c(
    pearson  = !isFALSE(methods$pearson),
    spearman = isTRUE(methods$spearman),
    kendall  = isTRUE(methods$kendall)
  )
  if (!any(want)) want["pearson"] <- TRUE

  corr_label <- list(
    pearson  = "output.col.pearsonCorr",
    spearman = "output.col.spearman",
    kendall  = "output.col.kendallTaub"
  )
  method_name <- list(pearson = "Pearson", spearman = "Spearman", kendall = "Kendall")

  all_tables <- list()
  boot_rows  <- list()

  for (m in names(want)) {
    if (!want[[m]]) next
    cols_hdr <- c("", "", names_vec)
    out_rows <- list()
    xprod_here <- want_xprod && identical(m, "pearson")

    for (i in seq_len(k)) {
      corr_row <- list(names_vec[i], corr_label[[m]])
      sig_row  <- list("", sig_label)
      n_row    <- list("", "output.col.n")
      xprod_row <- list("", "output.col.sumSqCrossProd")
      cov_row   <- list("", "output.col.covariance")
      for (j in seq_len(k)) {
        xi <- mats[[i]]; xj <- mats[[j]]
        ok <- !is.na(xi) & !is.na(xj)
        nij <- sum(ok)
        if (i == j) {
          corr_val <- 1; p_val <- NA_real_
        } else if (nij < 3 || sd(xi[ok]) == 0 || sd(xj[ok]) == 0) {
          corr_val <- NA_real_; p_val <- NA_real_
        } else {
          ct <- suppressWarnings(cor.test(xi[ok], xj[ok], method = m))
          corr_val <- as.numeric(ct$estimate)
          p_val    <- if (one_tailed) ct$p.value / 2 else ct$p.value
        }
        corr_row <- c(corr_row, list(if (flag_sig) flag_corr(corr_val, p_val) else
          (if (is.na(corr_val)) NULL else round(corr_val, 6))))
        sig_row  <- c(sig_row, list(if (i == j || is.na(p_val)) "" else round(p_val, 6)))
        n_row    <- c(n_row, list(as.integer(nij)))
        if (xprod_here) {
          if (nij >= 2) {
            cp  <- sum((xi[ok] - mean(xi[ok])) * (xj[ok] - mean(xj[ok])))
            cov <- cp / (nij - 1)
            xprod_row <- c(xprod_row, list(round(cp, 6)))
            cov_row   <- c(cov_row, list(round(cov, 6)))
          } else {
            xprod_row <- c(xprod_row, list(NULL))
            cov_row   <- c(cov_row, list(NULL))
          }
        }

        # Bootstrapping (BOOT2): upper triangle only (i<j) — r_ij == r_ji,
        # bootstrapping both would just duplicate rows. Case-resampling of
        # the pair's own complete-case rows.
        if (!(i == j) && nij >= 3 && sd(xi[ok]) > 0 && sd(xj[ok]) > 0 && j > i) {
          boot_df <- data.frame(xi = xi[ok], xj = xj[ok])
          boot_out <- sai_bootstrap(
            boot_df,
            function(data, indices) {
              d <- data[indices, , drop = FALSE]
              c(r = suppressWarnings(cor(d$xi, d$xj, method = m)))
            },
            params
          )
          if (!is.null(boot_out)) {
            for (r in boot_out) {
              boot_rows <- c(boot_rows, list(list(
                names_vec[i], names_vec[j], method_name[[m]],
                round(r$estimate, 6), round(r$bias, 6), round(r$se, 6),
                round(r$ci_lower, 6), round(r$ci_upper, 6))))
            }
          }
        }
      }
      out_rows <- c(out_rows, list(corr_row), list(sig_row), list(n_row))
      if (xprod_here) out_rows <- c(out_rows, list(xprod_row), list(cov_row))
    }

    all_tables <- c(all_tables, list(list(
      titleKey    = paste0("output.correlate.title:", method_name[[m]]),
      columns     = as.list(unname(cols_hdr)),
      rows        = out_rows,
      footnoteKey = NULL
    )))
  }

  if (want_desc) {
    desc_rows <- lapply(seq_len(k), function(i) {
      xi <- mats[[i]][!is.na(mats[[i]])]
      list(names_vec[i], round(mean(xi), 6), round(sd(xi), 6), as.integer(length(xi)))
    })
    all_tables <- c(list(list(
      titleKey    = "output.correlate.descriptivesTitle",
      columns     = list("output.col.variable", "output.col.mean", "output.col.stdDeviation", "output.col.n"),
      rows        = desc_rows,
      footnoteKey = NULL
    )), all_tables)
  }

  if (length(boot_rows) > 0) {
    all_tables <- c(all_tables, list(list(
      titleKey    = "output.bootstrap.correlationTitle",
      columns     = list("output.col.variable1", "output.col.variable2", "output.col.method",
                         "output.col.correlation", "output.bootstrap.bias",
                         "output.bootstrap.stdError", "output.bootstrap.ciLower",
                         "output.bootstrap.ciUpper"),
      rows        = boot_rows,
      footnoteKey = "output.bootstrap.footnote"
    )))
  }

  progress(100L, "progress.done")
  sai_output(tables = all_tables)

}, error = function(e) {
  sai_error(conditionMessage(e))
})
