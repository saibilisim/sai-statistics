# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# npar-binomial.R — Binomial Test (SPSS-style).
#
# Params: variables (dichotomous colIds), varNames, testProp (default 0.5).
# Output: per variable Category/N/Observed Prop./Test Prop./Exact Sig. (2-tailed).

suppressPackageStartupMessages(library(jsonlite))
.params_file <- commandArgs(trailingOnly = TRUE)[1]
.params_raw  <- fromJSON(paste(readLines(.params_file, warn = FALSE), collapse = "\n"),
                         simplifyVector = FALSE)
source(file.path(.params_raw$rScriptsDir, "_bootstrap.R"))
params <- read_params(); df <- load_data(params)

tryCatch({
  progress(10L, "progress.loading")

  # Weight Cases (W1): category counts become weighted sums. binom.test()
  # needs integer trial counts, so a fractional weighted N/n1 is rounded to
  # the nearest whole number for the test itself (displayed N/proportions
  # still use the precise weighted values) and flagged in `notes`.
  .gw <- get_weights(df, params)
  df  <- .gw$df
  w   <- .gw$w

  vars <- unlist(params$variables); var_names <- params$varNames
  # Options ▸ Missing Values (listwise) and Statistics — _bootstrap.R helpers
  # shared by Binomial, One-Sample K-S and Runs.
  .lw <- npar_listwise(df, w, vars, params); df <- .lw$df; w <- .lw$w
  tp   <- if (is.null(params$testProp)) 0.5 else as.numeric(params$testProp)
  if (length(vars) == 0) sai_error("No test variables")

  cnt <- function(x) format_wtd_count(x, w)
  rounded_weight_note <- FALSE

  rows <- list()
  for (v in vars) {
    nm <- if (!is.null(var_names[[v]])) var_names[[v]] else v
    x_all <- as.character(apply_user_missing(df[[v]], v, params))
    keep  <- !is.na(x_all) & x_all != "NA"
    x  <- x_all[keep]
    wv <- if (is.null(w)) NULL else w[keep]
    # SPSS's Group 1 is the category of the FIRST case in the file, not the
    # smaller value — and the test is "is Group 1's proportion equal to Test
    # Prop", so sorting here silently tested the other category whenever the
    # test proportion was not .5 (with .5 only the row order looked different).
    # unique() keeps first-occurrence order, which is exactly SPSS's rule.
    cats <- unique(x)
    if (length(cats) != 2) next
    if (is.null(wv)) {
      n1 <- sum(x == cats[1]); n2 <- sum(x == cats[2])
    } else {
      n1 <- sum(wv[x == cats[1]]); n2 <- sum(wv[x == cats[2]])
    }
    N <- n1 + n2
    n1_int <- round(n1); N_int <- round(N)
    if (!is.null(wv) && (abs(n1 - n1_int) > 1e-9 || abs(N - N_int) > 1e-9)) {
      rounded_weight_note <- TRUE
    }
    p  <- binom.test(n1_int, N_int, p = tp)$p.value
    rows <- c(rows,
      list(list(nm, cats[1], cnt(n1), round(n1 / N, 2), round(tp, 2), round(p, 6))),
      list(list("", cats[2], cnt(n2), round(n2 / N, 2), "", "")),
      list(list("", "output.col.total", cnt(N), 1, "", "")))
  }
  if (length(rows) == 0) sai_error("Binomial test needs dichotomous variables")

  progress(100L, "progress.done")
  desc_tbl <- npar_descriptives_table(df, w, vars, var_names, params)
  sai_output(
    tables = c(if (is.null(desc_tbl)) list() else list(desc_tbl), list(list(
      titleKey = "output.nparBinomial.title",
      columns = list("output.col.variable", "output.col.category", "output.col.n",
                     "output.col.observedProp", "output.col.testProp", "output.col.exactSig"),
      rows = rows, footnoteKey = NULL))),
    notes = if (rounded_weight_note) "output.nparBinomial.noteWeightRounded" else character(0)
  )
}, error = function(e) sai_error(conditionMessage(e)))
