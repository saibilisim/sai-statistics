# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# discriminant.R — Discriminant Analysis (SPSS-style, via MASS::lda).
#
# Params: groupVar, groupName, independents (colIds), varNames.
# Output: "Eigenvalues" (Eigenvalue, % of Variance, Canonical Correlation),
#         "Wilks' Lambda" (Wilks, Chi-square, df, Sig.) and "Classification
#         Results" (% correctly classified).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")
  if (!requireNamespace("MASS", quietly = TRUE)) {
    sai_output(tables = list(), warnings = "output.discriminant.needsPackage"); quit(save = "no")
  }
  gvar <- params$groupVar
  indeps <- unlist(params$independents); var_names <- params$varNames
  if (is.null(gvar) || !gvar %in% names(df)) sai_error("Grouping variable not found")
  if (length(indeps) == 0) sai_error("No independent variables specified")

  dat <- data.frame(.g = factor(as.character(df[[gvar]])))
  for (i in seq_along(indeps)) dat[[paste0("x", i)]] <- suppressWarnings(as.numeric(df[[indeps[i]]]))
  # Carried through the listwise deletion so any new variable this run creates
  # knows which dataset rows its values belong to (NV1, roadmap ★11).
  dat[["__row_idx"]] <- row_index_of(df)
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  n <- nrow(dat); g <- nlevels(dat$.g); p <- length(indeps)
  if (g < 2 || n <= p + g) sai_error("Not enough data for discriminant analysis")

  # Explicit predictor list, NOT `.g ~ .`. The frame also carries __row_idx for
  # NV1, and a dot formula would silently enrol the row number as a predictor —
  # which is exactly what happened, and what the reference tests caught.
  fit <- MASS::lda(
    stats::as.formula(paste(".g ~", paste(paste0("x", seq_along(indeps)), collapse = " + "))),
    data = dat)
  # lda()$svd^2, ham SSCP oranıdır (W ve B toplam kareler toplamı); SPSS'in
  # raporladığı kanonik eigenvalue ortalama-kare oranıdır: svd^2 * (g-1)/(n-g).
  # (test-discriminant-explore-casesum.R: stats::cancor + manova(Wilks) ile doğrulandı)
  ev  <- fit$svd^2 * (g - 1) / (n - g)          # eigenvalues (SPSS konvansiyonu)
  pctv <- ev / sum(ev) * 100
  cancorr <- sqrt(ev / (1 + ev))

  eig_rows <- lapply(seq_along(ev), function(i)
    list(as.integer(i), round(ev[i], 3), round(pctv[i], 1), round(cumsum(pctv)[i], 1),
         round(cancorr[i], 3)))

  # Wilks' Lambda for all functions, with Bartlett's chi-square approximation.
  wilks <- prod(1 / (1 + ev))
  chi   <- -(n - 1 - (p + g) / 2) * log(wilks)
  dfree <- p * (g - 1)
  pval  <- pchisq(chi, dfree, lower.tail = FALSE)

  # Classification results (resubstitution), with EQUAL prior probabilities —
  # SPSS's default ("All groups equal" in the Classification sub-dialog).
  # MASS::lda classifies with the observed group proportions instead, which
  # with unequal group sizes shifts the boundary: on the parity fixture that
  # was 62.3% correct against SPSS's 60.5%.
  #
  # The prior belongs HERE and not on lda() itself: MASS::lda also uses the
  # prior to weight the between-class scatter, so setting it at fit time moved
  # the eigenvalue and pushed Wilks' chi-square off SPSS (11.911 vs 11.908).
  # SPSS keeps the two separate — the functions come from the data, the
  # classification from whatever priors you asked for — and so do we now.
  pr <- predict(fit, prior = rep(1 / g, g))
  pred <- pr$class
  pct_correct <- mean(pred == dat$.g) * 100

  # ── New variables (NV1) ────────────────────────────────────────────────────
  # The predicted group goes back as the ORIGINAL group label, so it can be
  # dropped straight into a crosstab against the real group without decoding.
  case_vars <- list()
  want <- requested_new_vars(params)
  if (length(want) > 0) {
    if (!is.null(want[["predictedGroup"]])) {
      case_vars[[length(case_vars) + 1L]] <- sai_case_var(
        want[["predictedGroup"]], as.character(pred), dat,
        labelKey = "output.discriminant.newVar.predictedGroup",
        type = "string", measure = "nominal")
    }
    # One column per discriminant function — the scores SPSS calls Dis1_1,
    # Dis2_1… Named by their index so the slot list stays fixed however many
    # functions the data supports.
    for (j in seq_along(ev)) {
      key <- paste0("score", j)
      if (!is.null(want[[key]]) && j <= ncol(pr$x)) {
        case_vars[[length(case_vars) + 1L]] <- sai_case_var(
          want[[key]], pr$x[, j], dat,
          labelKey = paste0("output.discriminant.newVar.score:", j), decimals = 5)
      }
    }
  }

  progress(100L, "progress.done")
  sai_output(caseVars = case_vars, tables = list(
    list(titleKey = "output.discriminant.eigTitle",
         columns = list("output.col.function", "output.col.eigenvalue",
                        "output.col.pctVariance", "output.col.cumulativePct",
                        "output.col.canonicalCorr"),
         rows = eig_rows, footnoteKey = NULL),
    list(titleKey = "output.discriminant.wilksTitle",
         columns = list("output.col.wilksLambda", "output.col.chiSquare",
                        "output.col.df", "output.col.sig"),
         rows = list(list(round(wilks, 3), round(chi, 3), as.integer(dfree),
                          round(pval, 6))),
         footnoteKey = NULL),
    list(titleKey = "output.discriminant.classTitle",
         columns = list("output.col.statistic", "output.col.value"),
         rows = list(list("output.col.pctCorrect", round(pct_correct, 1))),
         footnoteKey = NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
