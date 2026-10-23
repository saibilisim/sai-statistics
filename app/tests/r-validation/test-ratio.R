# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-ratio.R — validates ratio.R's SPSS-style Ratio Statistics (Median,
# Mean, Weighted Mean, Min/Max/Range, COD, PRD, COV) against an
# independently-written reference computed directly from the documented
# formulas (COD = mean|r-median|/median, a proportion as SPSS prints it;
# PRD = mean/weighted-mean;
# COV = 100*sd(r)/mean), both overall and per group.

ref_ratio_stats <- function(num, den) {
  ok <- is.finite(num) & is.finite(den) & den != 0
  r <- num[ok] / den[ok]
  md <- median(r); mn <- mean(r); wmean <- sum(num[ok]) / sum(den[ok])
  list(n = length(r), median = md, mean = mn, wmean = wmean,
       min = min(r), max = max(r), range = max(r) - min(r),
       cod = mean(abs(r - md)) / md, prd = mn / wmean, cov = 100 * sd(r) / mn)
}

test_that("ratio: overall statistics match an independent reference implementation", {
  set.seed(61)
  num <- round(runif(40, 80, 200), 1)
  den <- round(runif(40, 100, 150), 1)
  df <- data.frame(col_num = num, col_den = den)

  fixture <- write_fixture(df, list(
    numerator = "col_num", denominator = "col_den",
    varNames = list(col_num = "Assessed", col_den = "Sale")
  ))
  result <- run_analysis_script("ratio.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- ref_ratio_stats(num, den)
  tbl <- find_table(result, "output.ratio.title")
  # Single overall row (no group specified).
  expect_equal(cell_num(tbl, 1, 2), ref$n, tolerance = 1e-9, "N")
  expect_equal(cell_num(tbl, 1, 3), ref$median, tolerance = 1e-3, "Median")
  expect_equal(cell_num(tbl, 1, 4), ref$mean, tolerance = 1e-3, "Mean")
  expect_equal(cell_num(tbl, 1, 5), ref$wmean, tolerance = 1e-3, "Weighted Mean")
  expect_equal(cell_num(tbl, 1, 6), ref$min, tolerance = 1e-3, "Minimum")
  expect_equal(cell_num(tbl, 1, 7), ref$max, tolerance = 1e-3, "Maximum")
  expect_equal(cell_num(tbl, 1, 8), ref$range, tolerance = 1e-3, "Range")
  expect_equal(cell_num(tbl, 1, 9), ref$cod, tolerance = 1e-2, "COD")
  expect_equal(cell_num(tbl, 1, 10), ref$prd, tolerance = 1e-3, "PRD")
  expect_equal(cell_num(tbl, 1, 11), ref$cov, tolerance = 1e-2, "COV")
})

test_that("ratio: grouped statistics produce one row per group plus an Overall row", {
  set.seed(62)
  num <- c(round(runif(15, 80, 120), 1), round(runif(10, 150, 220), 1))
  den <- c(round(runif(15, 90, 110), 1), round(runif(10, 130, 180), 1))
  grp <- c(rep("A", 15), rep("B", 10))
  df <- data.frame(col_num = num, col_den = den, col_grp = grp)

  fixture <- write_fixture(df, list(
    numerator = "col_num", denominator = "col_den", group = "col_grp",
    varNames = list(col_num = "Assessed", col_den = "Sale")
  ))
  result <- run_analysis_script("ratio.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.ratio.title")
  expect_equal(length(tbl$rows), 3L, label = "2 groups + Overall row")

  refA <- ref_ratio_stats(num[grp == "A"], den[grp == "A"])
  refB <- ref_ratio_stats(num[grp == "B"], den[grp == "B"])
  refAll <- ref_ratio_stats(num, den)

  expect_equal(cell_num(tbl, 1, 2), refA$n, tolerance = 1e-9, "group A N")
  expect_equal(cell_num(tbl, 1, 4), refA$mean, tolerance = 1e-3, "group A mean")
  expect_equal(cell_num(tbl, 2, 2), refB$n, tolerance = 1e-9, "group B N")
  expect_equal(cell_num(tbl, 2, 4), refB$mean, tolerance = 1e-3, "group B mean")
  expect_equal(cell_num(tbl, 3, 2), refAll$n, tolerance = 1e-9, "Overall N")
  expect_equal(cell_num(tbl, 3, 4), refAll$mean, tolerance = 1e-3, "Overall mean")
})
