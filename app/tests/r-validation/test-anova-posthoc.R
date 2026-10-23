# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-anova-posthoc.R — validates the One-Way ANOVA post hoc tests added in
# roadmap.md Konu Yol Haritalari SB, eski PH1/PH2 (LSD, Sidak, Scheffe, Games-Howell,
# Tamhane's T2, on top of the pre-existing Tukey/Bonferroni) against R's own
# base-R oracles: stats::TukeyHSD (Tukey) and stats::pairwise.t.test with
# pool.sd = TRUE (LSD = no adjustment, Bonferroni = "bonferroni" adjustment) —
# same PlantGrowth dataset as test-anova-oneway.R, published F=4.846 baseline.
#
# Row layout: for k=3 groups, each enabled method contributes 6 rows in
# i != j order over levels("ctrl","trt1","trt2"): (ctrl,trt1) (ctrl,trt2)
# (trt1,ctrl) (trt1,trt2) (trt2,ctrl) (trt2,trt1) — so each method block's
# 3rd row is always "trt1 vs ctrl", used below to cross-check against the
# base-R oracles (which report trt1-ctrl directly).

test_that("anova-oneway post hoc: LSD/Bonferroni/Tukey match base-R oracles", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(
      lsd = TRUE, bonferroni = TRUE, sidak = TRUE, scheffe = TRUE,
      tukey = TRUE, gamesHowell = TRUE, tamhaneT2 = TRUE, sigLevel = "0.05"
    )
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  ph <- find_table(result, "output.anova.postHocTitle")
  expect_equal(length(ph$rows), 42L, label = "7 methods x 6 rows")

  # Method emission order in anova-oneway.R is: LSD, Sidak, Scheffe, Tukey,
  # Bonferroni, Games-Howell, Tamhane — 6 rows each (k=3), 3rd row = trt1-ctrl.
  # So trt1-ctrl lives at row 3 (LSD), 9 (Sidak), 15 (Scheffe), 21 (Tukey),
  # 27 (Bonferroni), 33 (Games-Howell), 39 (Tamhane).

  # Oracle 1: stats::TukeyHSD — base R, independent of our implementation.
  fit <- aov(weight ~ group, data = PlantGrowth)
  tk  <- TukeyHSD(fit)$group
  tukey_row <- ph$rows[[21]]  # Tukey block rows 19-24; 3rd row = trt1-ctrl
  expect_equal(tukey_row[[2]], "trt1", label = "tukey row21 groupI")
  expect_equal(tukey_row[[3]], "ctrl", label = "tukey row21 groupJ")
  expect_equal(cell_num(ph, 21, 4), tk["trt1-ctrl", "diff"], tolerance = 1e-6, label = "tukey diff")
  expect_equal(cell_num(ph, 21, 6), tk["trt1-ctrl", "p adj"], tolerance = 1e-4, label = "tukey sig")
  expect_equal(cell_num(ph, 21, 7), tk["trt1-ctrl", "lwr"], tolerance = 1e-4, label = "tukey CI lower")
  expect_equal(cell_num(ph, 21, 8), tk["trt1-ctrl", "upr"], tolerance = 1e-4, label = "tukey CI upper")

  # Oracle 2: stats::pairwise.t.test with pooled SD — base R.
  pw_none <- pairwise.t.test(PlantGrowth$weight, PlantGrowth$group,
                              p.adjust.method = "none", pool.sd = TRUE)
  pw_bonf <- pairwise.t.test(PlantGrowth$weight, PlantGrowth$group,
                              p.adjust.method = "bonferroni", pool.sd = TRUE)
  expect_equal(cell_num(ph, 3, 6), pw_none$p.value["trt1", "ctrl"], tolerance = 1e-4, label = "LSD sig")
  expect_equal(cell_num(ph, 27, 6), pw_bonf$p.value["trt1", "ctrl"], tolerance = 1e-4, label = "Bonferroni sig")

  # Sidak/Scheffe/Games-Howell/Tamhane T2: base R has no built-in oracle for
  # these, so assert structural sanity (valid probability, ordered CI) rather
  # than an exact external reference. Rows: Sidak 9, Scheffe 15, GH 33, Tamhane 39.
  for (row in c(9, 15, 33, 39)) {
    sig <- cell_num(ph, row, 6); lo <- cell_num(ph, row, 7); hi <- cell_num(ph, row, 8)
    expect_true(!is.na(sig) && sig >= 0 && sig <= 1, sprintf("row %d: sig in [0,1]", row))
    expect_true(!is.na(lo) && !is.na(hi) && lo <= hi, sprintf("row %d: CI lower <= upper", row))
  }
})

test_that("anova-oneway post hoc: significance level parameterizes the CI width", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))

  narrow <- run_analysis_script("anova-oneway.R", write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(tukey = TRUE, sigLevel = "0.10")
  )))
  wide <- run_analysis_script("anova-oneway.R", write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(tukey = TRUE, sigLevel = "0.01")
  )))
  ph_narrow <- find_table(narrow, "output.anova.postHocTitle")
  ph_wide   <- find_table(wide, "output.anova.postHocTitle")
  width_narrow <- cell_num(ph_narrow, 3, 8) - cell_num(ph_narrow, 3, 7)
  width_wide   <- cell_num(ph_wide, 3, 8) - cell_num(ph_wide, 3, 7)
  expect_true(width_wide > width_narrow, "alpha=0.01 CI is wider than alpha=0.10 CI")

  # 90% CI header should read "90", not the hardcoded default "95".
  expect_equal(ph_narrow$columns[[7]], "output.col.ciLowerPct:90", label = "90% CI column header")
})

# ── ANOVA Effect Sizes (PH6, 2026-07-17) ─────────────────────────────────────
# Oracle: hand-derivable from SSB/SSW/SST via aov()'s own decomposition — a
# clean 3-groups-of-3 toy dataset (1..9) gives exact values (SSB=54, SSW=6,
# SST=60, dfb=2, msw=1): eta2=54/60=0.9, epsilon2=(54-2)/60=0.8667,
# omega2=(54-2)/61=0.8525. Also checks the eta2 >= epsilon2 >= omega2
# ordering property that must hold whenever SSB > dfb*MSW.
test_that("anova-oneway effect sizes (eta2/epsilon2/omega2) match hand-derived SSB/SSW", {
  df <- data.frame(col_1 = c(1,2,3, 4,5,6, 7,8,9), col_2 = rep(c("A", "B", "C"), each = 3))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factor = "col_2", factorName = "group",
    options = list(effectSize = TRUE)
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  es_table <- find_table(result, "output.anova.effectSizeTitle")
  expect_equal(cell_num(es_table, 1, 2), 0.9, tolerance = 1e-6, "eta squared")
  expect_equal(cell_num(es_table, 2, 2), 52 / 60, tolerance = 1e-6, "epsilon squared")
  expect_equal(cell_num(es_table, 3, 2), 52 / 61, tolerance = 1e-6, "omega squared")

  eta2 <- cell_num(es_table, 1, 2)
  epsilon2 <- cell_num(es_table, 2, 2)
  omega2 <- cell_num(es_table, 3, 2)
  expect_true(eta2 >= epsilon2 && epsilon2 >= omega2, "eta2 >= epsilon2 >= omega2 ordering")
})

test_that("anova-oneway effect sizes: no table when effectSize option is off (default)", {
  df <- data.frame(col_1 = c(1,2,3, 4,5,6, 7,8,9), col_2 = rep(c("A", "B", "C"), each = 3))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factor = "col_2", factorName = "group"
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_es <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.anova.effectSizeTitle"), logical(1)))
  expect_true(!has_es, "effect size table is opt-in only")
})
