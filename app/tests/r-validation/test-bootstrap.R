# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-bootstrap.R — validates the Bootstrapping module (BOOT1, see
# roadmap.md SE): sai_bootstrap()'s own contract (percentile/BCa CI,
# seed reproducibility, integer-weight case-replication, non-integer-weight
# rejection, disabled/omitted no-op) plus the honesty warning and the first
# wired procedure (ttest-onesample.R).

# ── sai_bootstrap() unit-level contract ─────────────────────────────────────
test_that("sai_bootstrap: disabled/omitted options return NULL (no-op)", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  df <- data.frame(x = rnorm(20))
  stat_fn <- function(data, indices) c(mean = mean(data$x[indices]))

  expect_true(is.null(sai_bootstrap(df, stat_fn, list(options = list()))), "no bootstrap key")
  expect_true(
    is.null(sai_bootstrap(df, stat_fn, list(options = list(bootstrap = list(enabled = FALSE))))),
    "enabled = FALSE"
  )
})

test_that("sai_bootstrap: seed reproducibility and estimate correctness", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  set.seed(1)
  x <- rnorm(60, mean = 5, sd = 1.5)
  df <- data.frame(x = x)
  stat_fn <- function(data, indices) c(mean = mean(data$x[indices]))
  opt <- list(options = list(bootstrap = list(
    enabled = TRUE, samples = 1500, seed = 99, ciLevel = 95, ciType = "percentile"
  )))

  out1 <- sai_bootstrap(df, stat_fn, opt)
  out2 <- sai_bootstrap(df, stat_fn, opt)
  expect_true(!is.null(out1), "first call returns a result")
  expect_equal(out1[[1]]$estimate, mean(x), tolerance = 1e-9, "estimate == sample mean")
  expect_equal(out1[[1]]$ci_lower, out2[[1]]$ci_lower, tolerance = 1e-9, "same seed -> same CI (repro)")
  expect_true(out1[[1]]$ci_lower < mean(x) && out1[[1]]$ci_upper > mean(x), "CI brackets the mean")
})

test_that("sai_bootstrap: BCa and percentile CIs both contain the true mean (large-sample sanity)", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  set.seed(7)
  x <- rnorm(200, mean = 50, sd = 10)
  df <- data.frame(x = x)
  stat_fn <- function(data, indices) c(mean = mean(data$x[indices]))

  for (type in c("percentile", "bca")) {
    opt <- list(options = list(bootstrap = list(
      enabled = TRUE, samples = 2000, seed = 42, ciLevel = 95, ciType = type
    )))
    out <- sai_bootstrap(df, stat_fn, opt)
    expect_true(!is.null(out), paste(type, "returns a result"))
    expect_true(out[[1]]$ci_lower < 50 && out[[1]]$ci_upper > 50, paste(type, "CI brackets true mean 50"))
  }
})

test_that("sai_bootstrap: integer weight == row-replication reference", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  set.seed(3)
  x <- rnorm(30, mean = 20, sd = 3)
  w <- sample(1:4, 30, replace = TRUE)
  df <- data.frame(x = x)
  stat_fn <- function(data, indices) c(mean = mean(data$x[indices]))
  opt <- list(options = list(bootstrap = list(
    enabled = TRUE, samples = 500, seed = 5, ciLevel = 95, ciType = "percentile"
  )))

  out <- sai_bootstrap(df, stat_fn, opt, weight = w)
  expanded_mean <- mean(rep(x, times = w))
  expect_equal(out[[1]]$estimate, expanded_mean, tolerance = 1e-9, "weighted estimate == row-expansion mean")
})

test_that("sai_bootstrap: non-integer weight is rejected (returns NULL)", {
  source(file.path(r_scripts_dir(), "_bootstrap.R"))
  df <- data.frame(x = rnorm(20))
  stat_fn <- function(data, indices) c(mean = mean(data$x[indices]))
  opt <- list(options = list(bootstrap = list(enabled = TRUE, samples = 500)))
  w <- runif(20, 1, 3) # fractional weights
  expect_true(is.null(sai_bootstrap(df, stat_fn, opt, weight = w)), "non-integer weight -> NULL")
})

# ── End-to-end: ttest-onesample.R ───────────────────────────────────────────
test_that("ttest-onesample: bootstrap table appears and brackets the sample mean", {
  set.seed(11)
  x <- rnorm(40, mean = 100, sd = 15)
  df <- data.frame(score = x)
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    testValue = 0,
    options = list(missing = "analysis", bootstrap = list(
      enabled = TRUE, samples = 1000, seed = 123, ciLevel = 95, ciType = "bca"
    ))
  ))
  result <- run_analysis_script("ttest-onesample.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  boot_table <- find_table(result, "output.bootstrap.meanTitle")
  expect_equal(cell_num(boot_table, 1, 2), mean(x), tolerance = 1e-4, "bootstrap estimate == sample mean")
  lo <- cell_num(boot_table, 1, 5)
  hi <- cell_num(boot_table, 1, 6)
  expect_true(lo < mean(x) && hi > mean(x), "bootstrap CI brackets the sample mean")
})

test_that("ttest-onesample: bootstrap omitted (disabled) produces no bootstrap table or warning", {
  set.seed(12)
  x <- rnorm(30, mean = 10, sd = 2)
  df <- data.frame(score = x)
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    testValue = 0,
    options = list(missing = "analysis")
  ))
  result <- run_analysis_script("ttest-onesample.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_boot_table <- any(vapply(result$tables, function(t) startsWith(t$titleKey, "output.bootstrap"), logical(1)))
  expect_true(!has_boot_table, "no bootstrap table when not requested")
  expect_true(length(result$warnings) == 0, "no warnings when bootstrap not requested")
})
