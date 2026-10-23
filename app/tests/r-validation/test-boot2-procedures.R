# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-boot2-procedures.R — validates BOOT2 (spss-parity-findings-2026-07-07
# §B1): bootstrap wired into ttest-independent.R, ttest-paired.R,
# descriptives.R, correlation.R, regression-linear.R. sai_bootstrap()'s own
# math is already covered by test-bootstrap.R; this file checks each
# script's WIRING — right statistic bootstrapped, right table/columns, right
# honesty behavior (off by default, conflict with Split File).

test_that("ttest-independent: bootstrap table absent by default, present + correct when enabled", {
  set.seed(1)
  x <- c(rnorm(20, 10, 2), rnorm(20, 13, 2))
  g <- c(rep("A", 20), rep("B", 20))
  df <- data.frame(col_1 = x, col_2 = g)

  fixture_off <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B"
  ))
  res_off <- run_analysis_script("ttest-independent.R", fixture_off)
  expect_true(isTRUE(res_off$success), "off: success")
  has_boot_off <- any(vapply(res_off$tables, function(t)
    startsWith(t$titleKey, "output.bootstrap.diffTitle"), logical(1)))
  expect_true(!has_boot_off, "no bootstrap table when disabled")

  fixture_on <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", groupName = "grp", group1 = "A", group2 = "B",
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 5))
  ))
  res_on <- run_analysis_script("ttest-independent.R", fixture_on)
  expect_true(isTRUE(res_on$success), "on: success")
  boot_tbl <- find_table(res_on, "output.bootstrap.diffTitle")
  ref_diff <- mean(x[g == "A"]) - mean(x[g == "B"])
  expect_equal(cell_num(boot_tbl, 1, 2), ref_diff, tolerance = 1e-6, "bootstrap estimate == mean(A)-mean(B)")
})

test_that("ttest-paired: bootstrap estimate equals mean(post - pre)", {
  set.seed(2)
  n <- 30
  pre <- rnorm(n, 50, 5); post <- pre + rnorm(n, 3, 2)
  df <- data.frame(col_1 = pre, col_2 = post)

  fixture <- write_fixture(df, list(
    var1 = list("col_1"), var2 = list("col_2"),
    varNames = list(col_1 = "pre", col_2 = "post"),
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 6))
  ))
  result <- run_analysis_script("ttest-paired.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  boot_tbl <- find_table(result, "output.bootstrap.pairedDiffTitle")
  # Script computes d = var1 - var2 (pair label "pre - post"), matching SPSS's
  # Variable1-Variable2 convention.
  expect_equal(cell_num(boot_tbl, 1, 2), mean(pre - post), tolerance = 1e-6,
               "bootstrap estimate == mean(pre - post)")
})

test_that("descriptives: bootstrap estimate equals the sample mean, and is skipped honestly when Split File is active", {
  set.seed(3)
  x <- rnorm(50, 100, 15)
  df <- data.frame(col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    options = list(mean = TRUE, bootstrap = list(enabled = TRUE, samples = 1000, seed = 7))
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  boot_tbl <- find_table(result, "output.bootstrap.meanTitle")
  expect_equal(cell_num(boot_tbl, 1, 2), mean(x), tolerance = 1e-6, "bootstrap estimate == sample mean")

  # SPSS rule: bootstrap + Split File are mutually exclusive.
  df2 <- data.frame(col_1 = x, col_split = rep(c("g1", "g2"), 25))
  fixture_split <- write_fixture(df2, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    splitVariable = "col_split", splitVariableName = "grp",
    options = list(mean = TRUE, bootstrap = list(enabled = TRUE, samples = 1000, seed = 7))
  ))
  result_split <- run_analysis_script("descriptives.R", fixture_split)
  expect_true(isTRUE(result_split$success), "split: success")
  has_boot <- any(vapply(result_split$tables, function(t)
    startsWith(t$titleKey, "output.bootstrap.meanTitle"), logical(1)))
  expect_true(!has_boot, "no bootstrap table when Split File is active (SPSS mutual-exclusion rule)")
  expect_true("output.warn.bootstrapNotApplied" %in% unlist(result_split$warnings),
              "honest warning explains bootstrap was skipped")
})

test_that("correlation: bootstrap estimate equals cor() on the pair's complete cases", {
  set.seed(4)
  n <- 60
  x1 <- rnorm(n); x2 <- x1 * 0.6 + rnorm(n) * 0.8
  df <- data.frame(col_1 = x1, col_2 = x2)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"), varNames = list(col_1 = "a", col_2 = "b"),
    methods = list(pearson = TRUE),
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 8))
  ))
  result <- run_analysis_script("correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  boot_tbl <- find_table(result, "output.bootstrap.correlationTitle")
  expect_equal(cell_num(boot_tbl, 1, 4), cor(x1, x2), tolerance = 1e-6,
               "bootstrap estimate == cor(a, b)")
})

test_that("regression-linear: bootstrap estimates equal lm() coefficients on the full sample", {
  set.seed(5)
  n <- 80
  x1 <- rnorm(n); x2 <- rnorm(n)
  y <- 2 + 1.5 * x1 - 0.7 * x2 + rnorm(n)
  df <- data.frame(col_y = y, col_x1 = x1, col_x2 = x2)

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    independents = list("col_x1", "col_x2"),
    varNames = list(col_y = "y", col_x1 = "x1", col_x2 = "x2"),
    options = list(bootstrap = list(enabled = TRUE, samples = 1000, seed = 9))
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref_fit <- lm(y ~ x1 + x2)
  boot_tbl <- find_table(result, "output.bootstrap.coefficientsTitle")
  expect_equal(length(boot_tbl$rows), 3L, label = "3 rows: constant + 2 predictors")
  expect_equal(cell_num(boot_tbl, 1, 2), unname(coef(ref_fit)["(Intercept)"]), tolerance = 1e-6, "constant")
  expect_equal(cell_num(boot_tbl, 2, 2), unname(coef(ref_fit)["x1"]), tolerance = 1e-6, "x1 coefficient")
  expect_equal(cell_num(boot_tbl, 3, 2), unname(coef(ref_fit)["x2"]), tolerance = 1e-6, "x2 coefficient")
})
