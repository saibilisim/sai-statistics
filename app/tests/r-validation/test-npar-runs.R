# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-npar-runs.R — validates npar-runs.R's asymptotic Z/Sig. (previously
# untested, flagged by an earlier hand-computation audit) and the Exact Sig. column
# (science-over-SPSS, CLAUDE.md §11) against the `randtests` package —
# base R has no runs test at all, so randtests is the independent oracle.

test_that("runs test: asymptotic Z/Sig. match a from-scratch reference formula", {
  set.seed(3)
  x <- c(5, 2, 8, 1, 9, 3, 7, 4, 6, 10, 2, 8, 15, 3, 9, 2)
  df <- data.frame(col_1 = x)

  fixture <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"),
    cutPoint = "median"
  ))
  result <- run_analysis_script("npar-runs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  cut <- median(x)
  ge <- x >= cut
  n1 <- sum(!ge); n2 <- sum(ge); N <- n1 + n2
  runs_ref <- 1 + sum(ge[-1] != ge[-N])
  mu <- 2 * n1 * n2 / N + 1
  va <- 2 * n1 * n2 * (2 * n1 * n2 - N) / (N^2 * (N - 1))
  Z_ref <- (runs_ref - mu) / sqrt(va)
  p_ref <- 2 * pnorm(-abs(Z_ref))

  tbl <- find_table(result, "output.nparRuns.title")
  expect_equal(cell_num(tbl, 1, 6), runs_ref, tolerance = 1e-9, "number of runs")
  expect_equal(cell_num(tbl, 1, 7), Z_ref, tolerance = 5e-3, "Z statistic")
  expect_equal(cell_num(tbl, 1, 8), p_ref, tolerance = 2e-4, "asymptotic p-value")
})

test_that("runs test: Exact Sig. column appears only when requested, and matches randtests when installed", {
  set.seed(4)
  x <- c(5, 2, 8, 1, 9, 3, 7, 4, 6, 10, 2, 8, 15, 3, 9, 2)
  df <- data.frame(col_1 = x)

  fixture_off <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"), cutPoint = "median"
  ))
  result_off <- run_analysis_script("npar-runs.R", fixture_off)
  tbl_off <- find_table(result_off, "output.nparRuns.title")
  expect_true(!("output.col.exactSig" %in% unlist(tbl_off$columns)),
              "no Exact Sig. column when not requested")

  fixture_on <- write_fixture(df, list(
    variables = list("col_1"), varNames = list(col_1 = "score"), cutPoint = "median",
    options = list(pMethod = list(method = "exact"))
  ))
  result_on <- run_analysis_script("npar-runs.R", fixture_on)
  expect_true(isTRUE(result_on$success), "on: result$success")
  tbl_on <- find_table(result_on, "output.nparRuns.title")

  if (requireNamespace("randtests", quietly = TRUE)) {
    expect_true("output.col.exactSig" %in% unlist(tbl_on$columns),
                "Exact Sig. column present when requested and randtests installed")
    cut <- median(x)
    ge <- as.numeric(x >= cut)
    ref <- randtests::runs.test(ge, threshold = 0.5, pvalue = "exact")$p.value
    expect_equal(cell_num(tbl_on, 1, 9), ref, tolerance = 2e-4, "Exact Sig. matches randtests")
  } else {
    expect_true(
      "output.warn.pMethodNotApplied" %in% unlist(result_on$warnings),
      "honest pMethodNotApplied warning when randtests is absent"
    )
  }
})
