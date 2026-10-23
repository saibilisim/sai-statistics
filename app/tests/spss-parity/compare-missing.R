# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Missing-values strategy parity: our R scripts vs real SPSS 26, per procedure,
# in both modes (SPSS default vs /MISSING LISTWISE).
#
#   job-missing.sps            — every Missing-Values-capable procedure twice
#   dispatch-missing.test.ts   — that file through our dispatcher →
#                                missing-syntax-params.json
#   run-missing-job.py         — the same file through real SPSS (OXML) →
#                                extract-tables-oxml.cjs → spss-missing-tables.json
#   this script                — replays the params through the production R
#                                scripts and compares, N by N.
#
# Fixture: data.csv with overlapping NAs (score 3, income 4, post 2 of 120).
#
# Usage:
#   Rscript tests/spss-parity/compare-missing.R
# Resolves its own paths from the script location.

.here <- dirname(normalizePath(sub("--file=", "",
  grep("--file=", commandArgs(trailingOnly = FALSE), value = TRUE))))
if (length(.here) == 0 || !nzchar(.here)) .here <- getwd()

options(sai.rScriptsDir = normalizePath(file.path(.here, "..", "..", "r-scripts")))
spss_tables <- jsonlite::fromJSON(file.path(.here, "spss-missing-tables.json"), simplifyVector = FALSE)
runs <- jsonlite::fromJSON(file.path(.here, "missing-syntax-params.json"), simplifyVector = FALSE)
df <- read.csv(file.path(.here, "data.csv"), stringsAsFactors = FALSE)

setwd(normalizePath(file.path(.here, "..", "r-validation")))
source("_harness.R")

n_pass <- 0; n_fail <- 0; n_skip <- 0
fails <- character(0); skips <- character(0)
cmp <- function(label, ours, theirs, digits = 0) {
  if (is.null(theirs) || is.null(ours) || length(ours) != 1 || length(theirs) != 1 ||
      is.na(ours) || is.na(theirs)) {
    n_skip <<- n_skip + 1; skips <<- c(skips, label)
    cat(sprintf("  %-44s %-16s %-16s  ATLANDI\n", label, "-", "-"))
    return(invisible(NULL))
  }
  a <- as.numeric(ours); b <- as.numeric(theirs)
  ok <- abs(a - b) <= 0.5 * 10^(-digits) + 1e-12
  if (ok) n_pass <<- n_pass + 1 else { n_fail <<- n_fail + 1; fails <<- c(fails, label) }
  cat(sprintf("  %-44s %-16s %-16s  %s\n", label,
              format(round(a, max(digits, 0))), format(round(b, max(digits, 0))),
              if (ok) "OK" else "FARK"))
}
hdr <- function(x) cat(sprintf("\n== %s ==\n  %-44s %-16s %-16s\n", x, "istatistik", "SAI", "SPSS"))

num <- function(x) suppressWarnings(as.numeric(x))

# ── SPSS side: pick the occ-th table of a command/label (occ 1 = default run,
#    occ 2 = /MISSING LISTWISE). Rows are string vectors. ────────────────────
pick <- function(command, label, occ = 1, minRows = 0) {
  k <- 0
  for (t in spss_tables) {
    if (identical(t$command, command) && identical(t$label, label) && length(t$rows) >= minRows) {
      k <- k + 1
      if (k == occ) return(t$rows)
    }
  }
  NULL
}
# First cell of each SPSS row that equals `label` anywhere → the row.
srow <- function(rows, ..., occ = 1) {
  k <- 0
  for (r in rows) {
    if (all(vapply(list(...), function(n) any(r == n), logical(1)))) {
      k <- k + 1
      if (k == occ) return(r)
    }
  }
  NULL
}

# ── Our side: replay one dispatched entry (scriptFile + listwise flag). ─────
dfc <- df
names(dfc) <- paste0("col_", seq_along(df))
our <- function(scriptFile, listwise) {
  for (e in runs) {
    if (identical(e$request$scriptFile, scriptFile) && identical(e$listwise, listwise)) {
      return(run_analysis_script(scriptFile, write_fixture(dfc, e$request$params)))
    }
  }
  NULL
}
tbl <- function(result, prefix) tryCatch(find_table(result, prefix), error = function(e) NULL)
# Row of one of OUR tables whose cell `col` equals `key` (colId/level/total).
orow <- function(t, key, col = 1) {
  if (is.null(t)) return(NULL)
  for (r in t$rows) if (identical(as.character(r[[col]]), key)) return(r)
  NULL
}

MODES <- list(list(FALSE, 1L, "default"), list(TRUE, 2L, "listwise"))

# ── 1. One-sample T-TEST ────────────────────────────────────────────────────
hdr("T-TEST one-sample (score income, TESTVAL=50)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("ttest-onesample.R", lw), "output.ttest1.statsTitle")
  s <- pick("T-Test", "One-Sample Statistics", occ)
  for (v in c("score", "income")) {
    cmp(paste(v, "N", tag), num(orow(o, v)[[2]]), num(srow(s, v)[[2]]))
    cmp(paste(v, "Mean", tag), num(orow(o, v)[[3]]), num(srow(s, v)[[3]]), digits = 3)
  }
}

# ── 2. Paired T-TEST ────────────────────────────────────────────────────────
hdr("T-TEST paired (pre-post, score-income)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("ttest-paired.R", lw), "output.ttestPaired.statsTitle")
  s <- pick("T-Test", "Paired Samples Statistics", occ)
  # SPSS row shape: [pair, var, mean, N, sd, se]; ours: [colId, mean, N, sd, se]
  for (v in c("pre", "post", "score", "income")) {
    cmp(paste(v, "N", tag), num(orow(o, v)[[3]]), num(srow(s, v)[[4]]))
  }
}

# ── 3. Independent-samples T-TEST ───────────────────────────────────────────
hdr("T-TEST independent (score income BY grp2)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("ttest-independent.R", lw), "output.ttestInd.groupStatsTitle")
  s <- pick("T-Test", "Group Statistics", occ)
  for (v in c("score", "income")) {
    for (g in c("1", "2")) {
      # rows: [varName, grp, N, ...] — the colId/name repeats on every row here.
      ours <- NULL
      for (r in o$rows) if (as.character(r[[1]]) == v && as.character(r[[2]]) == g) ours <- num(r[[3]])
      theirs_row <- NULL
      for (r in s) if (r[[1]] == v && r[[2]] == g) theirs_row <- r
      cmp(paste(v, "grp", g, "N", tag), ours, num(theirs_row[[3]]))
    }
  }
}

# ── 4. ONEWAY ───────────────────────────────────────────────────────────────
hdr("ONEWAY (score income BY grp3)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  s <- pick("Oneway", "Descriptives", occ)
  for (v in c("score", "income")) {
    o <- tbl(our("anova-oneway.R", lw), paste0("output.anova.descTitle:", v))
    for (g in c("1", "2", "3")) {
      theirs_row <- NULL
      for (r in s) if (length(r) >= 4 && r[[1]] == v && r[[3]] == g) theirs_row <- r
      cmp(paste(v, "grp", g, "N", tag), num(orow(o, g)[[2]]), num(theirs_row[[4]]))
      cmp(paste(v, "grp", g, "Mean", tag), num(orow(o, g)[[3]]), num(theirs_row[[5]]), digits = 3)
    }
  }
}

# ── 5. MEANS ────────────────────────────────────────────────────────────────
hdr("MEANS (score income BY grp3)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  s <- pick("Means", "Report", occ)
  for (v in c("score", "income")) {
    vi <- match(v, c("score", "income"))  # cell position within N/Mean rows
    o <- tbl(our("means.R", lw), paste0("output.means.reportTitle:", v))
    for (g in c("1", "2", "3")) {
      n_row <- srow(s, g, "N"); mean_row <- srow(s, g, "Mean")
      cmp(paste(v, "grp", g, "N", tag), num(orow(o, g)[[3]]), num(n_row[[3 + vi]]))
      cmp(paste(v, "grp", g, "Mean", tag), num(orow(o, g)[[2]]), num(mean_row[[3 + vi]]), digits = 3)
    }
  }
}

# ── 6. CORRELATIONS ─────────────────────────────────────────────────────────
hdr("CORRELATIONS (score income age — SPSS default PAIRWISE)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("correlation.R", lw), "output.correlate.title:Pearson")
  s <- pick("Correlations", "Correlations", occ)
  vars3 <- c("score", "income", "age")
  for (i in 1:3) for (j in i:3) {
    vi <- vars3[i]; vj <- vars3[j]
    # SPSS omits the N rows from the table when every cell shares one N (the
    # LISTWISE run) — there the discriminating value is the coefficient.
    if (lw) {
      o_r <- NULL; s_r <- NULL
      in_block <- FALSE
      for (r in o$rows) {
        if (as.character(r[[1]]) == vi) in_block <- TRUE
        if (in_block && grepl("Corr$", as.character(r[[2]]))) { o_r <- num(r[[j + 2]]); break }
      }
      s_r <- num(srow(s, vi, "Pearson Correlation")[[j + 2]])
      cmp(paste(vi, "x", vj, "r", tag), o_r, s_r, digits = 3)
      next
    }
    # ours: N row of vi's block, cell j+2; theirs: [vi, "N", c1..c3]
    o_n <- NULL
    in_block <- FALSE
    for (r in o$rows) {
      if (as.character(r[[1]]) == vi) in_block <- TRUE
      if (in_block && identical(as.character(r[[2]]), "output.col.n")) { o_n <- num(r[[j + 2]]); break }
    }
    s_n <- num(srow(s, vi, "N")[[j + 2]])
    cmp(paste(vi, "x", vj, "N", tag), o_n, s_n)
  }
}

# ── 7. EXAMINE (SPSS default is LISTWISE — see explore.R) ──────────────────
hdr("EXAMINE (score income BY grp3)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("explore.R", lw), "output.cps.title")
  s <- pick("Explore", "Case Processing Summary", occ, minRows = 4)
  for (v in c("score", "income")) {
    for (g in c("1", "2", "3")) {
      ours <- NULL
      for (r in o$rows) if (as.character(r[[1]]) == v && as.character(r[[2]]) == g) ours <- num(r[[3]])
      theirs_row <- NULL
      for (r in s) if (r[[1]] == v && r[[2]] == g) theirs_row <- r
      cmp(paste(v, "grp", g, "ValidN", tag), ours, num(theirs_row[[3]]))
    }
  }
}

# ── 8. NPAR Mann-Whitney ────────────────────────────────────────────────────
hdr("NPAR M-W (score income BY grp2)")
npar_ranks <- function(kind, occ) {
  k <- 0
  for (t in spss_tables) {
    if (!identical(t$command, "NPar Tests") || !identical(t$label, "Ranks")) next
    flat <- paste(vapply(t$rows, function(r) paste(r, collapse = "|"), character(1)), collapse = "//")
    is_wil <- grepl("Negative Ranks", flat)
    is_mw <- grepl("Sum of Ranks", flat) && !is_wil
    is_kw <- !grepl("Sum of Ranks", flat)
    match_kind <- switch(kind, wilcoxon = is_wil, mw = is_mw, kw = is_kw)
    if (match_kind) { k <- k + 1; if (k == occ) return(t$rows) }
  }
  NULL
}
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("npar-mann-whitney.R", lw), "output.npar.ranksTitle")
  s <- npar_ranks("mw", occ)
  cur <- NULL
  for (v in c("score", "income")) {
    for (g in c("1", "2")) {
      ours <- NULL
      for (r in o$rows) {
        if (nzchar(as.character(r[[1]]))) cur <- as.character(r[[1]])
        if (identical(cur, v) && as.character(r[[2]]) == g) ours <- num(r[[3]])
      }
      theirs_row <- NULL
      for (r in s) if (r[[1]] == v && r[[2]] == g) theirs_row <- r
      cmp(paste(v, "grp", g, "N", tag), ours, num(theirs_row[[3]]))
    }
  }
}

# ── 9. NPAR Kruskal-Wallis ──────────────────────────────────────────────────
hdr("NPAR K-W (score income BY grp3)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("npar-kruskal-wallis.R", lw), "output.npar.ranksTitle")
  s <- npar_ranks("kw", occ)
  cur <- NULL
  for (v in c("score", "income")) {
    for (g in c("1", "2", "3")) {
      ours <- NULL
      for (r in o$rows) {
        if (nzchar(as.character(r[[1]]))) cur <- as.character(r[[1]])
        if (identical(cur, v) && as.character(r[[2]]) == g) ours <- num(r[[3]])
      }
      theirs_row <- NULL
      for (r in s) if (r[[1]] == v && r[[2]] == g) theirs_row <- r
      cmp(paste(v, "grp", g, "N", tag), ours, num(theirs_row[[3]]))
    }
  }
}

# ── 10. NPAR Wilcoxon ───────────────────────────────────────────────────────
hdr("NPAR Wilcoxon (pre-post, score-income)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("npar-wilcoxon.R", lw), "output.npar.ranksTitle")
  s <- npar_ranks("wilcoxon", occ)
  pairs <- list(list("post - pre", 1), list("income - score", 2))
  for (pr in pairs) {
    srow_total <- NULL
    for (r in s) if (r[[1]] == pr[[1]] && r[[2]] == "Total") srow_total <- r
    # ours: total row of the pr[[2]]-th pair block
    totals <- Filter(function(r) as.character(r[[2]]) == "output.col.total", o$rows)
    ours <- if (length(totals) >= pr[[2]]) num(totals[[pr[[2]]]][[3]]) else NULL
    cmp(paste("pair", pr[[2]], "Total N", tag), ours, num(srow_total[[3]]))
  }
}

# ── 11. SUMMARIZE (Case Summaries) ──────────────────────────────────────────
hdr("SUMMARIZE (score income BY grp3)")
for (m in MODES) {
  lw <- m[[1]]; occ <- m[[2]]; tag <- m[[3]]
  o <- tbl(our("case-summaries.R", lw), "output.caseSummaries.summaryTitle")
  s <- pick("Summarize", "Report", occ)
  for (v in c("score", "income")) {
    vi <- match(v, c("score", "income"))
    for (g in c("1", "2", "3")) {
      ours <- NULL
      for (r in o$rows) if (as.character(r[[1]]) == g && as.character(r[[2]]) == v) ours <- num(r[[3]])
      n_row <- srow(s, g, "N")
      cmp(paste(v, "grp", g, "N", tag), ours, num(n_row[[3 + vi]]))
    }
  }
}

# ── 12. OLAP CUBES (SPSS has no /MISSING there — default mode only) ─────────
hdr("OLAP CUBES (score income BY grp3 — default only)")
o <- tbl(our("olap-cubes.R", FALSE), "output.olapCubes.title")
s <- pick("OLAP Cubes", "Case Processing Summary", 1)
for (v in c("score", "income")) {
  ours <- NULL
  # The Total block's continuation rows carry an empty first cell.
  for (r in o$rows) {
    if (as.character(r[[2]]) == v && as.character(r[[1]]) %in% c("output.col.total", "")) ours <- num(r[[3]])
  }
  theirs_row <- NULL
  for (r in s) if (grepl(v, r[[1]], fixed = TRUE)) theirs_row <- r
  cmp(paste(v, "total N default"), ours, num(theirs_row[[2]]))
}

# ── Özet ────────────────────────────────────────────────────────────────────
cat(sprintf("\nSONUC: %d OK, %d FARK, %d ATLANDI\n", n_pass, n_fail, n_skip))
if (length(fails)) cat("FARKLAR:\n  -", paste(fails, collapse = "\n  - "), "\n")
if (length(skips)) cat("ATLANDI:\n  -", paste(skips, collapse = "\n  - "), "\n")
quit(status = if (n_fail > 0) 1 else 0)
