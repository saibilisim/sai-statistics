# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# harman.R — Harman's single-factor test for common method variance
# (Podsakoff, MacKenzie, Lee & Podsakoff 2003).
#
# Params: variables (all items of every scale in the study), varNames, options:
#   cfa   also fit a one-factor CFA and report its fit (default TRUE)
#
# All items enter one unrotated factor. The share of total variance that
# factor explains is reported for principal components (first eigenvalue / p,
# what SPSS users usually run) and for principal axis factoring (sum of
# squared loadings of the single factor / p). A single factor explaining 50%
# or more points to common method bias. The test is a weak diagnostic — the
# footnote says so; a poorly fitting one-factor CFA is the stronger evidence
# against a single method factor.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

r2 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 2) else NULL
r3 <- function(x) if (length(x) == 1 && is.finite(x)) round(x, 3) else NULL

tryCatch({
  progress(10L, "progress.loading")
  sai_weight_unsupported("output.harman.title")
  vars <- unlist(params$variables)
  if (length(vars) < 3) sai_error("Harman's test needs at least three items")
  opts <- if (is.null(params$options)) list() else params$options
  mat <- sapply(vars, function(c) suppressWarnings(as.numeric(apply_user_missing(df[[c]], c, params))))
  mat <- mat[stats::complete.cases(mat), , drop = FALSE]
  n <- nrow(mat); p <- ncol(mat)
  if (n <= p) sai_error("Harman's test needs more complete cases than items")
  R <- stats::cor(mat)
  ev <- eigen(R, symmetric = TRUE, only.values = TRUE)$values
  pc <- 100 * ev[1] / p
  paf <- tryCatch(suppressWarnings(psych::fa(R, nfactors = 1, n.obs = n, fm = "pa", rotate = "none",
                                             max.iter = 100, min.err = 1e-6)), error = function(e) NULL)
  pa <- if (is.null(paf)) NA_real_ else 100 * sum(unclass(paf$loadings)^2) / p
  verdict <- function(v) if (!is.finite(v)) NULL else if (v >= 50) "output.harman.biasLikely" else "output.harman.biasUnlikely"
  tables <- list(list(
    titleKey = "output.harman.varTitle",
    columns = list("output.harman.method", "output.harman.eigen", "output.harman.pctVar", "output.harman.verdict"),
    rows = list(list("output.harman.pca", r3(ev[1]), r2(pc), verdict(pc)),
                list("output.harman.paf", r3(if (is.finite(pa)) pa * p / 100 else NA), r2(pa), verdict(pa))),
    footnoteKey = paste0("output.harman.footnote:", p, "|", n)))
  if (!identical(opts$cfa, FALSE) && requireNamespace("lavaan", quietly = TRUE)) {
    d <- as.data.frame(mat); names(d) <- paste0("x", seq_len(p))
    fit <- tryCatch(suppressWarnings(lavaan::cfa(paste("F =~", paste(names(d), collapse = " + ")), d)),
                    error = function(e) NULL)
    if (!is.null(fit) && isTRUE(lavaan::lavInspect(fit, "converged"))) {
      fm <- lavaan::fitMeasures(fit, c("chisq", "df", "pvalue", "cfi", "tli", "rmsea", "srmr"))
      tables <- c(tables, list(list(
        titleKey = "output.harman.cfaTitle",
        columns = list("output.col.chiSquare", "output.col.df", "output.col.sig", "CFI", "TLI", "RMSEA", "SRMR"),
        rows = list(list(r3(fm[["chisq"]]), as.integer(fm[["df"]]), r3(fm[["pvalue"]]), r3(fm[["cfi"]]),
                         r3(fm[["tli"]]), r3(fm[["rmsea"]]), r3(fm[["srmr"]]))),
        footnoteKey = "output.harman.cfaFootnote")))
    }
  }
  sai_output(tables = tables)
}, error = function(e) sai_error(conditionMessage(e)))
