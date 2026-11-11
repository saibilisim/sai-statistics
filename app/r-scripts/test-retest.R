# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-retest.R — Test-Retest Reliability: for each pair of measurements
# (first and second administration) Pearson r, the intraclass correlation and
# the paired-samples t test in one table.
#
# Params: first (colIds), second (colIds, same length — paired by position),
#   varNames, options:
#     iccModel  "mixed" (default) | "random"      iccType "absolute" (default) | "consistency"
#     ci        confidence level in percent (default 95)
#
# ICC is single measures from the two-way cases x occasions ANOVA (McGraw &
# Wong 1996), absolute agreement by default: test-retest asks whether the
# second score equals the first, not merely whether it ranks cases alike
# (Koo & Li 2016). Each pair uses its complete cases.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
source(file.path(.params_raw$rScriptsDir, "_reliability_models.R"))
params <- read_params(); df <- load_data(params)

r2 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 2) else NULL
r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL
r4 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 4) else NULL

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.retest.title")
  a <- unlist(params$first); b <- unlist(params$second)
  if (!length(a) || length(a) != length(b)) sai_error("Select the same number of first and second measurements")
  opts <- if (is.null(params$options)) list() else params$options
  im <- if (identical(opts$iccModel, "random")) "random" else "mixed"
  it <- if (identical(opts$iccType, "consistency")) "consistency" else "absolute"
  ci <- suppressWarnings(as.numeric(opts$ci)); if (!length(ci) || is.na(ci)) ci <- 95
  nm_a <- resolve_var_names(a, params$varNames); nm_b <- resolve_var_names(b, params$varNames)
  get <- function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params)))
  desc <- list(); rel <- list(); warns <- character(0)
  for (i in seq_along(a)) {
    x <- get(a[i]); y <- get(b[i]); ok <- !is.na(x) & !is.na(y)
    x <- x[ok]; y <- y[ok]; n <- length(x)
    lbl <- paste0(nm_a[i], " – ", nm_b[i])
    if (n < 3) { warns <- c(warns, paste0("output.retest.tooFew:", lbl)); next }
    ct <- stats::cor.test(x, y)
    I <- rel_icc(rel_twoway(cbind(x, y)), im, it, ci / 100)$single
    tt <- if (stats::sd(x - y) > 0) stats::t.test(x, y, paired = TRUE) else NULL
    dz <- if (stats::sd(x - y) > 0) mean(x - y) / stats::sd(x - y) else NA
    desc[[length(desc) + 1]] <- list(lbl, as.integer(n), r2(mean(x)), r2(stats::sd(x)), r2(mean(y)), r2(stats::sd(y)))
    rel[[length(rel) + 1]] <- list(lbl, r3(unname(ct$estimate)), r4(ct$p.value), r3(I[1]), r3(I[2]), r3(I[3]),
      if (is.null(tt)) NULL else r3(unname(tt$statistic)), if (is.null(tt)) NULL else as.integer(tt$parameter),
      if (is.null(tt)) NULL else r4(tt$p.value), r2(dz))
  }
  tables <- list(
    list(titleKey = "output.retest.descTitle",
         columns = list("output.retest.pair", "output.col.n", "output.retest.mean1", "output.retest.sd1",
                        "output.retest.mean2", "output.retest.sd2"),
         rows = desc, footnoteKey = NULL),
    list(titleKey = "output.retest.relTitle",
         columns = list("output.retest.pair", "output.retest.r", "output.retest.rSig", "output.reliability.icc",
                        paste0("output.reliability.iccLower:", ci), paste0("output.reliability.iccUpper:", ci),
                        "output.col.t", "output.col.df", "output.col.sig", "output.retest.dz"),
         rows = rel,
         footnoteKey = paste0("output.retest.footnote:", paste0("output.reliability.iccModel_", im), "|",
                              paste0("output.reliability.iccType_", it))))
  sai_output(tables = tables, warnings = warns)
}, error = function(e) sai_error(conditionMessage(e)))
