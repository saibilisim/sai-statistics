# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-descriptives-validn-2026-08.R — regression tests for the SPSS-parity
# "Valid N (listwise)" row in descriptives.R (manuel-test
# karsilastirma-ve-fizibilite-2026-08-07 §2 item 15: SPSS's Descriptive
# Statistics table ends with a "Valid N (listwise)" row; SAI's did not).
#
# The row reports cases valid on ALL variables (complete cases), sits last,
# and carries a value only in the N column — the statistic cells stay empty,
# rendered as SPSS's dot by the frontend.

test_that("descriptives: Valid N (listwise) row counts complete cases only", {
  # col_1 missing at row 3, col_2 missing at row 2 → complete cases = 1,4,5,6.
  df <- data.frame(
    col_1 = c(1, 2, NA, 4, 5, 6),
    col_2 = c(10, NA, 20, 30, 40, 50)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "alpha", col_2 = "beta"),
    options = list(mean = TRUE, sd = TRUE)
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.descriptives.title")
  # 2 variable rows + 1 Valid N row.
  expect_equal(length(tbl$rows), 3L, tolerance = 0, "row count = variables + Valid N")

  last <- tbl$rows[[3]]
  expect_true(identical(last[[1]], "output.descriptives.validN"), "last row is the Valid N label key")
  expect_equal(as.numeric(last[[2]]), 4, tolerance = 0, "listwise N = complete cases")
  # Statistic cells stay empty (SPSS shows a dot there).
  expect_true(is.null(last[[3]]), "Mean cell empty on the Valid N row")
  expect_true(is.null(last[[4]]), "Std. Deviation cell empty on the Valid N row")

  # Per-variable Ns are unaffected (each is 5 here, not the listwise 4).
  expect_equal(cell_num(tbl, 1, 2), 5, tolerance = 0, "col_1 per-variable N")
  expect_equal(cell_num(tbl, 2, 2), 5, tolerance = 0, "col_2 per-variable N")
})

test_that("descriptives: Valid N (listwise) equals full N when nothing is missing", {
  df <- data.frame(col_1 = rnorm(30), col_2 = rnorm(30))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "x", col_2 = "y"),
    options = list()   # no statistics — table is Variable + N only
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.descriptives.title")
  expect_equal(length(tbl$rows), 3L, tolerance = 0, "row count = variables + Valid N")
  last <- tbl$rows[[3]]
  expect_true(identical(last[[1]], "output.descriptives.validN"), "last row is the Valid N label key")
  expect_equal(as.numeric(last[[2]]), 30, tolerance = 0, "listwise N = full N")
  expect_equal(length(last), 2L, tolerance = 0, "row width matches the 2-column table")
})

test_that("descriptives: single variable — Valid N (listwise) equals that variable's N", {
  df <- data.frame(col_1 = c(1, 2, NA, 4, NA, 6, 7))
  fixture <- write_fixture(df, list(
    variables = list("col_1"),
    varNames = list(col_1 = "score"),
    options = list(mean = TRUE)
  ))
  result <- run_analysis_script("descriptives.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.descriptives.title")
  expect_equal(length(tbl$rows), 2L, tolerance = 0, "row count = variable + Valid N")
  last <- tbl$rows[[2]]
  expect_true(identical(last[[1]], "output.descriptives.validN"), "last row is the Valid N label key")
  expect_equal(as.numeric(last[[2]]), 5, tolerance = 0, "listwise N = valid N of the single variable")
})
