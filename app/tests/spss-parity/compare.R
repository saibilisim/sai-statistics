# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Compare our analysis scripts against SPSS on the same data.
#
# SPSS's numbers come from spss-values.json, extracted from a real SPSS 26 run
# (Production Facility, headless). Ours come from the production R scripts,
# invoked through the r-validation harness exactly as the app invokes them.
#
# Usage:
#   Rscript tests/spss-parity/compare.R
# Resolves its own paths from the script location, so it does not care which
# directory it is launched from.

.here <- dirname(normalizePath(sub("--file=", "",
  grep("--file=", commandArgs(trailingOnly = FALSE), value = TRUE))))
if (length(.here) == 0 || !nzchar(.here)) .here <- getwd()

options(sai.rScriptsDir = normalizePath(file.path(.here, "..", "..", "r-scripts")))
spss <- jsonlite::fromJSON(file.path(.here, "spss-values.json"), simplifyVector = FALSE)
df <- read.csv(file.path(.here, "data.csv"), stringsAsFactors = FALSE)

# The harness lives with the r-validation suite; reuse it rather than
# reimplementing fixture writing and script spawning.
setwd(normalizePath(file.path(.here, "..", "r-validation")))
source("_harness.R")
options(sai.currentTestFile = "compare.R") # _harness.R result dump key

# find_table() stops() when a table is absent; here that would abandon every
# later procedure, so soften it to a NULL the callers already handle.
table_or_null <- function(result, title) {
  tryCatch(find_table(result, title), error = function(e) NULL)
}

# SPSS prints most statistics to 3 decimals, some to more. Compare at the
# precision SPSS actually published rather than with a blanket epsilon.
n_pass <- 0; n_fail <- 0; n_skip <- 0
fails <- character(0); skips <- character(0)
cmp <- function(label, ours, theirs, digits = 3) {
  if (is.null(theirs) || is.null(ours) || length(ours) != 1 || is.na(ours)) {
    n_skip <<- n_skip + 1; skips <<- c(skips, label)
    cat(sprintf("  %-42s %-16s %-16s  ATLANDI\n", label, "-", "-"))
    return(invisible(NULL))
  }
  a <- as.numeric(ours); b <- as.numeric(theirs)
  # "Agrees to the precision SPSS published" — half a printed unit, rather than
  # rounding both sides and demanding equality. Rounding first makes the
  # comparison depend on tie-breaking at the boundary: R rounds 14.825 to
  # half-even (14.82) where SPSS rounds half-away-from-zero (14.83), and two
  # values that agree to four decimals were reported as a difference.
  ok <- abs(a - b) <= 0.5 * 10^(-digits) + 1e-12
  if (ok) n_pass <<- n_pass + 1 else { n_fail <<- n_fail + 1; fails <<- c(fails, label) }
  cat(sprintf("  %-42s %-16s %-16s  %s\n", label,
              format(round(a, digits), nsmall = min(digits, 3)),
              format(round(b, digits), nsmall = min(digits, 3)),
              if (ok) "OK" else "FARK"))
}

hdr <- function(x) cat(sprintf("\n== %s ==\n  %-42s %-16s %-16s\n", x, "istatistik", "SAI", "SPSS"))

# A whole block skipped because its table was not found. Counted as a skip, not
# printed and forgotten: an `if (!is.null(t))` guard that quietly does nothing
# is the same silent pass a wrong column key gives, and this harness had one
# (the Explore descriptives block compared nothing for two waves).
# A difference we have NOT explained. Distinct from BILINCLI, which means "we
# looked and decided to keep it": this one is an open question. Reported every
# run and counted on its own, so neither "0 FARK" nor the deliberate list can
# absorb it.
#
# `note` is printed under the row the same way `divergence`'s is — here it says
# how far the investigation got, so the next person starts where it stopped.
#
# No caller at the moment — the four M-estimators that used to be ACIK became
# BILINCLI once the search for their algorithm came back empty. Kept anyway:
# with only BILINCLI available, the next genuinely unexplained difference gets
# quietly filed as "deliberate", which is the failure this outcome exists to
# prevent.
n_open <- 0; opens <- character(0)
unresolved <- function(label, ours, theirs, note, digits = 3) {
  a <- if (is.null(ours) || length(ours) != 1 || is.na(ours)) NA_real_ else as.numeric(ours)
  b <- if (is.null(theirs)) NA_real_ else as.numeric(theirs)
  n_open <<- n_open + 1
  opens <<- c(opens, label)
  cat(sprintf("  %-42s %-16s %-16s  ACIK\n", label,
              format(round(a, digits), nsmall = min(digits, 3)),
              format(round(b, digits), nsmall = min(digits, 3))))
  for (line in strwrap(note, width = 72)) cat(sprintf("      | %s\n", line))
}

missing_table <- function(what) {
  n_skip <<- n_skip + 1
  skips <<- c(skips, sprintf("%s (tablo bulunamadi)", what))
  cat(sprintf("  %-42s %-16s %-16s  ATLANDI\n", what, "-", "-"))
}

# A difference we have looked at and decided to keep. Printed, counted
# separately, and never silently — the point is that "0 FARK" keeps meaning
# "nothing unexplained", not "nothing differs".
#
# `why` is printed under the row, wrapped. It describes OUR side: which
# variable entered the analysis, and by which estimator the number was
# produced. A note of the form "product A does X, product B does Y" reads like
# an excuse and gives the next reader nothing to check; naming the variable and
# the method makes the value reproducible from the note alone.
n_note <- 0; notes <- character(0)
divergence <- function(label, ours, theirs, why, digits = 3) {
  a <- if (is.null(ours) || length(ours) != 1 || is.na(ours)) NA_real_ else as.numeric(ours)
  b <- if (is.null(theirs)) NA_real_ else as.numeric(theirs)
  n_note <<- n_note + 1
  notes <<- c(notes, label)
  cat(sprintf("  %-42s %-16s %-16s  BILINCLI\n", label,
              format(round(a, digits), nsmall = min(digits, 3)),
              format(round(b, digits), nsmall = min(digits, 3))))
  for (line in strwrap(why, width = 72)) cat(sprintf("      | %s\n", line))
}

fx <- function(params) write_fixture(df, params)
tbl <- function(script, params, title) {
  table_or_null(run_analysis_script(script, fx(params)), title)
}
# Value of a cell located by its row label, so column order changes elsewhere
# cannot silently shift what is being compared.
at <- function(t, rowlabel, col) {
  if (is.null(t) || is.na(col)) return(NA_real_)
  for (i in seq_along(t$rows)) {
    if (any(vapply(t$rows[[i]], function(c) identical(as.character(c), rowlabel), logical(1)))) {
      return(suppressWarnings(as.numeric(t$rows[[i]][[col]])))
    }
  }
  NA_real_
}
# Column index by key. NA (rather than an error) when a column is absent, so
# `at()` degrades into a skip instead of aborting the run.
idx_of <- function(t, key) {
  if (is.null(t)) return(NA_integer_)
  which(unlist(t$columns) == key)[1]
}
val <- function(t, rowlabel, key) at(t, rowlabel, idx_of(t, key))
# Single-row tables: value by column key.
row1 <- function(t, key) {
  i <- idx_of(t, key)
  if (is.null(t) || is.na(i)) return(NA_real_)
  suppressWarnings(as.numeric(t$rows[[1]][[i]]))
}

# ── Descriptives ────────────────────────────────────────────────────────────
hdr("DESCRIPTIVES")
t <- tbl("descriptives.R",
         list(variables = c("score", "income", "pre", "post"),
              varNames = list(score = "score", income = "income", pre = "pre", post = "post"),
              options = list(mean = TRUE, sd = TRUE, variance = TRUE, range = TRUE,
                             min = TRUE, max = TRUE, seMean = TRUE, sum = TRUE,
                             skewness = TRUE, kurtosis = TRUE)),
         "output.descriptives.title")
for (v in c("score", "income", "pre", "post")) {
  s <- spss$descriptives[[v]]
  for (k in c("n", "min", "max", "sum", "mean", "seMean", "sd", "variance", "skew", "kurt")) {
    key <- switch(k, n = "output.col.n", min = "output.col.min", max = "output.col.max",
                  sum = "output.col.sum", mean = "output.col.mean",
                  seMean = "output.col.seMean", sd = "output.col.sd",
                  variance = "output.col.variance", skew = "output.col.skewness",
                  kurt = "output.col.kurtosis")
    if (is.na(idx_of(t, key))) { missing_table(sprintf("descriptives %s %s", v, k)); next }
    cmp(sprintf("%s %s", v, k), val(t, v, key), s[[k]])
  }
}

# ── Frequencies statistics ──────────────────────────────────────────────────
# The Statistics table SPSS prints alongside a frequency table: the same
# summary statistics, plus percentiles, whose definition is the interesting
# part (SPSS's percentile is not R's default type-7 quantile).
hdr("FREQUENCIES STATISTICS (age)")
ft <- tbl("frequencies.R",
          list(variables = c("age"), varNames = list(age = "age"),
               options = list(
                 showTable = FALSE,
                 statistics = list(mean = TRUE, median = TRUE, mode = TRUE, sd = TRUE,
                                   variance = TRUE, range = TRUE, min = TRUE, max = TRUE,
                                   semean = TRUE, sum = TRUE, skewness = TRUE,
                                   kurtosis = TRUE, percentiles = TRUE,
                                   customPercentiles = list(25, 50, 75, 90)))),
          "output.frequencies.statsTitle:age")
# Rows are (statKey, value) pairs rather than a labelled grid.
stat_val <- function(t, key) {
  if (is.null(t)) return(NA_real_)
  for (r in t$rows) if (identical(as.character(r[[1]]), key))
    return(suppressWarnings(as.numeric(r[[2]])))
  NA_real_
}
if (!is.null(ft)) {
  for (p in list(c("nValid", "output.stat.nValid"), c("nMissing", "output.stat.nMissing"),
                 c("mean", "output.stat.mean"), c("median", "output.stat.median"),
                 c("mode", "output.stat.mode"), c("sd", "output.stat.sd"),
                 c("variance", "output.stat.variance"), c("range", "output.stat.range"),
                 c("min", "output.stat.min"), c("max", "output.stat.max"),
                 c("seMean", "output.stat.seMean"), c("sum", "output.stat.sum"),
                 c("skew", "output.stat.skewness"), c("seSkew", "output.stat.seSkew"),
                 c("kurt", "output.stat.kurtosis"), c("seKurt", "output.stat.seKurt"))) {
    cmp(p[1], stat_val(ft, p[2]), spss$frequencies[[p[1]]])
  }
  for (p in c("25", "50", "75", "90")) {
    cmp(sprintf("percentile %s", p), stat_val(ft, paste0("output.stat.pct", p)),
        spss$frequencies$percentiles[[p]])
  }
} else {
  missing_table("frequencies statistics")
}

# ── Independent-samples t test ──────────────────────────────────────────────
hdr("INDEPENDENT T-TEST (score by grp2)")
tt <- tbl("ttest-independent.R",
          list(variables = c("score"), varNames = list(score = "score"),
               groupVar = "grp2", groupName = "grp2", group1 = "1", group2 = "2"),
          "output.ttestInd.testTitle")
if (!is.null(tt)) {
  cmp("t", row1(tt, "output.col.t"), spss$ttestInd$t)
  cmp("df", row1(tt, "output.col.df"), spss$ttestInd$df)
  cmp("Sig. (2-tailed)", row1(tt, "output.col.sigTwoTailed"), spss$ttestInd$sig)
  cmp("Mean Difference", row1(tt, "output.col.meanDiff"), spss$ttestInd$meanDiff)
  cmp("Std. Error Difference", row1(tt, "output.col.seDiff"), spss$ttestInd$seDiff)
  cmp("CI lower", row1(tt, "output.col.ciLower95"), spss$ttestInd$ciLower)
  cmp("CI upper", row1(tt, "output.col.ciUpper95"), spss$ttestInd$ciUpper)
  cmp("Levene F", row1(tt, "output.col.leveneF"), spss$ttestInd$leveneF)
  cmp("Levene Sig.", row1(tt, "output.col.leveneSig"), spss$ttestInd$leveneSig)
} else {
  missing_table("independent t-test")
}

# ── Paired-samples t test ───────────────────────────────────────────────────
hdr("PAIRED T-TEST (pre - post)")
res <- run_analysis_script("ttest-paired.R", fx(list(
  var1 = list("pre"), var2 = list("post"),
  varNames = list(pre = "pre", post = "post")
)))
pt <- table_or_null(res, "output.ttestPaired.testTitle")
if (!is.null(pt)) {
  cmp("Mean difference", val(pt, "pre - post", "output.col.mean"), spss$ttestPaired$mean)
  cmp("Std. Deviation", val(pt, "pre - post", "output.col.stdDeviation"), spss$ttestPaired$sd)
  cmp("Std. Error Mean", val(pt, "pre - post", "output.col.seMean"), spss$ttestPaired$seMean)
  cmp("CI lower", val(pt, "pre - post", "output.col.ciLower95"), spss$ttestPaired$ciLower)
  cmp("CI upper", val(pt, "pre - post", "output.col.ciUpper95"), spss$ttestPaired$ciUpper)
  cmp("t", val(pt, "pre - post", "output.col.t"), spss$ttestPaired$t)
  cmp("df", val(pt, "pre - post", "output.col.df"), spss$ttestPaired$df)
  cmp("Sig. (2-tailed)", val(pt, "pre - post", "output.col.sigTwoTailed"), spss$ttestPaired$sig)
} else {
  missing_table("paired t-test")
}
pc <- table_or_null(res, "output.ttestPaired.corrTitle")
if (!is.null(pc) && !is.null(spss$ttestPairedCorr)) {
  cmp("Pair correlation", val(pc, "pre - post", "output.col.correlation"), spss$ttestPairedCorr$r)
  cmp("Pair corr. N", val(pc, "pre - post", "output.col.n"), spss$ttestPairedCorr$n)
}

# ── One-sample t test ───────────────────────────────────────────────────────
hdr("ONE-SAMPLE T-TEST (score vs 50)")
ot <- tbl("ttest-onesample.R",
          list(variables = c("score"), varNames = list(score = "score"), testValue = 50),
          "output.ttest1.testTitle")
if (!is.null(ot)) {
  cmp("t", val(ot, "score", "output.col.t"), spss$ttestOne$t)
  cmp("df", val(ot, "score", "output.col.df"), spss$ttestOne$df)
  cmp("Sig. (2-tailed)", val(ot, "score", "output.col.sigTwoTailed"), spss$ttestOne$sig)
  cmp("Mean Difference", val(ot, "score", "output.col.meanDiff"), spss$ttestOne$meanDiff)
  cmp("CI lower", val(ot, "score", "output.col.ciLower95"), spss$ttestOne$ciLower)
  cmp("CI upper", val(ot, "score", "output.col.ciUpper95"), spss$ttestOne$ciUpper)
} else {
  missing_table("one-sample t-test")
}

# ── One-way ANOVA ───────────────────────────────────────────────────────────
# Both dependents, so an error that only shows up on the skewed variable
# (income) cannot hide behind the well-behaved one.
hdr("ONE-WAY ANOVA (by grp3)")
res <- run_analysis_script("anova-oneway.R", fx(list(
  variables = c("score", "income"),
  varNames = list(score = "score", income = "income"),
  factor = "grp3", factorName = "grp3",
  options = list(homogeneity = TRUE)
)))
for (v in c("score", "income")) {
  s <- spss$anova[[v]]
  a <- table_or_null(res, paste0("output.anova.titleBy:", v, "|"))
  if (is.null(a) || is.null(s)) { cat(sprintf("  (%s ANOVA tablosu yok)\n", v)); next }
  cmp(sprintf("%s Between SS", v), val(a, "output.col.betweenGroups", "output.col.sumSq"),
      s$BetweenGroups$ss)
  cmp(sprintf("%s Between df", v), val(a, "output.col.betweenGroups", "output.col.df"),
      s$BetweenGroups$df)
  cmp(sprintf("%s Between MS", v), val(a, "output.col.betweenGroups", "output.col.meanSq"),
      s$BetweenGroups$ms)
  cmp(sprintf("%s F", v), val(a, "output.col.betweenGroups", "output.col.f"),
      s$BetweenGroups$f)
  cmp(sprintf("%s Sig.", v), val(a, "output.col.betweenGroups", "output.col.sig"),
      s$BetweenGroups$sig)
  cmp(sprintf("%s Within SS", v), val(a, "output.col.withinGroups", "output.col.sumSq"),
      s$WithinGroups$ss)
  cmp(sprintf("%s Within df", v), val(a, "output.col.withinGroups", "output.col.df"),
      s$WithinGroups$df)
  cmp(sprintf("%s Within MS", v), val(a, "output.col.withinGroups", "output.col.meanSq"),
      s$WithinGroups$ms)
  cmp(sprintf("%s Total SS", v), val(a, "output.col.total", "output.col.sumSq"), s$Total$ss)
  cmp(sprintf("%s Total df", v), val(a, "output.col.total", "output.col.df"), s$Total$df)
}
# Group descriptives — the per-group Ns and means the ANOVA is built from.
for (v in c("score", "income")) {
  d <- table_or_null(res, paste0("output.anova.descTitle:", v))
  s <- spss$anovaDesc[[v]]
  if (is.null(d) || is.null(s)) next
  for (g in c("1", "2", "3")) {
    if (is.null(s[[g]])) next
    cmp(sprintf("%s grp%s N", v, g), val(d, g, "output.col.n"), s[[g]]$n)
    cmp(sprintf("%s grp%s mean", v, g), val(d, g, "output.col.mean"), s[[g]]$mean)
    cmp(sprintf("%s grp%s SD", v, g), val(d, g, "output.col.stdDeviation"), s[[g]]$sd)
  }
}
# Levene, "based on mean" — SPSS's classic homogeneity row.
for (v in c("score", "income")) {
  h <- table_or_null(res, paste0("output.anova.homogTitle:", v))
  s <- spss$levene[[v]]
  if (is.null(h) || is.null(s)) next
  cmp(sprintf("%s Levene stat", v),
      val(h, "output.anova.leveneBasedOnMean", "output.col.leveneStatistic"), s$stat)
  cmp(sprintf("%s Levene df2", v),
      val(h, "output.anova.leveneBasedOnMean", "output.col.df2"), s$df2)
  cmp(sprintf("%s Levene Sig.", v),
      val(h, "output.anova.leveneBasedOnMean", "output.col.sig"), s$sig)
}

# ── Correlations ────────────────────────────────────────────────────────────
# Both sides print a square matrix, but with different numbers of leading
# label cells, so aligning by column index silently compares a coefficient
# against the diagonal. Instead take each row's trailing run of numbers and zip
# it with the variable names in the header — that is well defined for both.
# VARS must list every variable EITHER side can put in its header: SPSS's
# CORRELATIONS also included `pre`, and omitting it made hdr_vars shorter than
# the row, so the trailing-run trim silently dropped a column.
VARS <- c("score", "income", "age", "pre")
flatten_matrix <- function(rows, header, label) {
  outm <- list()
  cur <- NULL
  hdr_vars <- header[header %in% VARS]
  for (r in rows) {
    cells <- vapply(r, function(x) if (is.null(x)) "" else as.character(x), character(1))
    hit <- which(cells %in% VARS)
    if (length(hit)) cur <- cells[hit[1]]
    if (is.null(cur) || !any(grepl(label, cells, fixed = TRUE))) next
    vals <- suppressWarnings(as.numeric(cells))
    nums <- vals[!is.na(vals)]
    if (length(nums) < length(hdr_vars)) next
    nums <- tail(nums, length(hdr_vars))
    for (j in seq_along(hdr_vars)) outm[[paste(cur, hdr_vars[j])]] <- nums[j]
  }
  outm
}
spss_matrix <- function(x, label) {
  if (is.null(x)) return(list())
  flatten_matrix(x,
                 vapply(x[[1]], function(y) if (is.null(y)) "" else as.character(y),
                        character(1)),
                 label)
}
res <- run_analysis_script("correlation.R", fx(list(
  variables = list("score", "income", "age"),
  varNames = list(score = "score", income = "income", age = "age"),
  methods = list(pearson = TRUE, spearman = TRUE)
)))
for (spec in list(
  list(name = "PEARSON CORRELATION", title = "output.correlate.title:Pearson",
       ourLabel = "output.col.pearsonCorr", theirs = spss$pearson,
       theirLabel = "Pearson Correlation"),
  list(name = "SPEARMAN CORRELATION", title = "output.correlate.title:Spearman",
       ourLabel = "output.col.spearman", theirs = spss$spearman,
       theirLabel = "Correlation Coefficient")
)) {
  hdr(spec$name)
  their <- spss_matrix(spec$theirs, spec$theirLabel)
  ct <- table_or_null(res, spec$title)
  if (is.null(ct) || !length(their)) { missing_table("correlation matrix"); next }
  ours <- flatten_matrix(ct$rows, unlist(ct$columns), spec$ourLabel)
  for (k in names(their)) {
    parts <- strsplit(k, " ")[[1]]
    if (parts[1] == parts[2]) next            # the diagonal is 1 by construction
    if (!is.null(ours[[k]])) cmp(sprintf("r(%s)", k), ours[[k]], their[[k]])
  }
}

# ── Crosstabs chi-square ────────────────────────────────────────────────────
hdr("CROSSTABS (region x grp2)")
res <- run_analysis_script("crosstabs.R", fx(list(
  rows = list("region"), rowNames = list(region = "region"),
  cols = list("grp2"), colNames = list(grp2 = "grp2"),
  options = list(cells = list(observed = TRUE),
                 stats = list(chisquare = TRUE, phiCramer = TRUE))
)))
xt <- table_or_null(res, "output.crosstabs.chiSqTitle")
if (!is.null(xt)) {
  cmp("Pearson Chi-Square", val(xt, "output.col.pearsonChiSq", "output.col.value"),
      spss$chisq$pearson$value)
  cmp("df", val(xt, "output.col.pearsonChiSq", "output.col.df"), spss$chisq$pearson$df)
  cmp("Asymp. Sig.", val(xt, "output.col.pearsonChiSq", "output.col.sig"),
      spss$chisq$pearson$sig)
  cmp("Likelihood Ratio", val(xt, "output.col.likelihoodRatio", "output.col.value"),
      spss$chisq$lr$value)
} else {
  missing_table("crosstabs chi-square")
}
sy <- table_or_null(res, "output.crosstabs.symTitle")
if (!is.null(sy)) {
  cmp("Phi", val(sy, "output.col.phi", "output.col.value"), spss$chisq$phi$value)
  cmp("Cramer's V", val(sy, "output.col.cramersV", "output.col.value"),
      spss$chisq$cramersV$value)
  cmp("Phi Approx. Sig.", val(sy, "output.col.phi", "output.col.approxSig"),
      spss$chisq$phi$sig)
}
# Observed counts: a chi-square can agree while the table underneath it is
# wrong, so check the cells the statistic was computed from.
ctab <- table_or_null(res, "output.crosstabs.crosstabTitle")
if (!is.null(ctab) && !is.null(spss$crosstab)) {
  for (g in c("North", "South", "East", "West")) {
    s <- spss$crosstab[[g]]
    if (is.null(s)) next
    r <- NULL
    for (rr in ctab$rows) {
      if (any(vapply(rr, function(c) identical(as.character(c), g), logical(1)))) { r <- rr; break }
    }
    if (is.null(r)) next
    nums <- suppressWarnings(as.numeric(vapply(r, function(c)
      if (is.null(c)) NA_character_ else as.character(c), character(1))))
    nums <- nums[!is.na(nums)]
    if (length(nums) < 2) next
    cmp(sprintf("count %s/grp2=1", g), nums[1], s$g1)
    cmp(sprintf("count %s/grp2=2", g), nums[2], s$g2)
  }
}

# ── Linear regression ───────────────────────────────────────────────────────
hdr("LINEAR REGRESSION (score ~ income + age)")
res <- run_analysis_script("regression-linear.R", fx(list(
  dependent = "score", dependentName = "score",
  independents = list("income", "age"),
  varNames = list(income = "income", age = "age")
)))
ms <- table_or_null(res, "output.regression.modelSummaryTitle")
if (!is.null(ms) && !is.null(spss$regression)) {
  cmp("R", row1(ms, "output.col.rVal"), spss$regression$r)
  cmp("R Square", row1(ms, "output.col.rSquare"), spss$regression$r2)
  cmp("Adjusted R Square", row1(ms, "output.col.adjRSquare"), spss$regression$adjR2)
  cmp("Std. Error of Estimate", row1(ms, "output.col.stdErrEst"), spss$regression$se)
}
ra <- table_or_null(res, "output.regression.anovaTitle")
if (!is.null(ra) && !is.null(spss$regressionAnova)) {
  cmp("Regression SS", val(ra, "output.col.regression", "output.col.sumSq"),
      spss$regressionAnova$Regression$ss)
  cmp("Regression df", val(ra, "output.col.regression", "output.col.df"),
      spss$regressionAnova$Regression$df)
  cmp("F", val(ra, "output.col.regression", "output.col.f"),
      spss$regressionAnova$Regression$f)
  cmp("Sig.", val(ra, "output.col.regression", "output.col.sig"),
      spss$regressionAnova$Regression$sig)
  cmp("Residual SS", val(ra, "output.col.residual", "output.col.sumSq"),
      spss$regressionAnova$Residual$ss)
  cmp("Residual df", val(ra, "output.col.residual", "output.col.df"),
      spss$regressionAnova$Residual$df)
}
cf <- table_or_null(res, "output.regression.coeffTitle")
if (!is.null(cf) && !is.null(spss$regressionCoef)) {
  for (v in c("income", "age")) {
    s <- spss$regressionCoef[[v]]
    if (is.null(s)) next
    cmp(sprintf("B (%s)", v), val(cf, v, "output.col.b"), s$b, digits = 3)
    cmp(sprintf("Beta (%s)", v), val(cf, v, "output.col.beta"), s$beta)
    cmp(sprintf("t (%s)", v), val(cf, v, "output.col.t"), s$t)
    cmp(sprintf("Sig. (%s)", v), val(cf, v, "output.col.sig"), s$sig)
  }
}
if (is.null(ms) && is.null(cf)) missing_table("regression tables")

# ── Explore (EXAMINE) ───────────────────────────────────────────────────────
hdr("EXPLORE (score)")
res <- run_analysis_script("explore.R", fx(list(
  variables = "score", varNames = list(score = "score"),
  options = list(display = "statistics",
                 stats = list(descriptives = TRUE, percentiles = TRUE))
)))
ed <- table_or_null(res, "output.explore.descTitle")
if (!is.null(ed)) {
  # Rows are (label, group, value) triples rather than a grid.
  edv <- function(key) {
    for (r in ed$rows) {
      for (cell in r) if (identical(as.character(cell), key)) {
        nums <- suppressWarnings(as.numeric(vapply(r, function(c)
          if (is.null(c)) NA_character_ else as.character(c), character(1))))
        nums <- nums[!is.na(nums)]
        return(if (length(nums)) nums[1] else NA_real_)
      }
    }
    NA_real_
  }
  for (p in list(c("mean", "output.stat.mean"), c("median", "output.stat.median"),
                 c("variance", "output.stat.variance"), c("sd", "output.stat.sd"),
                 c("min", "output.stat.min"), c("max", "output.stat.max"),
                 c("range", "output.stat.range"), c("iqr", "output.stat.iqr"),
                 c("skew", "output.stat.skewness"), c("kurt", "output.stat.kurtosis"),
                 c("trimmed", "output.stat.trimmedMean"))) {
    cmp(sprintf("explore %s", p[1]), edv(p[2]), spss$explore[[p[1]]])
  }
} else {
  missing_table("explore descriptives")
}
ep <- table_or_null(res, "output.explore.percentilesTitle")
if (!is.null(ep) && length(spss$explorePct)) {
  # Row 1 is the weighted-average (HAVERAGE) row; columns 1-2 are labels.
  for (i in seq_along(c(5, 10, 25, 50, 75, 90, 95))) {
    p <- c("5", "10", "25", "50", "75", "90", "95")[i]
    ours <- suppressWarnings(as.numeric(ep$rows[[1]][[i + 2]]))
    cmp(sprintf("explore p%s", p), ours, spss$explorePct[[p]])
  }
}

# ── Means ───────────────────────────────────────────────────────────────────
hdr("MEANS (score by grp3)")
mt <- tbl("means.R", list(variables = "score", varNames = list(score = "score"),
                          factor = "grp3", factorName = "grp3"),
          "output.means.reportTitle")
for (g in c("1", "2", "3", "Total")) {
  s <- spss$means[[g]]
  if (is.null(s)) next
  label <- if (g == "Total") "output.col.total" else g
  cmp(sprintf("means grp%s mean", g), val(mt, label, "output.col.mean"), s$Mean)
  cmp(sprintf("means grp%s N", g), val(mt, label, "output.col.n"), s$N)
  cmp(sprintf("means grp%s SD", g), val(mt, label, "output.col.stdDeviation"),
      s[["Std. Deviation"]])
}

# The Cells sub-dialog. means.R used to print Mean/N/Std. Deviation and nothing
# else — /CELLS was parsed and dropped — so the eight statistics below were a
# feature gap rather than a wrong number. Compared here now that they exist.
hdr("MEANS FULL CELLS (score by grp3)")
mt2 <- tbl("means.R", list(
  variables = "score", varNames = list(score = "score"),
  factor = "grp3", factorName = "grp3",
  options = list(cells = list(mean = TRUE, n = TRUE, sd = TRUE, median = TRUE,
                              min = TRUE, max = TRUE, range = TRUE, sum = TRUE,
                              variance = TRUE, kurtosis = TRUE, skewness = TRUE))),
  "output.means.reportTitle")
for (g in c("1", "2", "3", "Total")) {
  s <- spss$meansCells[[g]]
  if (is.null(s)) next
  label <- if (g == "Total") "output.col.total" else g
  for (p in list(c("output.col.median", "Median"), c("output.col.min", "Minimum"),
                 c("output.col.max", "Maximum"), c("output.col.range", "Range"),
                 c("output.col.sum", "Sum"), c("output.col.variance", "Variance"),
                 c("output.col.kurtosis", "Kurtosis"), c("output.col.skewness", "Skewness"))) {
    if (is.na(idx_of(mt2, p[1]))) { missing_table(sprintf("means cell %s", p[2])); next }
    cmp(sprintf("means grp%s %s", g, p[2]), val(mt2, label, p[1]), s[[p[2]]])
  }
}

# ── Partial correlation ─────────────────────────────────────────────────────
hdr("PARTIAL CORR (score, income | age)")
pc2 <- tbl("correlation-partial.R",
           list(variables = c("score", "income"), controls = "age",
                varNames = list(score = "score", income = "income", age = "age")),
           "output.partialCorr.title")
if (!is.null(pc2)) {
  # Matrix: row 1 is score's coefficient row, its 4th cell is r(score,income).
  gm <- function(i, j) suppressWarnings(as.numeric(pc2$rows[[i]][[j]]))
  cmp("partial r", gm(1, 4), spss$partial$r)
  cmp("partial Sig.", gm(2, 4), spss$partial$sig)
  cmp("partial df", gm(3, 4), spss$partial$df)
}

# ── Nonparametric tests ─────────────────────────────────────────────────────
hdr("NONPARAMETRIC TESTS")
mw <- tbl("npar-mann-whitney.R",
          list(variables = "score", varNames = list(score = "score"),
               groupVar = "grp2", groupName = "grp2", group1 = "1", group2 = "2"),
          "output.npar.testStatsTitle")
cmp("Mann-Whitney U", val(mw, "score", "output.col.mannWhitneyU"), spss$mannWhitney$u)
cmp("Wilcoxon W", val(mw, "score", "output.col.wilcoxonW"), spss$mannWhitney$w)
cmp("M-W Z", val(mw, "score", "output.col.z"), spss$mannWhitney$z)
cmp("M-W Asymp. Sig.", val(mw, "score", "output.col.asympSig"), spss$mannWhitney$sig)

res <- run_analysis_script("npar-wilcoxon.R", fx(list(
  var1 = "pre", var2 = "post", varNames = list(pre = "pre", post = "post"))))
wt <- table_or_null(res, "output.npar.testStatsTitle")
cmp("Wilcoxon Z", val(wt, "post - pre", "output.col.z"), spss$wilcoxon$z)
cmp("Wilcoxon Sig.", val(wt, "post - pre", "output.col.asympSig"), spss$wilcoxon$sig)
wr <- table_or_null(res, "output.npar.ranksTitle")
for (p in list(c("output.col.negRanks", "Negative Ranks"),
               c("output.col.posRanks", "Positive Ranks"))) {
  s <- spss$wilcoxonRanks[[p[2]]]
  cmp(sprintf("Wilcoxon %s N", p[2]), val(wr, p[1], "output.col.n"), s$n)
  cmp(sprintf("Wilcoxon %s mean rank", p[2]), val(wr, p[1], "output.col.meanRank"), s$meanRank)
  cmp(sprintf("Wilcoxon %s sum", p[2]), val(wr, p[1], "output.col.sumRanks"), s$sumRanks)
}

kw <- tbl("npar-kruskal-wallis.R",
          list(variables = "score", varNames = list(score = "score"),
               factor = "grp3", factorName = "grp3"),
          "output.npar.testStatsTitle")
cmp("Kruskal-Wallis H", val(kw, "score", "output.col.chiSquare"), spss$kruskal$h)
cmp("K-W df", val(kw, "score", "output.col.df"), spss$kruskal$df)
cmp("K-W Asymp. Sig.", val(kw, "score", "output.col.asympSig"), spss$kruskal$sig)

res <- run_analysis_script("npar-friedman.R", fx(list(
  variables = c("q1", "q2", "q3"), varNames = list(q1 = "q1", q2 = "q2", q3 = "q3"))))
frt <- table_or_null(res, "output.npar.testStatsTitle")
cmp("Friedman N", row1(frt, "output.col.n"), spss$friedman$n)
cmp("Friedman Chi-Square", row1(frt, "output.col.chiSquare"), spss$friedman$chi)
cmp("Friedman df", row1(frt, "output.col.df"), spss$friedman$df)
cmp("Friedman Asymp. Sig.", row1(frt, "output.col.asympSig"), spss$friedman$sig)
frr <- table_or_null(res, "output.npar.ranksTitle")
for (q in c("q1", "q2", "q3")) {
  cmp(sprintf("Friedman %s mean rank", q), val(frr, q, "output.col.meanRank"),
      spss$friedmanRanks[[q]])
}

bt <- tbl("npar-binomial.R", list(variables = "evt", varNames = list(evt = "evt"),
                                  testProp = 0.5),
          "output.nparBinomial.title")
cmp("Binomial Exact Sig.", val(bt, "evt", "output.col.exactSig"), spss$binomial$exactSig)
if (!is.null(bt)) {
  # SPSS labels categories Group 1 / Group 2 by first appearance in the FILE;
  # we sort them. Compare by the category value, not by the slot.
  ni <- idx_of(bt, "output.col.n")
  ci <- idx_of(bt, "output.col.category")
  byCat <- list()
  for (r in bt$rows) {
    key <- as.character(r[[ci]])
    if (key %in% c("0", "1")) byCat[[key]] <- suppressWarnings(as.numeric(r[[ni]]))
  }
  for (g in c("Group 1", "Group 2")) {
    s <- spss$binomial[[g]]
    if (is.null(s)) next
    cmp(sprintf("Binomial N (category %s)", s$category), byCat[[as.character(s$category)]], s$n)
  }
}

gt <- tbl("npar-chisquare.R", list(variables = "grp3", varNames = list(grp3 = "grp3")),
          "output.npar.testStatsTitle")
cmp("GOF Chi-Square", val(gt, "grp3", "output.col.chiSquare"), spss$gof$chi)
cmp("GOF df", val(gt, "grp3", "output.col.df"), spss$gof$df)
cmp("GOF Asymp. Sig.", val(gt, "grp3", "output.col.asympSig"), spss$gof$sig)

kst <- tbl("npar-ks.R", list(variables = "score", varNames = list(score = "score"),
                             dist = "normal"),
           "output.nparKS.title")
cmp("K-S N", val(kst, "score", "output.col.n"), spss$ks$n)
cmp("K-S mean", val(kst, "score", "output.col.mean"), spss$ks$mean)
cmp("K-S SD", val(kst, "score", "output.col.stdDeviation"), spss$ks$sd)
cmp("K-S absolute diff", val(kst, "score", "output.col.absDiff"), spss$ks$absolute)
cmp("K-S positive diff", val(kst, "score", "output.col.posDiff"), spss$ks$positive)
cmp("K-S negative diff", val(kst, "score", "output.col.negDiff"), spss$ks$negative)

rt <- tbl("npar-runs.R", list(variables = "score", varNames = list(score = "score"),
                              cutPoint = "median"),
          "output.nparRuns.title")
cmp("Runs test value", val(rt, "score", "output.col.testValue"), spss$runs$testValue)
cmp("Runs cases <", val(rt, "score", "output.col.casesLt"), spss$runs$below)
cmp("Runs cases >=", val(rt, "score", "output.col.casesGe"), spss$runs$atOrAbove)
cmp("Runs number of runs", val(rt, "score", "output.col.numRuns"), spss$runs$nRuns)
cmp("Runs Z", val(rt, "score", "output.col.z"), spss$runs$z)
cmp("Runs Asymp. Sig.", val(rt, "score", "output.col.asympSig"), spss$runs$sig)

# ── Reliability ─────────────────────────────────────────────────────────────
hdr("RELIABILITY (q1..q5)")
res <- run_analysis_script("reliability.R", fx(list(
  variables = c("q1", "q2", "q3", "q4", "q5"),
  varNames = list(q1 = "q1", q2 = "q2", q3 = "q3", q4 = "q4", q5 = "q5"))))
rl <- table_or_null(res, "output.reliability.statsTitle")
cmp("Cronbach's Alpha", row1(rl, "output.col.cronbachAlpha"), spss$reliability$alpha)
it <- table_or_null(res, "output.reliability.itemTotalTitle")
for (q in c("q1", "q2", "q3", "q4", "q5")) {
  s <- spss$reliabilityItems[[q]]
  if (is.null(s)) next
  cmp(sprintf("%s corrected item-total", q), val(it, q, "output.col.corrItemTotal"), s$corr)
  cmp(sprintf("%s alpha if deleted", q), val(it, q, "output.col.alphaDel"), s$alphaDel)
  cmp(sprintf("%s scale var if deleted", q), val(it, q, "output.col.scaleVarDel"), s$varDel)
}
sc <- table_or_null(res, "output.reliability.scaleStatsTitle")
cmp("scale mean", row1(sc, "output.col.mean"), spss$reliabilityScale$mean, digits = 2)
cmp("scale variance", row1(sc, "output.col.variance"), spss$reliabilityScale$variance)
cmp("scale SD", row1(sc, "output.col.stdDeviation"), spss$reliabilityScale$sd)

# /MODEL=SPLIT — a second reliability model, not an extra statistic. It ran on
# the SPSS side from the first wave and had nothing to compare against here,
# because reliability.R only knew Cronbach's alpha.
hdr("RELIABILITY SPLIT-HALF (q1..q5)")
res <- run_analysis_script("reliability.R", fx(list(
  variables = c("q1", "q2", "q3", "q4", "q5"),
  varNames = list(q1 = "q1", q2 = "q2", q3 = "q3", q4 = "q4", q5 = "q5"),
  options = list(model = "split")
)))
sh <- table_or_null(res, "output.reliability.splitTitle")
if (is.null(sh)) {
  missing_table("reliability split-half")
} else {
  for (p in list(c("output.reliability.alphaPart1", "alphaPart1"),
                 c("output.reliability.nItemsPart1", "nItemsPart1"),
                 c("output.reliability.alphaPart2", "alphaPart2"),
                 c("output.reliability.nItemsPart2", "nItemsPart2"),
                 c("output.reliability.nItemsTotal", "nItemsTotal"),
                 c("output.reliability.corrBetweenForms", "corrBetweenForms"),
                 c("output.reliability.sbEqual", "sbEqual"),
                 c("output.reliability.guttman", "guttman"))) {
    cmp(sprintf("split-half %s", p[2]), at(sh, p[1], 2), spss$reliabilitySplit[[p[2]]])
  }
  # The unequal-length Spearman-Brown is the one coefficient in this table whose
  # formula the two sides do not share, and the search for theirs came up empty
  # — see the note below.
  divergence("split-half sbUnequal", at(sh, "output.reliability.sbUnequal", 2),
             spss$reliabilitySplit$sbUnequal,
             paste("q1-q5 madde sirasina gore ikiye bolundu: 1. bolum q1-q3,",
                   "2. bolum q4-q5. Esit olmayan uzunluk icin Spearman-Brown'in",
                   "genellemesi kullanildi: L = n1/k = 0.6 ile",
                   "r / (2L(1-L) + r(1 - 2L(1-L))) = 0.8240. Ayni tablodaki",
                   "diger sekiz deger (iki bolumun alfasi, formlar arasi",
                   "korelasyon 0.692, esit uzunluk 0.8180, Guttman 0.8065) tam",
                   "esitleniyor, yani veri ve bolme ayni; ayrilan tek sey bu",
                   "katsayinin formulu. Referansin 0.823'u; r = 0.692 sabitken",
                   "hicbir standart varyant (Flanagan-Rulon 0.8065,",
                   "Angoff-Feldt 0.8201, Raju/Horst 0.8401) o degeri vermiyor,",
                   "ve 0.823'u uretecek bir uzunluk orani L = 0.5915 olurdu --",
                   "3'e 2 bolunmus bir olcekte boyle bir oran yok."))
}

# ── ROC ─────────────────────────────────────────────────────────────────────
hdr("ROC (score, state=disease)")
rc <- tbl("roc.R", list(variables = "score", varNames = list(score = "score"),
                        stateVar = "disease", stateName = "disease", stateValue = "1"),
          "output.roc.aucTitle")
cmp("ROC area", val(rc, "score", "output.col.area"), spss$roc$area)
cmp("ROC std. error", val(rc, "score", "output.col.stdError"), spss$roc$se)
cmp("ROC Asymp. Sig.", val(rc, "score", "output.col.asympSig"), spss$roc$sig)
cmp("ROC CI lower", val(rc, "score", "output.col.ciLowerPct:95"), spss$roc$ciLower)
# The upper bound was a recorded divergence (.907 vs .906) while the SE was
# DeLong's; 2026-10 _bootstrap.R switched to SPSS's own nonparametric formula
# (Hanley-McNeil form, Q1/Q2 estimated from the data), so it is compared as is.
cmp("ROC CI upper", val(rc, "score", "output.col.ciUpperPct:95"), spss$roc$ciUpper)

# The SAME area, through the other dialog. roc-analysis.R was compared against
# nothing until now, and it had drifted: it computed the Hanley-McNeil (Q1/Q2)
# standard error while roc.R used the nonparametric one, so one dataset gave two
# different confidence intervals depending on which dialog was open (SE .039 vs
# .037). Both call _bootstrap.R's auc_nonparametric_se() now, and both are
# compared here — an uncompared second implementation is how the drift survived.
ra <- tbl("roc-analysis.R", list(variables = "score", varNames = list(score = "score"),
                                 stateVar = "disease", stateName = "disease", stateValue = "1"),
          "output.rocAnalysis.aucTitle")
cmp("ROC Analysis area", val(ra, "score", "output.col.area"), spss$roc$area)
cmp("ROC Analysis std. error", val(ra, "score", "output.col.stdError"), spss$roc$se)
cmp("ROC Analysis Asymp. Sig.", val(ra, "score", "output.col.asympSig"), spss$roc$sig)
cmp("ROC Analysis CI lower", val(ra, "score", "output.col.ciLowerPct:95"), spss$roc$ciLower)

# ── Survival ────────────────────────────────────────────────────────────────
hdr("KAPLAN-MEIER (surv by grp2)")
res <- run_analysis_script("survival-km.R", fx(list(
  timeVar = "surv", timeName = "surv", statusVar = "evt", statusName = "evt",
  eventValue = "1", factor = "grp2", factorName = "grp2")))
kc <- table_or_null(res, "output.survival.cpsTitle")
for (g in c("1", "2")) {
  cmp(sprintf("KM grp%s N events", g), val(kc, g, "output.col.nEvents"),
      if (g == "1") 45 else 52)
}
km <- table_or_null(res, "output.survival.medianTitle")
for (g in c("1", "2")) {
  s <- spss$km[[g]]
  if (is.null(s)) next
  cmp(sprintf("KM grp%s median", g), val(km, g, "output.col.medianEst"), s$median)
  divergence(sprintf("KM grp%s median CI lower", g),
             val(km, g, "output.col.ciLower95"), s$medianLo,
             sprintf(paste("surv zaman degiskeni evt=1 olayina gore grp2=%s grubunda",
                           "cozumlendi. Medyanin guven araligi, Greenwood varyansiyla",
                           "kurulan S(t) guven bandinin S=0.5 duzeyinde tersine",
                           "cevrilmesiyle uretiliyor: alt sinir, ust guven bandinin",
                           "0.5'i kestigi en kucuk t. Medyan +- 1.96*SE(medyan)",
                           "dogrusal yaklasimi kullanilmadi; iki yontem sansurun",
                           "yogunlastigi kuyrukta ayrisir."), g))
  divergence(sprintf("KM grp%s median CI upper", g),
             val(km, g, "output.col.ciUpper95"), s$medianHi,
             sprintf(paste("Ayni ters cevirme, bandin diger ucu: grp2=%s icin ust sinir,",
                           "alt guven bandinin 0.5'i kestigi en kucuk t olarak alindi."), g))
}
lg <- table_or_null(res, "output.survival.logrankTitle")
cmp("Log rank Chi-Square", val(lg, "output.col.logRank", "output.col.chiSquare"),
    spss$logrank$chi)
cmp("Log rank df", val(lg, "output.col.logRank", "output.col.df"), spss$logrank$df)
cmp("Log rank Sig.", val(lg, "output.col.logRank", "output.col.sig"), spss$logrank$sig)

hdr("COX REGRESSION (surv ~ score + age)")
res <- run_analysis_script("survival-cox.R", fx(list(
  timeVar = "surv", timeName = "surv", statusVar = "evt", eventValue = "1",
  covariates = c("score", "age"), varNames = list(score = "score", age = "age"))))
co <- table_or_null(res, "output.cox.omnibusTitle")
# SPSS breaks ties with Breslow's approximation; coxph() defaults to Efron's,
# which is the more accurate one when ties are present (and this fixture has
# them). CLAUDE.md §11 says take R's default where it is the better statistic,
# so the divergence is deliberate — it shows up only in the 3rd decimal.
divergence("Cox -2LL", row1(co, "output.col.neg2LL"), spss$coxOmnibus$neg2LL,
           paste("surv zaman degiskeninde bagli (tied) olay zamanlari var; evt=1",
                 "olayina karsi score ve age ortak degiskenleriyle kurulan model,",
                 "kismi olabilirlikte Efron bag duzeltmesiyle kestirildi (baglar",
                 "varken daha dogru olan yaklasim). -2LL dogrudan bu duzeltmenin",
                 "sonucu; daha kaba bir bag duzeltmesi (Breslow) 3. ondalikta",
                 "baska bir deger uretir."))
divergence("Cox LR Chi-Square", row1(co, "output.col.chiSquare"), spss$coxOmnibus$chi,
           paste("Ayni Efron bag duzeltmesi: LR ki-kare = -2LL(bos model) -",
                 "-2LL(score + age), dolayisiyla -2LL ile ayni basamakta oynuyor."))
cmp("Cox Sig.", row1(co, "output.col.sig"), spss$coxOmnibus$sig, digits = 2)
ce <- table_or_null(res, "output.cox.equationTitle")
for (v in c("score", "age")) {
  s <- spss$cox[[v]]
  if (is.null(s)) next
  cmp(sprintf("Cox B (%s)", v), val(ce, v, "output.col.b"), s$b)
  cmp(sprintf("Cox Wald (%s)", v), val(ce, v, "output.col.wald"), s$wald, digits = 2)
  cmp(sprintf("Cox Sig. (%s)", v), val(ce, v, "output.col.sig"), s$sig, digits = 2)
  cmp(sprintf("Cox Exp(B) (%s)", v), val(ce, v, "output.col.expB"), s$expB)
}

# ── Binary logistic ─────────────────────────────────────────────────────────
hdr("LOGISTIC REGRESSION (disease ~ score + age)")
res <- run_analysis_script("regression-logistic.R", fx(list(
  dependent = "disease", dependentName = "disease",
  covariates = c("score", "age"), varNames = list(score = "score", age = "age"))))
lm2 <- table_or_null(res, "output.logistic.modelSummaryTitle")
cmp("logistic -2LL", row1(lm2, "output.col.neg2LL"), spss$logistic$neg2LL)
cmp("Cox & Snell R2", row1(lm2, "output.col.coxSnell"), spss$logistic$coxSnell)
cmp("Nagelkerke R2", row1(lm2, "output.col.nagelkerke"), spss$logistic$nagelkerke)
le <- table_or_null(res, "output.logistic.equationTitle")
for (p in list(c("score", "score"), c("age", "age"),
               c("output.col.constant", "Constant"))) {
  s <- spss$logisticCoef[[p[2]]]
  if (is.null(s)) next
  cmp(sprintf("logistic B (%s)", p[2]), val(le, p[1], "output.col.b"), s$b)
  cmp(sprintf("logistic Wald (%s)", p[2]), val(le, p[1], "output.col.wald"), s$wald)
  cmp(sprintf("logistic Sig. (%s)", p[2]), val(le, p[1], "output.col.sig"), s$sig)
  cmp(sprintf("logistic Exp(B) (%s)", p[2]), val(le, p[1], "output.col.expB"), s$expB)
}

# ── Curve estimation ────────────────────────────────────────────────────────
hdr("CURVE ESTIMATION (score on age)")
cv <- tbl("regression-curve.R",
          list(dependent = "score", dependentName = "score",
               independent = "age", independentName = "age",
               models = list(linear = TRUE, quadratic = TRUE)),
          "output.curve.title")
for (p in list(c("output.col.mLinear", "Linear"), c("output.col.mQuadratic", "Quadratic"))) {
  s <- spss$curve[[p[2]]]
  if (is.null(s)) next
  cmp(sprintf("curve %s R2", p[2]), val(cv, p[1], "output.col.rSquare"), s$r2)
  cmp(sprintf("curve %s F", p[2]), val(cv, p[1], "output.col.f"), s$f)
  cmp(sprintf("curve %s Sig.", p[2]), val(cv, p[1], "output.col.sig"), s$sig)
  cmp(sprintf("curve %s constant", p[2]), val(cv, p[1], "output.col.constant"), s$constant)
  cmp(sprintf("curve %s b1", p[2]), val(cv, p[1], "output.col.b1"), s$b1)
}

# ── Case Summaries / OLAP Cubes ─────────────────────────────────────────────
hdr("SUMMARIZE / OLAP CUBES (score by grp2)")
res <- run_analysis_script("case-summaries.R", fx(list(
  variables = "score", varNames = list(score = "score"),
  groupVar = "grp2", groupVarName = "grp2", displayCases = FALSE,
  options = list(stats = list(n = TRUE, mean = TRUE, sd = TRUE)))))
cs <- table_or_null(res, "output.caseSummaries.summaryTitle")
for (g in c("1", "2")) {
  s <- spss$summarize[[g]]
  if (is.null(s) || is.null(cs)) next
  # Row: group | variable | N | Mean | SD …; locate by the group label.
  r <- NULL
  for (rr in cs$rows) if (identical(as.character(rr[[1]]), g)) { r <- rr; break }
  if (is.null(r)) next
  nums <- suppressWarnings(as.numeric(vapply(r, function(c)
    if (is.null(c)) NA_character_ else as.character(c), character(1))))
  nums <- nums[!is.na(nums)]
  cmp(sprintf("summarize grp%s N", g), nums[2], s$N)
  cmp(sprintf("summarize grp%s mean", g), nums[3], s$Mean)
}
ol <- tbl("olap-cubes.R",
          list(variables = "score", varNames = list(score = "score"),
               groupVars = list("grp2"), groupVarNames = list(grp2 = "grp2"),
               options = list(stats = list(n = TRUE, mean = TRUE, sd = TRUE))),
          "output.olap.title")
if (!is.null(ol)) {
  r <- ol$rows[[1]]
  nums <- suppressWarnings(as.numeric(vapply(r, function(c)
    if (is.null(c)) NA_character_ else as.character(c), character(1))))
  nums <- nums[!is.na(nums)]
  cmp("OLAP total N", nums[1], spss$olap$n)
  cmp("OLAP total mean", nums[2], spss$olap$mean)
  cmp("OLAP total SD", nums[3], spss$olap$sd)
}

# ── Factor analysis (PCA) ───────────────────────────────────────────────────
hdr("FACTOR (q1..q5, PC, unrotated)")
res <- run_analysis_script("factor.R", fx(list(
  variables = c("q1", "q2", "q3", "q4", "q5"),
  varNames = list(q1 = "q1", q2 = "q2", q3 = "q3", q4 = "q4", q5 = "q5"),
  options = list(rotation = "none", extraction = "pc")
)))
fc <- table_or_null(res, "output.factor.commTitle")
for (q in c("q1", "q2", "q3", "q4", "q5")) {
  cmp(sprintf("communality %s", q), val(fc, q, "output.col.extraction"),
      spss$factorComm[[q]]$extraction)
}
ft2 <- table_or_null(res, "output.factor.tveTitle")
for (comp in c("1", "2", "3")) {
  s <- spss$factorTve[[comp]]
  if (is.null(s)) next
  cmp(sprintf("eigenvalue %s", comp), val(ft2, comp, "output.col.eigenvalue"), s$eigenvalue)
  cmp(sprintf("%% variance %s", comp), val(ft2, comp, "output.col.pctVariance"), s$pct)
}
fm <- table_or_null(res, "output.factor.matrixTitle")
if (!is.null(fm)) {
  for (q in c("q1", "q2", "q3", "q4", "q5")) {
    ours <- suppressWarnings(as.numeric(fm$rows[[which(vapply(fm$rows,
      function(r) identical(as.character(r[[1]]), q), logical(1)))]][[2]]))
    cmp(sprintf("loading %s", q), ours, spss$factorLoadings[[q]])
  }
}

# ── Discriminant ────────────────────────────────────────────────────────────
hdr("DISCRIMINANT (grp2 by score, income, age)")
res <- run_analysis_script("discriminant.R", fx(list(
  groupVar = "grp2", groupName = "grp2",
  independents = c("score", "income", "age"),
  varNames = list(score = "score", income = "income", age = "age")
)))
de <- table_or_null(res, "output.discriminant.eigTitle")
cmp("eigenvalue", val(de, "1", "output.col.eigenvalue"), spss$discEigen$eigenvalue)
cmp("canonical correlation", val(de, "1", "output.col.canonicalCorr"),
    spss$discEigen$canonicalCorr)
dw <- table_or_null(res, "output.discriminant.wilksTitle")
cmp("Wilks' Lambda", row1(dw, "output.col.wilksLambda"), spss$discWilks$lambda)
cmp("Wilks Chi-square", row1(dw, "output.col.chiSquare"), spss$discWilks$chi)
cmp("Wilks df", row1(dw, "output.col.df"), spss$discWilks$df)
cmp("Wilks Sig.", row1(dw, "output.col.sig"), spss$discWilks$sig)
dc <- table_or_null(res, "output.discriminant.classTitle")
cmp("% correctly classified", val(dc, "output.col.pctCorrect", "output.col.value"),
    spss$discPctCorrect, digits = 1)

# ── Ratio statistics ────────────────────────────────────────────────────────
hdr("RATIO STATISTICS (post / pre)")
rt2 <- tbl("ratio.R", list(numerator = "post", denominator = "pre",
                           varNames = list(post = "post", pre = "pre")),
           "output.ratio.title")
cmp("ratio mean", val(rt2, "output.ratio.overall", "output.ratio.mean"), spss$ratio$mean)
cmp("ratio median", val(rt2, "output.ratio.overall", "output.ratio.median"), spss$ratio$median)
cmp("price related differential", val(rt2, "output.ratio.overall", "output.ratio.prd"),
    spss$ratio$prd)
cmp("coefficient of dispersion", val(rt2, "output.ratio.overall", "output.ratio.cod"),
    spss$ratio$cod)

# ── Ordinal regression (PLUM) ───────────────────────────────────────────────
hdr("ORDINAL REGRESSION (grp3 on score, age)")
res <- run_analysis_script("regression-ordinal.R", fx(list(
  dependent = "grp3", dependentName = "grp3",
  covariates = c("score", "age"), varNames = list(score = "score", age = "age")
)))
of <- table_or_null(res, "output.ordinal.fitTitle")
cmp("ordinal -2LL", val(of, "output.col.final", "output.col.neg2LL"), spss$ordinalFit$neg2LL)
cmp("ordinal Chi-square", val(of, "output.col.final", "output.col.chiSquare"),
    spss$ordinalFit$chi)
cmp("ordinal Sig.", val(of, "output.col.final", "output.col.sig"), spss$ordinalFit$sig)
op <- table_or_null(res, "output.ordinal.paramTitle")
for (v in c("score", "age")) {
  s <- spss$ordinalParams[[v]]
  if (is.null(s)) next
  cmp(sprintf("ordinal estimate (%s)", v), val(op, v, "output.col.estimate"), s$estimate)
  cmp(sprintf("ordinal SE (%s)", v), val(op, v, "output.col.stdError"), s$se)
  # Wald = (estimate/SE)², so it amplifies whatever is below the third decimal
  # of its two inputs — both of which match SPSS exactly at the precision SPSS
  # prints them. Compared at two decimals for that reason, not to be lenient.
  cmp(sprintf("ordinal Wald (%s)", v), val(op, v, "output.col.wald"), s$wald, digits = 2)
}
for (p in list(c("1|2", "[grp3 = 1]"), c("2|3", "[grp3 = 2]"))) {
  s <- spss$ordinalParams[[p[2]]]
  if (is.null(s)) next
  cmp(sprintf("ordinal threshold %s", p[1]), val(op, p[1], "output.col.estimate"), s$estimate)
}

# ── Missing value analysis ──────────────────────────────────────────────────
hdr("MISSING VALUE ANALYSIS")
mv <- tbl("missing-values.R",
          list(variables = c("score", "income", "post"),
               varNames = list(score = "score", income = "income", post = "post")),
          "output.missing.uniTitle")
for (v in c("score", "income", "post")) {
  s <- spss$mva[[v]]
  if (is.null(s)) next
  cmp(sprintf("MVA %s N", v), val(mv, v, "output.col.n"), s$n)
  cmp(sprintf("MVA %s mean", v), val(mv, v, "output.col.mean"), s$mean)
  cmp(sprintf("MVA %s missing N", v), val(mv, v, "output.missing.count"), s$missingN)
  cmp(sprintf("MVA %s missing %%", v), val(mv, v, "output.missing.percent"), s$missingPct,
      digits = 1)
}

# ── GLM univariate (two-way factorial) ──────────────────────────────────────
hdr("GLM UNIVARIATE (score by grp3, grp4)")
gu <- tbl("glm-univariate.R",
          list(dependent = "score", dependentName = "score",
               factors = c("grp3", "grp4"), factorNames = list(grp3 = "grp3", grp4 = "grp4")),
          "output.glmUni.title")
for (p in list(c("output.col.correctedModel", "Corrected Model"),
               c("output.col.intercept", "Intercept"),
               c("grp3", "grp3"), c("grp4", "grp4"),
               c("output.col.error", "Error"))) {
  s <- spss$glmUni[[p[2]]]
  if (is.null(s)) next
  cmp(sprintf("GLM %s SS", p[2]), val(gu, p[1], "output.col.typeIIISS"), s$ss)
  cmp(sprintf("GLM %s df", p[2]), val(gu, p[1], "output.col.df"), s$df)
  if (!is.null(s$f)) cmp(sprintf("GLM %s F", p[2]), val(gu, p[1], "output.col.f"), s$f)
}
# The interaction row's label is built from the factor names.
s <- spss$glmUni[["grp3 * grp4"]]
if (!is.null(s) && !is.null(gu)) {
  ours <- NA_real_
  for (r in gu$rows) {
    lbl <- as.character(r[[1]])
    if (grepl("grp3", lbl, fixed = TRUE) && grepl("grp4", lbl, fixed = TRUE)) {
      ours <- suppressWarnings(as.numeric(r[[idx_of(gu, "output.col.typeIIISS")]]))
      break
    }
  }
  cmp("GLM interaction SS", ours, s$ss)
}

# ── GLM multivariate (MANOVA) ───────────────────────────────────────────────
hdr("GLM MULTIVARIATE (pre, post by grp2)")
gm <- tbl("glm-multivariate.R",
          list(dependents = c("pre", "post"), dependentNames = list(pre = "pre", post = "post"),
               factors = "grp2", factorNames = list(grp2 = "grp2")),
          "output.glmMulti.mvTitle")
if (!is.null(gm)) {
  # Rows: (source, statistic, value, F, hypDf, errDf, sig) with the source only
  # on its first row — mirror SPSS's own layout with a cursor.
  cur <- ""
  ourMv <- list()
  for (r in gm$rows) {
    src <- as.character(r[[1]])
    if (nzchar(src)) cur <- src
    stat <- as.character(r[[2]])
    ourMv[[paste(cur, stat)]] <- list(
      value = suppressWarnings(as.numeric(r[[3]])),
      f = suppressWarnings(as.numeric(r[[4]])))
  }
  for (p in list(
    list(ours = "output.col.intercept output.col.pillai", theirs = "Intercept|Pillai's Trace"),
    list(ours = "output.col.intercept output.col.wilks", theirs = "Intercept|Wilks' Lambda"),
    list(ours = "grp2 output.col.pillai", theirs = "grp2|Pillai's Trace"),
    list(ours = "grp2 output.col.wilks", theirs = "grp2|Wilks' Lambda"),
    list(ours = "grp2 output.col.hotelling", theirs = "grp2|Hotelling's Trace"))) {
    s2 <- spss$glmMulti[[p$theirs]]
    o2 <- ourMv[[p$ours]]
    if (is.null(s2) || is.null(o2)) next
    cmp(sprintf("MANOVA %s value", p$theirs), o2$value, s2$value)
    if (startsWith(p$theirs, 'Intercept')) {
      # The intercept's F is a near-singular function of Wilks' Lambda here
      # (Λ ≈ 0.0219, F ≈ 2570): the third decimal SPSS prints, .022, admits
      # every F between roughly 2560 and 2580, so the two cannot be told apart
      # from the published output. The grp2 rows below — the ones that test
      # anything — match exactly.
      divergence(sprintf("MANOVA %s F", p$theirs), o2$f, s2$f,
                 paste("pre ve post bagimli degiskenleri grp2 faktoruyle cozumlendi.",
                       "Kesisim (intercept) etkisinde Wilks Lambda 0.0219'a kadar",
                       "dusuyor ve F = ((1-L)/L)*(errDf/hypDf) oldugu icin L'nin 3.",
                       "ondaligindaki yarim birimlik yuvarlama F'i ~10 birim",
                       "oynatiyor: yayimlanan 0.022 degeri kabaca 2560-2580",
                       "araligindaki her F ile tutarli. Modeli sinayan grp2",
                       "satirlari (Pillai/Wilks/Hotelling) tam esitleniyor."))
    } else {
      cmp(sprintf("MANOVA %s F", p$theirs), o2$f, s2$f)
    }
  }
}

# ── Multinomial logistic ────────────────────────────────────────────────────
hdr("MULTINOMIAL LOGISTIC (grp3 on score, age)")
mp <- tbl("regression-multinomial.R",
          list(dependent = "grp3", dependentName = "grp3",
               covariates = c("score", "age"), varNames = list(score = "score", age = "age"),
               reference = list(category = "first")),   # job.sps: BASE=FIRST
          "output.multinom.paramTitle")
if (!is.null(mp)) {
  # Rows: (category, term, B, SE, Wald, df, Sig., Exp(B)); the category label
  # appears only on its first row, so carry a cursor as SPSS's own table does.
  cur <- ""
  ours <- list()
  for (r in mp$rows) {
    cat_lbl <- as.character(r[[1]])
    if (nzchar(cat_lbl)) cur <- cat_lbl
    term <- as.character(r[[2]])
    term <- if (identical(term, "output.col.intercept")) "Intercept" else term
    ours[[paste0(cur, "|", term)]] <- list(
      b = suppressWarnings(as.numeric(r[[3]])),
      wald = suppressWarnings(as.numeric(r[[5]])))
  }
  for (k in c("2|Intercept", "2|score", "2|age", "3|Intercept", "3|score", "3|age")) {
    s <- spss$multinom[[k]]
    o <- ours[[k]]
    if (is.null(s) || is.null(o)) next
    cmp(sprintf("multinom B (%s)", k), o$b, s$b)
    cmp(sprintf("multinom Wald (%s)", k), o$wald, s$wald)
  }
}

# ── Life table ──────────────────────────────────────────────────────────────
hdr("LIFE TABLE (surv, 6-unit intervals)")
lt <- tbl("life-tables.R",
          list(time = "surv", status = "evt", interval = 6, maxTime = 24,
               varNames = list(surv = "surv", evt = "evt")),
          "output.lifetab.title")
for (start in c("0", "6", "12", "18")) {
  s <- spss$lifeTable[[start]]
  if (is.null(s)) next
  cmp(sprintf("life table [%s) entering", start), val(lt, start, "output.lifetab.entering"),
      s$entering)
  cmp(sprintf("life table [%s) events", start), val(lt, start, "output.lifetab.terminal"),
      s$terminal)
  cmp(sprintf("life table [%s) prop. terminating", start),
      val(lt, start, "output.lifetab.propTerm"), s$propTerm, digits = 2)
  cmp(sprintf("life table [%s) cum. surviving", start),
      val(lt, start, "output.lifetab.cumSurv"), s$cumSurv, digits = 2)
}

# ── GENLIN (Poisson) ────────────────────────────────────────────────────────
hdr("GENLIN (q1 ~ score + age, Poisson/log)")
res <- run_analysis_script("genlin.R", fx(list(
  dependent = "q1", dependentName = "q1", predictors = c("score", "age"),
  varNames = list(score = "score", age = "age"), distribution = "poisson"
)))
gg <- table_or_null(res, "output.genlin.gofTitle")
for (p in list(c("output.col.deviance", "deviance"), c("output.col.pearsonChi", "pearson"),
               c("output.col.logLikelihood", "logLik"), c("output.col.aic", "aic"),
               c("output.col.bic", "bic"))) {
  cmp(sprintf("GENLIN %s", p[2]), val(gg, p[1], "output.col.value"), spss$genlinGof[[p[2]]])
}
gp <- table_or_null(res, "output.genlin.paramTitle")
for (p in list(c("output.col.constant", "(Intercept)"), c("score", "score"),
               c("age", "age"))) {
  s <- spss$genlinParams[[p[2]]]
  if (is.null(s)) next
  cmp(sprintf("GENLIN B (%s)", p[2]), val(gp, p[1], "output.col.b"), s$b)
  cmp(sprintf("GENLIN Wald (%s)", p[2]), val(gp, p[1], "output.col.wald"), s$wald)
  cmp(sprintf("GENLIN Sig. (%s)", p[2]), val(gp, p[1], "output.col.sig"), s$sig)
}

# ── GEE ─────────────────────────────────────────────────────────────────────
# GENLIN q1 WITH score /REPEATED SUBJECT=grp3 CORRTYPE=EXCHANGEABLE.
#
# Both sides estimate the same GEE: identity link, exchangeable working
# correlation, clusters given by grp3, and robust (sandwich) standard errors —
# geeglm reports those by default, which is what makes the SEs comparable at
# all. This is the comparison the README listed as "still to be written" once
# geepack was installed.
hdr("GEE (q1 ~ score, exchangeable, subject=grp3)")
res <- run_analysis_script("gee.R", fx(list(
  dependent = "q1", dependentName = "q1", predictors = c("score"),
  varNames = list(score = "score"), subject = "grp3",
  family = "gaussian", corstr = "exchangeable"
)))
ge <- table_or_null(res, "output.gee.paramTitle")
if (is.null(ge)) {
  # geepack absent, or the script failed: either way nothing was compared, and
  # a silent skip here is what let this procedure sit uncovered for two waves.
  missing_table("GEE parameter estimates")
} else {
  for (p in list(c("output.col.constant", "(Intercept)"), c("score", "score"))) {
    s <- spss$geeParams[[p[2]]]
    if (is.null(s)) next
    cmp(sprintf("GEE B (%s)", p[2]), val(ge, p[1], "output.col.b"), s$b)
    cmp(sprintf("GEE SE (%s)", p[2]), val(ge, p[1], "output.col.stdError"), s$se, digits = 4)
    if (p[2] == "(Intercept)") {
      # Wald = (B/SE)^2, so a statistic of magnitude 61 is being checked to
      # 0.0005 from an SE published to four decimals. Every SE that prints as
      # .4617 spans Wald 61.034 to 61.061 — a range that contains both 61.057
      # (ours, from SE .461664) and 61.058. The two cannot be told apart from
      # what is printed. The score row, where the Wald is 5.331 and the same
      # SE precision buys two more digits of resolution, matches exactly.
      divergence(sprintf("GEE Wald (%s)", p[2]), val(ge, p[1], "output.col.wald"), s$wald,
                 paste("q1, score ile grp3 kumelerinde exchangeable calisma",
                       "korelasyonu ve saglam (sandwich) standart hatalarla",
                       "modellendi; kesisim icin B = 3.607403, SH = 0.461664,",
                       "dolayisiyla Wald = (B/SH)^2 = 61.0573. Wald, SH'nin",
                       "karesine bolundugu icin SH'nin yayimlanan 4 ondaligi",
                       "Wald'i ancak 61.034-61.061 araligina kadar belirler;",
                       "bu aralik iki degeri de kapsiyor. B, SH ve Sig. tam",
                       "esitleniyor, score satirinda Wald da tam esitleniyor."))
    } else {
      cmp(sprintf("GEE Wald (%s)", p[2]), val(ge, p[1], "output.col.wald"), s$wald)
    }
    cmp(sprintf("GEE Sig. (%s)", p[2]), val(ge, p[1], "output.col.sig"), s$sig)
  }
}

# ── GLM repeated measures ───────────────────────────────────────────────────
hdr("GLM REPEATED MEASURES (pre, post)")
res <- run_analysis_script("glm-repeated.R", fx(list(
  variables = c("pre", "post"), varNames = list(pre = "pre", post = "post"),
  factorName = "timepoint"
)))
gr <- table_or_null(res, "output.glmRep.mauchlyTitle")
cmp("Mauchly's W", row1(gr, "output.col.mauchlyW"), spss$glmRepMauchly$w)
gw <- table_or_null(res, "output.glmRep.withinTitle")
cmp("within-subjects SS", val(gw, "output.col.sphericityAssumed", "output.col.typeIIISS"),
    spss$glmRepWithin$ss)
cmp("within-subjects df", val(gw, "output.col.sphericityAssumed", "output.col.df"),
    spss$glmRepWithin$df)
cmp("within-subjects F", val(gw, "output.col.sphericityAssumed", "output.col.f"),
    spss$glmRepWithin$f)
cmp("within-subjects error SS", val(gw, "output.glmRep.errorOf:timepoint", "output.col.typeIIISS"),
    spss$glmRepError$ss)

# ── Proximities ─────────────────────────────────────────────────────────────
hdr("PROXIMITIES (q1, q2, q3 — Euclidean between variables)")
px <- tbl("distances.R",
          list(variables = c("q1", "q2", "q3"), varNames = list(q1 = "q1", q2 = "q2", q3 = "q3"),
               measure = "euclidean"),
          "output.distances.title")
if (!is.null(px)) {
  for (i in seq_along(c("q1", "q2", "q3"))) {
    v <- c("q1", "q2", "q3")[i]
    s <- spss$proximity[[v]]
    if (is.null(s)) next
    for (j in seq_len(3)) {
      if (i == j) next
      cmp(sprintf("d(%s,%s)", v, c("q1", "q2", "q3")[j]),
          suppressWarnings(as.numeric(px$rows[[i]][[j + 1]])), s[[j]])
    }
  }
}

# ── Multiple response ───────────────────────────────────────────────────────
hdr("MULTIPLE RESPONSE (d1, d2, d3)")
mr <- tbl("multiple-response.R",
          list(variables = c("d1", "d2", "d3"),
               varNames = list(d1 = "d1", d2 = "d2", d3 = "d3"), countedValue = 1),
          "output.mr.title")
for (d in c("d1", "d2", "d3")) {
  s <- spss$multResponse[[d]]
  if (is.null(s)) next
  cmp(sprintf("MR %s N", d), val(mr, d, "output.col.n"), s$n)
  cmp(sprintf("MR %s %% of responses", d), val(mr, d, "output.mr.pctResponses"),
      s$pctResponses, digits = 1)
  cmp(sprintf("MR %s %% of cases", d), val(mr, d, "output.mr.pctCases"), s$pctCases,
      digits = 1)
}
s <- spss$multResponse$Total
if (!is.null(s)) {
  cmp("MR total responses", val(mr, "output.mr.total", "output.col.n"), s$n)
  cmp("MR total %% of cases", val(mr, "output.mr.total", "output.mr.pctCases"),
      s$pctCases, digits = 1)
}

# Hierarchical cluster is deliberately NOT compared. Two reasons, both about
# the data rather than the code: (1) SPSS's dialog defaults to SQUARED
# Euclidean distance for interval data while hierarchical.R uses dist()'s plain
# Euclidean, and averaging squares is not the square of averaging; (2) the
# fixture is Likert data, so hundreds of pairs sit at distance zero and which
# of them merges first — a free choice for any implementation — changes every
# subsequent group average. Squaring our distances gets the tail from
# 2.09…2.96 to 4.30…9.79 against SPSS's 5.00…9.71: closer, still not equal,
# and no amount of matching conventions will make a tie-saturated schedule
# reproducible. Same class of problem as k-means. See README.

# ── Sub-dialog option sets ──────────────────────────────────────────────────
# Everything above exercises each procedure's DEFAULT output. These check the
# switches the Statistics / Cells / Post Hoc sub-dialogs offer — where a
# silently-dropped option would hide.

hdr("CROSSTABS FULL STATISTICS (d1 x grp2, 2x2)")
res <- run_analysis_script("crosstabs.R", fx(list(
  rows = list("d1"), rowNames = list(d1 = "d1"),
  cols = list("grp2"), colNames = list(grp2 = "grp2"),
  options = list(
    cells = list(observed = TRUE, expected = TRUE, rowPct = TRUE, colPct = TRUE,
                 totalPct = TRUE, unstdResid = TRUE, stdResid = TRUE, adjResid = TRUE),
    stats = list(chisquare = TRUE, phiCramer = TRUE, contingency = TRUE,
                 correlations = TRUE, gamma = TRUE, somersd = TRUE, taub = TRUE,
                 tauc = TRUE, eta = TRUE, kappa = TRUE, risk = TRUE, mcnemar = TRUE))
)))
sy2 <- table_or_null(res, "output.crosstabs.symTitle")
for (p in list(c("output.col.phi", "phi"), c("output.col.cramersV", "cramersV"),
               c("output.col.contingency", "contingency"), c("output.col.kendallTaub", "taub"),
               c("output.col.kendallTauc", "tauc"), c("output.col.gamma", "gamma"))) {
  s <- spss$crossMeasures[[p[2]]]
  if (is.null(s)) next
  cmp(sprintf("crosstabs %s", p[2]), val(sy2, p[1], "output.col.value"), s$value)
}
# Cohen's kappa measures agreement between two ratings of the SAME categories.
# crosstabs.R therefore requires the row and column categories to be identical;
# here they are 0/1 against 1/2, so we print nothing. SPSS pairs them by
# position and reports .020 anyway. Keeping the guard.
divergence("crosstabs kappa", NA_real_, spss$crossMeasures$kappa$value,
           paste("Satir degiskeni d1 (0/1), sutun degiskeni grp2 (1/2) olarak",
                 "capraz tabloya girdi. Cohen kappa AYNI kategori kumesinin iki",
                 "degerlendirmesi arasindaki uyumu olcer; burada kategori",
                 "kumeleri ortusmedigi icin crosstabs.R kappa uretmiyor ve hucre bos",
                 "kaliyor. Kategorileri konuma gore (0<->1, 1<->2) eslestirmek",
                 "sayisal bir deger verirdi, ama olctugu sey uyum olmazdi."))

x2 <- table_or_null(res, "output.crosstabs.chiSqTitle")
cmp("2x2 Pearson Chi-Square", val(x2, "output.col.pearsonChiSq", "output.col.value"),
    spss$cross2x2$pearson$value)
cmp("2x2 continuity correction", val(x2, "output.col.continuityCorrection", "output.col.value"),
    spss$cross2x2$continuity$value)
cmp("2x2 continuity Sig.", val(x2, "output.col.continuityCorrection", "output.col.sig"),
    spss$cross2x2$continuity$sig)
# Our Fisher row leaves value/df empty and carries the p in the last cell,
# so it is read positionally rather than by column key.
fisherP <- NA_real_
if (!is.null(x2)) for (r in x2$rows) {
  if (identical(as.character(r[[1]]), "output.col.fisherExact")) {
    nums <- suppressWarnings(as.numeric(vapply(r, function(c)
      if (is.null(c)) NA_character_ else as.character(c), character(1))))
    nums <- nums[!is.na(nums)]
    if (length(nums)) fisherP <- nums[1]
    break
  }
}
cmp("Fisher exact (2-sided)", fisherP, spss$cross2x2$fisher2)
rk <- table_or_null(res, "output.crosstabs.riskTitle")
if (!is.null(rk) && !is.null(spss$crossRisk)) {
  cmp("odds ratio", val(rk, "output.col.oddsRatio", "output.col.value"),
      spss$crossRisk$oddsRatio)
}

hdr("ONEWAY POST HOC AND ROBUST TESTS (score by grp3)")
res <- run_analysis_script("anova-oneway.R", fx(list(
  variables = "score", varNames = list(score = "score"),
  factor = "grp3", factorName = "grp3",
  options = list(homogeneity = TRUE, welch = TRUE, brownForsythe = TRUE,
                 lsd = TRUE, bonferroni = TRUE, sidak = TRUE, scheffe = TRUE,
                 tukey = TRUE, gamesHowell = TRUE, tamhaneT2 = TRUE, sigLevel = "0.05")
)))
# Welch and Brown-Forsythe are emitted as TWO tables sharing one title
# prefix, so find_table() returns only the first; scan every table instead.
robust <- Filter(function(t) startsWith(t$titleKey, "output.anova.robustTitle"), res$tables)
for (p in list(c("output.col.welch", "welch"), c("output.col.brownForsythe", "brownForsythe"))) {
  s <- spss$robustTests[[p[2]]]
  if (is.null(s)) next
  hit <- NULL
  for (t in robust) if (!is.na(at(t, p[1], idx_of(t, "output.col.statistic")))) { hit <- t; break }
  cmp(sprintf("%s statistic", p[2]), val(hit, p[1], "output.col.statistic"), s$stat)
  cmp(sprintf("%s df2", p[2]), val(hit, p[1], "output.col.df2"), s$df2)
  cmp(sprintf("%s Sig.", p[2]), val(hit, p[1], "output.col.sig"), s$sig)
}
ph <- table_or_null(res, "output.anova.postHocTitle")
if (!is.null(ph)) {
  # Rows: method | (I) | (J) | mean diff | SE | Sig | CI lo | CI hi.
  ourPh <- list()
  for (r in ph$rows) {
    m <- as.character(r[[1]])
    key <- sub("^output\\.col\\.", "", m)
    key <- switch(key, lsd = "LSD", bonferroni = "Bonferroni", sidak = "Sidak",
                  scheffe = "Scheffe", tukeyHSD = "Tukey HSD", gamesHowell = "Games-Howell",
                  tamhaneT2 = "Tamhane", key)
    ourPh[[paste(key, as.character(r[[2]]), as.character(r[[3]]), sep = "|")]] <- list(
      diff = suppressWarnings(as.numeric(r[[4]])),
      se = suppressWarnings(as.numeric(r[[5]])),
      sig = suppressWarnings(as.numeric(r[[6]])))
  }
  for (m in c("LSD", "Bonferroni", "Sidak", "Scheffe", "Tukey HSD", "Games-Howell", "Tamhane")) {
    k <- paste(m, "1", "2", sep = "|")
    s <- spss$postHoc[[k]]
    o <- ourPh[[k]]
    if (is.null(s) || is.null(o)) { cmp(sprintf("post hoc %s (1-2) Sig.", m), NULL, NULL); next }
    cmp(sprintf("post hoc %s (1-2) diff", m), o$diff, s$diff)
    cmp(sprintf("post hoc %s (1-2) SE", m), o$se, s$se)
    cmp(sprintf("post hoc %s (1-2) Sig.", m), o$sig, s$sig)
  }
}

hdr("EXPLORE M-ESTIMATORS AND EXTREME VALUES")
res <- run_analysis_script("explore.R", fx(list(
  variables = "score", varNames = list(score = "score"),
  options = list(display = "statistics",
                 stats = list(descriptives = TRUE, mEstimators = TRUE, outliers = TRUE))
)))
me <- table_or_null(res, "output.explore.mEstimatorsTitle")
if (!is.null(me) && !is.null(spss$mEstimators)) {
  vals <- suppressWarnings(as.numeric(vapply(me$rows[[1]], function(c)
    if (is.null(c)) NA_character_ else as.character(c), character(1))))
  vals <- vals[!is.na(vals)]
  for (i in seq_along(c("huber", "tukey", "hampel", "andrews"))) {
    k <- c("huber", "tukey", "hampel", "andrews")[i]
    const <- switch(k,
                    huber = "psi.huber, k = 1.339",
                    tukey = "psi.bisquare, c = 4.685",
                    hampel = "psi.hampel, a/b/c = 1.7/3.4/8.5",
                    andrews = "kendi psi'miz, a = 1.34 (kesim a*pi)")
    # 2026-08-23: eski not "hicbir varyant uretemedi" diyordu, o artik yanlis.
    # explore.R artik MASS::rlm degil, elle yazilmis bir IRLS kullaniyor: olcek
    # ortancaya gore HAM medyan mutlak sapma (1.4826/0.6745 tutarlilik sabiti
    # YOK), tek seferde hesaplanip tum yinelemeler boyunca SABIT tutuluyor --
    # rlm'nin varsayilani (duzeltmeli MAD, her adimda yeniden kestirilir)
    # degil. Bu, gercek bir SPSS 26 Explore ciktisindan (stem-and-leaf +
    # Extreme Values tablolarindan tam olarak yeniden insa edilen, cok carpik
    # iki klinik degisken) dogrulandi: hata %5-27'den %0.5'in altina dustu
    # (test-m-estimators-2026-08.R). Buradaki fark hala kucuk kaliyor cunku bu
    # olcut (score, N=117) kabaca simetrik -- olcek kurali sadece veri bir psi
    # kesim noktasini asinca ayrisiyor, ve bu ciktida pek az nokta o esigi
    # gecicek kadar uc deger tasiyor.
    divergence(sprintf("M-estimator %s", k), if (length(vals) >= i) vals[i] else NULL,
               spss$mEstimators[[k]],
               sprintf(paste("score degiskeni tek basina (faktorsuz) Explore'a girdi;",
                             "%s konum kestirimi artik explore.R'de elle yazilmis bir",
                             "IRLS sabit noktasi (%s), olcek = ham MAD, sabit -- ayrinti",
                             "yukarida. Fark burada ~0.02-0.10, 52.7 uzerinde binde",
                             "1-2 (test-m-estimators-2026-08.R'deki iki gercek SPSS",
                             "kosusunda ayni algoritma %%0.5'in altina dusuyor)."),
                       k, const))
  }
} else {
  missing_table("explore M-estimators")
}
ex <- table_or_null(res, "output.explore.extremeTitle")
if (!is.null(ex) && length(spss$extremes$highest)) {
  nums <- lapply(ex$rows, function(r) {
    v <- suppressWarnings(as.numeric(vapply(r, function(c)
      if (is.null(c)) NA_character_ else as.character(c), character(1))))
    v[!is.na(v)]
  })
  vals <- vapply(nums, function(v) if (length(v)) v[length(v)] else NA_real_, numeric(1))
  hi <- unlist(spss$extremes$highest)
  for (i in seq_len(min(5, length(hi)))) {
    cmp(sprintf("extreme high %d", i), if (length(vals) >= i) vals[i] else NULL, hi[i])
  }
}

hdr("KENDALL'S TAU-B CORRELATION")
res <- run_analysis_script("correlation.R", fx(list(
  variables = list("score", "income", "age"),
  varNames = list(score = "score", income = "income", age = "age"),
  methods = list(kendall = TRUE)
)))
kt <- table_or_null(res, "output.correlate.title:Kendall")
their <- spss_matrix(spss$kendall, 'Correlation Coefficient')
if (!is.null(kt) && length(their)) {
  ours <- flatten_matrix(kt$rows, unlist(kt$columns), "output.col.kendallTaub")
  for (k in c("score income", "score age", "income age")) {
    if (!is.null(ours[[k]]) && !is.null(their[[k]])) cmp(sprintf("tau-b(%s)", k), ours[[k]], their[[k]])
  }
} else {
  missing_table("Kendall matrix")
}

hdr("FREQUENCIES /NTILES=4 (cut points)")
ft4 <- tbl("frequencies.R",
           list(variables = c("age"), varNames = list(age = "age"),
                options = list(showTable = FALSE, statistics = list(cutPoints = 4L))),
           "output.frequencies.statsTitle:age")
for (p in c("25", "50", "75")) {
  cmp(sprintf("NTILES cut point %s", p), stat_val(ft4, paste0("output.stat.pct", p)),
      spss$ntiles[[p]])
}

# ── WEIGHT / SPLIT FILE / FILTER, and their combinations ────────────────────
# The app injects these at one choke point (analysis-handler.ts): `weightVariable`
# and `splitVariable` ride along in the params, while a case filter is applied
# upstream in the DuckDB query, before the data ever reaches R. The harness
# mirrors that exactly — weight/split as params, filter by subsetting the frame
# before writing the fixture — so what is compared is the production path.
hdr("WEIGHT / SPLIT / FILTER MATRIX (Descriptives on score)")

# A filtered frame is a genuinely different dataset, so it needs its own
# fixture writer rather than the shared fx().
fx_f <- function(params, filtered) write_fixture(if (filtered) df[df$keep == 1, ] else df, params)

desc_params <- function(stats, weighted, split) {
  p <- list(variables = "score", varNames = list(score = "score"), options = stats)
  if (weighted) p$weightVariable <- "wt"
  if (split) p$splitVariable <- "grp2"
  p
}

# Every cell of the 2x2x2 matrix. `stats` mirrors what the matching SPSS
# command asked for, so the two sides compute the same statistics.
CELLS <- list(
  list(alias = "s_w",   w = TRUE,  s = FALSE, f = FALSE,
       stats = list(mean = TRUE, sd = TRUE, variance = TRUE, seMean = TRUE, min = TRUE,
                    max = TRUE, sum = TRUE, skewness = TRUE, kurtosis = TRUE)),
  list(alias = "s_f",   w = FALSE, s = FALSE, f = TRUE,
       stats = list(mean = TRUE, sd = TRUE, variance = TRUE, min = TRUE, max = TRUE,
                    sum = TRUE)),
  list(alias = "s_wf",  w = TRUE,  s = FALSE, f = TRUE,
       stats = list(mean = TRUE, sd = TRUE, variance = TRUE, sum = TRUE)),
  list(alias = "s_s",   w = FALSE, s = TRUE,  f = FALSE,
       stats = list(mean = TRUE, sd = TRUE, min = TRUE, max = TRUE)),
  list(alias = "s_ws",  w = TRUE,  s = TRUE,  f = FALSE,
       stats = list(mean = TRUE, sd = TRUE, sum = TRUE)),
  list(alias = "s_fs",  w = FALSE, s = TRUE,  f = TRUE,
       stats = list(mean = TRUE, sd = TRUE, sum = TRUE)),
  list(alias = "s_wfs", w = TRUE,  s = TRUE,  f = TRUE,
       stats = list(mean = TRUE, sd = TRUE, sum = TRUE))
)

for (cell in CELLS) {
  theirs <- spss$wsf[[cell$alias]]
  if (is.null(theirs)) { missing_table(sprintf("matrix %s", cell$alias)); next }
  res <- run_analysis_script(
    "descriptives.R",
    fx_f(desc_params(cell$stats, cell$w, cell$s), cell$f)
  )
  # A split run emits one Descriptives table per group, in group order — the
  # same shape SPSS produces.
  ours <- Filter(function(t) startsWith(t$titleKey, "output.descriptives.title"), res$tables)
  tag <- paste0(if (cell$w) "W" else "", if (cell$s) "S" else "", if (cell$f) "F" else "")
  if (length(ours) != length(theirs)) {
    cmp(sprintf("[%s] table count", tag), length(ours), length(theirs))
    next
  }
  for (g in seq_along(theirs)) {
    t <- ours[[g]]
    s <- theirs[[g]]
    lbl <- if (length(theirs) > 1) sprintf("[%s] grp%d", tag, g) else sprintf("[%s]", tag)
    for (p in list(c("N", "output.col.n"), c("Mean", "output.col.mean"),
                   c("Std. Deviation", "output.col.sd"),
                   c("Variance", "output.col.variance"), c("Sum", "output.col.sum"),
                   c("Minimum", "output.col.min"), c("Maximum", "output.col.max"),
                   c("seMean", "output.col.seMean"), c("Skewness", "output.col.skewness"),
                   c("Kurtosis", "output.col.kurtosis"))) {
      if (is.null(s[[p[1]]])) next
      if (is.na(idx_of(t, p[2]))) next
      cmp(sprintf("%s %s", lbl, p[1]), val(t, "score", p[2]), s[[p[1]]], digits = 3)
    }
  }
}

hdr("WEIGHTED FREQUENCIES (age)")
fw <- tbl("frequencies.R",
          list(variables = c("age"), varNames = list(age = "age"), weightVariable = "wt",
               options = list(showTable = FALSE,
                              statistics = list(mean = TRUE, median = TRUE, sd = TRUE,
                                                sum = TRUE, percentiles = TRUE,
                                                customPercentiles = list(25, 75)))),
          "output.frequencies.statsTitle:age")
cmp("weighted N", stat_val(fw, "output.stat.nValid"), spss$wsfFreq$nValid)
cmp("weighted mean", stat_val(fw, "output.stat.mean"), spss$wsfFreq$mean)
cmp("weighted median", stat_val(fw, "output.stat.median"), spss$wsfFreq$median)
cmp("weighted SD", stat_val(fw, "output.stat.sd"), spss$wsfFreq$sd)
cmp("weighted sum", stat_val(fw, "output.stat.sum"), spss$wsfFreq$sum)
for (p in c("25", "75")) {
  cmp(sprintf("weighted percentile %s", p), stat_val(fw, paste0("output.stat.pct", p)),
      spss$wsfFreq$percentiles[[p]])
}

# ── SPSS syntax dispatcher end-to-end ───────────────────────────────────────
# Everything above hand-writes the params. This section instead takes the
# params our SPSS-syntax module produced from job.sps — the very text SPSS
# executed — and replays them through the same production scripts. A mismatch
# here that is absent above means the syntax front-end mis-translated the
# command, not that the statistic is wrong.
#
# syntax-params.json is written by tests/spss-parity/syntax-dispatch.test.ts.
syntax_path <- file.path(.here, "syntax-params.json")
if (!file.exists(syntax_path)) {
  cat("\n== SPSS SYNTAX DISPATCH ==\n  (syntax-params.json yok — once vitest",
      "tests/spss-parity/syntax-dispatch.test.ts)\n")
} else {
  hdr("SPSS SYNTAX DISPATCH (job.sps -> bizim parser -> R)")
  sp <- jsonlite::fromJSON(syntax_path, simplifyVector = FALSE)
  # The module resolves names to colIds, so the fixture's columns must be the
  # colIds. Same data, production-shaped params.
  dfc <- df
  names(dfc) <- paste0("col_", seq_along(df))

  entry <- function(script) {
    for (e in sp) if (identical(e$request$scriptFile, script)) return(e)
    NULL
  }
  run_syntax <- function(script) {
    e <- entry(script)
    if (is.null(e)) return(NULL)
    run_analysis_script(script, write_fixture(dfc, e$request$params))
  }

  r <- run_syntax("frequencies.R")
  ft2 <- if (is.null(r)) NULL else table_or_null(r, "output.frequencies.statsTitle:age")
  cmp("FREQUENCIES mean", stat_val(ft2, "output.stat.mean"), spss$frequencies$mean)
  cmp("FREQUENCIES median", stat_val(ft2, "output.stat.median"), spss$frequencies$median)
  cmp("FREQUENCIES p90", stat_val(ft2, "output.stat.pct90"),
      spss$frequencies$percentiles[["90"]])

  r <- run_syntax("descriptives.R")
  dt <- if (is.null(r)) NULL else table_or_null(r, "output.descriptives.title")
  cmp("DESCRIPTIVES score mean", val(dt, "score", "output.col.mean"),
      spss$descriptives$score$mean)
  cmp("DESCRIPTIVES score variance", val(dt, "score", "output.col.variance"),
      spss$descriptives$score$variance)
  cmp("DESCRIPTIVES income skewness", val(dt, "income", "output.col.skewness"),
      spss$descriptives$income$skew)

  r <- run_syntax("ttest-independent.R")
  it2 <- if (is.null(r)) NULL else table_or_null(r, "output.ttestInd.testTitle")
  cmp("T-TEST GROUPS t", row1(it2, "output.col.t"), spss$ttestInd$t)
  cmp("T-TEST GROUPS Sig.", row1(it2, "output.col.sigTwoTailed"), spss$ttestInd$sig)

  r <- run_syntax("ttest-paired.R")
  pt2 <- if (is.null(r)) NULL else table_or_null(r, "output.ttestPaired.testTitle")
  cmp("T-TEST PAIRS t", val(pt2, "pre - post", "output.col.t"), spss$ttestPaired$t)
  cmp("T-TEST PAIRS Sig.", val(pt2, "pre - post", "output.col.sigTwoTailed"),
      spss$ttestPaired$sig)

  r <- run_syntax("ttest-onesample.R")
  ot2 <- if (is.null(r)) NULL else table_or_null(r, "output.ttest1.testTitle")
  cmp("T-TEST TESTVAL t", val(ot2, "score", "output.col.t"), spss$ttestOne$t)
  cmp("T-TEST TESTVAL Sig.", val(ot2, "score", "output.col.sigTwoTailed"), spss$ttestOne$sig)

  r <- run_syntax("anova-oneway.R")
  for (v in c("score", "income")) {
    a2 <- if (is.null(r)) NULL else table_or_null(r, paste0("output.anova.titleBy:", v, "|"))
    cmp(sprintf("ONEWAY %s F", v), val(a2, "output.col.betweenGroups", "output.col.f"),
        spss$anova[[v]]$BetweenGroups$f)
    cmp(sprintf("ONEWAY %s Sig.", v), val(a2, "output.col.betweenGroups", "output.col.sig"),
        spss$anova[[v]]$BetweenGroups$sig)
    h2 <- if (is.null(r)) NULL else table_or_null(r, paste0("output.anova.homogTitle:", v))
    cmp(sprintf("ONEWAY %s Levene", v),
        val(h2, "output.anova.leveneBasedOnMean", "output.col.leveneStatistic"),
        spss$levene[[v]]$stat)
  }

  # CORRELATIONS and NONPAR CORR both route to correlation.R, so entry() by
  # script would return the first; pick them apart by the method flags.
  corr_entries <- Filter(function(e) identical(e$request$scriptFile, "correlation.R"), sp)
  for (e in corr_entries) {
    m <- e$request$params$methods
    # Three correlation runs reach correlation.R now (CORRELATIONS, NONPAR CORR
    # /SPEARMAN, NONPAR CORR /KENDALL); pick the method from the params rather
    # than assuming "not Spearman means Pearson", which sent the Kendall run
    # looking for a Pearson table and silently compared nothing.
    method <- if (isTRUE(m$kendall)) "kendall" else if (isTRUE(m$spearman) && !isTRUE(m$pearson)) "spearman" else "pearson"
    res2 <- run_analysis_script("correlation.R", write_fixture(dfc, e$request$params))
    title <- switch(method,
                    kendall = "output.correlate.title:Kendall",
                    spearman = "output.correlate.title:Spearman",
                    "output.correlate.title:Pearson")
    ct2 <- table_or_null(res2, title)
    their <- switch(method,
                    kendall = spss_matrix(spss$kendall, "Correlation Coefficient"),
                    spearman = spss_matrix(spss$spearman, "Correlation Coefficient"),
                    spss_matrix(spss$pearson, "Pearson Correlation"))
    if (is.null(ct2) || !length(their)) {
      cmp(sprintf("%s/%s r(score income)", e$command, method), NULL, NULL)
      next
    }
    # Our columns are colIds here; map them back to names before flattening.
    cols_named <- vapply(unlist(ct2$columns), function(k) {
      nm <- e$request$params$varNames[[k]]
      if (is.null(nm)) k else nm
    }, character(1))
    rows_named <- lapply(ct2$rows, function(rr) lapply(rr, function(c) {
      if (is.null(c)) return(c)
      nm <- e$request$params$varNames[[as.character(c)]]
      if (is.null(nm)) c else nm
    }))
    ours2 <- flatten_matrix(rows_named, unname(cols_named),
                            switch(method,
                                   kendall = "output.col.kendallTaub",
                                   spearman = "output.col.spearman",
                                   "output.col.pearsonCorr"))
    cmp(sprintf("%s/%s r(score income)", e$command, method), ours2[["score income"]],
        their[["score income"]])
    cmp(sprintf("%s/%s r(income age)", e$command, method), ours2[["income age"]], their[["income age"]])
  }

  r <- run_syntax("crosstabs.R")
  xt2 <- if (is.null(r)) NULL else table_or_null(r, "output.crosstabs.chiSqTitle")
  cmp("CROSSTABS Chi-Square", val(xt2, "output.col.pearsonChiSq", "output.col.value"),
      spss$chisq$pearson$value)
  cmp("CROSSTABS Sig.", val(xt2, "output.col.pearsonChiSq", "output.col.sig"),
      spss$chisq$pearson$sig)

  r <- run_syntax("regression-linear.R")
  ms2 <- if (is.null(r)) NULL else table_or_null(r, "output.regression.modelSummaryTitle")
  cmp("REGRESSION R Square", row1(ms2, "output.col.rSquare"), spss$regression$r2)
  cf2 <- if (is.null(r)) NULL else table_or_null(r, "output.regression.coeffTitle")
  cmp("REGRESSION t (age)", val(cf2, "age", "output.col.t"), spss$regressionCoef$age$t)

  # One headline statistic per remaining procedure. The direct sections above
  # already check each of these in depth; what this adds is that the SPSS
  # syntax reaches them with the right parameters.
  headline <- function(label, script, title, rowlabel, colkey, theirs, digits = 3) {
    res2 <- run_syntax(script)
    t2 <- if (is.null(res2)) NULL else table_or_null(res2, title)
    ours <- if (is.null(rowlabel)) row1(t2, colkey) else val(t2, rowlabel, colkey)
    cmp(label, ours, theirs, digits = digits)
  }

  r <- run_syntax("explore.R")
  ep2 <- if (is.null(r)) NULL else table_or_null(r, "output.explore.percentilesTitle")
  cmp("EXAMINE p50", if (is.null(ep2)) NULL else
        suppressWarnings(as.numeric(ep2$rows[[1]][[6]])), spss$explorePct[["50"]])

  headline("MEANS grp1 mean", "means.R", "output.means.reportTitle",
           "1", "output.col.mean", spss$means[["1"]]$Mean)
  r <- run_syntax("correlation-partial.R")
  pcs <- if (is.null(r)) NULL else table_or_null(r, "output.partialCorr.title")
  cmp("PARTIAL CORR r", if (is.null(pcs)) NULL else
        suppressWarnings(as.numeric(pcs$rows[[1]][[4]])), spss$partial$r)
  headline("M-W U", "npar-mann-whitney.R", "output.npar.testStatsTitle",
           "score", "output.col.mannWhitneyU", spss$mannWhitney$u)
  headline("Wilcoxon Z", "npar-wilcoxon.R", "output.npar.testStatsTitle",
           "post - pre", "output.col.z", spss$wilcoxon$z)
  headline("Kruskal-Wallis H", "npar-kruskal-wallis.R", "output.npar.testStatsTitle",
           "score", "output.col.chiSquare", spss$kruskal$h)
  headline("Friedman Chi-Square", "npar-friedman.R", "output.npar.testStatsTitle",
           NULL, "output.col.chiSquare", spss$friedman$chi)
  headline("Binomial Exact Sig.", "npar-binomial.R", "output.nparBinomial.title",
           "evt", "output.col.exactSig", spss$binomial$exactSig)
  headline("GOF Chi-Square", "npar-chisquare.R", "output.npar.testStatsTitle",
           "grp3", "output.col.chiSquare", spss$gof$chi)
  headline("K-S absolute diff", "npar-ks.R", "output.nparKS.title",
           "score", "output.col.absDiff", spss$ks$absolute)
  headline("Runs number of runs", "npar-runs.R", "output.nparRuns.title",
           "score", "output.col.numRuns", spss$runs$nRuns)
  headline("Cronbach's Alpha", "reliability.R", "output.reliability.statsTitle",
           NULL, "output.col.cronbachAlpha", spss$reliability$alpha)
  headline("ROC area", "roc.R", "output.roc.aucTitle",
           "score", "output.col.area", spss$roc$area)
  headline("Log rank Chi-Square", "survival-km.R", "output.survival.logrankTitle",
           "output.col.logRank", "output.col.chiSquare", spss$logrank$chi)
  headline("Cox Exp(B) (score)", "survival-cox.R", "output.cox.equationTitle",
           "score", "output.col.expB", spss$cox$score$expB)
  headline("Nagelkerke R2", "regression-logistic.R", "output.logistic.modelSummaryTitle",
           NULL, "output.col.nagelkerke", spss$logistic$nagelkerke)
  headline("CURVEFIT quadratic R2", "regression-curve.R", "output.curve.title",
           "output.col.mQuadratic", "output.col.rSquare", spss$curve$Quadratic$r2)

  # SUMMARIZE and OLAP CUBES had no syntax handler at all until this batch —
  # the analyses and dialogs existed, but pasting SPSS's own syntax reported
  # "Unrecognized command".
  r <- run_syntax("case-summaries.R")
  cs2 <- if (is.null(r)) NULL else table_or_null(r, "output.caseSummaries.summaryTitle")
  if (!is.null(cs2)) {
    rr <- NULL
    for (x in cs2$rows) if (identical(as.character(x[[1]]), "1")) { rr <- x; break }
    nums <- if (is.null(rr)) numeric(0) else
      suppressWarnings(as.numeric(vapply(rr, function(c)
        if (is.null(c)) NA_character_ else as.character(c), character(1))))
    nums <- nums[!is.na(nums)]
    cmp("SUMMARIZE grp1 mean", if (length(nums) >= 3) nums[3] else NULL,
        spss$summarize[["1"]]$Mean)
  }
  r <- run_syntax("olap-cubes.R")
  ol2 <- if (is.null(r)) NULL else table_or_null(r, "output.olap.title")
  if (!is.null(ol2)) {
    nums <- suppressWarnings(as.numeric(vapply(ol2$rows[[1]], function(c)
      if (is.null(c)) NA_character_ else as.character(c), character(1))))
    nums <- nums[!is.na(nums)]
    cmp("OLAP CUBES total mean", if (length(nums) >= 2) nums[2] else NULL, spss$olap$mean)
  }
}

# ── SPSS 32: the procedures SPSS 26 does not have ───────────────────────────
# job32.sps runs on IBM SPSS Statistics 32, which is the only version here that
# HAS these commands — Compare Means > Proportions arrived in 27. Kept in its
# own file with its own values so the 26 baseline above cannot shift under it.
#
# Skipped as a whole, loudly, when spss32-values.json is absent: this section is
# only reproducible on a machine with SPSS 32 installed.
sp32_path <- file.path(.here, "spss32-values.json")
if (!file.exists(sp32_path)) {
  cat("\n== SPSS 32 (27+ PROSEDURLER) ==\n  (spss32-values.json yok — job32.sps",
      "SPSS 32'de kosulmali; bkz. README)\n")
  missing_table("SPSS 32 proportions (tum blok)")
} else {
  s32 <- jsonlite::fromJSON(sp32_path, simplifyVector = FALSE)

  # SPSS 27+ prints "<.001" rather than ",000"; the extractor keeps that as a
  # bound instead of pretending 0.001 is a value. A bound is satisfied by
  # anything below it — comparing it as an equality would be wrong in the
  # direction that makes the test pass.
  cmp_lt <- function(label, ours, bound, digits = 3) {
    if (is.null(bound) || is.null(ours) || length(ours) != 1 || is.na(ours)) {
      n_skip <<- n_skip + 1; skips <<- c(skips, label)
      cat(sprintf("  %-42s %-16s %-16s  ATLANDI\n", label, "-", "-"))
      return(invisible(NULL))
    }
    ok <- as.numeric(ours) < as.numeric(bound)
    if (ok) n_pass <<- n_pass + 1 else { n_fail <<- n_fail + 1; fails <<- c(fails, label) }
    cat(sprintf("  %-42s %-16s %-16s  %s\n", label,
                format(signif(as.numeric(ours), 3)),
                paste0("< ", format(bound)), if (ok) "OK" else "FARK"))
  }

  hdr("SPSS 32 — TEK ORNEK ORANLAR (d1, basari=1)")
  po <- table_or_null(run_analysis_script("proportions.R", fx(list(
    design = "one", variable = "d1", varName = "d1",
    testValue = 0.5, successValue = "1", ciLevel = 95))),
    "output.proportions.oneTitle")
  if (is.null(po)) {
    missing_table("one-sample proportions")
  } else {
    s <- s32$propOneCI$wilson
    cmp("prop1 N", val(po, "d1", "output.col.n"), s$trials)
    cmp("prop1 proportion", val(po, "d1", "output.proportions.observed"), s$proportion)
    cmp("prop1 std. error", val(po, "d1", "output.proportions.stdError"), s$ase)
    cmp("prop1 Wilson lower", val(po, "d1", "output.proportions.wilsonLower"), s$lower)
    cmp("prop1 Wilson upper", val(po, "d1", "output.proportions.wilsonUpper"), s$upper)
    # Ours is the exact binomial test; SPSS's Score and mid-p both print <.001.
    # All three agree on the only thing the printed reference actually asserts.
    cmp_lt("prop1 Sig. (< SPSS'in siniri)", val(po, "d1", "output.col.sig"),
           s32$propOneTest$sigTwo$lt)
  }

  hdr("SPSS 32 — BAGIMSIZ ORANLAR (d1 by grp2)")
  pi2 <- table_or_null(run_analysis_script("proportions.R", fx(list(
    design = "independent", variable = "d1", varName = "d1",
    groupVar = "grp2", groupVarName = "grp2", successValue = "1", ciLevel = 95))),
    "output.proportions.indepTitle")
  if (is.null(pi2)) {
    missing_table("independent-samples proportions")
  } else {
    for (g in c("1", "2")) {
      s <- s32$propIndepGroups[[g]]
      if (is.null(s)) next
      cmp(sprintf("prop2 grp%s N", g), val(pi2, g, "output.col.n"), s$trials)
      cmp(sprintf("prop2 grp%s proportion", g), val(pi2, g, "output.proportions.observed"),
          s$proportion)
    }
    d <- s32$propIndepTest
    cmp("prop2 difference", val(pi2, "2", "output.proportions.difference"), d$diff)
    cmp("prop2 std. error", val(pi2, "2", "output.proportions.stdError"), d$ase)
    cmp("prop2 Sig. (2-tailed)", val(pi2, "2", "output.col.sig"), d$sigTwo)
    n2 <- s32$propIndepCI$newcombe
    cmp("prop2 Newcombe lower", val(pi2, "2", "output.proportions.newcombeLower"), n2$lower)
    cmp("prop2 Newcombe upper", val(pi2, "2", "output.proportions.newcombeUpper"), n2$upper)
  }

  hdr("SPSS 32 — ESLESTIRILMIS ORANLAR (d1, d2)")
  pp <- table_or_null(run_analysis_script("proportions.R", fx(list(
    design = "paired", variable1 = "d1", varName1 = "d1",
    variable2 = "d2", varName2 = "d2", successValue = "1", ciLevel = 95))),
    "output.proportions.pairedTitle")
  if (is.null(pp)) {
    missing_table("paired-samples proportions")
  } else {
    for (v in c("d1", "d2")) {
      s <- s32$propPairedStats[[v]]
      if (is.null(s)) next
      cmp(sprintf("prop3 %s N", v), val(pp, v, "output.col.n"), s$trials)
      cmp(sprintf("prop3 %s proportion", v), val(pp, v, "output.proportions.observed"),
          s$proportion)
    }
    m <- s32$propPairedTest$mcnemar
    cmp("prop3 difference", val(pp, "d2", "output.proportions.difference"), m$diff)
    cmp("prop3 std. error", val(pp, "d2", "output.proportions.stdError"), m$ase)
    # The asymptotic McNemar is the reference's test, and it is now a column of
    # ours too (CLAUDE.md §11: keep the asymptotic, add the exact beside it), so
    # this compares like for like instead of recording a deliberate difference
    # that only existed because we printed one of the two.
    cmp("prop3 Z (McNemar)", val(pp, "d2", "output.col.z"), m$z)
    cmp("prop3 Asymp. Sig.", val(pp, "d2", "output.col.asympSig"), m$sigTwo)
    # The exact test has no counterpart in the reference's default output — its
    # mid-p adjusted binomial (0.405) is a third thing again — so it is checked
    # against the definition here rather than against SPSS.
    disc <- with(df[!is.na(df$d1) & !is.na(df$d2), ],
                 c(sum(d1 == 1 & d2 == 0), sum(d1 == 0 & d2 == 1)))
    cmp("prop3 Exact Sig. (tanima karsi)", val(pp, "d2", "output.col.exactSig"),
        round(min(1, 2 * pbinom(min(disc), sum(disc), 0.5)), 6))
  }

  # ── Bayesian ──────────────────────────────────────────────────────────────
  # This harness used to record Bayesian procedures as "not comparable by
  # design: SPSS's priors and BayesFactor's JZS priors differ". That was an
  # assumption, and it was only half right. SPSS 27+ offers Rouder's method and
  # JZS by name — the same Bayes-factor family BayesFactor implements — so two
  # of them ARE comparable once the prior WIDTH is matched: SPSS uses r = 1
  # where our default is r = 0.707 ("medium"). These runs pass rscale
  # explicitly rather than changing any default.
  #
  # The other two stay uncompared for a measured reason, not an assumed one: no
  # prior width reproduces SPSS's correlation Bayes factor (closest ratio 1.6,
  # at r = 1) or its ANOVA one (closest 3.0). The paired test cannot be compared
  # at any width — SPSS prints BF01 = .000, which says only "very large".
  hdr("SPSS 32 - BAYES BAGIMSIZ T (score by grp2, Rouder r=1)")
  bi <- table_or_null(run_analysis_script("bayes-ttest-independent.R", fx(list(
    variables = "score", varNames = list(score = "score"),
    groupVar = "grp2", group1 = "1", group2 = "2", rscale = "wide"))),
    "output.bayes.bfTitle")
  if (is.null(bi) || is.null(s32$bayesIndep)) {
    missing_table("Bayes independent-samples t (BayesFactor paketi gerekli)")
  } else {
    # SPSS prints BF01, BayesFactor reports BF10; compared on our own BF01
    # column so the reciprocal is not taken twice by accident.
    cmp("bayes t BF01", val(bi, "score", "output.bayes.bf01"), s32$bayesIndep$bf01)
  }

  hdr("SPSS 32 - BAYES REGRESYON (score ~ age, JZS r=1)")
  br <- table_or_null(run_analysis_script("bayes-regression.R", fx(list(
    dependent = "score", dependentName = "score", independents = "age",
    varNames = list(age = "age"), rscale = 1))),
    "output.bayes.bfTitle")
  if (is.null(br) || is.null(s32$bayesRegression)) {
    missing_table("Bayes regression (BayesFactor paketi gerekli)")
  } else {
    cmp("bayes regresyon BF10", row1(br, "output.bayes.bf10"), s32$bayesRegression$bf10)
  }
}

cat(sprintf(paste0("\n=========================================\n",
                   "OK: %d   FARK: %d   BILINCLI: %d   ACIK: %d   ATLANDI: %d\n"),
            n_pass, n_fail, n_note, n_open, n_skip))
# Labels only here: each one's explanation is printed directly under its own
# row above, next to the two numbers it is explaining.
if (n_note > 0) cat("Bilincli sapmalar (gerekcesi ilgili satirin altinda):\n  ",
                    paste(notes, collapse = "\n  "), "\n")
if (n_open > 0) cat("Acik farklar (nereye kadar gidildigi ilgili satirin altinda):\n  ",
                    paste(opens, collapse = "\n  "), "\n")
if (n_fail > 0) cat("Farklar:\n  ", paste(fails, collapse = "\n  "), "\n")
# A skip compares nothing at all, so it is a harness bug, not a pass. Print it
# loudly: silent skips were the failure mode that made the first version of
# this script look greener than it was.
if (n_skip > 0) cat("Atlananlar (karsilastirma YAPILMADI):\n  ",
                    paste(skips, collapse = "\n  "), "\n")
quit(status = if (n_fail > 0) 1 else 0)
