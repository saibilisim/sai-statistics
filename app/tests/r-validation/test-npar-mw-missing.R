# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-mw-missing.R — regression for the "missing value where TRUE/FALSE
# needed" crash in npar-mann-whitney.R: a case with a non-missing test
# variable but a system-missing (NA) grouping variable used to poison the
# `keep` mask with NA (gall == g1 | gall == g2 on an NA gall is NA, not
# FALSE), which propagated through sum(g == g1) into an NA n1/n2 and blew up
# the `if (n1 < 1 || n2 < 1)` check. Fixed by excluding !is.na(gall)
# explicitly (same guard npar-kruskal-wallis.R already had for its factor).

test_that("Mann-Whitney tolerates a system-missing grouping variable without crashing", {
  set.seed(7)
  x <- c(rnorm(15, 50, 10), rnorm(15, 60, 10), rnorm(5, 55, 10))
  g <- c(rep("A", 15), rep("B", 15), rep(NA_character_, 5))
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B",
    options = list()
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success (must not crash on NA group rows)")

  ranks <- find_table(result, "output.npar.ranksTitle")
  # Rows: A, B, Total — the 5 NA-group cases must not be counted in either N.
  expect_equal(cell_num(ranks, 1, 3), 15, label = "N group A excludes NA-group cases")
  expect_equal(cell_num(ranks, 2, 3), 15, label = "N group B excludes NA-group cases")
  expect_equal(cell_num(ranks, 3, 3), 30, label = "Total N excludes NA-group cases")

  ts <- find_table(result, "output.npar.testStatsTitle")
  expect_true(is.finite(cell_num(ts, 1, 4)), "Z is finite, not NA")
})

test_that("Mann-Whitney tolerates a missing test-variable value on an otherwise-valid group row", {
  x <- c(1, 2, 3, NA, 5, 6, 7, 8, 9, 10)
  g <- c("A", "A", "A", "A", "A", "B", "B", "B", "B", "B")
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B",
    options = list()
  ))
  result <- run_analysis_script("npar-mann-whitney.R", fixture)
  expect_true(isTRUE(result$success), "result$success (pre-existing NA-in-test-variable path)")
  ranks <- find_table(result, "output.npar.ranksTitle")
  expect_equal(cell_num(ranks, 1, 3), 4, label = "N group A excludes its own NA case")
})
