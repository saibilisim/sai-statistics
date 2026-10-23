# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-clustering-mds.R — validates kmeans.R, hierarchical.R and mds.R against
# base R's own kmeans()/hclust()/cmdscale() (the exact reference algorithms the
# scripts wrap) and, for hierarchical "average" linkage, cluster::agnes() as a
# second, independent implementation of the same Lance–Williams update.
#
# kmeans.R seeds with set.seed(1) before calling kmeans(..., nstart = 10,
# iter.max = 50); repeating that exact call here reproduces the reference
# solution bit-for-bit, so the assertions pin down centers (script rounds to
# round(x, 3) ⇒ tolerance 1e-3) and cluster sizes, not the RNG stream.
# hclust()/cmdscale() are deterministic, so those references match exactly
# modulo the script's display rounding (1e-3 for round(x,3), 1e-4/1e-3 for
# round(x,5)/round(x,4) under all.equal()'s relative-tolerance scaling).

test_that("kmeans: centers and sizes match base R kmeans() with the same seed", {
  set.seed(11)
  df <- data.frame(
    col_1 = c(rnorm(15, 0, 0.4), rnorm(15, 5, 0.4), rnorm(15, 10, 0.4)),
    col_2 = c(rnorm(15, 10, 0.4), rnorm(15, 5, 0.4), rnorm(15, 0, 0.4))
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "x", col_2 = "y"),
    clusters = 3
  ))
  result <- run_analysis_script("kmeans.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  mat <- as.matrix(df[, c("col_1", "col_2")])
  set.seed(1)
  ref <- kmeans(mat, centers = 3, nstart = 10, iter.max = 50)

  ctr <- find_table(result, "output.kmeans.centersTitle")
  # row i = variable i; col 1 = variable label, cols 2..k+1 = cluster centers.
  # unname(): centers rows carry dimnames, and all.equal() compares attributes
  # by default. tolerance 5e-3: the script's round(x, 3) costs up to 5e-4
  # absolute, which exceeds all.equal()'s 1e-3 relative scaling on sub-unit
  # center values.
  for (i in 1:2) for (cl in 1:3) {
    expect_equal(cell_num(ctr, i, cl + 1), unname(ref$centers[cl, i]),
                 tolerance = 5e-3, sprintf("center[var %d, cluster %d]", i, cl))
  }

  sizes <- find_table(result, "output.kmeans.sizesTitle")
  for (cl in 1:3) {
    expect_equal(cell_num(sizes, cl, 2), ref$size[cl],
                 tolerance = 1e-9, sprintf("size of cluster %d", cl))
  }
  # last row = total case count
  expect_equal(cell_num(sizes, 4, 2), nrow(mat), tolerance = 1e-9, "total N")
})

test_that("kmeans: default k = 2 when 'clusters' param is omitted", {
  set.seed(12)
  df <- data.frame(
    col_1 = c(rnorm(20, 0, 0.5), rnorm(20, 6, 0.5)),
    col_2 = c(rnorm(20, 6, 0.5), rnorm(20, 0, 0.5))
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "x", col_2 = "y")
  ))
  result <- run_analysis_script("kmeans.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  mat <- as.matrix(df[, c("col_1", "col_2")])
  set.seed(1)
  ref <- kmeans(mat, centers = 2, nstart = 10, iter.max = 50)

  ctr <- find_table(result, "output.kmeans.centersTitle")
  expect_equal(length(ctr$columns), 3L, tolerance = 1e-9, "centers table has 2 cluster columns")
  for (i in 1:2) for (cl in 1:2) {
    expect_equal(cell_num(ctr, i, cl + 1), unname(ref$centers[cl, i]),
                 tolerance = 5e-3, sprintf("center[var %d, cluster %d]", i, cl))
  }
  sizes <- find_table(result, "output.kmeans.sizesTitle")
  expect_equal(cell_num(sizes, 1, 2) + cell_num(sizes, 2, 2), nrow(mat),
               tolerance = 1e-9, "cluster sizes sum to N")
})

test_that("hierarchical: ward.D2 schedule matches hclust() merges and heights", {
  set.seed(21)
  df <- data.frame(col_1 = rnorm(12), col_2 = rnorm(12))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "x", col_2 = "y"),
    method = "ward.D2"
  ))
  result <- run_analysis_script("hierarchical.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- hclust(dist(as.matrix(df)), method = "ward.D2")
  sched <- find_table(result, "output.hier.scheduleTitle")
  expect_equal(length(sched$rows), nrow(df) - 1L, tolerance = 1e-9, "n-1 schedule rows")
  for (i in seq_len(nrow(ref$merge))) {
    a <- ref$merge[i, 1]; b <- ref$merge[i, 2]
    # hclust merge encoding: negative = case -m, positive = earlier stage m
    expect_equal(cell_num(sched, i, 1), i, tolerance = 1e-9, sprintf("stage %d index", i))
    expect_equal(cell_num(sched, i, 2), if (a < 0) -a else a,
                 tolerance = 1e-9, sprintf("stage %d cluster 1", i))
    expect_equal(cell_num(sched, i, 3), if (b < 0) -b else b,
                 tolerance = 1e-9, sprintf("stage %d cluster 2", i))
    expect_equal(cell_num(sched, i, 4), ref$height[i],
                 tolerance = 1e-3, sprintf("stage %d coefficient", i))
  }
})

test_that("hierarchical: average-linkage coefficients match cluster::agnes()", {
  suppressPackageStartupMessages(library(cluster))
  set.seed(31)
  df <- data.frame(col_1 = rnorm(10), col_2 = rnorm(10), col_3 = rnorm(10))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c"),
    method = "average"
  ))
  result <- run_analysis_script("hierarchical.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # agnes() is an independent implementation of the same UPGMA update; ties in
  # merge order may differ between implementations, so heights are compared
  # sorted (for average linkage the height sequence is non-decreasing anyway).
  ref <- agnes(dist(as.matrix(df)), diss = TRUE, method = "average")
  sched <- find_table(result, "output.hier.scheduleTitle")
  got <- vapply(seq_along(sched$rows), function(i) cell_num(sched, i, 4), numeric(1))
  expect_equal(sort(got), sort(unname(ref$height)),
               tolerance = 1e-3, "average-linkage coefficients vs agnes")
})

test_that("mds: Stress-I, RSQ and 2-D coordinates match cmdscale()", {
  set.seed(41)
  x1 <- rnorm(20)
  df <- data.frame(
    col_1 = x1,
    col_2 = x1 * 0.6 + rnorm(20, sd = 0.8),
    col_3 = rnorm(20, mean = 3, sd = 2),
    col_4 = rnorm(20, sd = 0.5)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "v1", col_2 = "v2", col_3 = "v3", col_4 = "v4"),
    dimensions = 2
  ))
  result <- run_analysis_script("mds.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Reference: standardize variables, Euclidean distances between variable
  # vectors, classical MDS via cmdscale(); Stress-I is Kruskal's stress
  # formula 1 recomputed from the reference distances.
  z <- scale(as.matrix(df))
  D <- dist(t(z))
  ref <- cmdscale(D, k = 2, eig = TRUE)
  dv <- as.numeric(D)
  dh <- as.numeric(dist(ref$points))
  stress1 <- sqrt(sum((dv - dh)^2) / sum(dv^2))
  rsq <- cor(dv, dh)^2

  fit <- find_table(result, "output.mds.fitTitle")
  expect_equal(cell_num(fit, 1, 2), stress1, tolerance = 1e-4, "Stress-I")
  expect_equal(cell_num(fit, 2, 2), rsq, tolerance = 1e-4, "RSQ")

  coord <- find_table(result, "output.mds.coordTitle")
  # row i = object i; col 1 = object label, cols 2..3 = dimension coordinates
  for (i in 1:4) for (d in 1:2) {
    expect_equal(cell_num(coord, i, d + 1), unname(ref$points[i, d]),
                 tolerance = 1e-3, sprintf("coord[obj %d, dim %d]", i, d))
  }
})

test_that("mds: dimensions = 3 yields three coordinate columns matching cmdscale(k = 3)", {
  set.seed(42)
  df <- data.frame(
    col_1 = rnorm(25),
    col_2 = rnorm(25),
    col_3 = rnorm(25),
    col_4 = rnorm(25),
    col_5 = rnorm(25)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4", "col_5"),
    varNames = list(col_1 = "v1", col_2 = "v2", col_3 = "v3", col_4 = "v4", col_5 = "v5"),
    dimensions = 3
  ))
  result <- run_analysis_script("mds.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  z <- scale(as.matrix(df))
  D <- dist(t(z))
  ref <- cmdscale(D, k = 3, eig = TRUE)

  coord <- find_table(result, "output.mds.coordTitle")
  expect_equal(length(coord$columns), 4L, tolerance = 1e-9, "object label + 3 dim columns")
  for (i in 1:5) for (d in 1:3) {
    expect_equal(cell_num(coord, i, d + 1), unname(ref$points[i, d]),
                 tolerance = 1e-3, sprintf("coord[obj %d, dim %d]", i, d))
  }

  # 3-D fit: with k = p - 1 = 4 the solution would be exact; k = 3 for 5
  # objects still reproduces the reference stress of the k = 3 solution.
  dv <- as.numeric(D)
  dh <- as.numeric(dist(ref$points))
  stress1 <- sqrt(sum((dv - dh)^2) / sum(dv^2))
  fit <- find_table(result, "output.mds.fitTitle")
  expect_equal(cell_num(fit, 1, 2), stress1, tolerance = 1e-4, "Stress-I (3-D)")
})


test_that("hierarchical: clusters param produces cutree() membership table", {
  set.seed(41)
  df <- data.frame(col_1 = rnorm(12), col_2 = rnorm(12))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "x", col_2 = "y"),
    method = "ward.D2",
    clusters = 3
  ))
  result <- run_analysis_script("hierarchical.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref <- stats::cutree(hclust(dist(as.matrix(df)), method = "ward.D2"), k = 3)
  memb <- find_table(result, "output.hier.membershipTitle")
  expect_equal(length(memb$rows), nrow(df), tolerance = 1e-9, "one membership row per case")
  for (i in seq_len(nrow(df))) {
    expect_equal(cell_num(memb, i, 1), i, tolerance = 1e-9, sprintf("case index %d", i))
    expect_equal(cell_num(memb, i, 2), unname(ref[i]),
                 tolerance = 1e-9, sprintf("membership of case %d", i))
  }
})

test_that("hierarchical: clusters = 0 yields no membership table", {
  set.seed(42)
  df <- data.frame(col_1 = rnorm(8), col_2 = rnorm(8))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "x", col_2 = "y")
  ))
  result <- run_analysis_script("hierarchical.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_equal(length(result$tables), 1L, tolerance = 1e-9, "only the schedule table")
})
