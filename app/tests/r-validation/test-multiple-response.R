# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-multiple-response.R — validates multiple-response.R's $set Frequencies
# (N, Percent of responses, Percent of cases, Total row) against a
# hand-computed reference per the documented SPSS multiple-dichotomy formula
# (percent of cases denominator = cases with >= 1 non-missing value in the set).

test_that("multiple-response: N/percent-of-responses/percent-of-cases match a hand-computed reference", {
  # 8 cases, 3 dichotomy variables (each 0/1, counted value = 1).
  df <- data.frame(
    col_a = c(1, 0, 1, 1, NA, 0, 1, 0),
    col_b = c(0, 1, 1, 0, NA, 1, 0, 0),
    col_c = c(1, 1, 0, 0, NA, 0, 1, 1)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b", "col_c"), countedValue = 1,
    varNames = list(col_a = "A", col_b = "B", col_c = "C")
  ))
  result <- run_analysis_script("multiple-response.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  M <- as.matrix(df)
  counts <- colSums(M == 1, na.rm = TRUE)  # A=4, B=3, C=4
  total_resp <- sum(counts)                # 11
  valid_cases <- sum(rowSums(!is.na(M)) > 0)  # 7 (row 5 is all-NA)

  tbl <- find_table(result, "output.mr.title")
  expect_equal(length(tbl$rows), 4L, label = "3 categories + Total row")

  for (i in 1:3) {
    expect_equal(cell_num(tbl, i, 2), unname(counts[i]), tolerance = 1e-9, sprintf("category %d N", i))
    expect_equal(cell_num(tbl, i, 3), unname(round(100 * counts[i] / total_resp, 1)), tolerance = 1e-6, sprintf("category %d %% of responses", i))
    expect_equal(cell_num(tbl, i, 4), unname(round(100 * counts[i] / valid_cases, 1)), tolerance = 1e-6, sprintf("category %d %% of cases", i))
  }
  expect_equal(cell_num(tbl, 4, 2), total_resp, tolerance = 1e-9, "Total N")
  expect_equal(cell_num(tbl, 4, 3), 100.0, tolerance = 1e-9, "Total %% of responses == 100")
  expect_equal(cell_num(tbl, 4, 4), round(100 * total_resp / valid_cases, 1), tolerance = 1e-6, "Total %% of cases")
})

test_that("multiple-response: a custom counted value (e.g. 2) is honored", {
  df <- data.frame(
    col_a = c(2, 0, 2, 2), col_b = c(0, 2, 2, 0)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b"), countedValue = 2,
    varNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("multiple-response.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  tbl <- find_table(result, "output.mr.title")
  expect_equal(cell_num(tbl, 1, 2), 3, tolerance = 1e-9, "A count of value 2")
  expect_equal(cell_num(tbl, 2, 2), 2, tolerance = 1e-9, "B count of value 2")
})

test_that("multiple-response: no matches for the counted value is an honest error, not a zero-row table", {
  df <- data.frame(col_a = c(0, 0, 0), col_b = c(0, 0, 0))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b"), countedValue = 1,
    varNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("multiple-response.R", fixture)
  expect_true(!isTRUE(result$success), "expected failure when no responses match the counted value")
})
