# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-decimals.R — validates Decimals (M2) display formatting: a numeric
# variable's own raw values are shown in output tables using its Variable
# View "Decimals" precision (display-only — never changes tabulation/grouping
# or the precision of computed statistics).

test_that("frequencies: Value column uses the variable's own decimals setting", {
  df <- data.frame(score = c(10, 20, 20, 30))
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    options = list(showTable = TRUE),
    variableDecimals = list(score = 2)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.frequencies.tableTitle")
  # Rows are sorted by frequency count (frequencies.R: sort(..., decreasing =
  # FALSE) sorts the table object, i.e. by count) — compare as a set.
  values <- vapply(table$rows[1:3], function(r) r[[1]], character(1))
  expect_true(setequal(values, c("10.00", "20.00", "30.00")), "values formatted to 2 decimals")
})

test_that("frequencies: no variableDecimals spec behaves exactly as before", {
  df <- data.frame(score = c(10, 20, 20, 30))
  fixture <- write_fixture(df, list(
    variables = list("score"), varNames = list(score = "Score"),
    options = list(showTable = TRUE)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.frequencies.tableTitle")
  values <- vapply(table$rows[1:3], function(r) as.character(r[[1]]), character(1))
  expect_true(setequal(values, c("10", "20", "30")), "values unformatted when no decimals spec")
})

test_that("frequencies: non-numeric string categories are left unformatted", {
  df <- data.frame(grp = c("A", "A", "B"))
  fixture <- write_fixture(df, list(
    variables = list("grp"), varNames = list(grp = "Group"),
    options = list(showTable = TRUE),
    variableDecimals = list(grp = 2)
  ))
  result <- run_analysis_script("frequencies.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  table <- find_table(result, "output.frequencies.tableTitle")
  values <- vapply(table$rows[1:2], function(r) r[[1]], character(1))
  expect_true(all(values %in% c("A", "B")), "string categories unchanged despite decimals spec")
})
