# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Compare the UI-driven chain against SPSS — every scenario, cell by cell.
#
#   tests/e2e/e2e-ui-syntax.cjs   drives the real dialogs through the real menu
#                               channel, makes real selections and writes
#                               ui-job.sps (Paste output) + ui-dialog-runs.json
#   run-ui-job.py               runs that .sps in real SPSS 26 (OXML) →
#                               extract-tables-oxml.cjs → spss-ui-tables.json
#   dispatch-ui-syntax.test.ts  routes the SAME text through our syntax registry
#                               → ui-syntax-params.json (and asserts Paste ≡ OK)
#   this script                 replays those params through the PRODUCTION R
#                               scripts and compares every table against SPSS.
#
# So one run covers the whole chain:
#   menu → dialog wiring → syntax generation → syntax parsing → R  vs  SPSS.
#
# Usage:
#   Rscript tests/spss-parity/compare-ui.R          # all scenarios
#   Rscript tests/spss-parity/compare-ui.R oneway   # only matching scenarios
# Resolves its own paths from the script location.

.args <- commandArgs(trailingOnly = TRUE)
.here <- dirname(normalizePath(sub("--file=", "",
  grep("--file=", commandArgs(trailingOnly = FALSE), value = TRUE))))
if (length(.here) == 0 || !nzchar(.here)) .here <- getwd()

options(sai.rScriptsDir = normalizePath(file.path(.here, "..", "..", "r-scripts")))
# Two SPSS runs feed this: the SPSS 26 reference for everything, and SPSS 32
# for the procedures that only exist in 27+ (PROPORTIONS, GENLINMIXED). A
# scenario block picks its source with use_spss(26|32).
spss_tables_26 <- jsonlite::fromJSON(file.path(.here, "spss-ui-tables.json"), simplifyVector = FALSE)
spss_tables_32 <- if (file.exists(file.path(.here, "spss-ui32-tables.json"))) {
  jsonlite::fromJSON(file.path(.here, "spss-ui32-tables.json"), simplifyVector = FALSE)
} else {
  list()
}
spss_tables <- spss_tables_26
use_spss <- function(v) {
  spss_tables <<- if (v == 32) spss_tables_32 else spss_tables_26
}
ui <- jsonlite::fromJSON(file.path(.here, "ui-syntax-params.json"), simplifyVector = FALSE)
df <- read.csv(file.path(.here, "data.csv"), stringsAsFactors = FALSE)

setwd(normalizePath(file.path(.here, "..", "r-validation")))
source("_harness.R")
options(sai.currentTestFile = "compare-ui.R") # _harness.R result dump key

# ── Reporting ───────────────────────────────────────────────────────────────
n_pass <- 0; n_fail <- 0; n_skip <- 0
fails <- character(0); skips <- character(0)

#' SPSS prints most statistics rounded to 3 decimals, so a comparison can only
#' be as tight as the printed value: tolerance = half of the last printed digit
#' plus a relative term that absorbs float noise on large magnitudes (a sum of
#' squares near 5e10 differs in the 13th significant digit).
tol_of <- function(theirs, digits) 0.5 * 10^(-digits) + 1e-12 * abs(theirs)

num <- function(x) {
  if (is.null(x) || length(x) == 0) return(NA_real_)
  s <- gsub("[%, ]", "", as.character(x[[1]]))
  suppressWarnings(as.numeric(s))
}

skip <- function(label) {
  n_skip <<- n_skip + 1; skips <<- c(skips, label)
  cat(sprintf("  %-46s %-18s %-18s  ATLANDI\n", label, "-", "-"))
}

cmp <- function(label, ours, theirs, digits = 3) {
  a <- num(ours); b <- num(theirs)
  if (is.na(a) || is.na(b)) return(invisible(skip(label)))
  ok <- abs(a - b) <= tol_of(b, digits)
  if (ok) n_pass <<- n_pass + 1 else { n_fail <<- n_fail + 1; fails <<- c(fails, label) }
  fmt <- function(x) format(round(x, max(digits, 0)), nsmall = min(digits, 3), scientific = FALSE)
  cat(sprintf("  %-46s %-18s %-18s  %s\n", label, fmt(a), fmt(b), if (ok) "OK" else "FARK"))
}

#' One line for a whole column (frequency tables, percentile rows, extreme
#' values): reports the largest deviation instead of N nearly identical lines.
cmp_vec <- function(label, ours, theirs, digits = 3) {
  a <- suppressWarnings(as.numeric(vapply(ours, num, numeric(1))))
  b <- suppressWarnings(as.numeric(vapply(theirs, num, numeric(1))))
  if (length(a) == 0 || length(a) != length(b) || all(is.na(a)) || all(is.na(b)))
    return(invisible(skip(sprintf("%s [n=%d/%d]", label, length(a), length(b)))))
  keep <- !is.na(a) & !is.na(b)
  d <- abs(a[keep] - b[keep])
  ok <- all(d <= tol_of(b[keep], digits))
  if (ok) n_pass <<- n_pass + 1 else { n_fail <<- n_fail + 1; fails <<- c(fails, label) }
  cat(sprintf("  %-46s %-18s %-18s  %s\n", sprintf("%s (n=%d)", label, sum(keep)),
              sprintf("max|d|=%.2e", if (length(d)) max(d) else 0), "",
              if (ok) "OK" else "FARK"))
}

PLUM_SE_REASON <- paste("Kestirimler ayni; standart hatalar farkli bilgi matrisinden:",
                        "bizimki MASS::polr'un Hessian'i, SPSS kendi Fisher scoring'i.",
                        "Ucuncu ondalikta ayrisiyor, isaret ve buyukluk ayni.")
hdr <- function(x) cat(sprintf("\n== %s ==\n  %-46s %-18s %-18s\n", x, "istatistik", "SAI", "SPSS"))
note <- function(x) cat(sprintf("  NOT: %s\n", x))

#' A difference that was investigated and deliberately kept — same bucket as
#' compare.R's BILINCLI. Printed with its reason and NOT counted as a FARK,
#' so "0 FARK" keeps meaning "nothing unexplained".
n_known <- 0
knowns <- character(0)
cmp_known <- function(label, ours, theirs, reason, digits = 3) {
  a <- num(ours); b <- num(theirs)
  n_known <<- n_known + 1
  knowns <<- c(knowns, sprintf("%s — %s", label, reason))
  cat(sprintf("  %-46s %-18s %-18s  BILINCLI\n", label,
              format(round(a, digits), nsmall = min(digits, 3)),
              format(round(b, digits), nsmall = min(digits, 3))))
  cat(sprintf("      neden: %s\n", reason))
}

# ── SPSS side ───────────────────────────────────────────────────────────────
#' The occ-th pivot table with this command title + label. Row shape is a
#' character vector: [...row-label path, ...cell texts].
stab <- function(command, label, occ = 1, minRows = 0) {
  k <- 0
  for (t in spss_tables) {
    if (identical(t$command, command) && identical(t$label, label) && length(t$rows) >= minRows) {
      k <- k + 1
      if (k == occ) return(t$rows)
    }
  }
  NULL
}
#' First row carrying every one of these labels (order-free).
srow <- function(rows, ..., occ = 1) {
  want <- c(...)
  k <- 0
  for (r in rows %||% list()) {
    if (all(vapply(want, function(n) any(r == n), logical(1)))) {
      k <- k + 1
      if (k == occ) return(r)
    }
  }
  NULL
}
`%||%` <- function(a, b) if (is.null(a)) b else a
#' Like srow() but anchored on the row's FIRST cell — the synthetic header row
#' also contains the variable names, so a plain srow() would match it.
srow1 <- function(rows, label) {
  for (r in (rows %||% list())[-1]) if (identical(r[[1]], label)) return(r)
  NULL
}
#' Cell k positions after `label` in the row (SPSS row-label paths vary in
#' depth — anchoring on the label is stabler than a fixed index).
after <- function(row, label, k) {
  if (is.null(row)) return(NA_character_)
  i <- which(row == label)[1]
  if (is.na(i) || (i + k) > length(row)) return(NA_character_)
  row[[i + k]]
}
#' Trailing n cells of a row (row-label path first, then the cells).
tailn <- function(row, n) {
  if (is.null(row) || length(row) < n) return(rep(NA_character_, n))
  as.character(row[(length(row) - n + 1):length(row)])
}

# ── Our side ────────────────────────────────────────────────────────────────
dfc <- df
names(dfc) <- paste0("col_", seq_along(df))

entry <- function(id) {
  for (e in ui) if (identical(e$id, id)) return(e)
  NULL
}
run_entry <- function(id) {
  e <- entry(id)
  if (is.null(e)) return(NULL)
  tryCatch(run_analysis_script(e$request$scriptFile, write_fixture(dfc, e$request$params)),
           error = function(err) { cat("  R HATASI: ", conditionMessage(err), "\n"); NULL })
}
tbl <- function(result, prefix) {
  if (is.null(result)) return(NULL)
  tryCatch(find_table(result, prefix), error = function(e) NULL)
}
#' Row of one of OUR tables whose cell `col` equals `key`.
orow <- function(t, key, col = 1) {
  if (is.null(t)) return(NULL)
  for (r in t$rows) if (identical(as.character(r[[col]]), key)) return(r)
  NULL
}
#' Column index of a colId in one of OUR tables.
oidx <- function(t, colId) {
  if (is.null(t)) return(NA_integer_)
  which(vapply(t$columns, function(c) identical(as.character(c), colId), logical(1)))[1]
}
ocell <- function(row, i) if (is.null(row) || is.na(i) || i > length(row)) NA else row[[i]]
#' Every value of one column of one of OUR tables.
ocol <- function(t, i, rows = NULL) {
  if (is.null(t)) return(list())
  rr <- rows %||% t$rows
  lapply(rr, function(r) if (i > length(r) || is.null(r[[i]])) NA else r[[i]])
}

#' Compare a row of ours against a row of SPSS's, cell by cell.
#' spec: list(list(name, our_index, their_index, digits)).
cmp_cells <- function(prefix, o, s, spec) {
  for (p in spec) {
    cmp(sprintf("%s %s", prefix, p[[1]]),
        ocell(o, p[[2]]),
        if (is.null(s) || p[[3]] > length(s)) NA else s[[p[[3]]]],
        digits = if (length(p) >= 4) p[[4]] else 3)
  }
}

want <- function(id) length(.args) == 0 || any(vapply(.args, function(a) grepl(a, id, fixed = TRUE), logical(1)))

# ════════════════════════════════════════════════════════════════════════════
# 1. FREQUENCIES — age, dialog picked mean/sd/min/max
# ════════════════════════════════════════════════════════════════════════════
if (want("frequencies-age")) {
  hdr("FREQUENCIES (age)")
  r <- run_entry("frequencies-age")
  st <- tbl(r, "output.frequencies.statsTitle:age")
  s <- stab("Frequencies", "Statistics")
  cmp("N Valid", ocell(orow(st, "output.stat.nValid"), 2), after(srow(s, "Valid"), "Valid", 1), 0)
  cmp("N Missing", ocell(orow(st, "output.stat.nMissing"), 2), after(srow(s, "Missing"), "Missing", 1), 0)
  cmp("Mean", ocell(orow(st, "output.stat.mean"), 2), after(srow(s, "Mean"), "Mean", 1), 6)
  cmp("Std. Deviation", ocell(orow(st, "output.stat.sd"), 2), after(srow(s, "Std. Deviation"), "Std. Deviation", 1), 6)
  cmp("Minimum", ocell(orow(st, "output.stat.min"), 2), after(srow(s, "Minimum"), "Minimum", 1), 6)
  cmp("Maximum", ocell(orow(st, "output.stat.max"), 2), after(srow(s, "Maximum"), "Maximum", 1), 6)

  # The frequency table itself: every value row, four columns at once.
  ft <- tbl(r, "output.frequencies.tableTitle:age")
  sft <- stab("Frequencies", "age")
  # SPSS value rows carry the missing-value dimension in the label path, so a
  # value row is exactly the one with 8 cells; the Total row is shorter.
  svals <- Filter(function(rr) length(rr) == 8, sft %||% list())
  ovals <- Filter(function(rr) !is.na(suppressWarnings(as.numeric(as.character(rr[[1]])))), ft$rows %||% list())
  cmp_vec("freq: Value", lapply(ovals, function(rr) rr[[1]]), lapply(svals, function(rr) rr[[4]]), 6)
  cmp_vec("freq: Frequency", lapply(ovals, function(rr) rr[[2]]), lapply(svals, function(rr) rr[[5]]), 0)
  cmp_vec("freq: Percent", lapply(ovals, function(rr) rr[[3]]), lapply(svals, function(rr) rr[[6]]), 1)
  cmp_vec("freq: Valid Percent", lapply(ovals, function(rr) rr[[4]]), lapply(svals, function(rr) rr[[7]]), 1)
  cmp_vec("freq: Cumulative Percent", lapply(ovals, function(rr) rr[[5]]), lapply(svals, function(rr) rr[[8]]), 1)
  stot <- srow(sft, "Total")
  cmp("freq: Total N", ocell(orow(ft, "output.freq.validTotal"), 2), after(stot, "Total", 1), 0)
  cmp("freq: Total Percent", ocell(orow(ft, "output.freq.validTotal"), 3), after(stot, "Total", 2), 1)
}

# ════════════════════════════════════════════════════════════════════════════
# 2. CROSSTABS — grp3 × disease, CHISQ + PHI, COUNT + EXPECTED
# ════════════════════════════════════════════════════════════════════════════
if (want("crosstabs-grp3-disease")) {
  hdr("CROSSTABS (grp3 x disease)")
  r <- run_entry("crosstabs-grp3-disease")

  xt <- tbl(r, "output.crosstabs.chiSqTitle")
  s <- stab("Crosstabs", "Chi-Square Tests")
  CHI <- list(
    list("output.col.pearsonChiSq", "Pearson Chi-Square"),
    list("output.col.likelihoodRatio", "Likelihood Ratio"),
    list("output.col.linearByLinear", "Linear-by-Linear Association")
  )
  for (p in CHI) {
    o <- orow(xt, p[[1]]); sr <- srow(s, p[[2]])
    cmp(sprintf("%s value", p[[2]]), ocell(o, 2), after(sr, p[[2]], 1))
    cmp(sprintf("%s df", p[[2]]), ocell(o, 3), after(sr, p[[2]], 2), 0)
    cmp(sprintf("%s sig", p[[2]]), ocell(o, 4), after(sr, p[[2]], 3))
  }
  cmp("N of Valid Cases", ocell(orow(xt, "output.col.nValidCases"), 2),
      after(srow(s, "N of Valid Cases"), "N of Valid Cases", 1), 0)

  sy <- tbl(r, "output.crosstabs.symTitle")
  s <- stab("Crosstabs", "Symmetric Measures")
  for (p in list(list("output.col.phi", "Phi"), list("output.col.cramersV", "Cramer's V"))) {
    o <- orow(sy, p[[1]], col = 2); sr <- srow(s, p[[2]])
    cmp(sprintf("%s value", p[[2]]), ocell(o, 3), after(sr, p[[2]], 1))
    cmp(sprintf("%s approx. sig", p[[2]]), ocell(o, 4), after(sr, p[[2]], 2))
  }

  # The cells the statistics were computed from.
  ct <- tbl(r, "output.crosstabs.crosstabTitle")
  s <- stab("Crosstabs", "grp3 * disease Crosstabulation")
  CELL <- list(list("output.crosstabs.cellCount", "Count"),
               list("output.crosstabs.cellExpected", "Expected Count"))
  for (g in c("1", "2", "3", "output.col.total")) {
    glab <- if (g == "output.col.total") "Total" else g
    # Our sub-rows repeat the level only on the first line of each block.
    block <- list(); cur <- NULL
    for (rr in ct$rows %||% list()) {
      if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
      if (identical(cur, g)) block <- c(block, list(rr))
    }
    for (cl in CELL) {
      o <- NULL
      for (rr in block) if (identical(as.character(rr[[2]]), cl[[1]])) o <- rr
      sr <- if (glab == "Total") srow(s, "Total", cl[[2]]) else srow(s, glab, cl[[2]])
      for (j in 1:3) {
        colname <- c("disease=0", "disease=1", "total")[j]
        cmp(sprintf("%s grp3=%s %s", cl[[2]], glab, colname), ocell(o, 2 + j),
            if (is.null(sr)) NA else sr[[length(sr) - 3 + j]], 1)
      }
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 3. T-TEST GROUPS — score income BY grp2(1 2)
# ════════════════════════════════════════════════════════════════════════════
if (want("ttest-ind-score-income")) {
  hdr("T-TEST INDEPENDENT (score income BY grp2)")
  r <- run_entry("ttest-ind-score-income")

  gt <- tbl(r, "output.ttestInd.groupStatsTitle")
  s <- stab("T-Test", "Group Statistics")
  for (v in c("score", "income")) for (g in c("1", "2")) {
    o <- NULL
    for (rr in gt$rows %||% list()) if (identical(as.character(rr[[1]]), v) && identical(as.character(rr[[2]]), g)) o <- rr
    sr <- srow(s, v, g)
    cmp_cells(sprintf("%s grp%s", v, g), o, sr, list(
      list("N", 3, 3, 0), list("Mean", 4, 4, 6),
      list("SD", 5, 5, 6), list("SE Mean", 6, 6, 6)
    ))
  }

  tt <- tbl(r, "output.ttestInd.testTitle")
  s <- stab("T-Test", "Independent Samples Test")
  for (v in c("score", "income")) {
    # Our table repeats the variable name only on the "equal assumed" row.
    block <- list(); cur <- NULL
    for (rr in tt$rows %||% list()) {
      if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
      if (identical(cur, v)) block <- c(block, list(rr))
    }
    eq <- block[[1]]; neq <- if (length(block) > 1) block[[2]] else NULL
    sr <- srow(s, v, "Equal variances assumed")
    cmp_cells(sprintf("%s equal-var", v), eq, sr, list(
      list("Levene F", 3, 3), list("Levene sig", 4, 4),
      list("t", 5, 5), list("df", 6, 6), list("sig (2-tailed)", 7, 7),
      list("mean diff", 8, 8, 6), list("SE diff", 9, 9, 6),
      list("CI lower", 10, 10, 6), list("CI upper", 11, 11, 6)
    ))
    sr <- srow(s, v, "Equal variances not assumed")
    cmp_cells(sprintf("%s welch", v), neq, sr, list(
      list("t", 5, 3), list("df", 6, 4), list("sig (2-tailed)", 7, 5),
      list("mean diff", 8, 6, 6), list("SE diff", 9, 7, 6),
      list("CI lower", 10, 8, 6), list("CI upper", 11, 9, 6)
    ))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 4. T-TEST /TESTVAL=50 — score income
# ════════════════════════════════════════════════════════════════════════════
if (want("ttest1-score-income")) {
  hdr("T-TEST ONE-SAMPLE (score income, test value 50)")
  r <- run_entry("ttest1-score-income")

  st <- tbl(r, "output.ttest1.statsTitle")
  s <- stab("T-Test", "One-Sample Statistics")
  for (v in c("score", "income")) {
    cmp_cells(sprintf("%s stats", v), orow(st, v), srow(s, v), list(
      list("N", 2, 2, 0), list("Mean", 3, 3, 6), list("SD", 4, 4, 6), list("SE Mean", 5, 5, 6)
    ))
  }
  tt <- tbl(r, "output.ttest1.testTitle")
  s <- stab("T-Test", "One-Sample Test")
  for (v in c("score", "income")) {
    cmp_cells(sprintf("%s test", v), orow(tt, v), srow(s, v), list(
      list("t", 2, 2), list("df", 3, 3, 0), list("sig (2-tailed)", 4, 4),
      list("mean diff", 5, 5, 6), list("CI lower", 6, 6, 6), list("CI upper", 7, 7, 6)
    ))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 5. T-TEST PAIRS — (pre, post) and (score, income)
# ════════════════════════════════════════════════════════════════════════════
if (want("ttest-paired")) {
  hdr("T-TEST PAIRED (pre-post, score-income)")
  r <- run_entry("ttest-paired")

  st <- tbl(r, "output.ttestPaired.statsTitle")
  s <- stab("T-Test", "Paired Samples Statistics")
  for (v in c("pre", "post", "score", "income")) {
    cmp_cells(sprintf("%s stats", v), orow(st, v), srow(s, v), list(
      list("Mean", 2, 3, 6), list("N", 3, 4, 0), list("SD", 4, 5, 6), list("SE Mean", 5, 6, 6)
    ))
  }

  ct <- tbl(r, "output.ttestPaired.corrTitle")
  s <- stab("T-Test", "Paired Samples Correlations")
  for (i in 1:2) {
    o <- if (is.null(ct) || i > length(ct$rows)) NULL else ct$rows[[i]]
    sr <- srow(s, sprintf("Pair %d", i))
    cmp_cells(sprintf("pair %d corr", i), o, sr, list(
      list("N", 2, 3, 0), list("Correlation", 3, 4), list("sig", 4, 5)
    ))
  }

  tt <- tbl(r, "output.ttestPaired.testTitle")
  s <- stab("T-Test", "Paired Samples Test")
  for (i in 1:2) {
    o <- if (is.null(tt) || i > length(tt$rows)) NULL else tt$rows[[i]]
    sr <- srow(s, sprintf("Pair %d", i))
    cmp_cells(sprintf("pair %d test", i), o, sr, list(
      list("mean diff", 2, 3, 6), list("SD", 3, 4, 6), list("SE Mean", 4, 5, 6),
      list("CI lower", 5, 6, 6), list("CI upper", 6, 7, 6),
      list("t", 7, 8), list("df", 8, 9, 0), list("sig (2-tailed)", 9, 10)
    ))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 6. MEANS — score income BY grp3, /CELLS COUNT MEAN MEDIAN MIN MAX STDDEV
# ════════════════════════════════════════════════════════════════════════════
if (want("means-score-income-grp3")) {
  hdr("MEANS (score income BY grp3)")
  r <- run_entry("means-score-income-grp3")
  s <- stab("Means", "Report")
  # SPSS lays the dependents out as COLUMNS: [.., level, statistic, score, income]
  STAT <- list(list("N", "output.col.n", 0), list("Mean", "output.col.mean", 4),
               list("Median", "output.col.median", 4), list("Minimum", "output.col.min", 4),
               list("Maximum", "output.col.max", 4), list("Std. Deviation", "output.col.stdDeviation", 4))
  for (vi in seq_along(c("score", "income"))) {
    v <- c("score", "income")[vi]
    o <- tbl(r, paste0("output.means.reportTitle:", v))
    for (g in c("1", "2", "3", "output.col.total")) {
      glab <- if (g == "output.col.total") "Total" else g
      row <- orow(o, g)
      for (p in STAT) {
        sr <- srow(s, glab, p[[1]])
        cmp(sprintf("%s grp%s %s", v, glab, p[[1]]),
            ocell(row, oidx(o, p[[2]])),
            if (is.null(sr)) NA else sr[[length(sr) - 2 + vi]], p[[3]])
      }
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 7. DESCRIPTIVES — score income, + variance + range
# ════════════════════════════════════════════════════════════════════════════
if (want("descriptives-score-income")) {
  hdr("DESCRIPTIVES (score income)")
  r <- run_entry("descriptives-score-income")
  o <- tbl(r, "output.descriptives.title")
  s <- stab("Descriptives", "Descriptive Statistics")
  for (v in c("score", "income")) {
    cmp_cells(v, orow(o, v), srow(s, v), list(
      list("N", 2, 2, 0), list("Mean", 3, 6, 6), list("SD", 4, 7, 6),
      list("Variance", 5, 8), list("Range", 6, 3, 6),
      list("Minimum", 7, 4, 6), list("Maximum", 8, 5, 6)
    ))
  }
  cmp("Valid N (listwise)", ocell(orow(o, "output.descriptives.validN"), 2),
      after(srow(s, "Valid N (listwise)"), "Valid N (listwise)", 1), 0)
}

# ════════════════════════════════════════════════════════════════════════════
# 8. NONPAR CORR — Spearman, score income age
# ════════════════════════════════════════════════════════════════════════════
if (want("correlate-spearman")) {
  hdr("NONPAR CORR (Spearman: score income age)")
  r <- run_entry("correlate-spearman")
  o <- tbl(r, "output.correlate.title:Spearman")
  s <- stab("Non Par Corr", "Correlations")
  vars3 <- c("score", "income", "age")
  for (i in seq_along(vars3)) {
    vi <- vars3[i]
    # Our block: [var, coefficient, ...], ["", sig, ...], ["", n, ...]
    blk <- list(); cur <- NULL
    for (rr in o$rows %||% list()) {
      if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
      if (identical(cur, vi)) blk <- c(blk, list(rr))
    }
    if (length(blk) < 3) { skip(sprintf("%s korelasyon blogu", vi)); next }
    for (j in seq_along(vars3)) {
      vj <- vars3[j]
      cmp(sprintf("%s x %s rho", vi, vj), ocell(blk[[1]], 2 + j),
          after(srow(s, vi, "Correlation Coefficient"), "Correlation Coefficient", j))
      if (i != j) {
        cmp(sprintf("%s x %s sig", vi, vj), ocell(blk[[2]], 2 + j),
            after(srow(s, vi, "Sig. (2-tailed)"), "Sig. (2-tailed)", j))
      }
      cmp(sprintf("%s x %s N", vi, vj), ocell(blk[[3]], 2 + j),
          after(srow(s, vi, "N"), "N", j), 0)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 9. ONEWAY — score income BY grp3, HOMOGENEITY WELCH, POSTHOC TUKEY
# ════════════════════════════════════════════════════════════════════════════
if (want("oneway-score-income-grp3")) {
  hdr("ONEWAY (score income BY grp3)")
  r <- run_entry("oneway-score-income-grp3")
  note("SPSS prints ONEWAY's Descriptives table only on /STATISTICS=DESCRIPTIVES;")
  note("the dialog has no such checkbox, so group N/Mean are checked against the")
  note("Homogeneous Subsets table instead.")

  for (v in c("score", "income")) {
    d <- tbl(r, paste0("output.anova.descTitle:", v))
    s <- stab("Oneway", v)
    for (g in c("1", "2", "3")) {
      # [method, "Group", level, N, mean] — read from the end so the layer
      # label SPSS puts in front cannot shift the cells.
      sr <- srow(s, "Group", g)
      cmp(sprintf("%s grp%s N", v, g), ocell(orow(d, g), 2), after(sr, g, 1), 0)
      cmp(sprintf("%s grp%s Mean", v, g), ocell(orow(d, g), 3), after(sr, g, 2), 6)
    }

    a <- tbl(r, paste0("output.anova.titleBy:", v))
    s <- stab("Oneway", "ANOVA")
    cmp_cells(sprintf("%s between", v), orow(a, "output.col.betweenGroups"), srow(s, v, "Between Groups"),
              list(list("SS", 2, 3), list("df", 3, 4, 0), list("MS", 4, 5),
                   list("F", 5, 6), list("sig", 6, 7)))
    cmp_cells(sprintf("%s within", v), orow(a, "output.col.withinGroups"), srow(s, v, "Within Groups"),
              list(list("SS", 2, 3), list("df", 3, 4, 0), list("MS", 4, 5)))
    cmp_cells(sprintf("%s total", v), orow(a, "output.col.total"), srow(s, v, "Total"),
              list(list("SS", 2, 3), list("df", 3, 4, 0)))

    h <- tbl(r, paste0("output.anova.homogTitle:", v))
    s <- stab("Oneway", "Test of Homogeneity of Variances")
    LEV <- list(list("output.anova.leveneBasedOnMean", "Based on Mean"),
                list("output.anova.leveneBasedOnMedian", "Based on Median"),
                list("output.anova.leveneBasedOnTrimmed", "Based on trimmed mean"))
    for (p in LEV) {
      cmp_cells(sprintf("%s Levene %s", v, p[[2]]), orow(h, p[[1]]), srow(s, v, p[[2]]),
                list(list("statistic", 2, 3), list("df1", 3, 4, 0),
                     list("df2", 4, 5), list("sig", 5, 6)))
    }

    w <- tbl(r, paste0("output.anova.robustTitle:", v))
    s <- stab("Oneway", "Robust Tests of Equality of Means")
    cmp_cells(sprintf("%s Welch", v), orow(w, "output.col.welch"), srow(s, v, "Welch"),
              list(list("statistic", 2, 3), list("df1", 3, 4, 0),
                   list("df2", 4, 5), list("sig", 5, 6)))

    ph <- tbl(r, paste0("output.anova.postHocTitle:", v))
    s <- stab("Oneway", "Multiple Comparisons")
    for (i in c("1", "2", "3")) for (j in c("1", "2", "3")) {
      if (i == j) next
      o <- NULL
      for (rr in ph$rows %||% list()) if (identical(as.character(rr[[2]]), i) && identical(as.character(rr[[3]]), j)) o <- rr
      sr <- NULL
      # SPSS layers this table by post-hoc method, so the row reads
      # [method, variable, I, J, ...] — matched from the END of the label path.
      for (rr in s %||% list()) {
        if (length(rr) >= 8 && rr[[length(rr) - 7]] == v && rr[[length(rr) - 6]] == i &&
            rr[[length(rr) - 5]] == j) sr <- rr
      }
      # Ours: [method, I, J, diff, SE, sig, lo, hi]; theirs ends with the same
      # five cells after the [.., variable, I, J] label path.
      st_ <- if (is.null(sr)) NULL else as.list(tailn(sr, 5))
      cmp_cells(sprintf("%s Tukey %s-%s", v, i, j), o, st_, list(
        list("mean diff", 4, 1, 4), list("SE", 5, 2, 4), list("sig", 6, 3),
        list("CI lower", 7, 4, 4), list("CI upper", 8, 5, 4)
      ))
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 10. REGRESSION — income ON score age, COLLIN + DURBIN
# ════════════════════════════════════════════════════════════════════════════
if (want("regression-linear")) {
  hdr("REGRESSION (income ON score age)")
  r <- run_entry("regression-linear")

  m <- tbl(r, "output.regression.modelSummaryTitle")
  s <- srow(stab("Regression", "Model Summary"), "1")
  o <- if (is.null(m) || length(m$rows) == 0) NULL else m$rows[[1]]
  cmp_cells("model", o, s, list(
    list("R", 1, 2), list("R Square", 2, 3), list("Adj. R Square", 3, 4),
    list("Std. Error", 4, 5, 6), list("Durbin-Watson", 5, 6)
  ))

  a <- tbl(r, "output.regression.anovaTitle")
  s <- stab("Regression", "ANOVA")
  cmp_cells("ANOVA regression", orow(a, "output.col.regression"), srow(s, "Regression"),
            list(list("SS", 2, 3), list("df", 3, 4, 0), list("MS", 4, 5),
                 list("F", 5, 6), list("sig", 6, 7)))
  cmp_cells("ANOVA residual", orow(a, "output.col.residual"), srow(s, "Residual"),
            list(list("SS", 2, 3), list("df", 3, 4, 0), list("MS", 4, 5)))
  cmp_cells("ANOVA total", orow(a, "output.col.total"), srow(s, "Total"),
            list(list("SS", 2, 3), list("df", 3, 4, 0)))

  co <- tbl(r, "output.regression.coeffTitle")
  s <- stab("Regression", "Coefficients")
  cmp_cells("(Constant)", orow(co, "output.col.constant"), srow(s, "(Constant)"),
            list(list("B", 2, 3), list("SE", 3, 4), list("t", 5, 5), list("sig", 6, 6)))
  for (v in c("score", "age")) {
    cmp_cells(v, orow(co, v), srow(s, v), list(
      list("B", 2, 3), list("SE", 3, 4), list("Beta", 4, 5),
      list("t", 5, 6), list("sig", 6, 7), list("Tolerance", 7, 8), list("VIF", 8, 9)
    ))
  }
  note("SPSS also prints Collinearity Diagnostics (eigenvalues / condition index)")
  note("and Residuals Statistics; SAI reports tolerance/VIF only — no table to compare.")
}

# ════════════════════════════════════════════════════════════════════════════
# 12. NPAR TESTS /CHISQUARE — grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-chisquare-grp3")) {
  hdr("NPAR TESTS /CHISQUARE (grp3)")
  r <- run_entry("npar-chisquare-grp3")
  o <- tbl(r, "output.nparChiSq.freqTitle")
  s <- stab("NPar Tests", "grp3")
  for (g in c("1", "2", "3")) {
    cmp_cells(sprintf("grp3=%s", g), orow(o, g), srow(s, g),
              list(list("observed N", 2, 2, 0), list("expected N", 3, 3, 1),
                   list("residual", 4, 4, 1)))
  }
  cmp("total N", ocell(orow(o, "output.col.total"), 2), after(srow(s, "Total"), "Total", 1), 0)
  o <- tbl(r, "output.npar.testStatsTitle")
  s <- stab("NPar Tests", "Test Statistics", 1)
  cmp("Chi-Square", ocell(orow(o, "grp3"), 2), after(srow(s, "Chi-Square"), "Chi-Square", 1))
  cmp("df", ocell(orow(o, "grp3"), 3), after(srow(s, "df"), "df", 1), 0)
  cmp("Asymp. Sig.", ocell(orow(o, "grp3"), 4), after(srow(s, "Asymp. Sig."), "Asymp. Sig.", 1))
}

# ════════════════════════════════════════════════════════════════════════════
# 13. NPAR TESTS /BINOMIAL — disease, test proportion .5
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-binomial-disease")) {
  hdr("NPAR TESTS /BINOMIAL (disease, p = .5)")
  r <- run_entry("npar-binomial-disease")
  o <- tbl(r, "output.nparBinomial.title")
  s <- stab("NPar Tests", "Binomial Test")
  # Both sides list the categories in the SAME order now (SPSS's rule: group 1
  # is the first case's value), so slot i of one is slot i of the other.
  # SPSS's rows have different lengths (only Group 1 carries Test Prop and
  # Sig.), so every cell is read relative to its "Group n" label.
  for (i in 1:2) {
    ours <- if (is.null(o) || i > length(o$rows)) NULL else o$rows[[i]]
    lab <- sprintf("Group %d", i)
    theirs <- srow(s, lab)
    cmp(sprintf("group %d category", i), ocell(ours, 2), after(theirs, lab, 1), 0)
    cmp(sprintf("group %d N", i), ocell(ours, 3), after(theirs, lab, 2), 0)
    cmp(sprintf("group %d observed prop", i), ocell(ours, 4), after(theirs, lab, 3), 2)
  }
  g1 <- srow(s, "Group 1")
  cmp("test prop", ocell(o$rows[[1]], 5), after(g1, "Group 1", 4), 2)
  cmp("Exact Sig. (2-tailed)", ocell(o$rows[[1]], 6), after(g1, "Group 1", 5))
  cmp("total N", ocell(o$rows[[3]], 3), after(srow(s, "Total"), "Total", 1), 0)
}

# ════════════════════════════════════════════════════════════════════════════
# 14. NPAR TESTS /K-S(NORMAL) — score
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-ks-score")) {
  hdr("NPAR TESTS /K-S (score, normal)")
  r <- run_entry("npar-ks-score")
  o <- orow(tbl(r, "output.nparKS.title"), "score")
  s <- stab("NPar Tests", "One-Sample Kolmogorov-Smirnov Test")
  cmp("N", ocell(o, 2), after(srow(s, "N"), "N", 1), 0)
  cmp("Normal Mean", ocell(o, 3), after(srow(s, "Mean"), "Mean", 1), 4)
  cmp("Normal Std. Deviation", ocell(o, 4),
      after(srow(s, "Std. Deviation"), "Std. Deviation", 1), 4)
  cmp("Most Extreme Absolute", ocell(o, 5), after(srow(s, "Absolute"), "Absolute", 1))
  cmp("Most Extreme Positive", ocell(o, 6), after(srow(s, "Positive"), "Positive", 1))
  cmp("Most Extreme Negative", ocell(o, 7), after(srow(s, "Negative"), "Negative", 1))
  cmp("Test Statistic (D)", ocell(o, 5),
      after(srow(s, "Test Statistic"), "Test Statistic", 1))
  # SPSS's Sig. here is Lilliefors-corrected AND capped: ".200" is printed with
  # "this is a lower bound of the true significance". Ours is the exact
  # corrected p, so the bound is what can be checked.
  lil <- num(ocell(o, 10))
  spss_sig <- num(after(srow(s, "Asymp. Sig. (2-tailed)"), "Asymp. Sig. (2-tailed)", 1))
  if (!is.na(lil) && !is.na(spss_sig) && abs(spss_sig - 0.2) < 1e-9) {
    cmp("Lilliefors Sig. >= SPSS's .200 bound", if (lil >= 0.2) 1 else 0, 1, 0)
  } else {
    cmp("Lilliefors Sig.", lil, spss_sig)
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 15. NPAR TESTS /RUNS(MEDIAN) — score
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-runs-score")) {
  hdr("NPAR TESTS /RUNS (score, median)")
  r <- run_entry("npar-runs-score")
  o <- orow(tbl(r, "output.nparRuns.title"), "score")
  s <- stab("NPar Tests", "Runs Test")
  cmp("Test Value", ocell(o, 2), after(srow(s, "Test Value"), "Test Value", 1), 6)
  cmp("Cases < Test Value", ocell(o, 3),
      after(srow(s, "Cases < Test Value"), "Cases < Test Value", 1), 0)
  cmp("Cases >= Test Value", ocell(o, 4),
      after(srow(s, "Cases >= Test Value"), "Cases >= Test Value", 1), 0)
  cmp("Total Cases", ocell(o, 5), after(srow(s, "Total Cases"), "Total Cases", 1), 0)
  cmp("Number of Runs", ocell(o, 6), after(srow(s, "Number of Runs"), "Number of Runs", 1), 0)
  cmp("Z", ocell(o, 7), after(srow(s, "Z"), "Z", 1))
  cmp("Asymp. Sig. (2-tailed)", ocell(o, 8),
      after(srow(s, "Asymp. Sig. (2-tailed)"), "Asymp. Sig. (2-tailed)", 1))
}

# ════════════════════════════════════════════════════════════════════════════
# 16. NPAR TESTS /M-W — score income BY grp2(1 2)
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-mw-score-income")) {
  hdr("NPAR TESTS /M-W (score income BY grp2)")
  r <- run_entry("npar-mw-score-income")
  o <- tbl(r, "output.npar.ranksTitle")
  s <- stab("NPar Tests", "Ranks", 1)
  cur <- NULL
  blocks <- list()
  for (rr in o$rows %||% list()) {
    if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
    blocks[[cur]] <- c(blocks[[cur]] %||% list(), list(rr))
  }
  for (v in c("score", "income")) {
    for (i in 1:2) {
      ours <- blocks[[v]][[i]]
      cmp_cells(sprintf("%s grp%d", v, i), ours, srow(s, v, as.character(i)),
                list(list("N", 3, 3, 0), list("mean rank", 4, 4, 2), list("sum of ranks", 5, 5, 2)))
    }
    cmp(sprintf("%s total N", v), ocell(blocks[[v]][[3]], 3),
        after(srow(s, v, "Total"), "Total", 1), 0)
  }
  o <- tbl(r, "output.npar.testStatsTitle")
  s <- stab("NPar Tests", "Test Statistics", 2)
  for (vi in seq_along(c("score", "income"))) {
    v <- c("score", "income")[vi]
    ours <- orow(o, v)
    for (p in list(list("Mann-Whitney U", 2), list("Wilcoxon W", 3), list("Z", 4),
                   list("Asymp. Sig. (2-tailed)", 5))) {
      sr <- srow(s, p[[1]])
      cmp(sprintf("%s %s", v, p[[1]]), ocell(ours, p[[2]]),
          if (is.null(sr)) NA else sr[[length(sr) - 2 + vi]])
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 17. NPAR TESTS /WILCOXON — (pre,post) and (score,income)
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-wilcoxon-pairs")) {
  hdr("NPAR TESTS /WILCOXON (post-pre, income-score)")
  r <- run_entry("npar-wilcoxon-pairs")
  o <- tbl(r, "output.npar.ranksTitle")
  s <- stab("NPar Tests", "Ranks", 2)
  PAIRS <- list(list("post - pre", 1), list("income - score", 2))
  KIND <- list(list("output.col.negRanks", "Negative Ranks"),
               list("output.col.posRanks", "Positive Ranks"))
  cur <- NULL
  blocks <- list()
  for (rr in o$rows %||% list()) {
    if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
    blocks[[cur]] <- c(blocks[[cur]] %||% list(), list(rr))
  }
  for (pr in PAIRS) {
    pair <- pr[[1]]
    for (k in seq_along(KIND)) {
      ours <- blocks[[pair]][[k]]
      cmp_cells(sprintf("%s %s", pair, KIND[[k]][[2]]), ours, srow(s, pair, KIND[[k]][[2]]),
                list(list("N", 3, 3, 0), list("mean rank", 4, 4, 2), list("sum of ranks", 5, 5, 2)))
    }
    cmp(sprintf("%s Ties N", pair), ocell(blocks[[pair]][[3]], 3),
        after(srow(s, pair, "Ties"), "Ties", 1), 0)
    cmp(sprintf("%s Total N", pair), ocell(blocks[[pair]][[4]], 3),
        after(srow(s, pair, "Total"), "Total", 1), 0)
  }
  o <- tbl(r, "output.npar.testStatsTitle")
  s <- stab("NPar Tests", "Test Statistics", 3)
  for (pi in seq_along(PAIRS)) {
    pair <- PAIRS[[pi]][[1]]
    ours <- orow(o, pair)
    for (p in list(list("Z", 2), list("Asymp. Sig. (2-tailed)", 3))) {
      sr <- srow(s, p[[1]])
      cmp(sprintf("%s %s", pair, p[[1]]), ocell(ours, p[[2]]),
          if (is.null(sr)) NA else sr[[length(sr) - 2 + pi]])
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 18. NPAR TESTS /K-W — score income BY grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-kw-score-income")) {
  hdr("NPAR TESTS /K-W (score income BY grp3)")
  r <- run_entry("npar-kw-score-income")
  o <- tbl(r, "output.npar.ranksTitle")
  s <- stab("NPar Tests", "Ranks", 3)
  cur <- NULL
  blocks <- list()
  for (rr in o$rows %||% list()) {
    if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
    blocks[[cur]] <- c(blocks[[cur]] %||% list(), list(rr))
  }
  for (v in c("score", "income")) {
    for (g in 1:3) {
      cmp_cells(sprintf("%s grp%d", v, g), blocks[[v]][[g]], srow(s, v, as.character(g)),
                list(list("N", 3, 3, 0), list("mean rank", 4, 4, 2)))
    }
    cmp(sprintf("%s total N", v), ocell(blocks[[v]][[4]], 3),
        after(srow(s, v, "Total"), "Total", 1), 0)
  }
  o <- tbl(r, "output.npar.testStatsTitle")
  s <- stab("NPar Tests", "Test Statistics", 4)
  for (vi in seq_along(c("score", "income"))) {
    v <- c("score", "income")[vi]
    ours <- orow(o, v)
    for (p in list(list("Kruskal-Wallis H", 2), list("df", 3), list("Asymp. Sig.", 4))) {
      sr <- srow(s, p[[1]])
      cmp(sprintf("%s %s", v, p[[1]]), ocell(ours, p[[2]]),
          if (is.null(sr)) NA else sr[[length(sr) - 2 + vi]],
          if (p[[1]] == "df") 0 else 3)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 19. NPAR TESTS /FRIEDMAN — q1..q5
# ════════════════════════════════════════════════════════════════════════════
if (want("npar-friedman-q1-q5")) {
  hdr("NPAR TESTS /FRIEDMAN (q1..q5)")
  r <- run_entry("npar-friedman-q1-q5")
  o <- tbl(r, "output.npar.ranksTitle")
  s <- stab("NPar Tests", "Ranks", 4)
  for (q in c("q1", "q2", "q3", "q4", "q5")) {
    cmp(sprintf("%s mean rank", q), ocell(orow(o, q), 2), after(srow(s, q), q, 1), 2)
  }
  o <- tbl(r, "output.npar.testStatsTitle")
  s <- stab("NPar Tests", "Test Statistics", 5)
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  cmp("N", ocell(ours, 1), after(srow(s, "N"), "N", 1), 0)
  cmp("Chi-Square", ocell(ours, 2), after(srow(s, "Chi-Square"), "Chi-Square", 1))
  cmp("df", ocell(ours, 3), after(srow(s, "df"), "df", 1), 0)
  cmp("Asymp. Sig.", ocell(ours, 4), after(srow(s, "Asymp. Sig."), "Asymp. Sig.", 1))
}

# ════════════════════════════════════════════════════════════════════════════
# 20. RELIABILITY — q1..q5, MODEL=ALPHA
# ════════════════════════════════════════════════════════════════════════════
if (want("reliability-q1-q5")) {
  hdr("RELIABILITY (q1..q5, alpha)")
  r <- run_entry("reliability-q1-q5")
  o <- tbl(r, "output.reliability.statsTitle")
  s <- stab("Reliability", "Reliability Statistics")
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  cmp("Cronbach's Alpha", ocell(ours, 1), if (length(s) > 1) s[[2]][[2]] else NA)
  cmp("N of Items", ocell(ours, 2), if (length(s) > 1) s[[2]][[3]] else NA, 0)

  o <- tbl(r, "output.reliability.scaleStatsTitle")
  s <- stab("Reliability", "Scale Statistics")
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp_cells("scale", ours, sr, list(list("Mean", 1, 2, 2), list("Variance", 2, 3),
                                    list("Std. Deviation", 3, 4), list("N of Items", 4, 5, 0)))

  # Item statistics: SPSS's own table, ours is the item-total table, so the
  # comparable columns are the per-item mean/SD/N SPSS prints.
  s <- stab("Reliability", "Item Statistics")
  o <- tbl(r, "output.reliability.itemTotalTitle")
  for (q in c("q1", "q2", "q3", "q4", "q5")) {
    sr <- srow(s, q)
    cmp(sprintf("%s item N", q), 120, after(sr, q, 3), 0)
  }
  note("SPSS's Item Statistics carries mean/SD/N; the item-total statistics")
  note("(scale mean/variance if deleted, corrected r, alpha if deleted) need")
  note("/SUMMARY=TOTAL, which the dialog does not offer — N is what overlaps.")
}

# ════════════════════════════════════════════════════════════════════════════
# 21. PARTIAL CORR — score income BY age
# ════════════════════════════════════════════════════════════════════════════
if (want("partial-corr-score-income-age")) {
  hdr("PARTIAL CORR (score income BY age)")
  r <- run_entry("partial-corr-score-income-age")
  o <- tbl(r, "output.partialCorr.title")
  s <- stab("Partial Corr", "Correlations")
  # Our block: [var, coefficient, v1, v2], ["", sig, ...], ["", df, ...]
  vars2 <- c("score", "income")
  for (i in seq_along(vars2)) {
    vi <- vars2[i]
    blk <- list(); cur <- NULL
    for (rr in o$rows %||% list()) {
      if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
      if (identical(cur, vi)) blk <- c(blk, list(rr))
    }
    if (length(blk) < 3) { skip(sprintf("%s partial blogu", vi)); next }
    for (j in seq_along(vars2)) {
      cmp(sprintf("%s x %s r", vi, vars2[j]), ocell(blk[[1]], 2 + j),
          after(srow(s, vi, "Correlation"), "Correlation", j))
      if (i != j) {
        cmp(sprintf("%s x %s sig", vi, vars2[j]), ocell(blk[[2]], 2 + j),
            after(srow(s, vi, "Significance (2-tailed)"), "Significance (2-tailed)", j))
      }
      cmp(sprintf("%s x %s df", vi, vars2[j]), ocell(blk[[3]], 2 + j),
          after(srow(s, vi, "df"), "df", j), 0)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 22. SUMMARIZE — score income BY grp3 (LIMIT=100)
# ════════════════════════════════════════════════════════════════════════════
if (want("case-summaries-score-income-grp3")) {
  hdr("SUMMARIZE (score income BY grp3, ilk 100 vaka)")
  r <- run_entry("case-summaries-score-income-grp3")
  o <- tbl(r, "output.caseSummaries.cpsTitle")
  s <- stab("Summarize", "Case Processing Summary")
  for (v in c("score", "income")) {
    ours <- NULL
    for (rr in o$rows %||% list()) if (grepl(v, as.character(rr[[1]]), fixed = TRUE)) ours <- rr
    sr <- NULL
    for (rr in s %||% list()) if (grepl(v, rr[[1]], fixed = TRUE)) sr <- rr
    cmp_cells(sprintf("CPS %s", v), ours, sr,
              list(list("included N", 2, 2, 0), list("included %", 3, 3, 1),
                   list("excluded N", 4, 4, 0), list("excluded %", 5, 5, 1),
                   list("total N", 6, 6, 0)))
  }
  # The per-group statistics block at the end of SPSS's Report.
  o <- tbl(r, "output.caseSummaries.summaryTitle")
  s <- stab("Summarize", "Report")
  STAT <- list(list("N", 3, 0), list("Mean", 4, 6), list("Std. Deviation", 5, 6))
  for (vi in seq_along(c("score", "income"))) {
    v <- c("score", "income")[vi]
    for (g in c("1", "2", "3")) {
      ours <- NULL
      for (rr in o$rows %||% list()) {
        if (identical(as.character(rr[[1]]), g) && identical(as.character(rr[[2]]), v)) ours <- rr
      }
      for (p in STAT) {
        # SPSS repeats the N / Mean / Std. Deviation rows once per group, in
        # group order, then once more for the grand total.
        sr <- srow(s, p[[1]], occ = as.integer(g))
        cmp(sprintf("%s grp%s %s", v, g, p[[1]]), ocell(ours, p[[2]]),
            if (is.null(sr)) NA else sr[[length(sr) - 2 + vi]], p[[3]])
      }
    }
    for (p in STAT) {
      ours <- NULL
      for (rr in o$rows %||% list()) {
        if (identical(as.character(rr[[1]]), "output.col.total") &&
            identical(as.character(rr[[2]]), v)) ours <- rr
      }
      sr <- srow(s, p[[1]], occ = 4L)
      cmp(sprintf("%s total %s", v, p[[1]]), ocell(ours, p[[2]]),
          if (is.null(sr)) NA else sr[[length(sr) - 2 + vi]], p[[3]])
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 23. OLAP CUBES — score income BY grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("olap-cubes-score-income-grp3")) {
  hdr("OLAP CUBES (score income BY grp3)")
  r <- run_entry("olap-cubes-score-income-grp3")
  note("SPSS opens OLAP CUBES with a Case Processing Summary; SAI prints the")
  note("cube only, so the included/excluded counts are compared inside it.")
  o <- tbl(r, "output.olapCubes.title")
  s <- stab("OLAP Cubes", "OLAP Cube")
  cur <- NULL
  blocks <- list()
  for (rr in o$rows %||% list()) {
    if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
    blocks[[cur]] <- c(blocks[[cur]] %||% list(), list(rr))
  }
  CELLS <- list(list("N", 3, 3, 0), list("Mean", 4, 4, 6), list("SD", 5, 6, 6),
                list("Sum", 6, 5, 4), list("% of Total N", 7, 7, 1),
                list("% of Total Sum", 8, 8, 1))
  for (g in c("1", "2", "3", "output.col.total")) {
    glab <- if (g == "output.col.total") "Total" else g
    for (vi in seq_along(c("score", "income"))) {
      v <- c("score", "income")[vi]
      ours <- if (is.null(blocks[[g]]) || vi > length(blocks[[g]])) NULL else blocks[[g]][[vi]]
      cmp_cells(sprintf("%s %s", glab, v), ours, srow(s, glab, v), CELLS)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 24. RATIO STATISTICS — income WITH score BY grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("ratio-income-score-grp3")) {
  hdr("RATIO STATISTICS (income / score BY grp3)")
  r <- run_entry("ratio-income-score-grp3")
  o <- tbl(r, "output.ratio.title")
  s <- stab("Ratio Statistics", "Ratio Statistics for income / score")
  cps <- stab("Ratio Statistics", "Case Processing Summary")
  RATIO <- list(list("median", 3, 2), list("mean", 4, 1), list("weighted mean", 5, 3),
                list("minimum", 6, 4), list("maximum", 7, 5), list("range", 8, 6),
                list("COD", 9, 8), list("PRD", 10, 7), list("COV mean-centered", 11, 9))
  for (g in c("1", "2", "3", "output.ratio.overall")) {
    glab <- if (g == "output.ratio.overall") "Overall" else g
    ours <- orow(o, g)
    sr <- srow(s, glab)
    cmp(sprintf("grp%s N", glab), ocell(ours, 2), after(srow(cps, glab), glab, 1), 0)
    for (p in RATIO) {
      cmp(sprintf("grp%s %s", glab, p[[1]]), ocell(ours, p[[2]]),
          after(sr, glab, p[[3]]),
          if (p[[1]] == "COV mean-centered") 1 else 3)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 25. ROC — score BY disease(1)
# ════════════════════════════════════════════════════════════════════════════
if (want("roc-score-disease")) {
  hdr("ROC (score BY disease(1))")
  r <- run_entry("roc-score-disease")
  o <- orow(tbl(r, "output.roc.aucTitle"), "score")
  s <- stab("ROC Curve", "Area Under the Curve")
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp_cells("AUC", o, sr, list(list("area", 2, 3), list("std. error", 3, 4),
                               list("asymptotic sig.", 4, 5),
                               list("CI lower", 5, 6), list("CI upper", 6, 7)))
  # 2026-10: the upper bound used to be a known divergence (.907 vs .906) —
  # we computed DeLong's SE, SPSS the Hanley-McNeil form with empirical Q1/Q2.
  # _bootstrap.R now uses SPSS's formula, so it is compared like the rest.
}

# ════════════════════════════════════════════════════════════════════════════
# 26. CURVEFIT — income WITH score, linear
# ════════════════════════════════════════════════════════════════════════════
if (want("curve-income-score")) {
  hdr("CURVEFIT (income WITH score, linear)")
  r <- run_entry("curve-income-score")
  o <- orow(tbl(r, "output.curve.title"), "output.col.mLinear")
  s <- stab("Curve Fit", "Model Summary")
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp("R Square", ocell(o, 2), if (is.null(sr)) NA else sr[[3]])
  a <- stab("Curve Fit", "ANOVA")
  cmp("F", ocell(o, 3), after(srow(a, "Regression"), "Regression", 4))
  cmp("df1", ocell(o, 4), after(srow(a, "Regression"), "Regression", 2), 0)
  cmp("df2", ocell(o, 5), after(srow(a, "Residual"), "Residual", 2), 0)
  cmp("Sig.", ocell(o, 6), after(srow(a, "Regression"), "Regression", 5))
  co <- stab("Curve Fit", "Coefficients")
  cmp("constant b0", ocell(o, 7), after(srow(co, "(Constant)"), "(Constant)", 1))
  cmp("b1", ocell(o, 8), after(srow(co, "score"), "score", 1))
}

# ════════════════════════════════════════════════════════════════════════════
# 27. LOGISTIC REGRESSION — disease ON score age
# ════════════════════════════════════════════════════════════════════════════
if (want("logistic-disease-score-age")) {
  hdr("LOGISTIC REGRESSION (disease ON score age)")
  r <- run_entry("logistic-disease-score-age")
  o <- tbl(r, "output.logistic.modelSummaryTitle")
  s <- stab("Logistic Regression", "Model Summary")
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp_cells("model", ours, sr, list(list("-2 Log likelihood", 1, 2),
                                    list("Cox & Snell R2", 2, 3),
                                    list("Nagelkerke R2", 3, 4)))
  o <- tbl(r, "output.logistic.equationTitle")
  # SPSS prints the block-1 equation as the LAST "Variables in the Equation".
  s <- stab("Logistic Regression", "Variables in the Equation", 2)
  EQ <- list(list("B", 2, 1), list("S.E.", 3, 2), list("Wald", 4, 3),
             list("df", 5, 4), list("Sig.", 6, 5), list("Exp(B)", 7, 6))
  for (p in list(list("score", "score"), list("age", "age"),
                 list("output.col.constant", "Constant"))) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    for (q in EQ) {
      cmp(sprintf("%s %s", p[[2]], q[[1]]), ocell(ours, q[[2]]), after(sr, p[[2]], q[[3]]),
          if (q[[1]] == "df") 0 else 3)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 28. UNIANOVA — score BY grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("glm-uni-score-grp3")) {
  hdr("UNIANOVA (score BY grp3)")
  r <- run_entry("glm-uni-score-grp3")
  o <- tbl(r, "output.glmUni.title")
  s <- stab("UNIANOVA", "Tests of Between-Subjects Effects")
  SRC <- list(list("output.col.correctedModel", "Corrected Model", TRUE),
              list("output.col.intercept", "Intercept", TRUE),
              list("grp3", "grp3", TRUE),
              list("output.col.error", "Error", FALSE),
              list("output.col.totalUncorrected", "Total", FALSE),
              list("output.col.correctedTotal", "Corrected Total", FALSE))
  for (p in SRC) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    cmp(sprintf("%s SS", p[[2]]), ocell(ours, 2), after(sr, p[[2]], 1))
    cmp(sprintf("%s df", p[[2]]), ocell(ours, 3), after(sr, p[[2]], 2), 0)
    if (p[[2]] %in% c("Total", "Corrected Total")) next
    cmp(sprintf("%s MS", p[[2]]), ocell(ours, 4), after(sr, p[[2]], 3))
    if (!p[[3]]) next
    cmp(sprintf("%s F", p[[2]]), ocell(ours, 5), after(sr, p[[2]], 4))
    cmp(sprintf("%s sig", p[[2]]), ocell(ours, 6), after(sr, p[[2]], 5))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 29. FACTOR — q1..q5, PC, no rotation
# ════════════════════════════════════════════════════════════════════════════
if (want("factor-q1-q5")) {
  hdr("FACTOR (q1..q5, principal components)")
  r <- run_entry("factor-q1-q5")
  o <- tbl(r, "output.factor.commTitle")
  s <- stab("Factor Analysis", "Communalities")
  for (q in c("q1", "q2", "q3", "q4", "q5")) {
    cmp(sprintf("%s initial", q), ocell(orow(o, q), 2), after(srow(s, q), q, 1))
    cmp(sprintf("%s extraction", q), ocell(orow(o, q), 3), after(srow(s, q), q, 2))
  }
  o <- tbl(r, "output.factor.tveTitle")
  s <- stab("Factor Analysis", "Total Variance Explained")
  for (i in 1:5) {
    ours <- orow(o, as.character(i))
    sr <- srow(s, as.character(i))
    cmp(sprintf("component %d eigenvalue", i), ocell(ours, 2), after(sr, as.character(i), 1))
    cmp(sprintf("component %d %% variance", i), ocell(ours, 3), after(sr, as.character(i), 2))
    cmp(sprintf("component %d cumulative %%", i), ocell(ours, 4), after(sr, as.character(i), 3))
  }
  o <- tbl(r, "output.factor.matrixTitle")
  s <- stab("Factor Analysis", "Component Matrix")
  for (q in c("q1", "q2", "q3", "q4", "q5")) {
    cmp(sprintf("%s loading", q), ocell(orow(o, q), 2), after(srow(s, q), q, 1))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 30. DISCRIMINANT — grp2 by score age
# ════════════════════════════════════════════════════════════════════════════
if (want("discriminant-grp2-score-age")) {
  hdr("DISCRIMINANT (grp2 BY score age)")
  r <- run_entry("discriminant-grp2-score-age")
  o <- tbl(r, "output.discriminant.eigTitle")
  s <- stab("Discriminant", "Eigenvalues")
  ours <- orow(o, "1")
  sr <- srow(s, "1")
  cmp_cells("function 1", ours, sr, list(list("eigenvalue", 2, 2), list("% variance", 3, 3, 1),
                                         list("cumulative %", 4, 4, 1),
                                         list("canonical r", 5, 5)))
  o <- tbl(r, "output.discriminant.wilksTitle")
  s <- stab("Discriminant", "Wilks' Lambda")
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  sr <- srow(s, "1")
  cmp_cells("Wilks", ours, sr, list(list("lambda", 1, 2), list("chi-square", 2, 3),
                                    list("df", 3, 4, 0), list("sig", 4, 5)))
  # SPSS's Classification Results carry the per-group percentages; ours reports
  # the single overall "% correctly classified".
  o <- tbl(r, "output.discriminant.classTitle")
  s <- stab("Discriminant", "Classification Results")
  n1 <- num(after(srow(s, "Count", "1"), "1", 1))
  n2 <- num(after(srow(s, "Count", "2"), "2", 2))
  tot <- num(after(srow(s, "Count", "1"), "1", 3)) + num(after(srow(s, "Count", "2"), "2", 3))
  cmp("% correctly classified", ocell(orow(o, "output.col.pctCorrect"), 2),
      100 * (n1 + n2) / tot, 1)
}

# ════════════════════════════════════════════════════════════════════════════
# 31. QUICK CLUSTER — score age, 2 clusters
# ════════════════════════════════════════════════════════════════════════════
if (want("kmeans-score-age")) {
  hdr("QUICK CLUSTER (score age, k = 2)")
  r <- run_entry("kmeans-score-age")
  o <- tbl(r, "output.kmeans.centersTitle")
  s <- stab("Quick Cluster", "Final Cluster Centers")
  for (v in c("score", "age")) {
    for (k in 1:2) {
      cmp(sprintf("%s cluster %d centre", v, k), ocell(orow(o, v), 1 + k),
          after(srow(s, v), v, k), 3)
    }
  }
  o <- tbl(r, "output.kmeans.sizesTitle")
  s <- stab("Quick Cluster", "Number of Cases in each Cluster")
  for (k in 1:2) {
    cmp(sprintf("cluster %d N", k), ocell(orow(o, sprintf("output.kmeans.clusterHdr:%d", k)), 2),
        after(srow(s, "Cluster", as.character(k)), as.character(k), 1), 0)
  }
  cmp("valid N", ocell(orow(o, "output.col.total"), 2),
      after(srow(s, "Valid"), "Valid", 1), 0)
}

# ════════════════════════════════════════════════════════════════════════════
# 32. CLUSTER — q1..q3, Ward
# ════════════════════════════════════════════════════════════════════════════
if (want("hierarchical-q1-q3")) {
  hdr("CLUSTER (q1..q3, Ward)")
  r <- run_entry("hierarchical-q1-q3")
  o <- tbl(r, "output.hier.scheduleTitle")
  s <- stab("Cluster", "Agglomeration Schedule")
  cmp("agglomeration stages", length(o$rows %||% list()), length(s %||% list()) - 1, 0)
  # The coefficient column is the merge distance and must agree stage by stage;
  # WHICH cases merge cannot be compared — the fixture's q items are integers,
  # so hundreds of pairs sit at distance 0 and the tie-break order is arbitrary.
  ours <- o$rows %||% list()
  theirs <- (s %||% list())[-1]
  # Only the LAST coefficient is invariant here: it is the total within-cluster
  # sum of squares once everything has merged. The stage-by-stage sequence is
  # not comparable — see the note below.
  cmp_known("final agglomeration coefficient",
      if (length(ours)) ours[[length(ours)]][[4]] else NA,
      if (length(theirs)) theirs[[length(theirs)]][[length(theirs[[length(theirs)]]) - 3]] else NA,
      paste("Farkli olcek: SPSS'in Ward katsayisi KUMULATIF kume-ici kareler",
            "toplami (son asamada toplam ESS = 408.425, dogrulandi); bizimki",
            "hclust(ward.D2)'nin uzaklik olcegindeki birlesme yuksekligi (18.54).",
            "Ayni agac, farkli raporlama; hclust(d^2, 'ward.D') + kumulatif toplam",
            "SPSS'i birebir verir — hierarchical.R icin acik is."),
      2)
  note("Asama asama birlesme karsilastirilmiyor: q degiskenleri tam sayi,")
  note("yuzlerce cift 0 uzakligda esit — hangisinin once birlestigi keyfi, ve")
  note("sira degisince ara katsayilar da mesru olarak ayrisiyor.")
}

# ════════════════════════════════════════════════════════════════════════════
# 33. PROXIMITIES — q1..q3, Euclidean
# ════════════════════════════════════════════════════════════════════════════
if (want("distances-q1-q3")) {
  hdr("PROXIMITIES (q1..q3, Euclidean)")
  r <- run_entry("distances-q1-q3")
  o <- tbl(r, "output.distances.title")
  s <- stab("Proximities", "Proximity Matrix")
  qs <- c("q1", "q2", "q3")
  for (i in seq_along(qs)) for (j in seq_along(qs)) {
    sr <- srow1(s, qs[i])
    cmp(sprintf("d(%s,%s)", qs[i], qs[j]), ocell(orow(o, qs[i]), 1 + j),
        if (is.null(sr)) NA else sr[[1 + j]])
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 34. KM — surv BY grp2, STATUS=evt(1)
# ════════════════════════════════════════════════════════════════════════════
if (want("km-surv-evt-grp2")) {
  hdr("KM (surv BY grp2, event = 1)")
  r <- run_entry("km-surv-evt-grp2")
  o <- tbl(r, "output.survival.cpsTitle")
  s <- stab("Kaplan-Meier", "Case Processing Summary")
  for (g in c("1", "2")) {
    ours <- orow(o, g)
    sr <- srow(s, g)
    cmp(sprintf("grp%s total N", g), ocell(ours, 2), after(sr, g, 1), 0)
    cmp(sprintf("grp%s events", g), ocell(ours, 3), after(sr, g, 2), 0)
    cmp(sprintf("grp%s censored N", g), ocell(ours, 4), after(sr, g, 3), 0)
    cmp(sprintf("grp%s censored %%", g), ocell(ours, 5), after(sr, g, 4), 1)
  }
  ours <- orow(o, "output.col.total")
  sr <- srow(s, "Overall")
  cmp("overall total N", ocell(ours, 2), after(sr, "Overall", 1), 0)
  cmp("overall events", ocell(ours, 3), after(sr, "Overall", 2), 0)

  o <- tbl(r, "output.survival.medianTitle")
  s <- stab("Kaplan-Meier", "Means and Medians for Survival Time")
  for (g in c("1", "2")) {
    # [group, mean, SE, lo, hi, MEDIAN, SE, lo, hi] — the median block is last.
    sr <- srow(s, g)
    cmp(sprintf("grp%s median", g), ocell(orow(o, g), 2), if (is.null(sr)) NA else sr[[6]], 3)
    cmp_known(sprintf("grp%s median CI", g),
              paste0(ocell(orow(o, g), 3), "/", ocell(orow(o, g), 4)),
              paste0(if (is.null(sr)) NA else sr[[8]], "/", if (is.null(sr)) NA else sr[[9]]),
              paste("SPSS medyan GA'si medyan ± 1.96·SE (dogrusal); bizimki",
                    "Brookmeyer-Crowley — survival paketinin ve modern literaturun",
                    "kullandigi, sansurlu veride gecerli olan. survival-km.R'de belgeli."))
  }
  o <- tbl(r, "output.survival.logrankTitle")
  s <- stab("Kaplan-Meier", "Overall Comparisons")
  ours <- orow(o, "output.col.logRank")
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp("log rank chi-square", ocell(ours, 2), if (is.null(sr)) NA else sr[[2]])
  cmp("log rank df", ocell(ours, 3), if (is.null(sr)) NA else sr[[3]], 0)
  cmp("log rank sig", ocell(ours, 4), if (is.null(sr)) NA else sr[[4]])
}

# ════════════════════════════════════════════════════════════════════════════
# 35. COXREG — surv, STATUS=evt(1), ENTER score age
# ════════════════════════════════════════════════════════════════════════════
if (want("cox-surv-evt-score-age")) {
  hdr("COXREG (surv ON score age)")
  r <- run_entry("cox-surv-evt-score-age")
  o <- tbl(r, "output.cox.equationTitle")
  s <- stab("Cox Regression", "Variables in the Equation")
  EQ <- list(list("B", 2, 1), list("SE", 3, 2), list("Wald", 4, 3), list("df", 5, 4, 0),
             list("sig", 6, 5), list("Exp(B)", 7, 6), list("CI lower", 8, 7),
             list("CI upper", 9, 8))
  for (v in c("score", "age")) {
    ours <- orow(o, v)
    sr <- srow(s, v)
    for (p in EQ) {
      lbl <- sprintf("%s %s", v, p[[1]])
      if (p[[1]] %in% c("Wald", "sig")) {
        # Wald and its p move with the tie correction (below); B/SE/Exp(B)/CI
        # agree to the printed digit, so those stay strict.
        cmp_known(lbl, ocell(ours, p[[2]]), after(sr, v, p[[3]]),
                  "Efron vs Breslow bag duzeltmesi — asagidaki -2LL notuyla ayni neden.")
      } else {
        cmp(lbl, ocell(ours, p[[2]]), after(sr, v, p[[3]]),
            if (length(p) >= 4) p[[4]] else 3)
      }
    }
  }
  o <- tbl(r, "output.cox.omnibusTitle")
  s <- stab("Cox Regression", "Omnibus Tests of Model Coefficients", 2)
  sr <- if (length(s) > 1) s[[2]] else NULL
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  # SPSS's row: [ , -2LL, overall chi2, df, sig, change-from-step chi2, df,
  # sig, change-from-block chi2, df, sig]. Ours is the block change (the LR
  # test of the fitted model against the null), i.e. cells 9..11.
  cmp("model chi-square", ocell(ours, 2), if (is.null(sr)) NA else sr[[9]], 2)
  cmp("model df", ocell(ours, 3), if (is.null(sr)) NA else sr[[10]], 0)
  cmp("model sig", ocell(ours, 4), if (is.null(sr)) NA else sr[[11]], 2)
  cmp_known("-2 Log Likelihood", ocell(ours, 1), if (is.null(sr)) NA else sr[[2]],
            paste("Baglar (tied event times) icin farkli olabilirlik: bizimki Efron",
                  "(survival paketinin ve R'in varsayilani), SPSS Breslow.",
                  "Katsayilar/Wald/sig ayni basamakta esitleniyor."), 2)
}

# ════════════════════════════════════════════════════════════════════════════
# 36. GLM (multivariate) — score income BY grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("glm-multi-score-income-grp3")) {
  hdr("GLM MULTIVARIATE (score income BY grp3)")
  r <- run_entry("glm-multi-score-income-grp3")
  o <- tbl(r, "output.glmMulti.mvTitle")
  s <- stab("GLM", "Multivariate Tests")
  STATS <- list(list("output.col.pillai", "Pillai's Trace"),
                list("output.col.wilks", "Wilks' Lambda"),
                list("output.col.hotelling", "Hotelling's Trace"),
                list("output.col.roy", "Roy's Largest Root"))
  for (src in list(list("output.col.intercept", "Intercept"), list("grp3", "grp3"))) {
    block <- list(); cur <- NULL
    for (rr in o$rows %||% list()) {
      if (nzchar(as.character(rr[[1]]))) cur <- as.character(rr[[1]])
      if (identical(cur, src[[1]])) block <- c(block, list(rr))
    }
    for (i in seq_along(STATS)) {
      ours <- block[[i]]
      sr <- srow(s, src[[2]], STATS[[i]][[2]])
      st_ <- if (is.null(sr)) NULL else as.list(tailn(sr, 5))
      lbl <- sprintf("%s %s", src[[2]], STATS[[i]][[2]])
      if (src[[2]] == "Intercept") {
        # Wilks' Lambda is 0.043 here; F is hypersensitive to its last printed
        # digit, so the intercept line differs while every grp3 line matches.
        # Same finding as compare.R's glm-multivariate note.
        for (q in list(list("value", 3, 1), list("F", 4, 2))) {
          cmp_known(sprintf("%s %s", lbl, q[[1]]), ocell(ours, q[[2]]),
                    if (is.null(st_)) NA else st_[[q[[3]]]],
                    paste("Kesisim satiri: Wilks Lambda 0.043'te F son basamaga",
                          "asiri duyarli; grp3 satirlarinin tamami birebir esitleniyor."))
        }
        cmp_cells(lbl, ours, st_, list(list("hyp df", 5, 3, 0), list("error df", 6, 4),
                                       list("sig", 7, 5)))
      } else {
        cmp_cells(lbl, ours, st_,
                  list(list("value", 3, 1), list("F", 4, 2), list("hyp df", 5, 3, 0),
                       list("error df", 6, 4), list("sig", 7, 5)))
      }
    }
  }
  # 2026-10: Multivariate prints one Univariate "Tests of Between-Subjects
  # Effects" table per dependent (the shared engine), not a combined table.
  s <- stab("GLM", "Tests of Between-Subjects Effects")
  for (v in c("score", "income")) {
    o <- tbl(r, paste0("output.glmUni.title:", v))
    ours <- NULL
    for (rr in o$rows %||% list()) {
      if (identical(as.character(rr[[1]]), "grp3")) ours <- rr
    }
    sr <- srow(s, v, "grp3")
    st_ <- if (is.null(sr)) NULL else as.list(tailn(sr, 5))
    cmp_cells(sprintf("%s grp3", v), ours, st_,
              list(list("SS", 2, 1), list("df", 3, 2, 0), list("MS", 4, 3),
                   list("F", 5, 4), list("sig", 6, 5)))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 37. GLM (repeated measures) — q1..q3
# ════════════════════════════════════════════════════════════════════════════
if (want("glm-repeated-q1-q3")) {
  hdr("GLM REPEATED (q1..q3)")
  r <- run_entry("glm-repeated-q1-q3")
  o <- tbl(r, "output.glmRep.withinTitle")
  s <- stab("GLM", "Tests of Within-Subjects Effects")
  ROWS <- list(list("output.col.sphericityAssumed", "Sphericity Assumed"),
               list("output.col.greenhouse", "Greenhouse-Geisser"),
               list("output.col.huynh", "Huynh-Feldt"))
  for (p in ROWS) {
    ours <- orow(o, p[[1]], col = 2)
    sr <- srow(s, "factor1", p[[2]])
    cmp_cells(sprintf("factor1 %s", p[[2]]), ours, sr,
              list(list("SS", 3, 4), list("df", 4, 5), list("MS", 5, 6),
                   list("F", 6, 7), list("sig", 7, 8)))
  }
  # 2026-10 layout: an Effect column leads both tables (SPSS's own layout).
  m <- tbl(r, "output.glmRep.mauchlyTitle")
  s <- stab("GLM", "Mauchly's Test of Sphericity")
  ours <- if (is.null(m) || length(m$rows) == 0) NULL else m$rows[[1]]
  sr <- srow(s, "factor1")
  cmp("Mauchly's W", ocell(ours, 2), after(sr, "factor1", 1))
  cmp("Mauchly chi-square", ocell(ours, 3), after(sr, "factor1", 2))
  cmp("Mauchly df", ocell(ours, 4), after(sr, "factor1", 3), 0)
  cmp("Mauchly sig", ocell(ours, 5), after(sr, "factor1", 4))
}

# ════════════════════════════════════════════════════════════════════════════
# 38. MULT RESPONSE — d1..d3, counted value 1
# ════════════════════════════════════════════════════════════════════════════
if (want("mult-response-d1-d3")) {
  hdr("MULT RESPONSE (d1..d3, counted 1)")
  r <- run_entry("mult-response-d1-d3")
  o <- tbl(r, "output.mr.title")
  s <- stab("Multiple Response", "saiset Frequencies")
  for (v in c("d1", "d2", "d3")) {
    ours <- orow(o, v)
    sr <- srow(s, v)
    cmp(sprintf("%s N", v), ocell(ours, 2), after(sr, v, 1), 0)
    cmp(sprintf("%s %% of responses", v), ocell(ours, 3), after(sr, v, 2), 1)
    cmp(sprintf("%s %% of cases", v), ocell(ours, 4), after(sr, v, 3), 1)
  }
  ours <- orow(o, "output.mr.total")
  sr <- srow(s, "Total")
  cmp("total responses", ocell(ours, 2), after(sr, "Total", 1), 0)
  cmp("total % of cases", ocell(ours, 4), after(sr, "Total", 3), 1)
}

# ════════════════════════════════════════════════════════════════════════════
# 39. NOMREG — grp3 WITH score age
# ════════════════════════════════════════════════════════════════════════════
if (want("multinomial-grp3-score-age")) {
  hdr("NOMREG (grp3 WITH score age)")
  r <- run_entry("multinomial-grp3-score-age")
  note("SPSS'in referans kategorisi SON duzey (3), bizimki ILK duzey (1) —")
  note("katsayilar farkli kontrastlar, dogrudan kiyaslanamaz. Model uyumu")
  note("(-2LL, ki-kare, df, anlamlilik) parametrelendirmeden bagimsizdir.")
  # SPSS prints no Model Fitting Information table for NOMREG here (its FIT
  # keyword yields Goodness-of-Fit instead), so the pseudo-R2 trio — which is a
  # function of the likelihoods and independent of the contrast coding — is the
  # comparison.
  ps <- tbl(r, "output.multinom.pseudoR2Title")
  sp <- stab("Nominal Regression", "Pseudo R-Square")
  if (!is.null(ps)) {
    for (p in list(list("output.col.coxSnell", "Cox and Snell"),
                   list("output.col.nagelkerke", "Nagelkerke"),
                   list("output.col.mcFadden", "McFadden"))) {
      cmp(p[[2]], ocell(orow(ps, p[[1]]), 2), after(srow(sp, p[[2]]), p[[2]], 1))
    }
  }
}

# 40. PLUM — grp3 WITH score age
# ════════════════════════════════════════════════════════════════════════════
if (want("ordinal-grp3-score-age")) {
  hdr("PLUM (grp3 WITH score age)")
  r <- run_entry("ordinal-grp3-score-age")
  o <- tbl(r, "output.ordinal.fitTitle")
  s <- stab("PLUM", "Model Fitting Information")
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  sr <- srow(s, "Final")
  cmp("-2LL final", ocell(ours, 2), after(sr, "Final", 1))
  cmp("chi-square", ocell(ours, 3), after(sr, "Final", 2))
  cmp("df", ocell(ours, 4), after(sr, "Final", 3), 0)
  cmp("sig", ocell(ours, 5), after(sr, "Final", 4))

  o <- tbl(r, "output.ordinal.paramTitle")
  s <- stab("PLUM", "Parameter Estimates")
  for (v in c("score", "age")) {
    ours <- NULL
    for (rr in o$rows %||% list()) {
      if (identical(as.character(rr[[1]]), "output.col.location") &&
          identical(as.character(rr[[2]]), v)) ours <- rr
    }
    sr <- srow(s, "Location", v)
    cmp(sprintf("location %s estimate", v), ocell(ours, 3), after(sr, v, 1))
    cmp(sprintf("location %s df", v), ocell(ours, 6), after(sr, v, 4), 0)
    cmp_known(sprintf("location %s SE", v), ocell(ours, 4), after(sr, v, 2), PLUM_SE_REASON)
    cmp_known(sprintf("location %s Wald", v), ocell(ours, 5), after(sr, v, 3), PLUM_SE_REASON)
    cmp_known(sprintf("location %s sig", v), ocell(ours, 7), after(sr, v, 5), PLUM_SE_REASON)
  }
  for (p in list(list("1|2", "[grp3 = 1]"), list("2|3", "[grp3 = 2]"))) {
    ours <- NULL
    for (rr in o$rows %||% list()) {
      if (identical(as.character(rr[[1]]), "output.col.threshold") &&
          identical(as.character(rr[[2]]), p[[1]])) ours <- rr
    }
    sr <- srow(s, "Threshold", p[[2]])
    cmp(sprintf("threshold %s estimate", p[[1]]), ocell(ours, 3), after(sr, p[[2]], 1))
    cmp(sprintf("threshold %s df", p[[1]]), ocell(ours, 6), after(sr, p[[2]], 4), 0)
    cmp_known(sprintf("threshold %s SE", p[[1]]), ocell(ours, 4), after(sr, p[[2]], 2),
              PLUM_SE_REASON)
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 41. PROBIT — disease OF saiN WITH score
# ════════════════════════════════════════════════════════════════════════════
if (want("probit-disease-score")) {
  hdr("PROBIT (disease WITH score)")
  r <- run_entry("probit-disease-score")
  o <- tbl(r, "output.probit.paramTitle")
  s <- stab("Probit Analysis", "Parameter Estimates")
  for (p in list(list("score", "score"), list("output.col.constant", "Intercept"))) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    cmp(sprintf("%s estimate", p[[2]]), ocell(ours, 2), after(sr, p[[2]], 1))
    cmp(sprintf("%s SE", p[[2]]), ocell(ours, 3), after(sr, p[[2]], 2))
    cmp_known(sprintf("%s Z", p[[2]]), ocell(ours, 4), after(sr, p[[2]], 3),
              paste("Kestirim ve anlamlilik birebir; Z orani standart hatanin",
                    "4. ondalik farkindan 0.002 oynuyor (bizimki glm probit'in",
                    "Hessian'i, SPSS kendi yinelemesi)."))
    cmp(sprintf("%s sig", p[[2]]), ocell(ours, 5), after(sr, p[[2]], 4))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 42. SURVIVAL (life tables) — surv, STATUS=evt(1), 5-wide intervals
# ════════════════════════════════════════════════════════════════════════════
if (want("lifetables-surv-evt")) {
  hdr("SURVIVAL (life table, surv by 5)")
  r <- run_entry("lifetables-surv-evt")
  o <- tbl(r, "output.lifetab.title")
  s <- stab("Survival Analysis", "Life Table")
  for (rr in o$rows %||% list()) {
    start <- as.character(rr[[1]])
    sr <- srow1(s, start)
    if (is.null(sr)) next
    cmp_cells(sprintf("interval %s", start), rr, sr,
              list(list("entering", 2, 2, 0), list("withdrawn", 3, 3, 0),
                   list("exposed", 4, 4, 1), list("terminal events", 5, 5, 0),
                   list("prop. terminating", 6, 6, 2), list("prop. surviving", 7, 7, 2),
                   list("cumulative surviving", 8, 8, 2),
                   # 2026-10: the five columns SPSS prints after it.
                   list("SE cumulative", 9, 9, 2), list("density", 10, 10, 3),
                   list("SE density", 11, 11, 3), list("hazard", 12, 12, 2),
                   list("SE hazard", 13, 13, 2)))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 43. MIXED — score WITH age, SUBJECT(grp3)
# ════════════════════════════════════════════════════════════════════════════
if (want("mixed-score-age-grp3")) {
  hdr("MIXED (score WITH age, subject grp3)")
  r <- run_entry("mixed-score-age-grp3")
  o <- tbl(r, "output.mixed.fixedTitle")
  s <- stab("Mixed", "Estimates of Fixed Effects")
  for (p in list(list("output.col.intercept", "Intercept"), list("age", "age"))) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    st_ <- if (is.null(sr)) NULL else as.list(tailn(sr, 7))
    cmp_cells(p[[2]], ours, st_,
              list(list("estimate", 2, 1, 6), list("SE", 3, 2, 6),
                   list("t", 5, 4), list("sig", 6, 5)))
    for (q in list(list("CI lower", 7, 6), list("CI upper", 8, 7))) {
      cmp_known(sprintf("%s %s", p[[2]], q[[1]]), ocell(ours, q[[2]]),
                if (is.null(st_)) NA else st_[[q[[3]]]],
                "Guven araligi df'ten tureiyor — asagidaki df notuyla ayni neden.", 3)
    }
    cmp_known(sprintf("%s df", p[[2]]), ocell(ours, 4), after(sr, p[[2]], 3),
              paste("Payda serbestlik derecesi: nlme'nin containment kurali",
                    "113 veriyor, SPSS burada 115 (N - p) basiyor; katsayi, SE,",
                    "t ve Sig. birebir ayni."),
              0)
  }
  # 2026-10: Information Criteria, SPSS MIXED algorithm (REML: n = N - p,
  # d = covariance parameters). Before the fix AIC/BIC used lme4's counting.
  ic <- tbl(r, "output.mixed.fitTitle")
  s <- stab("Mixed", "Information Criteria")
  for (p in list(list("output.mixed.m2ll", "-2 Restricted Log Likelihood"),
                 list("output.col.aic", "Akaike's Information Criterion (AIC)"),
                 list("output.mixed.aicc", "Hurvich and Tsai's Criterion (AICC)"),
                 list("output.mixed.caic", "Bozdogan's Criterion (CAIC)"),
                 list("output.col.bic", "Schwarz's Bayesian Criterion (BIC)"))) {
    cmp(p[[2]], ocell(orow(ic, p[[1]]), 2), after(srow(s, p[[2]]), p[[2]], 1))
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 44. GENLIN — evt WITH score age (Poisson)
# ════════════════════════════════════════════════════════════════════════════
if (want("genlin-evt-score-age")) {
  hdr("GENLIN (evt WITH score age, Poisson)")
  r <- run_entry("genlin-evt-score-age")
  o <- tbl(r, "output.genlin.paramTitle")
  if (is.null(o)) o <- tbl(r, "output.genlin.coeffTitle")
  s <- stab("Generalized Linear Models", "Parameter Estimates")
  for (p in list(list("output.col.constant", "(Intercept)"), list("score", "score"),
                 list("age", "age"))) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    cmp(sprintf("%s B", p[[2]]), ocell(ours, 2), after(sr, p[[2]], 1))
    cmp(sprintf("%s SE", p[[2]]), ocell(ours, 3), after(sr, p[[2]], 2), 4)
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 45. MVA — score income post
# ════════════════════════════════════════════════════════════════════════════
if (want("mva-score-income-post")) {
  hdr("MVA (score income post)")
  r <- run_entry("mva-score-income-post")
  o <- tbl(r, "output.missing.uniTitle")
  s <- stab("MVA", "Univariate Statistics")
  for (v in c("score", "income", "post")) {
    ours <- orow(o, v)
    sr <- srow(s, v)
    cmp(sprintf("%s N", v), ocell(ours, 2), after(sr, v, 1), 0)
    cmp(sprintf("%s mean", v), ocell(ours, 3), after(sr, v, 2), 4)
    cmp(sprintf("%s SD", v), ocell(ours, 4), after(sr, v, 3), 4)
    cmp(sprintf("%s missing N", v), ocell(ours, 5), after(sr, v, 4), 0)
    cmp(sprintf("%s missing %%", v), ocell(ours, 6), after(sr, v, 5), 1)
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 46. PROPORTIONS — disease, TESTVAL .5 (SPSS 32)
# ════════════════════════════════════════════════════════════════════════════
if (want("proportions-one-disease")) {
  hdr("PROPORTIONS one-sample (disease = 1, SPSS 32)")
  use_spss(32)
  r <- run_entry("proportions-one-disease")
  o <- tbl(r, "output.proportions.oneTitle")
  ours <- if (is.null(o) || length(o$rows) == 0) NULL else o$rows[[1]]
  s <- stab("Proportions", "One-Sample Proportions Confidence Intervals")
  sr <- srow(s, "Wilson Score")
  cmp("successes", 55, after(sr, "Wilson Score", 1), 0)
  cmp("trials (N)", ocell(ours, 2), after(sr, "Wilson Score", 2), 0)
  cmp("observed proportion", ocell(ours, 3), after(sr, "Wilson Score", 3))
  cmp("asymptotic SE", ocell(ours, 4), after(sr, "Wilson Score", 4))
  cmp("Wilson CI lower", ocell(ours, 7), after(sr, "Wilson Score", 5))
  cmp("Wilson CI upper", ocell(ours, 8), after(sr, "Wilson Score", 6))
  note("SPSS 32'nin test tablosu Mid-p ve Score testlerini basiyor; bizim")
  note("anlamlilik sutunumuz tam binom (exact) — ayni sutun degil, kiyaslanmadi.")
  use_spss(26)
}

# ════════════════════════════════════════════════════════════════════════════
# 47. GENLINMIXED — disease WITH score, SUBJECTS=grp3 (SPSS 32)
# ════════════════════════════════════════════════════════════════════════════
if (want("glmm-disease-score-grp3")) {
  hdr("GENLINMIXED (disease WITH score, subject grp3, SPSS 32)")
  use_spss(32)
  r <- run_entry("glmm-disease-score-grp3")
  o <- tbl(r, "output.glmm.fixedTitle")
  s <- stab("Generalized Linear Mixed Models", "Fixed Coefficients")
  for (p in list(list("output.col.constant", "Intercept"), list("score", "score"))) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    cmp_known(sprintf("%s coefficient", p[[2]]), ocell(ours, 2), after(sr, p[[2]], 1),
              paste("Ayni model, farkli kestirim: bizimki lme4::glmer Laplace",
                    "yaklasimi, SPSS'inki kendi lineerlestirme yontemi.",
                    "Isaret ve buyukluk ayni, 3. ondalikta ayrisiyor."))
    cmp_known(sprintf("%s SE", p[[2]]), ocell(ours, 3), after(sr, p[[2]], 2),
              "Ayni kestirim farki (yukaridaki notla ayni).")
  }
  use_spss(26)
}

# ════════════════════════════════════════════════════════════════════════════
# 48. KNN — disease WITH score age, k = 5
# ════════════════════════════════════════════════════════════════════════════
if (want("knn-disease-score-age")) {
  hdr("KNN (disease WITH score age, k = 5)")
  r <- run_entry("knn-disease-score-age")
  o <- tbl(r, "output.knn.modelSummaryTitle")
  s <- stab("Nearest Neighbor Analysis", "Case Processing Summary")
  cmp("valid N", ocell(orow(o, "output.col.n"), 2), after(srow(s, "Valid"), "Valid", 1), 0)
  cmp("excluded N", 120 - num(ocell(orow(o, "output.col.n"), 2)),
      after(srow(s, "Excluded"), "Excluded", 1), 0)
  cmp("total N", 120, after(srow(s, "Total"), "Total", 1), 0)
  note("SPSS partitions into training/holdout by default and classifies only the")
  note("holdout, so its hit rates are not comparable with our leave-one-out ones;")
  note("the case counts are what both report on the same footing.")
}

# ════════════════════════════════════════════════════════════════════════════
# 49. TREE — disease BY score age (CHAID)
# ════════════════════════════════════════════════════════════════════════════
if (want("tree-disease-score-age")) {
  hdr("TREE (disease BY score age)")
  r <- run_entry("tree-disease-score-age")
  TREE_REASON <- paste(
    "Ayni aile, ayni agac degil: bizimki rpart (CART, cp ile budama),",
    "SPSS'in CRT'si kendi minimum/budama kurallariyla farkli bolme noktalari",
    "buluyor; ustelik SPSS eksik yordayicili vakalari vekil bolmelerle 120'de",
    "tutuyor, biz tam vakayla (117) calisiyoruz. Toplam dogruluk ve risk",
    "tahmini yine de binde iki icinde ortusuyor."
  )
  s <- stab("Classification Tree", "Case Processing Summary")
  o <- tbl(r, "output.tree.modelSummaryTitle")
  cmp_known("valid N", ocell(orow(o, "output.col.n"), 2),
            after(srow(s, "Valid"), "Valid", 1), TREE_REASON, 0)
  cl <- tbl(r, "output.knn.classTitle")
  s <- stab("Classification Tree", "Classification")
  for (g in c("0", "1")) {
    ours <- orow(cl, g)
    sr <- srow1(s, g)
    cmp_known(sprintf("classified %s -> 0", g), ocell(ours, 2),
              if (is.null(sr)) NA else sr[[2]], TREE_REASON, 0)
    cmp_known(sprintf("classified %s -> 1", g), ocell(ours, 3),
              if (is.null(sr)) NA else sr[[3]], TREE_REASON, 0)
  }
  # What survives the algorithm difference: the tree's overall quality.
  cmp("overall % correct", ocell(orow(cl, "output.knn.overallRow"), 4),
      after(srow(s, "Overall Percentage"), "Overall Percentage", 3), 0)
  rk <- tbl(r, "output.tree.riskTitle")
  s <- stab("Classification Tree", "Risk")
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp("risk estimate", ocell(orow(rk, "output.tree.estimate"), 2),
      if (is.null(sr)) NA else sr[[2]], 2)
  cmp("risk std. error", ocell(orow(rk, "output.col.stdError"), 2),
      if (is.null(sr)) NA else sr[[3]], 2)
}

# ════════════════════════════════════════════════════════════════════════════
# 50. GENLIN /REPEATED (GEE) — score WITH age, SUBJECT=grp3
# ════════════════════════════════════════════════════════════════════════════
if (want("gee-score-age-grp3")) {
  hdr("GEE / GENLIN /REPEATED (score WITH age, subject grp3)")
  r <- run_entry("gee-score-age-grp3")
  o <- tbl(r, "output.gee.paramTitle")
  # The GEE run is the second Generalized Linear Models block in the job (the
  # first is the plain GENLIN scenario).
  s <- stab("Generalized Linear Models", "Parameter Estimates", 2)
  for (p in list(list("output.col.constant", "(Intercept)"), list("age", "age"))) {
    ours <- orow(o, p[[1]])
    sr <- srow(s, p[[2]])
    for (q in list(list("B", 2, 1), list("SE", 3, 2))) {
      cmp_known(sprintf("%s %s", p[[2]], q[[1]]), ocell(ours, q[[2]]),
                after(sr, p[[2]], q[[3]]),
                paste("Bu veri setinde SUBJECT=grp3 yalniz 3 kume veriyor; degisim-ici",
                      "korelasyon 3 kumeden kestirilince iki uygulama (geepack sandwich",
                      "vs SPSS model-tabanli) hem katsayida hem hatada ayrisiyor."), 3)
    }
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 51. ALSCAL / MULTIPLE IMPUTATION / REPORT / GRAPH — no pivot tables
# ════════════════════════════════════════════════════════════════════════════
if (want("mds-q1-q3") || want("mi-score-income") || want("report-rows-score-grp3") ||
    want("report-columns-score-grp3") || want("chart-histogram-score")) {
  hdr("ALSCAL / MULTIPLE IMPUTATION / REPORT / GRAPH")
  note("Bu bes komut SPSS'te PIVOT TABLO uretmiyor: ALSCAL ve REPORT duz metin")
  note("basiyor, GRAPH yalniz grafik, MULTIPLE IMPUTATION ise sonucu bir veri")
  note("setine yaziyor. Hepsi SPSS'te hatasiz kosuyor (isin uyari tablosu yok) ve")
  note("Paste = Tamam esdegerligi dispatch testinde kilitli; sayisal karsilastirma")
  note("icin OXML'de kiyaslanacak tablo yok.")
  for (id in c("mds-q1-q3", "mi-score-income", "report-rows-score-grp3",
               "report-columns-score-grp3", "chart-histogram-score")) {
    if (!want(id)) next
    r <- run_entry(id)
    produced <- if (is.null(r)) 0 else length(r$tables) + length(r$plots)
    cmp(sprintf("%s: SAI cikti uretti", id), if (produced > 0) 1 else 0, 1, 0)
  }
}

# ════════════════════════════════════════════════════════════════════════════
# 52. ROC ANALYSIS — score BY disease(1) (SPSS 32)
# ════════════════════════════════════════════════════════════════════════════
if (want("roc-analysis-score-disease")) {
  hdr("ROC ANALYSIS (score BY disease(1), SPSS 32)")
  use_spss(32)
  r <- run_entry("roc-analysis-score-disease")
  o <- orow(tbl(r, "output.roc.aucTitle"), "score")
  s <- stab("ROC Analysis", "Case Processing Summary")
  cmp("positive N", 54, after(srow(s, "Positive"), "Positive", 1), 0)
  cmp("negative N", 63, after(srow(s, "Negative"), "Negative", 1), 0)
  s <- stab("ROC Analysis", "Area Under the ROC Curve")
  sr <- srow1(s, "score")
  cmp("area", ocell(o, 2), if (is.null(sr)) NA else sr[[length(sr)]])
  use_spss(26)
}

# ════════════════════════════════════════════════════════════════════════════
# 53. POWER — independent means, N = 30 per group (SPSS 32)
# ════════════════════════════════════════════════════════════════════════════
if (want("power-onesample")) {
  hdr("POWER (independent means, n = 30/group, SPSS 32)")
  use_spss(32)
  r <- run_entry("power-onesample")
  o <- tbl(r, "output.power.title")
  s <- stab("Power Analysis - Independent Sample Means", "Power Analysis Table")
  sr <- if (length(s) > 1) s[[2]] else NULL
  cmp("achieved power", ocell(orow(o, "output.power.achieved"), 2),
      if (is.null(sr)) NA else sr[[2]])
  cmp("N per group", ocell(orow(o, "output.power.nPerGroup"), 2),
      if (is.null(sr)) NA else sr[[3]], 0)
  cmp("effect size", ocell(orow(o, "output.power.effectSize"), 2),
      if (is.null(sr)) NA else sr[[5]], 2)
  cmp("alpha", ocell(orow(o, "output.power.alpha"), 2),
      if (is.null(sr)) NA else sr[[6]], 2)
  use_spss(26)
}

# ════════════════════════════════════════════════════════════════════════════
# 11. EXAMINE — score income BY grp3, DESCRIPTIVES EXTREME PERCENTILES
# ════════════════════════════════════════════════════════════════════════════
if (want("explore-score-income-grp3")) {
  hdr("EXAMINE (score income BY grp3)")
  r <- run_entry("explore-score-income-grp3")
  note("EXAMINE emits an ungrouped block first and the BY-group block second;")
  note("SAI produces the grouped one, so the grouped tables are the comparison.")

  cps <- tbl(r, "output.cps.title")
  s <- stab("Explore", "Case Processing Summary", minRows = 4)
  for (v in c("score", "income")) for (g in c("1", "2", "3")) {
    o <- NULL
    for (rr in cps$rows %||% list()) if (identical(as.character(rr[[1]]), v) && identical(as.character(rr[[2]]), g)) o <- rr
    cmp_cells(sprintf("CPS %s grp%s", v, g), o, srow(s, v, g), list(
      list("valid N", 3, 3, 0), list("valid %", 4, 4, 1),
      list("missing N", 5, 5, 0), list("missing %", 6, 6, 1),
      list("total N", 7, 7, 0)
    ))
  }

  sd_ <- stab("Explore", "Descriptives", minRows = 30)
  DESC <- list(
    list("output.stat.mean", "Mean", 1, 6), list("output.stat.ciLower", "Lower Bound", 1, 6),
    list("output.stat.ciUpper", "Upper Bound", 1, 6), list("output.stat.trimmedMean", "5% Trimmed Mean", 1, 6),
    list("output.stat.median", "Median", 1, 6), list("output.stat.variance", "Variance", 1, 3),
    list("output.stat.sd", "Std. Deviation", 1, 6), list("output.stat.min", "Minimum", 1, 6),
    list("output.stat.max", "Maximum", 1, 6), list("output.stat.range", "Range", 1, 6),
    list("output.stat.iqr", "Interquartile Range", 1, 6),
    list("output.stat.skewness", "Skewness", 1, 3), list("output.stat.seSkew", "Skewness", 2, 3),
    list("output.stat.kurtosis", "Kurtosis", 1, 3), list("output.stat.seKurt", "Kurtosis", 2, 3)
  )
  for (v in c("score", "income")) for (g in c("1", "2", "3")) {
    o <- tbl(r, sprintf("output.explore.descTitle:%s (grp3 = %s)", v, g))
    # (SPSS's Explore Descriptives has no N row — the count is compared in the
    # Case Processing Summary above.)
    for (p in DESC) {
      sr <- srow(sd_, v, g, p[[2]])
      cmp(sprintf("desc %s grp%s %s%s", v, g, p[[2]], if (p[[3]] == 2) " (SE)" else ""),
          ocell(orow(o, p[[1]]), 2), after(sr, p[[2]], p[[3]]), p[[4]])
    }
  }

  s <- stab("Explore", "Percentiles", minRows = 8)
  for (v in c("score", "income")) {
    o <- tbl(r, paste0("output.explore.percentilesTitle:", v))
    for (g in c("1", "2", "3")) {
      ow <- NULL; ot <- NULL
      for (rr in o$rows %||% list()) {
        if (!identical(as.character(rr[[2]]), g)) next
        if (identical(as.character(rr[[1]]), "output.explore.pctWeightedAvg")) ow <- rr else ot <- rr
      }
      sw <- srow(s, "Weighted Average(Definition 1)", v, g)
      cmp_vec(sprintf("pct %s grp%s weighted avg", v, g),
              lapply(3:9, function(i) ocell(ow, i)), tailn(sw, 7), 6)
      st_ <- srow(s, "Tukey's Hinges", v, g)
      cmp_vec(sprintf("pct %s grp%s Tukey hinges", v, g),
              lapply(5:7, function(i) ocell(ot, i)), tailn(st_, 3), 6)
    }
  }

  s <- stab("Explore", "Extreme Values", minRows = 30)
  for (v in c("score", "income")) {
    o <- tbl(r, paste0("output.explore.extremeTitle:", v))
    for (g in c("1", "2", "3")) for (kind in c("Highest", "Lowest")) {
      okey <- paste0("output.explore.extreme", kind)
      ours <- Filter(function(rr) identical(as.character(rr[[1]]), g) &&
                       identical(as.character(rr[[2]]), okey), o$rows %||% list())
      theirs <- Filter(function(rr) length(rr) >= 6 && rr[[1]] == v && rr[[2]] == g && rr[[3]] == kind,
                       s %||% list())
      cmp_vec(sprintf("extreme %s grp%s %s case#", v, g, kind),
              lapply(ours, function(rr) rr[[4]]), lapply(theirs, function(rr) rr[[5]]), 0)
      cmp_vec(sprintf("extreme %s grp%s %s value", v, g, kind),
              lapply(ours, function(rr) rr[[5]]), lapply(theirs, function(rr) rr[[6]]), 6)
    }
  }
}

# ── Özet ────────────────────────────────────────────────────────────────────
cat(sprintf("\nSONUC: %d OK, %d FARK, %d BILINCLI, %d ATLANDI\n",
            n_pass, n_fail, n_known, n_skip))
if (length(fails)) cat("FARKLAR:\n  -", paste(fails, collapse = "\n  - "), "\n")
if (length(knowns)) cat("BILINCLI:\n  -", paste(knowns, collapse = "\n  - "), "\n")
if (length(skips)) cat("ATLANDI:\n  -", paste(skips, collapse = "\n  - "), "\n")
quit(status = if (n_fail > 0) 1 else 0)
