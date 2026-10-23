# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-distances.R — validates distances.R's Proximity Matrix for every
# supported measure against base R's own dist()/cor() (the exact functions
# the script itself wraps), confirming the wrapping (transpose, squaring,
# cosine normalization) introduces no arithmetic error.
#
# Cosine/Pearson loop assertions use a looser relative tolerance than the
# distance measures: near-zero matrix entries amplify all.equal()'s default
# RELATIVE tolerance against the script's round(x, 3) display rounding.

test_that("distances: euclidean matches dist(M, 'euclidean')", {
  set.seed(91)
  df <- data.frame(col_a = rnorm(10), col_b = rnorm(10), col_c = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b", "col_c"), measure = "euclidean",
    varNames = list(col_a = "A", col_b = "B", col_c = "C")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  M <- t(as.matrix(df))
  ref <- as.matrix(dist(M, "euclidean"))
  tbl <- find_table(result, "output.distances.title")
  for (i in 1:3) for (j in 1:3) {
    expect_equal(cell_num(tbl, i, j + 1), ref[i, j], tolerance = 1e-3, sprintf("euclidean D[%d,%d]", i, j))
  }
})

test_that("distances: sqeuclidean == squared euclidean distance", {
  set.seed(92)
  df <- data.frame(col_a = rnorm(10), col_b = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b"), measure = "sqeuclidean",
    varNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  M <- t(as.matrix(df))
  ref <- as.matrix(dist(M, "euclidean"))^2
  tbl <- find_table(result, "output.distances.title")
  expect_equal(cell_num(tbl, 1, 3), ref[1, 2], tolerance = 1e-2, "sqeuclidean D[1,2]")
})

test_that("distances: manhattan matches dist(M, 'manhattan')", {
  set.seed(93)
  df <- data.frame(col_a = rnorm(10), col_b = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b"), measure = "manhattan",
    varNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  M <- t(as.matrix(df))
  ref <- as.matrix(dist(M, "manhattan"))
  tbl <- find_table(result, "output.distances.title")
  expect_equal(cell_num(tbl, 1, 3), ref[1, 2], tolerance = 1e-3, "manhattan D[1,2]")
})

test_that("distances: chebyshev matches dist(M, 'maximum')", {
  set.seed(94)
  df <- data.frame(col_a = rnorm(10), col_b = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b"), measure = "chebyshev",
    varNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  M <- t(as.matrix(df))
  ref <- as.matrix(dist(M, "maximum"))
  tbl <- find_table(result, "output.distances.title")
  expect_equal(cell_num(tbl, 1, 3), ref[1, 2], tolerance = 1e-3, "chebyshev D[1,2]")
})

test_that("distances: cosine similarity matches the standard dot-product/norm formula", {
  set.seed(95)
  df <- data.frame(col_a = rnorm(10), col_b = rnorm(10), col_c = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b", "col_c"), measure = "cosine",
    varNames = list(col_a = "A", col_b = "B", col_c = "C")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  M <- t(as.matrix(df))
  nrm <- sqrt(rowSums(M^2))
  ref <- (M %*% t(M)) / outer(nrm, nrm)
  tbl <- find_table(result, "output.distances.title")
  for (i in 1:3) for (j in 1:3) {
    expect_equal(cell_num(tbl, i, j + 1), ref[i, j], tolerance = 1e-2, sprintf("cosine D[%d,%d]", i, j))
  }
})

test_that("distances: pearson matches cor(mat) (variables as columns, not rows)", {
  set.seed(96)
  df <- data.frame(col_a = rnorm(15), col_b = rnorm(15), col_c = rnorm(15))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b", "col_c"), measure = "pearson",
    varNames = list(col_a = "A", col_b = "B", col_c = "C")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  ref <- cor(as.matrix(df))
  tbl <- find_table(result, "output.distances.title")
  for (i in 1:3) for (j in 1:3) {
    expect_equal(cell_num(tbl, i, j + 1), ref[i, j], tolerance = 2e-2, sprintf("pearson D[%d,%d]", i, j))
  }
  # Diagonal must be exactly 1 for Pearson self-correlation.
  expect_equal(cell_num(tbl, 1, 2), 1, tolerance = 1e-9, "pearson diagonal == 1")
})

test_that("distances: complete-case listwise deletion excludes rows with any NA", {
  df <- data.frame(col_a = c(1, 2, NA, 4, 5), col_b = c(5, 6, 7, NA, 9))
  fixture <- write_fixture(df, list(
    variables = list("col_a", "col_b"), measure = "euclidean",
    varNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("distances.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  # Rows 3 and 4 dropped -> complete cases are (1,5),(2,6),(5,9).
  M <- t(as.matrix(data.frame(col_a = c(1, 2, 5), col_b = c(5, 6, 9))))
  ref <- as.matrix(dist(M, "euclidean"))
  tbl <- find_table(result, "output.distances.title")
  expect_equal(cell_num(tbl, 1, 3), ref[1, 2], tolerance = 1e-3, "distance after listwise deletion")
})
