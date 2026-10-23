# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-crosstabs.R — validates r-scripts/crosstabs.R's cell/percentage/chi-
# square pipeline against a hand-built 2x2 table with a manually computed
# (not chisq.test-derived) Pearson chi-square, so the check is independent of
# the base-R function the script itself calls.
#
# Table (classic smoker/disease textbook shape):
#            Disease  NoDisease  Total
#  Smoker       30        70      100
#  NonSmoker    10        90      100
#  Total        40       160      200
# Expected: E11=20, E12=80, E21=20, E22=80
# Chi2 = (30-20)^2/20 + (70-80)^2/80 + (10-20)^2/20 + (90-80)^2/80 = 12.5, df=1

test_that("crosstabs counts, row/col %, and chi-square match hand-computed values", {
  rows <- c(rep("Smoker", 100), rep("NonSmoker", 100))
  cols <- c(rep("Disease", 30), rep("NoDisease", 70), rep("Disease", 10), rep("NoDisease", 90))
  df <- data.frame(col_1 = rows, col_2 = cols)

  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "smoking"),
    cols = list("col_2"), colNames = list(col_2 = "disease"),
    options = list(
      cells = list(observed = TRUE, rowPct = TRUE, colPct = TRUE),
      stats = list(chisquare = TRUE)
    )
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ct <- find_table(result, "output.crosstabs.crosstabTitle")
  # Row levels are alphabetical: "NonSmoker" before "Smoker".
  # Sub-rows per level: Count, RowPct, ColPct (3 measures) x 2 levels + Total block.
  # Row 1 = NonSmoker / Count: [level, measure, Disease, NoDisease, Total]
  expect_equal(cell_num(ct, 1, 3), 10, tolerance = 1e-9, "NonSmoker x Disease count")
  expect_equal(cell_num(ct, 1, 4), 90, tolerance = 1e-9, "NonSmoker x NoDisease count")
  expect_equal(cell_num(ct, 1, 5), 100, tolerance = 1e-9, "NonSmoker row total")
  # Row 2 = NonSmoker / RowPct
  expect_equal(cell_num(ct, 2, 3), 10.0, tolerance = 1e-6, "NonSmoker x Disease row%")
  expect_equal(cell_num(ct, 2, 4), 90.0, tolerance = 1e-6, "NonSmoker x NoDisease row%")
  # Row 4 = Smoker / Count
  expect_equal(cell_num(ct, 4, 3), 30, tolerance = 1e-9, "Smoker x Disease count")
  expect_equal(cell_num(ct, 4, 4), 70, tolerance = 1e-9, "Smoker x NoDisease count")

  chisq <- find_table(result, "output.crosstabs.chiSqTitle")
  expect_equal(cell_num(chisq, 1, 2), 12.5, tolerance = 1e-6, "Pearson chi-square = 12.5 (hand-computed)")
  expect_equal(cell_num(chisq, 1, 3), 1, tolerance = 1e-9, "df = 1")
  ref_p <- pchisq(12.5, 1, lower.tail = FALSE)
  # The script rounds to 6 decimal places before serialising (SPSS-style
  # display precision), so compare within that rounding, not to full
  # double precision.
  expect_equal(cell_num(chisq, 1, 4), ref_p, tolerance = 2e-4, "p-value matches manual pchisq")

  # Row 2 (A1): Continuity Correction (Yates) — SPSS always shows this for a
  # 2x2 table. Verify against chisq.test(correct=TRUE) directly (independent
  # of the script's own Pearson computation).
  tab <- matrix(c(10, 90, 30, 70), nrow = 2, byrow = TRUE)  # NonSmoker/Smoker x Disease/NoDisease
  cct_ref <- chisq.test(tab, correct = TRUE)
  expect_equal(cell_num(chisq, 2, 2), as.numeric(cct_ref$statistic), tolerance = 1e-6,
               "Continuity Correction statistic matches chisq.test(correct=TRUE)")
  expect_equal(cell_num(chisq, 2, 4), cct_ref$p.value, tolerance = 2e-4,
               "Continuity Correction p-value matches chisq.test(correct=TRUE)")
})

test_that("crosstabs Linear-by-Linear Association appears for numeric x numeric and matches (N-1)*r^2", {
  set.seed(1)
  rv <- sample(1:4, 60, replace = TRUE)
  cv <- pmin(4, pmax(1, rv + sample(-1:1, 60, replace = TRUE)))
  df <- data.frame(col_1 = as.character(rv), col_2 = as.character(cv))

  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "x"),
    cols = list("col_2"), colNames = list(col_2 = "y"),
    options = list(
      cells = list(observed = TRUE),
      stats = list(chisquare = TRUE)
    )
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  chisq <- find_table(result, "output.crosstabs.chiSqTitle")
  ref_r  <- cor(rv, cv)
  ref_ll <- (length(rv) - 1) * ref_r^2
  ref_p  <- pchisq(ref_ll, 1, lower.tail = FALSE)

  # Rows: 1 Pearson, 2 Continuity Correction (only for 2x2 — here 4x4, so
  # absent), 3 Likelihood Ratio, 4 Linear-by-Linear, 5 N of Valid Cases (no
  # Fisher row since a 4x4 table isn't "discrete 2x2").
  ll_row <- NULL
  for (i in seq_along(chisq$rows)) {
    if (identical(chisq$rows[[i]][[1]], "output.col.linearByLinear")) ll_row <- i
  }
  expect_true(!is.null(ll_row), "Linear-by-Linear row present")
  expect_equal(cell_num(chisq, ll_row, 2), ref_ll, tolerance = 1e-6, "Linear-by-Linear statistic = (N-1)*r^2")
  expect_equal(cell_num(chisq, ll_row, 4), ref_p, tolerance = 2e-4, "Linear-by-Linear p-value")
})

test_that("crosstabs shows value labels (not raw codes) for row/column levels when rowValueLabels/colValueLabels are supplied", {
  rows <- c(rep("1", 7), rep("2", 4), rep("1", 3), rep("2", 6))
  cols <- c(rep("0", 10), rep("1", 10))
  df <- data.frame(col_1 = rows, col_2 = cols)

  fixture <- write_fixture(df, list(
    rows = list("col_1"), rowNames = list(col_1 = "gender"),
    rowValueLabels = list(col_1 = list(`1` = "Kadın", `2` = "Erkek")),
    cols = list("col_2"), colNames = list(col_2 = "passed"),
    colValueLabels = list(col_2 = list(`0` = "Hayır", `1` = "Evet")),
    options = list(cells = list(observed = TRUE))
  ))
  result <- run_analysis_script("crosstabs.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ct <- find_table(result, "output.crosstabs.crosstabTitle")
  col_headers <- vapply(ct$columns, function(c) if (is.null(c)) "" else as.character(c), character(1))
  expect_true("Hayır" %in% col_headers, "column header shows 'Hayır' label, not raw code '0'")
  expect_true("Evet" %in% col_headers, "column header shows 'Evet' label, not raw code '1'")
  expect_true(!("0" %in% col_headers), "raw code '0' must not leak into column headers")
  expect_true(!("1" %in% col_headers), "raw code '1' must not leak into column headers")

  # Row levels sort as characters ("1" before "2"), so the first sub-row block
  # is level "1" -> "Kadın".
  expect_equal(ct$rows[[1]][[1]], "Kadın", "first row level shows label 'Kadın', not raw code '1'")
})
