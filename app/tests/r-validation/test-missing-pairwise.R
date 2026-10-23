# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-missing-pairwise.R — validates MV3 (spss-parity-findings-2026-07-07
# §B3): correlation.R's options$missing = "listwise" toggle. Default
# (pairwise) is the pre-existing per-cell NA filtering (already covered by
# test-correlation.R); this file checks the NEW listwise path.
#
# Fixture: 3 variables, deliberately staggered NA pattern so pairwise and
# listwise N genuinely differ.
#   col_1: NA at row 1
#   col_2: NA at row 2
#   col_3: no NA
# Pairwise N(col_1,col_2) = 8 (both rows dropped only pairwise); listwise N
# for ANY pair = 8 too here by construction? Use a pattern where listwise is
# strictly smaller than every pairwise N to make the distinction unambiguous.

test_that("correlation: listwise gives one shared N smaller than any pairwise N", {
  n <- 12
  x1 <- 1:n; x2 <- (1:n) * 2 + 1; x3 <- (1:n) * 0.5
  x1[c(1, 2)] <- NA       # missing rows 1,2
  x2[c(3, 4, 5)] <- NA    # missing rows 3,4,5
  x3[c(6)] <- NA          # missing row 6
  df <- data.frame(col_1 = x1, col_2 = x2, col_3 = x3)

  fixture_pw <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c"),
    methods = list(pearson = TRUE),
    options = list(flagSignificant = FALSE)
  ))
  result_pw <- run_analysis_script("correlation.R", fixture_pw)
  expect_true(isTRUE(result_pw$success), "pairwise: result$success")
  tbl_pw <- find_table(result_pw, "output.correlate.title")

  # Pairwise N(a,b): both a and b non-missing -> rows where !is.na(x1)&!is.na(x2)
  ref_n_ab <- sum(!is.na(x1) & !is.na(x2))
  ref_n_ac <- sum(!is.na(x1) & !is.na(x3))
  ref_n_bc <- sum(!is.na(x2) & !is.na(x3))
  # Row layout: 3 sub-rows (corr/sig/N) per variable block; block 1 = col_1.
  # N sub-row is row 3 of block 1; columns: [var,label,a,b,c] -> a=col3,b=col4,c=col5.
  expect_equal(cell_num(tbl_pw, 3, 4), ref_n_ab, tolerance = 1e-9, "pairwise N(a,b)")
  expect_equal(cell_num(tbl_pw, 3, 5), ref_n_ac, tolerance = 1e-9, "pairwise N(a,c)")

  fixture_lw <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c"),
    methods = list(pearson = TRUE),
    options = list(missing = "listwise", flagSignificant = FALSE)
  ))
  result_lw <- run_analysis_script("correlation.R", fixture_lw)
  expect_true(isTRUE(result_lw$success), "listwise: result$success")
  tbl_lw <- find_table(result_lw, "output.correlate.title")

  ref_n_listwise <- sum(!is.na(x1) & !is.na(x2) & !is.na(x3))
  expect_true(ref_n_listwise < ref_n_ab, "listwise N is strictly smaller than pairwise N(a,b) by construction")

  # Every N cell in the listwise table must equal the SAME shared N.
  # Block 1 (col_1) N-row is row 3; check its N vs col_2 (col 4) and col_3 (col 5).
  expect_equal(cell_num(tbl_lw, 3, 4), ref_n_listwise, tolerance = 1e-9, "listwise N(a,b) == shared N")
  expect_equal(cell_num(tbl_lw, 3, 5), ref_n_listwise, tolerance = 1e-9, "listwise N(a,c) == shared N")
  # Block 2 (col_2) N-row is row 6; col_1 is column 3, col_3 is column 5.
  expect_equal(cell_num(tbl_lw, 6, 3), ref_n_listwise, tolerance = 1e-9, "listwise N(b,a) == shared N")
  expect_equal(cell_num(tbl_lw, 6, 5), ref_n_listwise, tolerance = 1e-9, "listwise N(b,c) == shared N")

  # Correlation VALUES under listwise must match cor() on the complete-case subset.
  keep <- !is.na(x1) & !is.na(x2) & !is.na(x3)
  ref_r_ab <- cor(x1[keep], x2[keep])
  expect_equal(cell_num(tbl_lw, 1, 4), ref_r_ab, tolerance = 1e-6, "listwise r(a,b) matches complete-case cor()")
})
