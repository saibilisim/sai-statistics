# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-onesample-options-2026-10.R — the Options sub-dialog of the
# one-sample nonparametric tests (Binomial, One-Sample K-S, Runs):
# Statistics (Descriptive, Quartiles) and Missing Values (listwise).
# References: base R mean/sd/min/max and quantile(type = 6) — SPSS's
# HAVERAGE percentile definition.

ns_df <- data.frame(
  col_a = c(3.1, 4.5, 2.2, 5.8, 4.4, 3.9, NA, 6.1, 2.7, 4.0, 5.2, 3.3),
  col_b = c(1, 0, 1, 1, 0, NA, 1, 0, 0, 1, 1, 0))

test_that("npar one-sample: descriptives and quartiles match base R", {
  for (script in c("npar-ks.R", "npar-runs.R")) {
    res <- run_analysis_script(script, write_fixture(ns_df, list(
      variables = list("col_a"), varNames = list(col_a = "a"),
      options = list(descriptives = TRUE, quartiles = TRUE))))
    expect_true(isTRUE(res$success), paste(script, "success"))
    d <- find_table(res, "output.npar.descriptivesTitle")
    a <- ns_df$col_a[!is.na(ns_df$col_a)]
    expect_equal(cell_num(d, 1, 2), length(a), tolerance = 0, paste(script, "N"))
    expect_equal(cell_num(d, 1, 3), round(mean(a), 3), tolerance = 1e-9, paste(script, "mean"))
    expect_equal(cell_num(d, 1, 4), round(sd(a), 3), tolerance = 1e-9, paste(script, "SD"))
    q <- quantile(a, c(.25, .5, .75), type = 6)
    expect_equal(cell_num(d, 1, 7), round(unname(q[1]), 3), tolerance = 1e-9, paste(script, "P25"))
    expect_equal(cell_num(d, 1, 9), round(unname(q[3]), 3), tolerance = 1e-9, paste(script, "P75"))
  }
})

test_that("npar one-sample: listwise drops a case missing on any test variable", {
  res <- run_analysis_script("npar-binomial.R", write_fixture(ns_df, list(
    variables = list("col_a", "col_b"), varNames = list(col_a = "a", col_b = "b"),
    options = list(missing = "listwise", descriptives = TRUE))))
  expect_true(isTRUE(res$success), "success")
  d <- find_table(res, "output.npar.descriptivesTitle")
  expect_equal(cell_num(d, 2, 2), 10, tolerance = 0, "b: 12 cases - 1 missing b - 1 missing a")
  expect_true(!("output.warn.missingOptionNotApplied" %in% unlist(res$warnings)), "option honored")
})

test_that("npar runs: user-missing values no longer enter the test", {
  d <- data.frame(col_a = c(1, 5, 2, 6, 3, 99, 4, 7, 99, 2))
  base <- run_analysis_script("npar-runs.R", write_fixture(d[d$col_a != 99, , drop = FALSE], list(
    variables = list("col_a"), varNames = list(col_a = "a"))))
  um <- run_analysis_script("npar-runs.R", write_fixture(d, list(
    variables = list("col_a"), varNames = list(col_a = "a"),
    missingValues = list(col_a = list(type = "discrete", discrete = list(99))))))
  expect_true(identical(find_table(base, "output.nparRuns.title")$rows,
                        find_table(um, "output.nparRuns.title")$rows), "99 treated as missing")
})
