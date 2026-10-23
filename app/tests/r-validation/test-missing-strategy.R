# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-missing-strategy.R — validates the Missing Values *strategy* option
# (MV, roadmap.md SC, eski MV2/MV5): SPSS's "Exclude cases analysis
# by analysis" (default) vs "Exclude cases listwise" radio, implemented via
# _bootstrap.R's apply_listwise() and wired into the Compare Means family
# (ttest-onesample.R, ttest-independent.R, ttest-paired.R, anova-oneway.R,
# means.R). Reference N's are computed by hand from the known NA pattern,
# matching test-missing-values.R's/test-weights.R's philosophy (never trust
# the script's own internals for the expected value).

# ── One-Sample T Test: analysis-by-analysis vs listwise N ──────────────────
test_that("ttest-onesample: listwise ties both variables to the same N", {
  df <- data.frame(
    x1 = c(10, 20, NA, 30, 40, 50),
    x2 = c(1, 2, 3, 4, NA, 6)
  )
  # analysis-by-analysis (default): each variable excludes only its own NA.
  fixture_a <- write_fixture(df, list(
    variables = list("x1", "x2"), varNames = list(x1 = "X1", x2 = "X2"),
    testValue = 0
  ))
  res_a <- run_analysis_script("ttest-onesample.R", fixture_a)
  expect_true(isTRUE(res_a$success), "analysis-by-analysis result$success")
  stats_a <- find_table(res_a, "output.ttest1.statsTitle")
  expect_equal(cell_num(stats_a, 1, 2), 5, label = "analysis: N(x1) = 5")
  expect_equal(cell_num(stats_a, 2, 2), 5, label = "analysis: N(x2) = 5")

  # listwise: a case missing on EITHER variable is dropped from BOTH.
  fixture_l <- write_fixture(df, list(
    variables = list("x1", "x2"), varNames = list(x1 = "X1", x2 = "X2"),
    testValue = 0, options = list(missing = "listwise")
  ))
  res_l <- run_analysis_script("ttest-onesample.R", fixture_l)
  expect_true(isTRUE(res_l$success), "listwise result$success")
  stats_l <- find_table(res_l, "output.ttest1.statsTitle")
  expect_equal(cell_num(stats_l, 1, 2), 4, label = "listwise: N(x1) = 4")
  expect_equal(cell_num(stats_l, 2, 2), 4, label = "listwise: N(x2) = 4")

  ref <- df$x1[c(1, 2, 4, 6)]
  expect_equal(cell_num(stats_l, 1, 3), mean(ref), tolerance = 1e-6, label = "listwise mean(x1)")
})

# ── One-Way ANOVA: listwise ties multiple dependents to the same N ─────────
test_that("anova-oneway: listwise ties dependents' N together across the factor", {
  df <- data.frame(
    g  = c("A", "A", "B", "B", "A", "B"),
    y1 = c(10, 20, NA, 30, 40, 50),
    y2 = c(1, 2, 3, NA, 5, 6)
  )
  fixture_a <- write_fixture(df, list(
    variables = list("y1", "y2"), varNames = list(y1 = "Y1", y2 = "Y2"),
    factor = "g", factorName = "G"
  ))
  res_a <- run_analysis_script("anova-oneway.R", fixture_a)
  expect_true(isTRUE(res_a$success), "analysis-by-analysis result$success")
  desc_y1_a <- find_table(res_a, "output.anova.descTitle:Y1")
  desc_y2_a <- find_table(res_a, "output.anova.descTitle:Y2")
  expect_equal(cell_num(desc_y1_a, 3, 2), 5, label = "analysis: total N(Y1) = 5")
  expect_equal(cell_num(desc_y2_a, 3, 2), 5, label = "analysis: total N(Y2) = 5")

  fixture_l <- write_fixture(df, list(
    variables = list("y1", "y2"), varNames = list(y1 = "Y1", y2 = "Y2"),
    factor = "g", factorName = "G", options = list(missing = "listwise")
  ))
  res_l <- run_analysis_script("anova-oneway.R", fixture_l)
  expect_true(isTRUE(res_l$success), "listwise result$success")
  desc_y1_l <- find_table(res_l, "output.anova.descTitle:Y1")
  desc_y2_l <- find_table(res_l, "output.anova.descTitle:Y2")
  expect_equal(cell_num(desc_y1_l, 3, 2), 4, label = "listwise: total N(Y1) = 4")
  expect_equal(cell_num(desc_y2_l, 3, 2), 4, label = "listwise: total N(Y2) = 4")
})

# ── Weighted + listwise combination ─────────────────────────────────────────
test_that("ttest-onesample: listwise + case weights compose correctly", {
  df <- data.frame(
    x1 = c(10, 20, NA, 30, 40, 50),
    x2 = c(1, 2, 3, 4, NA, 6),
    w  = c(2, 1, 3, 1, 2, 1)
  )
  fixture <- write_fixture(df, list(
    variables = list("x1", "x2"), varNames = list(x1 = "X1", x2 = "X2"),
    testValue = 0, weightVariable = "w", options = list(missing = "listwise")
  ))
  res <- run_analysis_script("ttest-onesample.R", fixture)
  expect_true(isTRUE(res$success), "result$success")
  expect_true(length(res$warnings) == 0, "no dishonesty warning expected")
  stats <- find_table(res, "output.ttest1.statsTitle")
  # listwise keeps rows 1,2,4,6 -> weighted N = w1+w2+w4+w6 = 2+1+1+1 = 5.
  expect_equal(cell_num(stats, 1, 2), 5, tolerance = 1e-6, label = "weighted+listwise N(x1)")
  expect_equal(cell_num(stats, 2, 2), 5, tolerance = 1e-6, label = "weighted+listwise N(x2)")
})

# ── Honesty: an analysis that doesn't support "listwise" warns, not silence ─
# correlation.R gained a real listwise branch in MV3 (2026-07-07, see
# test-missing-pairwise.R) — moved this honesty check to correlation-partial.R
# instead, which is still hardcoded listwise (unconditional complete.cases(),
# not opt-in via options$missing) and so never calls apply_listwise().
test_that("correlation-partial.R: requesting listwise on an unsupported script warns honestly", {
  df <- data.frame(
    a = c(1, 2, 3, 4, 5, 6), b = c(2, 4, 5, 4, 6, 7), c = c(1, 1, 2, 3, 3, 4)
  )
  fixture <- write_fixture(df, list(
    variables = list("a", "b"), varNames = list(a = "A", b = "B"),
    controls = list("c"), controlNames = list(c = "C"),
    options = list(missing = "listwise")
  ))
  res <- run_analysis_script("correlation-partial.R", fixture)
  expect_true(isTRUE(res$success), "result$success")
  expect_true(
    "output.warn.missingOptionNotApplied" %in% unlist(res$warnings),
    "missingOptionNotApplied warning present"
  )
})

# ── Nonparametric legacy tests (2026-07-17) ─────────────────────────────────
# Same "test by test" (default) vs "listwise" distinction as the parametric
# family above, now wired for Kruskal-Wallis/Mann-Whitney/Wilcoxon. Friedman
# is intentionally NOT wired — it already requires a complete row across all
# K related variables to rank within a case (stats::complete.cases() in
# npar-friedman.R already IS listwise; there's no meaningful "test by test"
# alternative for a repeated-measures rank test).
test_that("npar-kruskal-wallis: listwise ties test variables' N together across the factor", {
  df <- data.frame(
    g  = c("A", "A", "B", "B", "A", "B"),
    y1 = c(10, 20, NA, 30, 40, 50),
    y2 = c(1, 2, 3, NA, 5, 6)
  )
  fixture_a <- write_fixture(df, list(
    variables = list("y1", "y2"), varNames = list(y1 = "Y1", y2 = "Y2"),
    factor = "g", factorName = "G"
  ))
  res_a <- run_analysis_script("npar-kruskal-wallis.R", fixture_a)
  expect_true(isTRUE(res_a$success), "analysis-by-analysis result$success")
  ts_a <- find_table(res_a, "output.npar.testStatsTitle")
  # Test Statistics rows: Y1 then Y2. H uses N implicitly via ranks — check
  # the Ranks table's Total N per variable instead (unambiguous N readout).
  ranks_a <- find_table(res_a, "output.npar.ranksTitle")
  # Rows: Y1(A),Y1(B),Y1(Total),Y2(A),Y2(B),Y2(Total)
  expect_equal(cell_num(ranks_a, 3, 3), 5, label = "analysis: total N(Y1) = 5")
  expect_equal(cell_num(ranks_a, 6, 3), 5, label = "analysis: total N(Y2) = 5")

  fixture_l <- write_fixture(df, list(
    variables = list("y1", "y2"), varNames = list(y1 = "Y1", y2 = "Y2"),
    factor = "g", factorName = "G", options = list(missing = "listwise")
  ))
  res_l <- run_analysis_script("npar-kruskal-wallis.R", fixture_l)
  expect_true(isTRUE(res_l$success), "listwise result$success")
  ranks_l <- find_table(res_l, "output.npar.ranksTitle")
  expect_equal(cell_num(ranks_l, 3, 3), 4, label = "listwise: total N(Y1) = 4")
  expect_equal(cell_num(ranks_l, 6, 3), 4, label = "listwise: total N(Y2) = 4")
})

test_that("npar-mann-whitney: listwise ties test variables' N together across the group", {
  df <- data.frame(
    g  = c("A", "A", "B", "B", "A", "B"),
    y1 = c(10, 20, NA, 30, 40, 50),
    y2 = c(1, 2, 3, NA, 5, 6)
  )
  fixture_a <- write_fixture(df, list(
    variables = list("y1", "y2"), varNames = list(y1 = "Y1", y2 = "Y2"),
    groupVar = "g", groupName = "G", group1 = "A", group2 = "B"
  ))
  res_a <- run_analysis_script("npar-mann-whitney.R", fixture_a)
  expect_true(isTRUE(res_a$success), "analysis-by-analysis result$success")
  ranks_a <- find_table(res_a, "output.npar.ranksTitle")
  # Rows: Y1(A),Y1(B),Y1(Total),Y2(A),Y2(B),Y2(Total) — same row shape as K-W.
  expect_equal(cell_num(ranks_a, 3, 3), 5, label = "analysis: total N(Y1) = 5")
  expect_equal(cell_num(ranks_a, 6, 3), 5, label = "analysis: total N(Y2) = 5")

  fixture_l <- write_fixture(df, list(
    variables = list("y1", "y2"), varNames = list(y1 = "Y1", y2 = "Y2"),
    groupVar = "g", groupName = "G", group1 = "A", group2 = "B",
    options = list(missing = "listwise")
  ))
  res_l <- run_analysis_script("npar-mann-whitney.R", fixture_l)
  expect_true(isTRUE(res_l$success), "listwise result$success")
  ranks_l <- find_table(res_l, "output.npar.ranksTitle")
  expect_equal(cell_num(ranks_l, 3, 3), 4, label = "listwise: total N(Y1) = 4")
  expect_equal(cell_num(ranks_l, 6, 3), 4, label = "listwise: total N(Y2) = 4")
})

test_that("npar-wilcoxon: listwise ties all pairs' variables together (union of var1/var2)", {
  # Pair 1: (a,b). Pair 2: (c,d). c has one missing value on a row where a/b/d
  # are all present — analysis mode leaves pair 1 untouched (a/b don't
  # reference c); listwise mode also drops that row from pair 1.
  df <- data.frame(
    a = c(1, 2, 3, 4, 5),
    b = c(2, 3, 5, 6, 8),
    c = c(1, NA, 3, 4, 5),
    d = c(2, 4, 5, 7, 9)
  )
  fixture_a <- write_fixture(df, list(
    var1 = list("a", "c"), var2 = list("b", "d"),
    varNames = list(a = "A", b = "B", c = "C", d = "D")
  ))
  res_a <- run_analysis_script("npar-wilcoxon.R", fixture_a)
  expect_true(isTRUE(res_a$success), "analysis-by-analysis result$success")
  ranks_a <- find_table(res_a, "output.npar.ranksTitle")
  # Rows per pair: NegRanks, PosRanks, Ties, Total — pair 1 (B-A) first.
  expect_equal(cell_num(ranks_a, 4, 3), 5, label = "analysis: pair 1 (B-A) total N = 5")

  fixture_l <- write_fixture(df, list(
    var1 = list("a", "c"), var2 = list("b", "d"),
    varNames = list(a = "A", b = "B", c = "C", d = "D"),
    options = list(missing = "listwise")
  ))
  res_l <- run_analysis_script("npar-wilcoxon.R", fixture_l)
  expect_true(isTRUE(res_l$success), "listwise result$success")
  ranks_l <- find_table(res_l, "output.npar.ranksTitle")
  expect_equal(cell_num(ranks_l, 4, 3), 4,
               label = "listwise: pair 1 (B-A) total N drops to 4 (c's NA row excluded)")
})
