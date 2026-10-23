# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-spss-parity-2026-08.R — regression tests for the SPSS-comparison round
# documented in manuel-test/NIHAI-RAPOR-2026-08-07.md (real SPSS output vs
# SAI output on the same 309-case dataset).
#
# References are computed independently of the scripts under test (base R
# stats::, hand-derived formulas) — never from the analysis script's internals.

# ══ crosstabs.R — McNemar requires identical category sets ═══════════════════
# SPSS prints a dot plus footnote "Both variables must have identical values of
# categories." McNemar compares the same trait measured twice, so with
# symptom{0,1} × sex{1,2} the discordant cells b and c are not a matched pair
# and any p-value is a false positive. The script used to emit one anyway.

test_that("crosstabs McNemar: skipped (with a warning) when categories differ", {
  set.seed(101)
  n <- 200
  df <- data.frame(
    col_1 = sample(c("0", "1"), n, replace = TRUE),   # symptom
    col_2 = sample(c("1", "2"), n, replace = TRUE),   # sex — different category set
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "symptom"),
    cols = list("col_2"), colNames = list(col_2 = "sex"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = TRUE, mcnemar = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  chisq <- find_table(result, "output.crosstabs.chiSqTitle")
  mrow <- Filter(function(r) identical(r[[1]], "output.col.mcnemar"), chisq$rows)
  expect_equal(length(mrow), 1L, tolerance = 0, "McNemar row is still shown")
  expect_true(is.null(mrow[[1]][[4]]), "McNemar Sig. is empty, like SPSS's dot")
  expect_true(
    "output.crosstabs.warnMcnemarCategories" %in% unlist(result$warnings),
    "warning explains why McNemar was not computed"
  )
})

test_that("crosstabs McNemar: computed when both variables share categories", {
  # Matched-pairs shape: same {no,yes} scale measured before/after.
  # b = (no,yes) = 30, c = (yes,no) = 10 → exact binomial two-sided p.
  before <- c(rep("no", 100), rep("yes", 100))
  after <- c(rep("no", 70), rep("yes", 30), rep("no", 10), rep("yes", 90))
  df <- data.frame(col_1 = before, col_2 = after, stringsAsFactors = FALSE)
  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "before"),
    cols = list("col_2"), colNames = list(col_2 = "after"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = TRUE, mcnemar = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  chisq <- find_table(result, "output.crosstabs.chiSqTitle")
  mrow <- Filter(function(r) identical(r[[1]], "output.col.mcnemar"), chisq$rows)[[1]]

  # Independent reference: exact two-sided binomial on the discordant pairs.
  # The script rounds to 6 decimals before serialising (SPSS-style display
  # precision); expect_equal()'s tolerance is relative, which at p ≈ 0.002 is
  # far tighter than that rounding — so round the reference the same way
  # instead of loosening the comparison.
  ref_p <- min(1, 2 * pbinom(min(30, 10), 30 + 10, 0.5))
  expect_equal(as.numeric(mrow[[4]]), round(ref_p, 6), tolerance = 1e-9, "McNemar exact p")
  expect_true(
    !("output.crosstabs.warnMcnemarCategories" %in% unlist(result$warnings)),
    "no category warning for a genuinely matched pair"
  )
})

# ══ crosstabs.R — signed phi on a 2×2 table ══════════════════════════════════
# sqrt(chi2/N) is |phi|; SPSS reports a SIGNED phi for 2×2, whose sign is that
# of (ad − bc). The unsigned value contradicted the (correctly signed) ordinal
# measures sitting in the same table.

# ══ crosstabs.R — Fisher's exact goes in the Exact Sig. columns ══════════════
# SPSS gives a 2×2 table an "Exact Sig. (2-sided)" and "Exact Sig. (1-sided)"
# column pair that only Fisher's row fills. This script used to put Fisher's p
# under "Asymp. Sig." and report no 1-sided value at all.

test_that("crosstabs Fisher: 2x2 reports exact 2-sided AND 1-sided in their own columns", {
  # The 2×2 table straight out of the SPSS run in manuel-test/ (halsizlik ×
  # cinsiyet), where SPSS printed 2-sided ,155 and 1-sided ,094.
  df <- data.frame(
    col_1 = c(rep("0", 247), rep("1", 62)),
    col_2 = c(rep("1", 106), rep("2", 141), rep("1", 33), rep("2", 29)),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "halsizlik"),
    cols = list("col_2"), colNames = list(col_2 = "cinsiyet"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  chisq <- find_table(result, "output.crosstabs.chiSqTitle")
  cols <- unlist(chisq$columns)
  expect_true("output.col.exactSig2" %in% cols, "Exact Sig. (2-sided) column exists")
  expect_true("output.col.exactSig1" %in% cols, "Exact Sig. (1-sided) column exists")
  i2 <- which(cols == "output.col.exactSig2")
  i1 <- which(cols == "output.col.exactSig1")

  frow <- Filter(function(r) identical(r[[1]], "output.col.fisherExact"), chisq$rows)[[1]]
  # Independent reference: base R, and the 1-sided value is the smaller of the
  # two one-tailed tests (the direction of the observed association).
  tab <- matrix(c(106, 33, 141, 29), nrow = 2)
  ref2 <- fisher.test(tab)$p.value
  ref1 <- min(fisher.test(tab, alternative = "less")$p.value,
              fisher.test(tab, alternative = "greater")$p.value)
  expect_equal(as.numeric(frow[[i2]]), round(ref2, 6), tolerance = 1e-6, "exact 2-sided")
  expect_equal(as.numeric(frow[[i1]]), round(ref1, 6), tolerance = 1e-6, "exact 1-sided")
  # SPSS's own printed values, to three decimals.
  expect_equal(round(as.numeric(frow[[i2]]), 3), 0.155, tolerance = 1e-9, "matches SPSS .155")
  expect_equal(round(as.numeric(frow[[i1]]), 3), 0.094, tolerance = 1e-9, "matches SPSS .094")

  # Fisher is exact, not asymptotic: the Asymp. Sig. / Value / df cells stay
  # empty on that row, and the other rows leave the exact columns empty.
  expect_true(is.null(frow[[2]]) && is.null(frow[[3]]) && is.null(frow[[4]]),
              "Value/df/Asymp. Sig. blank on the Fisher row")
  prow <- Filter(function(r) identical(r[[1]], "output.col.pearsonChiSq"), chisq$rows)[[1]]
  expect_equal(length(prow), length(cols), tolerance = 0, "every row spans every column")
  expect_true(is.null(prow[[i2]]) && is.null(prow[[i1]]),
              "Pearson row leaves the exact columns empty")
})

test_that("crosstabs Fisher: larger tables keep the single asymptotic Sig. layout", {
  set.seed(77)
  df <- data.frame(
    col_1 = sample(c("a", "b", "c"), 120, replace = TRUE),
    col_2 = sample(c("x", "y", "z"), 120, replace = TRUE),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "r"),
    cols = list("col_2"), colNames = list(col_2 = "c"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  cols <- unlist(find_table(result, "output.crosstabs.chiSqTitle")$columns)
  expect_true(!("output.col.exactSig1" %in% cols), "no 1-sided column beyond 2x2")
})

# ══ Case Processing Summary (SPSS opens Crosstabs and Explore with one) ══════

test_that("crosstabs: Case Processing Summary counts each pair's valid cases", {
  # Case 2 is missing on the row variable, case 5 on the column variable, so
  # the pair has 2 missing of 6 — a case counts as valid only when BOTH
  # variables are present, which is the same mask the crosstab itself uses.
  df <- data.frame(
    col_1 = c("a", NA, "a", "b", "b", "b"),
    col_2 = c("x", "x", "y", "y", NA, "x"),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "R"),
    cols = list("col_2"), colNames = list(col_2 = "C"),
    options = list(cells = list(observed = TRUE), stats = list(chisquare = FALSE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  cps <- find_table(result, "output.cps.title")
  expect_equal(length(cps$rows), 1L, tolerance = 0, "one row per variable pair")
  expect_true(identical(cps$rows[[1]][[1]], "R * C"), "pair label")
  expect_equal(cell_num(cps, 1, 2), 4, tolerance = 0, "valid N")
  expect_equal(cell_num(cps, 1, 3), round(4 / 6 * 100, 1), tolerance = 1e-9, "valid %")
  expect_equal(cell_num(cps, 1, 4), 2, tolerance = 0, "missing N")
  expect_equal(cell_num(cps, 1, 6), 6, tolerance = 0, "total N")
  expect_equal(cell_num(cps, 1, 7), 100, tolerance = 1e-9, "total %")

  # It is the FIRST table, ahead of the crosstabulation itself (SPSS order).
  expect_true(identical(result$tables[[1]]$titleKey, "output.cps.title"),
              "Case Processing Summary comes first")
})

test_that("explore: Case Processing Summary breaks valid/missing down by factor level", {
  df <- data.frame(
    col_1 = c(1, 2, NA, 4, 5, NA, 7, 8),
    col_2 = c("A", "A", "A", "A", "B", "B", "B", "B"),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factors = list("col_2"), factorNames = list(col_2 = "grp"),
    options = list(display = "statistics", stats = list(descriptives = TRUE))
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  cps <- find_table(result, "output.cps.title")
  expect_equal(length(cps$rows), 2L, tolerance = 0, "one row per factor level")
  # Columns: variable, group, valid N, valid %, missing N, missing %, total N, total %.
  expect_true(identical(cps$rows[[1]][[2]], "A"), "first row is group A")
  expect_equal(cell_num(cps, 1, 3), 3, tolerance = 0, "A valid")
  expect_equal(cell_num(cps, 1, 5), 1, tolerance = 0, "A missing")
  expect_equal(cell_num(cps, 1, 7), 4, tolerance = 0, "A total")
  expect_equal(cell_num(cps, 1, 4), 75, tolerance = 1e-9, "A valid %")
  expect_equal(cell_num(cps, 2, 3), 3, tolerance = 0, "B valid")
  expect_equal(cell_num(cps, 2, 5), 1, tolerance = 0, "B missing")
  expect_true(identical(result$tables[[1]]$titleKey, "output.cps.title"),
              "Case Processing Summary comes first")
})

# ══ crosstabs.R — nominal directional measures ═══════════════════════════════

test_that("crosstabs Lambda / Goodman-Kruskal tau match hand-derived PRE formulas", {
  # A fixed, deliberately asymmetric 3x3 table so the two directions differ.
  counts <- matrix(c(20, 5, 3,
                     4, 25, 6,
                     2, 7, 28), nrow = 3, byrow = TRUE)
  rows <- unlist(lapply(seq_len(3), function(i)
    unlist(lapply(seq_len(3), function(j) rep(paste0("r", i), counts[i, j])))))
  cols <- unlist(lapply(seq_len(3), function(i)
    unlist(lapply(seq_len(3), function(j) rep(paste0("c", j), counts[i, j])))))
  df <- data.frame(col_1 = rows, col_2 = cols, stringsAsFactors = FALSE)

  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "R"),
    cols = list("col_2"), colNames = list(col_2 = "C"),
    options = list(cells = list(observed = TRUE),
                   stats = list(chisquare = FALSE, lambda = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  dir <- find_table(result, "output.crosstabs.dirTitle")

  # Independent references, straight from the PRE definitions.
  N <- sum(counts); rt <- rowSums(counts); ct <- colSums(counts)
  lam_row <- (sum(apply(counts, 2, max)) - max(rt)) / (N - max(rt))
  lam_col <- (sum(apply(counts, 1, max)) - max(ct)) / (N - max(ct))
  lam_sym <- (sum(apply(counts, 2, max)) + sum(apply(counts, 1, max)) - max(rt) - max(ct)) /
             (2 * N - max(rt) - max(ct))
  tau_ref <- function(m, dep_tot, ind_tot) {
    num <- sum(vapply(seq_along(ind_tot), function(j) sum(m[, j]^2) / ind_tot[j], numeric(1)))
    base <- sum(dep_tot^2) / N
    (num - base) / (N - base)
  }
  tau_row <- tau_ref(counts, rt, ct)
  tau_col <- tau_ref(t(counts), ct, rt)

  pick <- function(stat, label) {
    hit <- Filter(function(r) identical(r[[1]], stat) && identical(r[[2]], label), dir$rows)
    as.numeric(hit[[1]][[3]])
  }
  expect_equal(pick("output.col.lambda", "output.col.symmetric"), round(lam_sym, 6),
               tolerance = 1e-6, "lambda symmetric")
  expect_equal(pick("output.col.lambda", "output.crosstabs.dependent:R"), round(lam_row, 6),
               tolerance = 1e-6, "lambda row dependent")
  expect_equal(pick("output.col.lambda", "output.crosstabs.dependent:C"), round(lam_col, 6),
               tolerance = 1e-6, "lambda column dependent")
  expect_equal(pick("output.col.gkTau", "output.crosstabs.dependent:R"), round(tau_row, 6),
               tolerance = 1e-6, "GK tau row dependent")
  expect_equal(pick("output.col.gkTau", "output.crosstabs.dependent:C"), round(tau_col, 6),
               tolerance = 1e-6, "GK tau column dependent")
  # Goodman-Kruskal tau has no symmetric version in SPSS.
  expect_equal(length(Filter(function(r) identical(r[[1]], "output.col.gkTau"), dir$rows)),
               2L, tolerance = 0, "tau is directional only")
})

test_that("crosstabs Uncertainty coefficient matches the entropy definition", {
  counts <- matrix(c(30, 10, 5,
                     8, 26, 9,
                     4, 6, 22), nrow = 3, byrow = TRUE)
  rows <- unlist(lapply(seq_len(3), function(i)
    unlist(lapply(seq_len(3), function(j) rep(paste0("r", i), counts[i, j])))))
  cols <- unlist(lapply(seq_len(3), function(i)
    unlist(lapply(seq_len(3), function(j) rep(paste0("c", j), counts[i, j])))))
  df <- data.frame(col_1 = rows, col_2 = cols, stringsAsFactors = FALSE)

  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "R"),
    cols = list("col_2"), colNames = list(col_2 = "C"),
    options = list(cells = list(observed = TRUE),
                   stats = list(chisquare = FALSE, uncertainty = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  dir <- find_table(result, "output.crosstabs.dirTitle")

  N <- sum(counts)
  H <- function(v) { p <- v[v > 0] / N; -sum(p * log(p)) }
  hr <- H(rowSums(counts)); hc <- H(colSums(counts)); hrc <- H(as.numeric(counts))
  info <- hr + hc - hrc
  pick <- function(label) {
    hit <- Filter(function(r) identical(r[[1]], "output.col.uncertainty") &&
                              identical(r[[2]], label), dir$rows)
    as.numeric(hit[[1]][[3]])
  }
  expect_equal(pick("output.col.symmetric"), round(2 * info / (hr + hc), 6),
               tolerance = 1e-6, "U symmetric")
  expect_equal(pick("output.crosstabs.dependent:R"), round(info / hr, 6),
               tolerance = 1e-6, "U row dependent")
  expect_equal(pick("output.crosstabs.dependent:C"), round(info / hc, 6),
               tolerance = 1e-6, "U column dependent")

  # All three share the likelihood-ratio test of independence.
  sig <- Filter(function(r) identical(r[[1]], "output.col.uncertainty"), dir$rows)[[1]][[4]]
  expect_equal(as.numeric(sig),
               round(pchisq(2 * N * info, 4, lower.tail = FALSE), 6),
               tolerance = 1e-6, "LR chi-square significance")
})

test_that("crosstabs phi: 2x2 keeps the sign of (ad - bc)", {
  # Rows alphabetical: NonSmoker, Smoker. Cols: Disease, NoDisease.
  #   a=10 b=90 / c=30 d=70  → ad - bc = 700 - 2700 < 0 → phi must be negative.
  rows <- c(rep("Smoker", 100), rep("NonSmoker", 100))
  cols <- c(rep("Disease", 30), rep("NoDisease", 70), rep("Disease", 10), rep("NoDisease", 90))
  df <- data.frame(col_1 = rows, col_2 = cols, stringsAsFactors = FALSE)
  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "smoking"),
    cols = list("col_2"), colNames = list(col_2 = "disease"),
    options = list(cells = list(observed = TRUE), stats = list(phiCramer = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  sym <- find_table(result, "output.crosstabs.symTitle")
  phi <- Filter(function(r) identical(r[[2]], "output.col.phi"), sym$rows)[[1]]
  cramer <- Filter(function(r) identical(r[[2]], "output.col.cramersV"), sym$rows)[[1]]

  tab <- matrix(c(10, 90, 30, 70), nrow = 2, byrow = TRUE)
  a <- tab[1, 1]; b <- tab[1, 2]; cc <- tab[2, 1]; d <- tab[2, 2]
  ref_phi <- (a * d - b * cc) / sqrt(sum(tab[1, ]) * sum(tab[2, ]) * sum(tab[, 1]) * sum(tab[, 2]))

  expect_equal(as.numeric(phi[[3]]), ref_phi, tolerance = 1e-6, "signed phi matches (ad-bc) formula")
  expect_true(as.numeric(phi[[3]]) < 0, "phi is negative here")
  # Cramer's V stays a magnitude (SPSS shows it unsigned even for 2x2).
  expect_equal(as.numeric(cramer[[3]]), abs(ref_phi), tolerance = 1e-6, "Cramer's V is |phi| for 2x2")
})

# ══ frequencies.R — no numeric statistics for a non-numeric variable ═════════
# SPSS leaves the Statistics table blank for a string variable. The script used
# to coerce with as.numeric(), silently drop the values that failed, and report
# a mean/sum over that subset while the Valid row still showed the full
# categorical N — Sum/Mean did not even agree with each other's N.

test_that("frequencies: mixed numeric/categorical column reports no numeric stats", {
  # 4 parseable values + 2 genuine categories ("3,4,5" style combination codes).
  df <- data.frame(
    col_1 = c("1", "2", "3", "4", "3,4,5", "1,2,6"),
    stringsAsFactors = FALSE
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "symptoms"),
    options = list(
      showTable = FALSE,
      statistics = list(mean = TRUE, sum = TRUE, sd = TRUE, mode = TRUE)
    )
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) r[[1]], character(1))
  expect_true(!("output.stat.mean" %in% labels), "no Mean row")
  expect_true(!("output.stat.sum" %in% labels), "no Sum row")
  expect_true(!("output.stat.sd" %in% labels), "no Std. Deviation row")
  # Valid/Missing stay categorical, and Mode remains — the most frequent
  # category of a string variable is well defined (deliberate, documented
  # deviation from SPSS, which blanks the whole table).
  expect_true("output.stat.nValid" %in% labels, "Valid row kept")
  expect_true("output.stat.mode" %in% labels, "Mode row kept")
  n_valid <- stats$rows[[which(labels == "output.stat.nValid")]][[2]]
  expect_equal(as.numeric(n_valid), 6, tolerance = 0, "Valid N is the full categorical N")
  expect_true(
    any(grepl("^output.freq.warnNonNumericStats", unlist(result$warnings))),
    "warning names the offending variable"
  )
})

test_that("frequencies: a genuinely numeric column still reports numeric stats", {
  set.seed(7)
  x <- round(rnorm(40, 10, 3), 4)
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(showTable = FALSE, statistics = list(mean = TRUE, sd = TRUE, sum = TRUE))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) r[[1]], character(1))
  expect_equal(as.numeric(stats$rows[[which(labels == "output.stat.mean")]][[2]]),
               mean(x), tolerance = 1e-5, "mean matches base R")
  expect_equal(as.numeric(stats$rows[[which(labels == "output.stat.sd")]][[2]]),
               sd(x), tolerance = 1e-5, "sd matches base R")
  expect_true(
    !any(grepl("^output.freq.warnNonNumericStats", unlist(result$warnings))),
    "no non-numeric warning for a clean numeric column"
  )
})

# ══ frequencies.R — user percentiles and cut points ══════════════════════════

test_that("frequencies: custom percentile list replaces the default list", {
  set.seed(8)
  x <- rnorm(200, 50, 12)
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(
      showTable = FALSE,
      statistics = list(percentiles = TRUE, customPercentiles = list(33, 66))
    )
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) r[[1]], character(1))

  expect_true("output.stat.pct33" %in% labels, "requested 33rd percentile present")
  expect_true("output.stat.pct66" %in% labels, "requested 66th percentile present")
  expect_true(!("output.stat.pct90" %in% labels), "default list is replaced, not merged")

  # type 6 = SPSS's HAVERAGE, the definition its percentile tables use; R's
  # default type 7 disagrees whenever the straddled order statistics differ.
  ref <- unname(quantile(x, probs = c(0.33, 0.66), type = 6))
  expect_equal(as.numeric(stats$rows[[which(labels == "output.stat.pct33")]][[2]]),
               ref[1], tolerance = 1e-5, "33rd percentile matches stats::quantile")
  expect_equal(as.numeric(stats$rows[[which(labels == "output.stat.pct66")]][[2]]),
               ref[2], tolerance = 1e-5, "66th percentile matches stats::quantile")
})

test_that("frequencies: cut points emit the N-1 equal-group percentiles", {
  set.seed(9)
  x <- rnorm(300, 0, 1)
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "z"),
    options = list(showTable = FALSE, statistics = list(cutPoints = 4L))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  stats <- find_table(result, "output.frequencies.statsTitle")
  labels <- vapply(stats$rows, function(r) r[[1]], character(1))

  # 4 equal groups → cut points at 25, 50, 75 (and nothing at 0 or 100).
  expect_true(all(c("output.stat.pct25", "output.stat.pct50", "output.stat.pct75") %in% labels),
              "quartile cut points present")
  ref <- unname(quantile(x, probs = c(0.25, 0.5, 0.75), type = 6))
  expect_equal(as.numeric(stats$rows[[which(labels == "output.stat.pct25")]][[2]]),
               ref[1], tolerance = 1e-5, "cut point 25 matches stats::quantile")
  expect_equal(as.numeric(stats$rows[[which(labels == "output.stat.pct75")]][[2]]),
               ref[3], tolerance = 1e-5, "cut point 75 matches stats::quantile")
})

# ══ explore.R — percentiles / extreme values / listwise ══════════════════════
# The Percentiles checkbox existed in the dialog but was never read by the
# script: ticking it produced no output at all.

test_that("explore: percentiles table matches stats::quantile and fivenum", {
  set.seed(11)
  x <- rnorm(120, 100, 15)
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(display = "statistics", stats = list(percentiles = TRUE))
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  pct <- find_table(result, "output.explore.percentilesTitle")
  expect_equal(length(pct$rows), 2L, tolerance = 0, "weighted-average + Tukey hinge rows")

  # Row 1: label, group, then 5/10/25/50/75/90/95 → data starts at column 3.
  # Explore's first row is literally labelled "Weighted Average (Definition 1)"
  # in SPSS — HAVERAGE, i.e. type 6. The Tukey hinge row below is fivenum().
  ref <- unname(quantile(x, probs = c(5, 10, 25, 50, 75, 90, 95) / 100, type = 6))
  for (i in seq_along(ref)) {
    expect_equal(as.numeric(pct$rows[[1]][[i + 2]]), ref[i], tolerance = 1e-5,
                 sprintf("percentile %d", c(5, 10, 25, 50, 75, 90, 95)[i]))
  }
  fv <- fivenum(x)
  expect_equal(as.numeric(pct$rows[[2]][[5]]), fv[2], tolerance = 1e-6, "lower hinge")
  expect_equal(as.numeric(pct$rows[[2]][[7]]), fv[4], tolerance = 1e-6, "upper hinge")
  expect_true(is.null(pct$rows[[2]][[3]]), "hinges leave the 5th percentile blank")
})

test_that("explore: extreme values list the 5 largest/smallest with case numbers", {
  set.seed(12)
  x <- rnorm(50, 0, 1)
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(display = "statistics", stats = list(outliers = TRUE))
  ))
  result <- run_analysis_script("explore.R", fixture)
  ext <- find_table(result, "output.explore.extremeTitle")
  expect_equal(length(ext$rows), 10L, tolerance = 0, "5 highest + 5 lowest")

  # Columns: group, type, rank, case number, value.
  hi <- Filter(function(r) identical(r[[2]], "output.explore.extremeHighest"), ext$rows)
  lo <- Filter(function(r) identical(r[[2]], "output.explore.extremeLowest"), ext$rows)
  ref_hi <- order(x, decreasing = TRUE)[1:5]
  ref_lo <- order(x)[1:5]
  expect_equal(vapply(hi, function(r) as.numeric(r[[4]]), numeric(1)), as.numeric(ref_hi),
               tolerance = 0, "highest case numbers")
  expect_equal(vapply(lo, function(r) as.numeric(r[[4]]), numeric(1)), as.numeric(ref_lo),
               tolerance = 0, "lowest case numbers")
  expect_equal(as.numeric(hi[[1]][[5]]), max(x), tolerance = 1e-6, "largest value")
  expect_equal(as.numeric(lo[[1]][[5]]), min(x), tolerance = 1e-6, "smallest value")
})

test_that("explore: M-Estimators match intercept-only MASS::rlm fits", {
  skip_needs <- !requireNamespace("MASS", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: MASS not installed)\n")
    return(invisible())
  }
  set.seed(13)
  x <- c(rnorm(60, 20, 3), 90, 95)   # two deliberate outliers
  df <- data.frame(col_1 = x)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(display = "statistics", stats = list(mEstimators = TRUE))
  ))
  result <- run_analysis_script("explore.R", fixture)
  mest <- find_table(result, "output.explore.mEstimatorsTitle")
  expect_equal(length(mest$rows), 1L, tolerance = 0, "one row (no factor)")

  # Independent reference: SPSS's M-estimator as test-m-estimators-2026-08.R
  # pinned it against two real SPSS runs — IRLS from the median with the scale
  # held FIXED at the raw median absolute deviation. (This block used to
  # compare against MASS::rlm(), whose re-estimated, consistency-scaled MAD is
  # the convention explore.R abandoned in 2026-08 to match SPSS; on this
  # outlier-heavy fixture the two differ in the first decimal.)
  m_ref <- function(wfun) {
    s <- median(abs(x - median(x))); mu <- median(x)
    for (it in 1:1000) {
      u <- (x - mu) / s; wt <- wfun(u)
      nmu <- sum(wt * x) / sum(wt)
      if (abs(nmu - mu) < 1e-12) break
      mu <- nmu
    }
    mu
  }
  ref_huber  <- m_ref(function(u) ifelse(abs(u) <= 1.339, 1, 1.339 / abs(u)))
  ref_tukey  <- m_ref(function(u) ifelse(abs(u) <= 4.685, (1 - (u / 4.685)^2)^2, 0))
  ref_hampel <- m_ref(function(u) {
    a <- 1.7; b <- 3.4; cc <- 8.5; au <- abs(u)
    ifelse(au <= a, 1, ifelse(au <= b, a / au, ifelse(au <= cc, a * (cc - au) / ((cc - b) * au), 0)))
  })
  expect_equal(as.numeric(mest$rows[[1]][[2]]), round(ref_huber, 6), tolerance = 1e-6, "Huber")
  expect_equal(as.numeric(mest$rows[[1]][[3]]), round(ref_tukey, 6), tolerance = 1e-6, "Tukey biweight")
  expect_equal(as.numeric(mest$rows[[1]][[4]]), round(ref_hampel, 6), tolerance = 1e-6, "Hampel")

  # Andrews' wave is the one estimator MASS does not ship, so the script
  # supplies its own psi. Re-derive it here straight from the textbook/SPSS
  # definition — psi(u) = sin(u/a) on |u| <= a*pi with SPSS's a = 1.34, hence
  # weight sin(u/a)/(u/a) and derivative cos(u/a) — rather than reusing the
  # script's, so a broken psi cannot validate itself.
  ref_psi_andrews <- function(u, a = 1.34, deriv = 0) {
    inside <- abs(u) <= a * pi
    z <- u / a
    if (!deriv) return(ifelse(inside, ifelse(abs(z) < 1e-8, 1, sin(z) / z), 0))
    ifelse(inside, cos(z), 0)
  }
  # The wave must reach exactly 0 at the |u| = a*pi cutoff. Scaling the
  # argument by the cutoff instead of by `a` leaves it at sin(1) = 0.84 and
  # makes the weight discontinuous.
  expect_equal(ref_psi_andrews(1.34 * pi), 0, tolerance = 1e-9, "weight is 0 at the cutoff")
  ref_andrews <- m_ref(function(u) ref_psi_andrews(u))
  expect_equal(as.numeric(mest$rows[[1]][[5]]), round(ref_andrews, 6), tolerance = 1e-6, "Andrews wave")
  # All four estimators must resist the outliers far better than the mean.
  for (k in 2:5) {
    expect_lt(abs(as.numeric(mest$rows[[1]][[k]]) - 20), abs(mean(x) - 20),
              sprintf("estimator %d is more robust than the mean", k - 1))
  }
})

test_that("explore: M-Estimators requested without MASS warn instead of failing", {
  if (requireNamespace("MASS", quietly = TRUE)) {
    cat("  (skipped: MASS is installed, honesty path not reachable)\n")
    return(invisible())
  }
  df <- data.frame(col_1 = rnorm(30, 5, 1))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(display = "statistics", stats = list(mEstimators = TRUE))
  ))
  result <- run_analysis_script("explore.R", fixture)
  expect_true(isTRUE(result$success), "the run still succeeds")
  expect_true(
    "output.explore.warnMassMissing" %in% unlist(result$warnings),
    "an honest warning replaces the missing table"
  )
})

test_that("explore: listwise missing drops cases missing on any dependent", {
  # Case 3 is missing on the second dependent only. Under listwise it must
  # disappear from BOTH descriptives tables; "analysis" keeps it in the first.
  # EXAMINE's DEFAULT is listwise — verified against SPSS 26 in
  # tests/spss-parity/compare-missing.R (the run without /MISSING and the
  # /MISSING=LISTWISE run produced identical tables), so the default case is
  # asserted against 4, and 5 needs an explicit missing = "analysis".
  d1 <- c(10, 20, 30, 40, 50)
  d2 <- c(1, 2, NA, 4, 5)
  df <- data.frame(col_1 = d1, col_2 = d2)
  base_params <- list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "a", col_2 = "b")
  )

  fx_default <- write_fixture(df, c(base_params, list(
    options = list(display = "statistics", stats = list(descriptives = TRUE))
  )))
  res_default <- run_analysis_script("explore.R", fx_default)
  t_default <- find_table(res_default, "output.explore.descTitle:a")
  expect_equal(as.numeric(t_default$rows[[1]][[2]]), 4, tolerance = 0,
               "the default (SPSS's listwise) drops the case missing on 'b'")

  fx_analysis <- write_fixture(df, c(base_params, list(
    options = list(display = "statistics", stats = list(descriptives = TRUE), missing = "analysis")
  )))
  res_analysis <- run_analysis_script("explore.R", fx_analysis)
  t_analysis <- find_table(res_analysis, "output.explore.descTitle:a")
  expect_equal(as.numeric(t_analysis$rows[[1]][[2]]), 5, tolerance = 0,
               "analysis-by-analysis keeps all 5 cases for 'a'")
  expect_equal(as.numeric(t_analysis$rows[[2]][[2]]), mean(d1), tolerance = 1e-6,
               "mean over all 5 cases")

  fx_listwise <- write_fixture(df, c(base_params, list(
    options = list(display = "statistics", stats = list(descriptives = TRUE), missing = "listwise")
  )))
  res_listwise <- run_analysis_script("explore.R", fx_listwise)
  t_listwise <- find_table(res_listwise, "output.explore.descTitle:a")
  expect_equal(as.numeric(t_listwise$rows[[1]][[2]]), 4, tolerance = 0,
               "listwise drops the case missing on 'b'")
  expect_equal(as.numeric(t_listwise$rows[[2]][[2]]), mean(d1[-3]), tolerance = 1e-6,
               "mean over the 4 complete cases")
})

test_that("explore: bootstrap table appears per dependent x group and brackets the mean", {
  # The Explore Bootstrap sub-dialog was wired in without a regression test.
  # Checks the WIRING, not sai_bootstrap's math (test-bootstrap.R owns that):
  # right statistic bootstrapped, one row per dependent x group, and the table
  # absent when the sub-dialog is off.
  set.seed(31)
  x <- c(rnorm(40, 100, 10), rnorm(40, 130, 10))
  g <- rep(c("A", "B"), each = 40)
  df <- data.frame(col_1 = x, col_2 = g, stringsAsFactors = FALSE)
  base <- list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factors = list("col_2"), factorNames = list(col_2 = "grp")
  )

  fx_off <- write_fixture(df, c(base, list(
    options = list(display = "statistics", stats = list(descriptives = TRUE))
  )))
  res_off <- run_analysis_script("explore.R", fx_off)
  expect_true(isTRUE(res_off$success), "off: success")
  has_boot_off <- any(vapply(res_off$tables,
    function(t) startsWith(t$titleKey, "output.bootstrap.meanTitle"), logical(1)))
  expect_true(!has_boot_off, "no bootstrap table when the sub-dialog is off")

  fx_on <- write_fixture(df, c(base, list(
    options = list(display = "statistics", stats = list(descriptives = TRUE),
                   bootstrap = list(enabled = TRUE, samples = 1000, seed = 11))
  )))
  res_on <- run_analysis_script("explore.R", fx_on)
  expect_true(isTRUE(res_on$success), "on: success")
  boot <- find_table(res_on, "output.bootstrap.meanTitle")

  # One row per group; the bootstrap estimate is the group's own sample mean.
  expect_equal(length(boot$rows), 2L, tolerance = 0, "one row per dependent x group")
  for (i in seq_len(2)) {
    lvl <- c("A", "B")[i]
    ref <- mean(x[g == lvl])
    expect_equal(cell_num(boot, i, 2), ref, tolerance = 1e-6,
                 paste("estimate is group", lvl, "'s mean"))
    lo <- cell_num(boot, i, 5); hi <- cell_num(boot, i, 6)
    expect_true(lo < ref && ref < hi, paste("group", lvl, "CI brackets the mean"))
  }
})
