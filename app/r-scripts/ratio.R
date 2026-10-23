# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# ratio.R — Ratio Statistics (SPSS Descriptive Statistics → Ratio).
#
# Params: numerator (colId), denominator (colId), group (optional colId),
#         varNames. ratio_i = numerator_i / denominator_i.
# Output: "Ratio Statistics" — one row per group (and Overall): Median, Mean,
#         Weighted Mean, Minimum, Maximum, Range, COD, PRD, COV (%).
#   COD = 100·mean|r−median|/median;  PRD = mean/weighted-mean;
#   COV = 100·sd(r)/mean.

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

ratio_stats <- function(num, den, label) {
  ok <- is.finite(num) & is.finite(den) & den != 0
  num <- num[ok]; den <- den[ok]; r <- num / den
  n <- length(r)
  if (n < 1) return(NULL)
  mn <- mean(r); md <- median(r); wmean <- sum(num) / sum(den)
  # COD as a proportion, not a percentage. The IAAO literature quotes it as a
  # percentage, but SPSS's Ratio Statistics table prints the proportion (0.065
  # where we printed 6.497) and this is an SPSS-compatible product: a number
  # 100× off the reference tool is worse than a convention debate. COV is left
  # as it was — SPSS's /PRINT list in tests/spss-parity does not request it, so
  # its convention there is unmeasured and guessing would be worse.
  cod <- if (md != 0) mean(abs(r - md)) / md else NA
  prd <- if (wmean != 0) mn / wmean else NA
  cov <- if (mn != 0 && n > 1) 100 * sd(r) / mn else NA
  list(label, as.integer(n), round(md, 4), round(mn, 4), round(wmean, 4),
       round(min(r), 4), round(max(r), 4), round(max(r) - min(r), 4),
       round(cod, 3), round(prd, 4), round(cov, 3))
}

tryCatch({
  progress(10L, "progress.loading")
  ncol <- params$numerator; dcol <- params$denominator; gcol <- params$group
  if (is.null(ncol) || !ncol %in% names(df)) sai_error("Numerator not found")
  if (is.null(dcol) || !dcol %in% names(df)) sai_error("Denominator not found")
  num <- suppressWarnings(as.numeric(df[[ncol]]))
  den <- suppressWarnings(as.numeric(df[[dcol]]))

  progress(50L, "progress.computing")
  rows <- list()
  if (!is.null(gcol) && gcol %in% names(df)) {
    g <- df[[gcol]]
    for (lv in sort(unique(g[!is.na(g)]))) {
      sel <- !is.na(g) & g == lv
      rr <- ratio_stats(num[sel], den[sel], as.character(lv))
      if (!is.null(rr)) rows <- c(rows, list(rr))
    }
  }
  overall <- ratio_stats(num, den, "output.ratio.overall")
  if (!is.null(overall)) rows <- c(rows, list(overall))
  if (length(rows) == 0) sai_error("No valid ratios")

  progress(100L, "progress.done")
  sai_output(tables = list(list(
    titleKey = "output.ratio.title",
    columns = list("output.ratio.group", "output.col.n", "output.ratio.median",
                   "output.ratio.mean", "output.ratio.wmean", "output.col.min",
                   "output.col.max", "output.col.range", "output.ratio.cod",
                   "output.ratio.prd", "output.ratio.cov"),
    rows = rows, footnoteKey = NULL)))
}, error = function(e) sai_error(conditionMessage(e)))
