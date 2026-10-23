# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-boot2-part2.R — validates the second BOOT2 wave (2026-07-07, follow-up
# to test-boot2-procedures.R): means.R, anova-oneway.R, correlation-partial.R.
# Each bootstrap estimate is checked against its analytic closed-form value.

test_that("means: bootstrap estimate equals each group's own sample mean", {
  set.seed(21)
  x <- c(rnorm(15, 10, 2), rnorm(15, 15, 2), rnorm(15, 20, 2))
  g <- rep(c("A", "B", "C"), each = 15)
  df <- data.frame(col_1 = x, col_2 = g)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    factor = "col_2", factorName = "grp",
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 10))
  ))
  result <- run_analysis_script("means.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  boot_tbl <- find_table(result, "output.bootstrap.meanTitle")
  expect_equal(length(boot_tbl$rows), 3L, label = "3 groups -> 3 bootstrap rows")
  ref_means <- c(A = mean(x[g == "A"]), B = mean(x[g == "B"]), C = mean(x[g == "C"]))
  for (i in 1:3) {
    lvl <- c("A", "B", "C")[i]
    expect_equal(cell_num(boot_tbl, i, 2), unname(ref_means[lvl]), tolerance = 1e-6,
                 sprintf("group %s bootstrap estimate == its own sample mean", lvl))
  }
})

test_that("anova-oneway: bootstrap estimate equals each group's own sample mean", {
  data(PlantGrowth)
  df <- data.frame(col_1 = PlantGrowth$weight, col_2 = as.character(PlantGrowth$group))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "weight"),
    factor = "col_2", factorName = "group",
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 11))
  ))
  result <- run_analysis_script("anova-oneway.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  boot_tbl <- find_table(result, "output.bootstrap.meanTitle")
  expect_equal(length(boot_tbl$rows), 3L, label = "3 groups (ctrl/trt1/trt2) -> 3 bootstrap rows")
  ctrl_mean <- mean(PlantGrowth$weight[PlantGrowth$group == "ctrl"])
  # Row order follows levels(g) = alphabetical: ctrl, trt1, trt2 -> row 1 = ctrl.
  expect_equal(cell_num(boot_tbl, 1, 2), ctrl_mean, tolerance = 1e-6,
               "ctrl group bootstrap estimate == its own sample mean")
})

test_that("correlation-partial: bootstrap estimate equals the partial correlation on the full sample", {
  set.seed(22)
  n <- 100
  z <- rnorm(n)
  x <- z * 0.6 + rnorm(n) * 0.8
  y <- z * 0.5 + rnorm(n) * 0.9
  df <- data.frame(col_x = x, col_y = y, col_z = z)

  fixture <- write_fixture(df, list(
    variables = list("col_x", "col_y"), controls = list("col_z"),
    varNames = list(col_x = "x", col_y = "y", col_z = "z"),
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 12))
  ))
  result <- run_analysis_script("correlation-partial.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Reference: partial correlation via residualization on the full sample.
  ref_rx <- residuals(lm(x ~ z)); ref_ry <- residuals(lm(y ~ z))
  ref_partial_r <- cor(ref_rx, ref_ry)

  boot_tbl <- find_table(result, "output.bootstrap.correlationTitle")
  expect_equal(length(boot_tbl$rows), 1L, label = "one pair (x,y) -> one bootstrap row")
  expect_equal(cell_num(boot_tbl, 1, 3), ref_partial_r, tolerance = 1e-4,
               "bootstrap estimate == full-sample partial correlation")
})
