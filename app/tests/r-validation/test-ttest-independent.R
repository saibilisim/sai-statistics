# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-ttest-independent.R — validates r-scripts/ttest-independent.R against
# R's own trusted t.test() (independent implementation of the same math).

test_that("independent t-test matches t.test() reference (equal variances)", {
  set.seed(42)
  df <- data.frame(
    col_1 = c(2.1, 3.4, 2.8, 3.9, 4.2, 3.1, 2.5, 3.3, 5.1, 4.8, 5.5, 6.0, 4.9, 5.2, 5.8, 6.3),
    col_2 = c(rep("A", 8), rep("B", 8))
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    groupVar = "col_2",
    groupName = "group",
    group1 = "A",
    group2 = "B"
  ))
  result <- run_analysis_script("ttest-independent.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- t.test(df$col_1[df$col_2 == "A"], df$col_1[df$col_2 == "B"], var.equal = TRUE)
  ref_welch <- t.test(df$col_1[df$col_2 == "A"], df$col_1[df$col_2 == "B"], var.equal = FALSE)

  test_table <- find_table(result, "output.ttestInd.testTitle")
  # row 1 = equal-variance assumed: variable, label, leveneF, leveneSig, t, df, sig2tail, meanDiff, seDiff, ciLo, ciHi
  expect_equal(cell_num(test_table, 1, 5), unname(ref$statistic), tolerance = 1e-4, "t (equal var)")
  expect_equal(cell_num(test_table, 1, 6), unname(ref$parameter), tolerance = 1e-4, "df (equal var)")
  expect_equal(cell_num(test_table, 1, 7), ref$p.value, tolerance = 1e-3, "p (equal var)")
  expect_equal(cell_num(test_table, 1, 8), unname(ref$estimate[1] - ref$estimate[2]), tolerance = 1e-4, "mean diff")

  # row 2 = Welch (unequal variances)
  expect_equal(cell_num(test_table, 2, 5), unname(ref_welch$statistic), tolerance = 1e-4, "t (Welch)")
  expect_equal(cell_num(test_table, 2, 6), unname(ref_welch$parameter), tolerance = 1e-2, "df (Welch)")
  expect_equal(cell_num(test_table, 2, 7), ref_welch$p.value, tolerance = 1e-3, "p (Welch)")

  group_table <- find_table(result, "output.ttestInd.groupStatsTitle")
  expect_equal(cell_num(group_table, 1, 4), mean(df$col_1[df$col_2 == "A"]), tolerance = 1e-6, "group A mean")
  expect_equal(cell_num(group_table, 2, 4), mean(df$col_1[df$col_2 == "B"]), tolerance = 1e-6, "group B mean")
  expect_equal(cell_num(group_table, 1, 5), sd(df$col_1[df$col_2 == "A"]), tolerance = 1e-6, "group A sd")
})

test_that("independent t-test: no significant difference when groups are equal", {
  set.seed(7)
  x <- rnorm(30, mean = 10, sd = 2)
  df <- data.frame(col_1 = x, col_2 = rep(c("A", "B"), 15))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "x"),
    groupVar = "col_2", groupName = "group", group1 = "A", group2 = "B"
  ))
  result <- run_analysis_script("ttest-independent.R", fixture)
  ref <- t.test(df$col_1[df$col_2 == "A"], df$col_1[df$col_2 == "B"], var.equal = TRUE)
  test_table <- find_table(result, "output.ttestInd.testTitle")
  expect_equal(cell_num(test_table, 1, 7), ref$p.value, tolerance = 1e-3, "p-value sanity (random, non-sig expected)")
})
