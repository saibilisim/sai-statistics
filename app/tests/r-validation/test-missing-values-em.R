# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-missing-values-em.R — validates missing-values.R's EM-estimated
# Univariate Statistics + Little's MCAR test against naniar::mcar_test(),
# an independent, well-established implementation of the same EM-based
# Little's (1988) test.

test_that("missing-values: univariate N/mean/sd and Little's MCAR test match naniar::mcar_test()", {
  if (!requireNamespace("naniar", quietly = TRUE)) {
    cat("SKIP: naniar not installed\n")
    return(invisible())
  }
  set.seed(41)
  n <- 60
  x <- rnorm(n, 10, 2); y <- rnorm(n, 15, 3); z <- rnorm(n, 5, 1)
  df <- data.frame(col_x = x, col_y = y, col_z = z)
  mis_x <- sample(n, 8); mis_y <- sample(n, 6)
  df$col_x[mis_x] <- NA
  df$col_y[mis_y] <- NA

  fixture <- write_fixture(df, list(
    variables = list("col_x", "col_y", "col_z"),
    varNames = list(col_x = "X", col_y = "Y", col_z = "Z")
  ))
  result <- run_analysis_script("missing-values.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  uni_tbl <- find_table(result, "output.missing.uniTitle")
  expect_equal(cell_num(uni_tbl, 1, 2), sum(!is.na(df$col_x)), tolerance = 1e-9, "X valid N")
  expect_equal(cell_num(uni_tbl, 1, 3), mean(df$col_x, na.rm = TRUE), tolerance = 1e-3, "X mean (complete-case, listed display)")
  expect_equal(cell_num(uni_tbl, 1, 5), sum(is.na(df$col_x)), tolerance = 1e-9, "X missing count")
  expect_equal(cell_num(uni_tbl, 3, 2), n, tolerance = 1e-9, "Z (no missing) valid N == n")
  expect_equal(cell_num(uni_tbl, 3, 5), 0, tolerance = 1e-9, "Z missing count == 0")

  ref <- naniar::mcar_test(df[, c("col_x", "col_y", "col_z")])
  mcar_tbl <- find_table(result, "output.missing.mcarTitle")
  expect_equal(cell_num(mcar_tbl, 1, 1), ref$statistic, tolerance = 1e-2, "Little's MCAR chi-square (EM-based)")
  expect_equal(cell_num(mcar_tbl, 1, 2), ref$df, tolerance = 1e-9, "Little's MCAR df")
  expect_equal(cell_num(mcar_tbl, 1, 3), ref$p.value, tolerance = 1e-2, "Little's MCAR Sig.")
})

test_that("missing-values: MCAR-violating (MNAR-like) pattern yields a small p-value, matching naniar", {
  if (!requireNamespace("naniar", quietly = TRUE)) {
    cat("SKIP: naniar not installed\n")
    return(invisible())
  }
  set.seed(42)
  n <- 80
  z <- rnorm(n, 0, 1)
  x <- 5 + 2 * z + rnorm(n, sd = 0.5)
  y <- 3 - z + rnorm(n, sd = 0.5)
  df <- data.frame(col_x = x, col_y = y, col_z = z)
  # Missingness on x depends on z (a covariate correlated with y) -> violates MCAR.
  drop_idx <- order(z)[1:25]
  df$col_x[drop_idx] <- NA

  fixture <- write_fixture(df, list(
    variables = list("col_x", "col_y", "col_z"),
    varNames = list(col_x = "X", col_y = "Y", col_z = "Z")
  ))
  result <- run_analysis_script("missing-values.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- naniar::mcar_test(df[, c("col_x", "col_y", "col_z")])
  mcar_tbl <- find_table(result, "output.missing.mcarTitle")
  expect_equal(cell_num(mcar_tbl, 1, 1), ref$statistic, tolerance = 1e-2, "Little's MCAR chi-square (MNAR-like pattern)")
  expect_equal(cell_num(mcar_tbl, 1, 3), ref$p.value, tolerance = 1e-2, "Little's MCAR Sig. (MNAR-like pattern)")
})
