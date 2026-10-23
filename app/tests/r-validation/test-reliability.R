# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-reliability.R — validates reliability.R (previously untested, flagged
# by an earlier hand-computation audit) against psych::alpha() directly: Cronbach's
# alpha, corrected item-total correlation, alpha-if-item-deleted, and (new,
# 2026-07-07) the alpha Std. Error / 95% CI (Feldt et al.) sourced from
# psych::alpha() rather than a hand-derived formula.

test_that("reliability: alpha, item-total correlations, alpha-if-deleted all match psych::alpha()", {
  skip_needs <- !requireNamespace("psych", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: psych not installed)\n")
    return(invisible())
  }

  set.seed(11)
  n <- 100
  f <- rnorm(n)
  items <- sapply(1:5, function(i) f + rnorm(n, sd = 0.8))
  colnames(items) <- paste0("i", 1:5)
  df <- as.data.frame(items)
  names(df) <- paste0("col_", 1:5)

  fixture <- write_fixture(df, list(
    variables = as.list(names(df)),
    varNames = setNames(as.list(names(df)), names(df))
  ))
  result <- run_analysis_script("reliability.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  pa <- suppressWarnings(psych::alpha(items, warnings = FALSE))
  ref_alpha <- pa$total$raw_alpha

  stats_tbl <- find_table(result, "output.reliability.statsTitle")
  expect_equal(cell_num(stats_tbl, 1, 1), ref_alpha, tolerance = 1e-4, "Cronbach's alpha matches psych::alpha")
  # tolerance 5e-3 (not 1e-4): all.equal's default RELATIVE tolerance is too
  # tight for a small-magnitude value like ase (~0.02) combined with the
  # script's own 4-decimal rounding.
  expect_equal(cell_num(stats_tbl, 1, 3), pa$total$ase, tolerance = 5e-3, "alpha Std. Error matches psych::alpha")
  expect_equal(cell_num(stats_tbl, 1, 4), pa$feldt$lower.ci$raw_alpha, tolerance = 1e-3, "alpha CI lower matches Feldt")
  expect_equal(cell_num(stats_tbl, 1, 5), pa$feldt$upper.ci$raw_alpha, tolerance = 1e-3, "alpha CI upper matches Feldt")

  item_tbl <- find_table(result, "output.reliability.itemTotalTitle")
  for (i in 1:5) {
    item_name <- paste0("i", i)
    expect_equal(cell_num(item_tbl, i, 4), pa$item.stats[item_name, "r.drop"], tolerance = 1e-4,
                 sprintf("corrected item-total correlation for item %d matches r.drop", i))
    expect_equal(cell_num(item_tbl, i, 5), pa$alpha.drop[item_name, "raw_alpha"], tolerance = 1e-4,
                 sprintf("alpha-if-deleted for item %d matches psych::alpha", i))
  }
})

test_that("reliability: options$interItemCorr emits the correlation matrix, matching cor() directly", {
  set.seed(11)
  n <- 100
  f <- rnorm(n)
  items <- sapply(1:5, function(i) f + rnorm(n, sd = 0.8))
  colnames(items) <- paste0("i", 1:5)
  df <- as.data.frame(items)
  names(df) <- paste0("col_", 1:5)

  fixture <- write_fixture(df, list(
    variables = as.list(names(df)),
    varNames = setNames(as.list(names(df)), names(df)),
    options = list(interItemCorr = TRUE)
  ))
  result <- run_analysis_script("reliability.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref_R <- cor(items)
  corr_tbl <- find_table(result, "output.reliability.interItemCorrTitle")
  for (i in 1:5) for (j in 1:5) {
    expect_equal(cell_num(corr_tbl, i, j + 1), round(ref_R[i, j], 3), tolerance = 1e-6,
                 sprintf("corr[%d,%d]", i, j))
  }
})

test_that("reliability: no correlation matrix table when interItemCorr is off (default)", {
  set.seed(12)
  df <- data.frame(col_1 = rnorm(30), col_2 = rnorm(30), col_3 = rnorm(30))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c")
  ))
  result <- run_analysis_script("reliability.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_corr <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.reliability.interItemCorrTitle"), logical(1)))
  expect_true(!has_corr, "inter-item correlation matrix is opt-in only")
})
