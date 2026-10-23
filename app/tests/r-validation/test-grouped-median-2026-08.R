# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-grouped-median-2026-08.R — _bootstrap.R's grouped_median() against
# values produced by IBM SPSS Statistics 26 ITSELF.
#
# Provenance: SPSS was driven headlessly through its Production Facility
# (`stats.exe job.spj -production`) on a dataset whose tie structure was chosen
# specifically to separate the candidate definitions, with the variables
# formatted F14.6 so nothing was rounded away. The expectations below are the
# numbers SPSS returned, to eight significant figures.
#
# Why the shape of the data matters: the first four candidates tried were all
# "class width" formulas — GM = L + w(n/2 − F)/f — and none of them can work,
# which cases `a` and `e` prove. Both have the same median class (2), the same
# cumulative-below (3) and the same class frequency (3); they differ only in
# the frequency of the class ABOVE. A class-width formula cannot see that, yet
# SPSS returns 2.142857 for one and 2.166667 for the other.
#
# What SPSS actually computes: each distinct value plotted against its
# mid-cumulative proportion (cum_{i-1} + cum_i)/2n, read off at 0.5 by linear
# interpolation. See grouped_median()'s comment.
#
# Run via run-all.R (sets options(sai.rScriptsDir)).

.standalone <- !exists("test_that")
if (.standalone) source("_harness.R")

# grouped_median() lives in _bootstrap.R, which is sourced by every analysis
# script; source it directly rather than round-tripping through a script.
local({
  dir <- getOption("sai.rScriptsDir")
  if (is.null(dir)) dir <- file.path("..", "..", "r-scripts")
  source(file.path(dir, "_bootstrap.R"))
})

# ── 1. The controlled SPSS run ──────────────────────────────────────────────
test_that("grouped median: matches SPSS on the discriminating cases", {
  # a and e are the pair that rules out every class-width formula.
  expect_equal(grouped_median(c(1, 1, 1, 2, 2, 2, 3, 3, 3, 3)), 2.14285714, tolerance = 1e-7)
  expect_equal(grouped_median(c(1, 1, 1, 2, 2, 2, 3, 3, 3, 4)), 2.16666667, tolerance = 1e-7)

  # Same shape as `a`, values scaled x10: the answer scales with the data, so
  # the definition carries no absolute unit.
  expect_equal(grouped_median(c(10, 10, 10, 20, 20, 20, 30, 30, 30, 30)),
               21.42857143, tolerance = 1e-7)

  # Unequal spacing: the gap ABOVE the median value is what the interpolation
  # crosses, not the gap below and not any global width.
  expect_equal(grouped_median(c(1, 1, 1, 2, 2, 2, 4, 4, 4, 4)), 2.28571429, tolerance = 1e-7)
  expect_equal(grouped_median(c(1, 1, 1, 5, 5, 5, 9, 9, 9, 9)), 5.57142857, tolerance = 1e-7)
})

# ── 2. The Case Summaries fixture ───────────────────────────────────────────
# The synthetic 100-case fixture of test-case-summaries-spss-2026-08.R, with
# the Grouped Median SPSS printed for each block (case-summaries.sps, F14.6).
# Independent of the controlled run above: different n, four distinct values
# with uneven frequencies, and an all-distinct column.
test_that("grouped median: matches SPSS on the Case Summaries fixture", {
  path <- file.path(if (.standalone) "." else file.path(getwd(), "tests", "r-validation"),
                    "fixtures-spss-case-summaries-100.csv")
  d <- read.csv(path, stringsAsFactors = FALSE, encoding = "UTF-8")
  g1 <- d[d$cinsiyet == 1, ]
  g2 <- d[d$cinsiyet == 2, ]

  # The plain median is 2017 in every block; the grouped median is not, and
  # differs between blocks with the same median — the tie structure decides it.
  expect_equal(grouped_median(d$tani_yili), 2016.55769231, tolerance = 1e-7)
  expect_equal(grouped_median(g1$tani_yili), 2016.56521739, tolerance = 1e-7)
  expect_equal(grouped_median(g2$tani_yili), 2016.55172414, tolerance = 1e-7)

  # All-distinct columns degenerate to the plain median, which is what SPSS
  # returned for them.
  expect_equal(grouped_median(g1$kayit_no), 1609676)
  expect_equal(grouped_median(d$kayit_no), 1602159.5)
})

# ── 3. Degenerate inputs ────────────────────────────────────────────────────
test_that("grouped median: degenerate inputs behave", {
  expect_equal(grouped_median(c(5, 5, 5, 5)), 5)          # one distinct value
  expect_equal(grouped_median(c(7)), 7)                    # single case
  expect_true(is.na(grouped_median(numeric(0))))           # nothing to compute
  expect_equal(grouped_median(c(1, 2, NA, 3, NA)), stats::median(c(1, 2, 3)))

  # A value holding more than half the weight is the answer outright — the
  # interpolation has no bracket to work in.
  expect_equal(grouped_median(c(1, 2, 2, 2, 2, 2, 2, 3)), 2)

  # Every value distinct and n even -> exactly the ordinary median.
  x <- c(4, 1, 9, 2, 7, 3)
  expect_equal(grouped_median(x), stats::median(x))
})

# ── 4. Reachable through Case Summaries ─────────────────────────────────────
test_that("grouped median: the statistic is selectable and lands in the table", {
  df <- data.frame(score = c(1, 1, 1, 2, 2, 2, 3, 3, 3, 3), stringsAsFactors = FALSE)
  fx <- write_fixture(df, list(
    variables = c("score"),
    varNames = list(score = "Score"),
    options = list(stats = list(n = TRUE, median = TRUE, groupedMedian = TRUE))
  ))
  result <- run_analysis_script("case-summaries.R", fx)
  t <- find_table(result, "output.caseSummaries.summaryTitle")

  # Columns: group label, variable, then N / Median / Grouped Median in the
  # shared registry's (SPSS's) order.
  expect_equal(t$columns[[5]], "output.col.groupedMedian")
  expect_equal(cell_num(t, 1, 4), 2)                        # Median
  expect_equal(cell_num(t, 1, 5), 2.142857, tolerance = 1e-5)
})

if (.standalone) report()
