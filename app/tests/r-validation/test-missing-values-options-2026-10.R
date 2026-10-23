# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-missing-values-options-2026-10.R — the estimation / descriptives /
# patterns options of missing-values.R (SPSS Missing Value Analysis).
# References: base R mean/sd/t.test/lm and hand counts.

set.seed(515)
mv_n <- 60
mv <- data.frame(col_a = rnorm(mv_n, 10, 2), col_b = rnorm(mv_n, 5, 1))
mv$col_c <- 2 + 0.5 * mv$col_a + rnorm(mv_n)
mv$col_b[c(2, 9, 15, 33, 41, 50)] <- NA
mv$col_c[c(4, 9, 22, 47)] <- NA
mv_params <- function(o) list(variables = list("col_a", "col_b", "col_c"),
  varNames = list(col_a = "a", col_b = "b", col_c = "c"), options = o)
row_of <- function(t, key) { for (r in t$rows) if (identical(r[[1]], key)) return(r); stop(key) }

test_that("MVA: EM equals the sample estimates when nothing is missing", {
  full <- mv; full$col_b <- rnorm(mv_n, 5); full$col_c <- rnorm(mv_n, 3)
  res <- run_analysis_script("missing-values.R", write_fixture(full, mv_params(list(estimation = list("em")))))
  expect_true(isTRUE(res$success), "success")
  ms <- find_table(res, "output.missing.meansSummaryTitle")
  expect_equal(as.numeric(row_of(ms, "output.missing.em")[[2]]), round(mean(full$col_a), 4), tolerance = 1e-6, "EM mean")
  sds <- find_table(res, "output.missing.sdSummaryTitle")
  expect_equal(as.numeric(row_of(sds, "output.missing.em")[[2]]),
               round(sqrt(mean((full$col_a - mean(full$col_a))^2)), 4), tolerance = 1e-5, "EM SD (ML)")
})

test_that("MVA: listwise, regression estimation, t tests, mismatch, patterns", {
  res <- run_analysis_script("missing-values.R", write_fixture(mv, mv_params(list(
    estimation = list("listwise", "pairwise", "regression"), tTests = TRUE, mismatch = TRUE, patterns = TRUE))))
  expect_true(isTRUE(res$success), "success")
  ms <- find_table(res, "output.missing.meansSummaryTitle")
  cc <- complete.cases(mv)
  expect_equal(as.numeric(row_of(ms, "output.missing.listwise")[[3]]), round(mean(mv$col_b[cc]), 4),
               tolerance = 1e-9, "listwise mean b")
  # Regression: case 22 misses only c; predicted from a and b by OLS on complete cases.
  fit <- lm(col_c ~ col_a + col_b, data = mv[cc, ])
  filled <- mv$col_c
  for (i in which(is.na(mv$col_c))) {
    if (!is.na(mv$col_b[i])) filled[i] <- predict(fit, mv[i, ])
    else filled[i] <- predict(lm(col_c ~ col_a, data = mv[cc, ]), mv[i, ])
  }
  expect_equal(as.numeric(row_of(ms, "output.missing.regression")[[4]]), round(mean(filled), 4),
               tolerance = 1e-6, "regression-estimated mean of c")
  tt <- find_table(res, "output.missing.tTestTitle")
  miss_b <- is.na(mv$col_b)
  ref <- t.test(mv$col_a[!miss_b], mv$col_a[miss_b])
  expect_equal(cell_num(tt, 1, 3), round(unname(ref$statistic), 3), tolerance = 1e-9, "Welch t of a by b missing")
  mm <- find_table(res, "output.missing.mismatchTitle")
  expect_equal(cell_num(mm, 2, 4), round(100 * mean(is.na(mv$col_b) != is.na(mv$col_c)), 1),
               tolerance = 1e-9, "mismatch b vs c")
  pt <- find_table(res, "output.missing.patternsTitle")
  expect_equal(cell_num(pt, 1, 1), sum(cc), tolerance = 0, "most frequent pattern = complete cases")
  expect_equal(sum(vapply(pt$rows, function(r) as.numeric(r[[1]]), 0)), mv_n, tolerance = 0, "patterns cover all cases")
  find_table(res, "output.missing.pairwiseCorTitle")
})
