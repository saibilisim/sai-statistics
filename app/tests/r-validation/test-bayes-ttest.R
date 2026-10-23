# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-bayes-ttest.R — validates r-scripts/bayes-ttest-onesample.R,
# bayes-ttest-independent.R and bayes-ttest-paired.R against references
# computed independently here with BayesFactor::ttestBF (the production
# scripts' own internals are NOT reused: the one-sample reference uses
# ttestBF's `mu` argument instead of the script's manual shift, and the
# paired reference uses `paired = TRUE`).
#
# BF10/error% are deterministic in BayesFactor (Laplace approximation), so
# they are compared tightly (script rounds to 4 decimals -> tolerance 1e-3).
# Posterior summaries come from MCMC (10000 iterations); the script seeds it
# (sai_bayes_seed, default 2000000) but this reference draws its own stream, so
# they are compared loosely (tolerance 0.1). Reproducibility of the script
# itself is pinned by the last test below.

# BayesFactor lives in ~/R/library, which run_analysis_script exposes to the
# spawned script via R_LIBS; make it visible to this reference session too.
.libPaths(c(file.path(path.expand("~"), "R", "library", paste(R.version$major, strsplit(R.version$minor, ".", fixed = TRUE)[[1]][1], sep = ".")), .libPaths()))
# BayesFactor is an OPTIONAL package (shared/r-packages.json), absent on a
# stock install. Guarded like test-anova-dunnett.R guards mvtnorm/multcomp,
# so its absence reads as a skip rather than a load failure.
if (!requireNamespace("BayesFactor", quietly = TRUE)) {
  cat("  (skipped: BayesFactor not installed)\n")
} else {

suppressPackageStartupMessages(library(BayesFactor))

# ── One-sample ──────────────────────────────────────────────────────────────

test_that("bayes one-sample: BF table matches ttestBF reference (mu = 0)", {
  set.seed(42)
  v <- rnorm(40, mean = 1.0, sd = 1.0)
  df <- data.frame(col_1 = v)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    testValue = 0, rscale = "medium"
  ))
  result <- run_analysis_script("bayes-ttest-onesample.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Independent reference: ttestBF's own mu argument (script shifts x instead).
  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = v, mu = 0, rscale = "medium"))

  bf_table <- find_table(result, "output.bayes.bfTitle")
  # row: variable, BF10, BF01, error%
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(cell_num(bf_table, 1, 3), 1 / eb$bf[1], tolerance = 1e-3, "BF01")
  expect_equal(cell_num(bf_table, 1, 4), 100 * eb$error[1], tolerance = 1e-3, "error %")
  # The footnote must name the NUMBER, not only the setting: "medium" means
  # 0.707 for a t test and 0.354 for a regression coefficient, so the word on
  # its own does not tell a reader what produced the Bayes factor.
  expect_equal(bf_table$footnoteKey,
               "output.bayes.priorFootnote:output.bayes.scaleMedium|0.7071",
               label = "prior footnote carries the t-test medium width")

  # Posterior: unseeded MCMC on both sides -> loose comparison only.
  set.seed(1)
  ref_delta <- as.numeric(BayesFactor::posterior(
    BayesFactor::ttestBF(x = v, mu = 0, rscale = "medium"),
    iterations = 10000, progress = FALSE)[, "delta"])
  post_table <- find_table(result, "output.bayes.postTitle")
  # row: variable, mean, sd, ciLo95, ciHi95
  expect_equal(cell_num(post_table, 1, 2), mean(ref_delta), tolerance = 0.1, "posterior mean")
  expect_equal(cell_num(post_table, 1, 3), sd(ref_delta), tolerance = 0.1, "posterior sd")
  expect_equal(cell_num(post_table, 1, 4), unname(quantile(ref_delta, 0.025)), tolerance = 0.1, "ci lower")
  expect_equal(cell_num(post_table, 1, 5), unname(quantile(ref_delta, 0.975)), tolerance = 0.1, "ci upper")
  # strong positive effect: credible interval must sit above 0
  expect_true(cell_num(post_table, 1, 4) > 0, "ci lower > 0 for strong effect")
  expect_true(length(result$plots) >= 1, "posterior density plot emitted")
})

test_that("bayes one-sample: nonzero testValue + wide prior, two variables", {
  set.seed(7)
  v1 <- rnorm(30, mean = 5.8, sd = 1.5)
  v2 <- rnorm(30, mean = 4.2, sd = 1.5)
  df <- data.frame(col_1 = v1, col_2 = v2)
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "pre", col_2 = "post"),
    testValue = 5, rscale = "wide"
  ))
  result <- run_analysis_script("bayes-ttest-onesample.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  bf_table <- find_table(result, "output.bayes.bfTitle")
  refs <- lapply(list(v1, v2), function(v)
    BayesFactor::extractBF(BayesFactor::ttestBF(x = v, mu = 5, rscale = "wide")))
  for (i in 1:2) {
    expect_equal(cell_num(bf_table, i, 2), refs[[i]]$bf[1], tolerance = 1e-3,
                 sprintf("BF10 var %d", i))
    expect_equal(cell_num(bf_table, i, 4), 100 * refs[[i]]$error[1], tolerance = 1e-3,
                 sprintf("error %% var %d", i))
  }
  # BF is invariant to shifting by mu: BF(v vs 5) == BF(v - 5 vs 0)
  expect_equal(refs[[1]]$bf[1],
               BayesFactor::extractBF(BayesFactor::ttestBF(x = v1 - 5, rscale = "wide"))$bf[1],
               tolerance = 1e-6, "reference sanity: mu shift invariance")
})

test_that("bayes one-sample: null data favors H0 (BF10 < 1)", {
  set.seed(99)
  v <- rnorm(30, mean = 0, sd = 1)
  df <- data.frame(col_1 = v)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "x"), testValue = 0
  ))
  result <- run_analysis_script("bayes-ttest-onesample.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = v, mu = 0))
  expect_lt(eb$bf[1], 1, "reference BF10 < 1 (fixture check)")
  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10")
  expect_lt(cell_num(bf_table, 1, 2), 1, "script BF10 < 1")
})

# ── Independent samples ─────────────────────────────────────────────────────

test_that("bayes independent: missing group values and Inf are dropped, not passed to ttestBF", {
  # Regression 2026-10-12: a case with a missing GROUP value made the group
  # match NA, the NA landed in x/y, and ttestBF stopped with "x or y must not
  # contain missing or infinite values". The result must equal the test on
  # the clean cases only.
  set.seed(31)
  x <- rnorm(20, mean = 0); y <- rnorm(20, mean = 1)
  df <- data.frame(
    col_1 = c(x, y, 5, 7, Inf, NA),
    col_2 = c(rep("A", 20), rep("B", 20), NA, NA, "A", "B"),
    stringsAsFactors = FALSE)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", group1 = "A", group2 = "B", rscale = "medium"
  ))
  result <- run_analysis_script("bayes-ttest-independent.R", fixture)
  expect_true(isTRUE(result$success), "success despite missing group / Inf")
  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = x, y = y, rscale = "medium"))
  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10 on clean cases")
})

test_that("bayes independent: BF + posterior match ttestBF reference", {
  set.seed(13)
  x <- rnorm(25, mean = 0, sd = 1)
  y <- rnorm(25, mean = 1.3, sd = 1)
  df <- data.frame(col_1 = c(x, y), col_2 = c(rep("A", 25), rep("B", 25)))
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    groupVar = "col_2", group1 = "A", group2 = "B", rscale = "medium"
  ))
  result <- run_analysis_script("bayes-ttest-independent.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = x, y = y, rscale = "medium"))
  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(cell_num(bf_table, 1, 3), 1 / eb$bf[1], tolerance = 1e-3, "BF01")
  expect_equal(cell_num(bf_table, 1, 4), 100 * eb$error[1], tolerance = 1e-3, "error %")

  set.seed(2)
  ref_delta <- as.numeric(BayesFactor::posterior(
    BayesFactor::ttestBF(x = x, y = y, rscale = "medium"),
    iterations = 10000, progress = FALSE)[, "delta"])
  post_table <- find_table(result, "output.bayes.postTitle")
  # ABSOLUTE tolerance, not expect_equal's relative one.
  #
  # Both sides are 10 000-draw MCMC and the script's chain runs in its own R
  # process, so it cannot be seeded from here: the two differ by Monte Carlo
  # error on every run. A relative tolerance turns that into an arbitrary test —
  # the 97.5% bound of delta sits near -0.17, so a 0.02 wobble is 12% and fails,
  # while the same 0.02 on the posterior sd passes comfortably. Strictness that
  # depends on how close a quantity happens to be to zero measures nothing.
  # 0.05 absolute is several times the MC error here and still far below any
  # real implementation difference.
  close_to <- function(actual, expected, label, tol = 0.05) {
    expect_true(is.finite(actual) && abs(actual - expected) < tol,
                sprintf("%s (|%.4f - %.4f| < %.2f)", label, actual, expected, tol))
  }
  close_to(cell_num(post_table, 1, 2), mean(ref_delta), "posterior mean")
  close_to(cell_num(post_table, 1, 3), sd(ref_delta), "posterior sd")
  close_to(cell_num(post_table, 1, 4), unname(quantile(ref_delta, 0.025)), "ci lower")
  close_to(cell_num(post_table, 1, 5), unname(quantile(ref_delta, 0.975)), "ci upper")
  # group A (first) has the lower mean -> negative delta
  expect_true(cell_num(post_table, 1, 5) < 0, "ci upper < 0 (A < B)")
})

test_that("bayes independent: equal groups favor H0, ultrawide prior", {
  set.seed(21)
  g <- rep(c("A", "B"), each = 20)
  v <- rnorm(40, mean = 10, sd = 2)
  df <- data.frame(col_1 = v, col_2 = g)
  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "x"),
    groupVar = "col_2", group1 = "A", group2 = "B", rscale = "ultrawide"
  ))
  result <- run_analysis_script("bayes-ttest-independent.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = v[g == "A"], y = v[g == "B"],
                                                    rscale = "ultrawide"))
  expect_lt(eb$bf[1], 1, "reference BF10 < 1 (fixture check)")
  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(bf_table$footnoteKey,
               "output.bayes.priorFootnote:output.bayes.scaleUltrawide|1.4142",
               label = "prior footnote carries the t-test ultrawide width")
})

# ── Paired samples ──────────────────────────────────────────────────────────

test_that("bayes paired: BF + posterior match ttestBF(paired = TRUE) reference", {
  set.seed(5)
  a <- rnorm(30, mean = 2, sd = 1)
  b <- a + rnorm(30, mean = 0.8, sd = 0.5) # correlated pairs, clear difference
  df <- data.frame(col_1 = a, col_2 = b)
  fixture <- write_fixture(df, list(
    var1 = list("col_1"), var2 = list("col_2"),
    varNames = list(col_1 = "before", col_2 = "after"), rscale = "medium"
  ))
  result <- run_analysis_script("bayes-ttest-paired.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = a, y = b, paired = TRUE,
                                                    rscale = "medium"))
  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_true(identical(bf_table$rows[[1]][[1]], "before - after"), "pair label format")
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10")
  expect_equal(cell_num(bf_table, 1, 3), 1 / eb$bf[1], tolerance = 1e-3, "BF01")
  expect_equal(cell_num(bf_table, 1, 4), 100 * eb$error[1], tolerance = 1e-3, "error %")

  set.seed(3)
  ref_delta <- as.numeric(BayesFactor::posterior(
    BayesFactor::ttestBF(x = a, y = b, paired = TRUE, rscale = "medium"),
    iterations = 10000, progress = FALSE)[, "delta"])
  post_table <- find_table(result, "output.bayes.postTitle")
  # ABSOLUTE tolerance, not expect_equal's relative one.
  #
  # Both sides are 10 000-draw MCMC and the script's chain runs in its own R
  # process, so it cannot be seeded from here: the two differ by Monte Carlo
  # error on every run. A relative tolerance turns that into an arbitrary test —
  # the 97.5% bound of delta sits near -0.17, so a 0.02 wobble is 12% and fails,
  # while the same 0.02 on the posterior sd passes comfortably. Strictness that
  # depends on how close a quantity happens to be to zero measures nothing.
  # 0.05 absolute is several times the MC error here and still far below any
  # real implementation difference.
  close_to <- function(actual, expected, label, tol = 0.05) {
    expect_true(is.finite(actual) && abs(actual - expected) < tol,
                sprintf("%s (|%.4f - %.4f| < %.2f)", label, actual, expected, tol))
  }
  close_to(cell_num(post_table, 1, 2), mean(ref_delta), "posterior mean")
  close_to(cell_num(post_table, 1, 3), sd(ref_delta), "posterior sd")
  close_to(cell_num(post_table, 1, 4), unname(quantile(ref_delta, 0.025)), "ci lower")
  close_to(cell_num(post_table, 1, 5), unname(quantile(ref_delta, 0.975)), "ci upper")
  # a < b -> negative delta
  expect_true(cell_num(post_table, 1, 5) < 0, "ci upper < 0 (before < after)")
})

test_that("bayes paired: no real difference favors H0", {
  set.seed(31)
  a <- rnorm(25, mean = 5, sd = 1)
  b <- a + rnorm(25, mean = 0, sd = 0.8)
  df <- data.frame(col_1 = a, col_2 = b)
  fixture <- write_fixture(df, list(
    var1 = list("col_1"), var2 = list("col_2"),
    varNames = list(col_1 = "t1", col_2 = "t2")
  ))
  result <- run_analysis_script("bayes-ttest-paired.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  eb <- BayesFactor::extractBF(BayesFactor::ttestBF(x = a, y = b, paired = TRUE))
  expect_lt(eb$bf[1], 1, "reference BF10 < 1 (fixture check)")
  bf_table <- find_table(result, "output.bayes.bfTitle")
  expect_equal(cell_num(bf_table, 1, 2), eb$bf[1], tolerance = 1e-3, "BF10")
  expect_lt(cell_num(bf_table, 1, 2), 1, "script BF10 < 1")
})

# ── Reproducibility (2026-10-10) ────────────────────────────────────────────
# Unseeded, the same data gave posterior summaries 1-9% apart between runs.
# The scripts now fix the seed (SPSS's default 2000000), overridable via
# params$seed, and say so in a note.

test_that("bayes posterior: same data + default seed -> identical; other seed -> differs", {
  set.seed(7)
  df <- data.frame(col_1 = rnorm(30, 0.4), col_2 = rnorm(30, 0))
  base <- list(variables = list("col_1"), varNames = list(col_1 = "x"), testValue = 0,
               rscale = "medium")
  post <- function(extra = list()) {
    r <- run_analysis_script("bayes-ttest-onesample.R", write_fixture(df, c(base, extra)))
    list(rows = find_table(r, "output.bayes.postTitle")$rows, notes = unlist(r$notes))
  }
  a <- post(); b <- post(); c <- post(list(seed = 12345))
  expect_true(identical(a$rows, b$rows), "two runs, default seed: identical posterior table")
  expect_true(!identical(a$rows, c$rows), "a different seed gives different draws")
  expect_true("output.bayes.mcmcNote:10000|2000000" %in% a$notes, "note names draws + default seed")
  expect_true("output.bayes.mcmcNote:10000|12345" %in% c$notes, "note names the seed used")

  pr <- function() {
    r <- run_analysis_script("bayes-ttest-paired.R", write_fixture(df, list(
      var1 = list("col_1"), var2 = list("col_2"), varNames = list(col_1 = "a", col_2 = "b"))))
    find_table(r, "output.bayes.postTitle")$rows
  }
  expect_true(identical(pr(), pr()), "paired: identical posterior across runs")
})

}  # end BayesFactor guard
