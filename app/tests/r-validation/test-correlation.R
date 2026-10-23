# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-correlation.R — validates r-scripts/correlation.R's Pearson matrix
# pipeline (table wiring, N handling) against an independently computed
# Pearson r + Student-t p-value (not via cor.test, so the check does not
# merely re-run the same R helper the script itself calls) using mtcars
# mpg vs wt (textbook r = -0.8677, a widely published reference value).

test_that("Pearson correlation matches independently computed r and p (mtcars mpg~wt)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "mpg", col_2 = "wt"),
    methods = list(pearson = TRUE),
    # Flagging (SPSS's own default) turns the correlation cell into a
    # formatted STRING ("-0.868**") — turned off here to check the raw
    # numeric r/p pipeline; the flagging format itself is checked separately.
    options = list(flagSignificant = FALSE)
  ))
  result <- run_analysis_script("correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  n <- nrow(mtcars)
  r <- cov(mtcars$mpg, mtcars$wt) / (sd(mtcars$mpg) * sd(mtcars$wt))
  t_stat <- r * sqrt(n - 2) / sqrt(1 - r^2)
  p_manual <- 2 * pt(-abs(t_stat), df = n - 2)

  table <- find_table(result, "output.correlate.title:Pearson")
  # Row 1 = corr row for variable 1 (mpg): [name, label, r(1,1)=1, r(1,2)]
  expect_equal(cell_num(table, 1, 3), 1, tolerance = 1e-9, "self-correlation = 1")
  expect_equal(cell_num(table, 1, 4), r, tolerance = 1e-4, "r(mpg, wt)")
  # Row 2 = sig row for variable 1: ["", label, "", p(1,2)]
  expect_equal(cell_num(table, 2, 4), p_manual, tolerance = 1e-4, "p-value(mpg, wt)")
  # Row 3 = N row for variable 1: ["", label, n(1,1), n(1,2)]
  expect_equal(cell_num(table, 3, 4), n, tolerance = 1e-9, "N(mpg, wt)")

  # Published reference value for this exact well-known dataset/pair.
  expect_equal(round(r, 4), -0.8677, tolerance = 1e-4, "published r=-0.8677")
})

test_that("Flag significant correlations formats the cell as SPSS's own asterisk convention", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "mpg", col_2 = "wt"),
    methods = list(pearson = TRUE)
    # flagSignificant defaults to TRUE (SPSS's own default) — not set here.
  ))
  result <- run_analysis_script("correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  r <- cor(mtcars$mpg, mtcars$wt)
  table <- find_table(result, "output.correlate.title:Pearson")
  # r(mpg, wt) is large and p << .01 for n=32, so it must carry "**".
  expect_equal(table$rows[[1]][[4]], sprintf("%.3f**", round(r, 3)),
               label = "flagged r(mpg, wt) carries ** and 3dp formatting")
  # Self-correlation (p undefined) must print bare, with no flag.
  expect_equal(table$rows[[1]][[3]], "1", label = "self-correlation prints as bare \"1\", unflagged")
})

test_that("One-tailed significance halves the p-value and relabels the row", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "mpg", col_2 = "wt"),
    methods = list(pearson = TRUE),
    options = list(oneTailed = TRUE, flagSignificant = FALSE)
  ))
  result <- run_analysis_script("correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ct <- cor.test(mtcars$mpg, mtcars$wt)
  table <- find_table(result, "output.correlate.title:Pearson")
  expect_equal(table$rows[[2]][[2]], "output.col.sigOneTailed", label = "sig row relabeled one-tailed")
  expect_equal(cell_num(table, 2, 4), ct$p.value / 2, tolerance = 1e-6, "one-tailed p = two-tailed / 2")
})

test_that("Means and standard deviations table matches base R mean()/sd() per variable", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "mpg", col_2 = "wt", col_3 = "hp"),
    methods = list(pearson = TRUE),
    options = list(meansAndSD = TRUE, flagSignificant = FALSE)
  ))
  result <- run_analysis_script("correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  desc <- find_table(result, "output.correlate.descriptivesTitle")
  expect_equal(cell_num(desc, 1, 2), mean(mtcars$mpg), tolerance = 1e-6, "mean(mpg)")
  expect_equal(cell_num(desc, 1, 3), sd(mtcars$mpg), tolerance = 1e-6, "sd(mpg)")
  expect_equal(cell_num(desc, 1, 4), nrow(mtcars), tolerance = 1e-9, "N(mpg)")
  expect_equal(cell_num(desc, 3, 2), mean(mtcars$hp), tolerance = 1e-6, "mean(hp)")
})

test_that("Cross-product deviations and covariances match cov() (Pearson only)", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "mpg", col_2 = "wt", col_3 = "hp"),
    methods = list(pearson = TRUE, spearman = TRUE),
    options = list(crossProduct = TRUE, flagSignificant = FALSE)
  ))
  result <- run_analysis_script("correlation.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  cp_ref  <- sum((mtcars$mpg - mean(mtcars$mpg)) * (mtcars$wt - mean(mtcars$wt)))
  cov_ref <- cov(mtcars$mpg, mtcars$wt)

  pear <- find_table(result, "output.correlate.title:Pearson")
  # Block 1 (mpg) has 5 rows when crossProduct is on: Correlation/Sig/N/SS&CP/Covariance.
  expect_equal(pear$rows[[4]][[2]], "output.col.sumSqCrossProd", label = "4th row is SS&CP")
  expect_equal(cell_num(pear, 4, 4), cp_ref, tolerance = 1e-4, "SS&CP(mpg, wt)")
  expect_equal(pear$rows[[5]][[2]], "output.col.covariance", label = "5th row is Covariance")
  expect_equal(cell_num(pear, 5, 4), cov_ref, tolerance = 1e-6, "Covariance(mpg, wt)")

  # Spearman has no cross-product-deviation concept — its block stays 3 rows.
  spear <- find_table(result, "output.correlate.title:Spearman")
  expect_true(length(spear$rows) == 9, "Spearman block stays 3 rows x 3 variables (no XPROD rows)")
})
