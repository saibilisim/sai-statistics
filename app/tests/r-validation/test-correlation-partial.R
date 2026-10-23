# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-correlation-partial.R — validates correlation-partial.R's base (non-
# bootstrap) output: partial r, df, and Sig. (2-tailed), against an
# independently-written reference (residualize each variable on the
# controls via lm(), correlate the residuals, t-test with df = n-2-k).
# Complements test-boot2-part2.R, which only covers the bootstrap addendum.
#
# Tolerances of 1e-4 (rather than 1e-6) are used where the script's own
# round(x, 6) display formatting can shift a small-magnitude r/p value by
# just enough to exceed a tight RELATIVE tolerance in all.equal().

ref_partial <- function(x, y, Z) {
  d <- data.frame(x = x, y = y, Z)
  rx <- residuals(lm(x ~ ., data = d[, c("x", names(Z)), drop = FALSE]))
  ry <- residuals(lm(y ~ ., data = d[, c("y", names(Z)), drop = FALSE]))
  r <- cor(rx, ry)
  n <- length(x); k <- ncol(Z)
  dfree <- n - 2 - k
  tval <- r * sqrt(dfree / (1 - r^2))
  pval <- 2 * pt(-abs(tval), dfree)
  list(r = r, df = dfree, p = pval)
}

test_that("correlation-partial: base output matches an independent residualization reference (1 control)", {
  set.seed(71)
  n <- 60
  z <- rnorm(n)
  x <- 0.7 * z + rnorm(n, sd = 0.9)
  y <- -0.4 * z + rnorm(n, sd = 1.1)
  df <- data.frame(col_x = x, col_y = y, col_z = z)

  fixture <- write_fixture(df, list(
    variables = list("col_x", "col_y"), controls = list("col_z"),
    varNames = list(col_x = "X", col_y = "Y", col_z = "Z")
  ))
  result <- run_analysis_script("correlation-partial.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- ref_partial(x, y, data.frame(z = z))
  tbl <- find_table(result, "output.partialCorr.title")
  # Row layout: correlation row, sig row, df row for variable "X" against [X, Y].
  # Column X is 3rd column (after the two label columns), column Y is 4th.
  expect_equal(cell_num(tbl, 1, 4), ref$r, tolerance = 1e-4, "partial r(X,Y)")
  expect_equal(cell_num(tbl, 2, 4), ref$p, tolerance = 1e-4, "Sig. (2-tailed)")
  expect_equal(cell_num(tbl, 3, 4), ref$df, tolerance = 1e-9, "df")
  # Symmetric: row for Y against X should report the same r.
  expect_equal(cell_num(tbl, 4, 3), ref$r, tolerance = 1e-4, "partial r(Y,X) == r(X,Y)")
})

test_that("correlation-partial: base output matches reference with 2 controls and 3 variables", {
  set.seed(72)
  n <- 80
  z1 <- rnorm(n); z2 <- rnorm(n)
  x <- 0.5 * z1 - 0.3 * z2 + rnorm(n)
  y <- -0.2 * z1 + 0.6 * z2 + rnorm(n)
  w <- 0.4 * z1 + 0.4 * z2 + rnorm(n)
  df <- data.frame(col_x = x, col_y = y, col_w = w, col_z1 = z1, col_z2 = z2)

  fixture <- write_fixture(df, list(
    variables = list("col_x", "col_y", "col_w"), controls = list("col_z1", "col_z2"),
    varNames = list(col_x = "X", col_y = "Y", col_w = "W", col_z1 = "Z1", col_z2 = "Z2")
  ))
  result <- run_analysis_script("correlation-partial.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  Z <- data.frame(z1 = z1, z2 = z2)
  ref_xy <- ref_partial(x, y, Z)
  ref_xw <- ref_partial(x, w, Z)
  ref_yw <- ref_partial(y, w, Z)

  tbl <- find_table(result, "output.partialCorr.title")
  # 3 variables -> 3 blocks of 3 rows each (X, Y, W). Columns: X=3, Y=4, W=5.
  expect_equal(cell_num(tbl, 1, 4), ref_xy$r, tolerance = 1e-4, "partial r(X,Y)")
  expect_equal(cell_num(tbl, 1, 5), ref_xw$r, tolerance = 1e-4, "partial r(X,W)")
  expect_equal(cell_num(tbl, 4, 5), ref_yw$r, tolerance = 1e-4, "partial r(Y,W)")
  expect_equal(cell_num(tbl, 3, 4), ref_xy$df, tolerance = 1e-9, "df with 2 controls (n-2-k)")
})

test_that("correlation-partial: missing needs at least one control (honesty: sai_error, not a silent no-op)", {
  df <- data.frame(col_x = rnorm(10), col_y = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_x", "col_y"), controls = list(),
    varNames = list(col_x = "X", col_y = "Y")
  ))
  result <- run_analysis_script("correlation-partial.R", fixture)
  expect_true(!isTRUE(result$success), "expected failure with zero controls")
})
