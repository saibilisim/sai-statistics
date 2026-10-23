# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-descriptives.R — validates the Skewness/Kurtosis Std. Error columns
# added in A4 (spss-parity-findings-2026-07-07): SPSS always pairs Skewness/
# Kurtosis with their Std. Error using
#   SE_skew = sqrt(6n(n-1) / ((n-2)(n+1)(n+3)))
#   SE_kurt = sqrt(4(n^2-1) * SE_skew^2 / ((n-3)(n+5)))
# Reference values are computed independently here, not by calling the
# script's own se_skewness()/se_kurtosis() helpers.

test_that("descriptives Skewness/Kurtosis Std. Error columns match the SPSS formula", {
  set.seed(7)
  x <- rgamma(40, shape = 2, rate = 1)  # skewed distribution — non-trivial skew/kurtosis
  df <- data.frame(col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    options = list(skewness = TRUE, kurtosis = TRUE)
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  n <- length(x)
  ref_se_skew <- sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
  ref_se_kurt <- sqrt(4 * (n^2 - 1) * ref_se_skew^2 / ((n - 3) * (n + 5)))

  tbl <- find_table(result, "output.descriptives.title")
  # Columns: Variable, N, Skewness, SE-Skewness, Kurtosis, SE-Kurtosis (mean/
  # sum/sd/etc. are all off in this fixture's options, so skewness is col 3).
  expect_equal(cell_num(tbl, 1, 4), ref_se_skew, tolerance = 1e-6, "SE of Skewness")
  expect_equal(cell_num(tbl, 1, 6), ref_se_kurt, tolerance = 1e-6, "SE of Kurtosis")
})

# A5: Frequencies previously had no Skewness/Kurtosis output at all.
test_that("frequencies Skewness/Kurtosis + Std. Error rows match the SPSS formula", {
  set.seed(7)
  x <- rgamma(40, shape = 2, rate = 1)
  df <- data.frame(col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    options = list(
      showTable = FALSE,
      statistics = list(skewness = TRUE, kurtosis = TRUE)
    )
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  n <- length(x)
  ref_se_skew <- sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
  ref_se_kurt <- sqrt(4 * (n^2 - 1) * ref_se_skew^2 / ((n - 3) * (n + 5)))

  # Statistic/Value rows — find by key rather than hardcoded index.
  stat_tbl <- NULL
  for (t in result$tables) {
    if (any(vapply(t$rows, function(r) identical(r[[1]], "output.stat.skewness"), logical(1)))) {
      stat_tbl <- t; break
    }
  }
  expect_true(!is.null(stat_tbl), "statistics table with skewness row found")

  row_value <- function(key) {
    for (r in stat_tbl$rows) if (identical(r[[1]], key)) return(as.numeric(r[[2]]))
    NA_real_
  }
  expect_equal(row_value("output.stat.seSkew"), ref_se_skew, tolerance = 1e-6, "Frequencies SE of Skewness")
  expect_equal(row_value("output.stat.seKurt"), ref_se_kurt, tolerance = 1e-6, "Frequencies SE of Kurtosis")
})

# ── Frequencies "Sum" statistic (2026-07-17) ────────────────────────────────
# The FrequenciesDialog UI checkbox for "Sum" (statistics.sum) already existed
# but frequencies.R never read stats_opts$sum — checking it silently did
# nothing. Fixed to call the existing wtd_sum() helper (already used by
# Weight Cases elsewhere); this test guards the fix.
test_that("frequencies Sum statistic matches sum()/weighted sum", {
  df <- data.frame(col_1 = c(10, 20, 30, NA, 40))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(showTable = FALSE, statistics = list(sum = TRUE))
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  stat_tbl <- NULL
  for (t in result$tables) {
    if (any(vapply(t$rows, function(r) identical(r[[1]], "output.stat.sum"), logical(1)))) {
      stat_tbl <- t; break
    }
  }
  expect_true(!is.null(stat_tbl), "statistics table with sum row found")
  row_value <- function(key) {
    for (r in stat_tbl$rows) if (identical(r[[1]], key)) return(as.numeric(r[[2]]))
    NA_real_
  }
  expect_equal(row_value("output.stat.sum"), 100, tolerance = 1e-9, "unweighted sum excludes NA")
})

test_that("frequencies Sum statistic respects Weight Cases", {
  df <- data.frame(col_1 = c(10, 20, 30, NA, 40), w = c(1, 2, 1, 1, 3))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(showTable = FALSE, statistics = list(sum = TRUE)),
    weightVariable = "w"
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  stat_tbl <- NULL
  for (t in result$tables) {
    if (any(vapply(t$rows, function(r) identical(r[[1]], "output.stat.sum"), logical(1)))) {
      stat_tbl <- t; break
    }
  }
  row_value <- function(key) {
    for (r in stat_tbl$rows) if (identical(r[[1]], key)) return(as.numeric(r[[2]]))
    NA_real_
  }
  expect_equal(row_value("output.stat.sum"), 200, tolerance = 1e-9,
               "weighted sum: 10*1+20*2+30*1+40*3 = 200 (NA row excluded)")
})
