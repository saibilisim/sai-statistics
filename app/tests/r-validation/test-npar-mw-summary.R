# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-mw-summary.R — validates the optional blocks npar-mann-whitney.R
# prints next to the Ranks / Test Statistics tables: the per-group Descriptive
# Statistics table (min, quartiles, median, max, IQR), the Effect Size table
# (r = |Z|/sqrt(N), rank-biserial, Hodges-Lehmann median difference + CI) and
# the grouped box plot.
#
# Oracles are independent of the script's internals: base R's quantile(type=6)
# (SPSS's percentile definition, which wtd_quantile implements) for the
# summary, wilcox.test(conf.int=TRUE) for Hodges-Lehmann, and the effect-size
# identities computed by hand from the Test Statistics table's own Z and U.

.mw_fixture <- function(opts) {
  set.seed(11)
  x <- c(rnorm(16, 50, 10), rnorm(19, 62, 9))
  g <- c(rep("A", 16), rep("B", 19))
  list(
    x = x, g = g,
    fixture = write_fixture(data.frame(col_1 = x, col_2 = g), list(
      variables = list("col_1"), varNames = list(col_1 = "score"),
      groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B",
      options = opts
    ))
  )
}

test_that("Descriptive Statistics reports each group's five-number summary (SPSS type-6 percentiles)", {
  f <- .mw_fixture(list(descriptives = TRUE, quartiles = TRUE))
  result <- run_analysis_script("npar-mann-whitney.R", f$fixture)
  expect_true(isTRUE(result$success), "result$success")

  d <- find_table(result, "output.npar.descriptivesTitle")
  # Columns: variable(1) group(2) N(3) mean(4) sd(5) min(6) p25(7) median(8)
  #          p75(9) max(10) iqr(11). Rows: group A, group B, Total.
  expect_equal(length(d$columns), 11L, label = "column count")
  expect_equal(length(d$rows), 3L, label = "row count (A, B, Total)")

  for (i in 1:2) {
    xs <- f$x[f$g == c("A", "B")[i]]
    q <- unname(quantile(xs, c(0.25, 0.5, 0.75), type = 6))
    expect_equal(cell_num(d, i, 3), length(xs), label = "N")
    expect_equal(cell_num(d, i, 4), round(mean(xs), 3), tolerance = 1e-3, label = "mean")
    expect_equal(cell_num(d, i, 5), round(sd(xs), 3), tolerance = 1e-3, label = "sd")
    expect_equal(cell_num(d, i, 6), round(min(xs), 3), tolerance = 1e-3, label = "min")
    expect_equal(cell_num(d, i, 7), round(q[1], 3), tolerance = 1e-3, label = "P25")
    expect_equal(cell_num(d, i, 8), round(q[2], 3), tolerance = 1e-3, label = "median")
    expect_equal(cell_num(d, i, 9), round(q[3], 3), tolerance = 1e-3, label = "P75")
    expect_equal(cell_num(d, i, 10), round(max(xs), 3), tolerance = 1e-3, label = "max")
    expect_equal(cell_num(d, i, 11), round(q[3] - q[1], 3), tolerance = 1e-3, label = "IQR")
  }
  # The Total row is the pooled figure SPSS's own /STATISTICS would print.
  expect_equal(cell_num(d, 3, 3), length(f$x), label = "Total N")
  expect_equal(cell_num(d, 3, 8), round(unname(quantile(f$x, 0.5, type = 6)), 3),
               tolerance = 1e-3, label = "Total median")
})

test_that("Descriptives and Quartiles are independent: each drops only its own columns", {
  f <- .mw_fixture(list(quartiles = TRUE))
  result <- run_analysis_script("npar-mann-whitney.R", f$fixture)
  d <- find_table(result, "output.npar.descriptivesTitle")
  # variable, group, N, P25, median, P75, IQR — no mean/sd/min/max.
  expect_equal(length(d$columns), 7L, label = "quartiles-only column count")
  expect_true(!("output.col.mean" %in% unlist(d$columns)), "mean column absent")
  expect_equal(cell_num(d, 1, 5),
               round(unname(quantile(f$x[f$g == "A"], 0.5, type = 6)), 3),
               tolerance = 1e-3, label = "median still in its own column")

  f2 <- .mw_fixture(list(descriptives = TRUE))
  d2 <- find_table(run_analysis_script("npar-mann-whitney.R", f2$fixture),
                   "output.npar.descriptivesTitle")
  # variable, group, N, mean, sd, min, max — no percentile columns.
  expect_equal(length(d2$columns), 7L, label = "descriptives-only column count")
  expect_true(!("output.col.p25" %in% unlist(d2$columns)), "P25 column absent")
})

test_that("Effect Size matches |Z|/sqrt(N), the rank-biserial identity and wilcox.test's Hodges-Lehmann CI", {
  f <- .mw_fixture(list(effectSize = TRUE))
  result <- run_analysis_script("npar-mann-whitney.R", f$fixture)
  expect_true(isTRUE(result$success), "result$success")

  ts <- find_table(result, "output.npar.testStatsTitle")
  e  <- find_table(result, "output.npar.effectSizeTitle")
  z  <- cell_num(ts, 1, 4)
  u  <- cell_num(ts, 1, 2)   # U = min(U1, U2)
  n1 <- 16; n2 <- 19

  expect_equal(cell_num(e, 1, 2), round(abs(z) / sqrt(n1 + n2), 3),
               tolerance = 1e-3, label = "r = |Z|/sqrt(N)")
  # Group A ranks below group B here, so U1 (= pairs where A > B) is the
  # smaller of the two and the rank-biserial correlation is negative.
  expect_equal(cell_num(e, 1, 3), round(2 * u / (n1 * n2) - 1, 3),
               tolerance = 1e-3, label = "rank-biserial r")
  expect_lt(cell_num(e, 1, 3), 0, label = "rank-biserial sign (A below B)")

  w <- suppressWarnings(wilcox.test(f$x[f$g == "A"], f$x[f$g == "B"], conf.int = TRUE))
  expect_equal(cell_num(e, 1, 4), round(unname(w$estimate), 3), tolerance = 1e-3,
               label = "Hodges-Lehmann estimate")
  expect_equal(cell_num(e, 1, 5), round(w$conf.int[1], 3), tolerance = 1e-3, label = "CI lower")
  expect_equal(cell_num(e, 1, 6), round(w$conf.int[2], 3), tolerance = 1e-3, label = "CI upper")
})

test_that("Box plot ships precomputed quartiles and Tukey fences, not the raw data vector", {
  f <- .mw_fixture(list(boxplot = TRUE))
  result <- run_analysis_script("npar-mann-whitney.R", f$fixture)
  expect_equal(length(result$plots), 1L, label = "one plot per test variable")

  traces <- result$plots[[1]]$data$data
  expect_equal(length(traces), 2L, label = "one box per group")
  xs <- f$x[f$g == "A"]
  q  <- unname(quantile(xs, c(0.25, 0.5, 0.75), type = 6))
  expect_equal(as.numeric(traces[[1]]$q1[[1]]), q[1], tolerance = 1e-6, label = "trace Q1")
  expect_equal(as.numeric(traces[[1]]$median[[1]]), q[2], tolerance = 1e-6, label = "trace median")
  expect_equal(as.numeric(traces[[1]]$q3[[1]]), q[3], tolerance = 1e-6, label = "trace Q3")
  # Whiskers stop at the last observation inside 1.5 x IQR (no outlier here).
  expect_equal(as.numeric(traces[[1]]$lowerfence[[1]]), min(xs), tolerance = 1e-6,
               label = "lower fence")
  expect_equal(as.numeric(traces[[1]]$upperfence[[1]]), max(xs), tolerance = 1e-6,
               label = "upper fence")
  # The raw vector must NOT be in the payload (a 100k-case run would otherwise
  # embed every point in the output document).
  expect_true(is.null(traces[[1]]$y), "no raw y vector in the box trace")
  # Each box needs its own x category — without it Plotly's default overlay
  # boxmode draws both groups on top of each other at position 0.
  expect_true(identical(traces[[1]]$x[[1]], "A"), "group A box has its own x category")
  expect_true(identical(traces[[2]]$x[[1]], "B"), "group B box has its own x category")
})

test_that("All optional blocks stay off unless asked for (SPSS's own default)", {
  f <- .mw_fixture(list())
  result <- run_analysis_script("npar-mann-whitney.R", f$fixture)
  titles <- vapply(result$tables, function(t) t$titleKey, "")
  expect_equal(length(titles), 2L, label = "only Ranks + Test Statistics")
  expect_equal(length(result$plots), 0L, label = "no plots")
})
