# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-factor.R — validates r-scripts/factor.R's Varimax rotation (B4,
# spss-parity-findings-2026-07-07) against base R's own stats::varimax(),
# and checks the rotation-invariant identities every correct implementation
# must satisfy: per-variable communalities and total variance are preserved
# by an orthogonal rotation.

test_that("factor rotation=varimax matches stats::varimax() and preserves communalities/total variance", {
  set.seed(21)
  n <- 100
  x1 <- rnorm(n); x2 <- x1 * 0.7 + rnorm(n) * 0.5
  x3 <- rnorm(n); x4 <- x3 * 0.8 + rnorm(n) * 0.4
  df <- data.frame(col_1 = x1, col_2 = x2, col_3 = x3, col_4 = x4)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "x1", col_2 = "x2", col_3 = "x3", col_4 = "x4"),
    options = list(rotation = "varimax")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Independent reference computation (mirrors the script's own extraction,
  # but the rotation call is the thing under test).
  mat <- cbind(x1, x2, x3, x4)
  R <- cor(mat); e <- eigen(R, symmetric = TRUE)
  retain <- which(e$values > 1)
  load <- e$vectors[, retain, drop = FALSE] %*% diag(sqrt(e$values[retain]), length(retain))
  vm <- stats::varimax(load)
  ref_rot_load <- unclass(vm$loadings)
  ref_comm <- rowSums(ref_rot_load^2)

  comm_table <- find_table(result, "output.factor.commTitle")
  # Rotation must not change communalities (extraction column, col 3).
  for (i in 1:4) {
    expect_equal(cell_num(comm_table, i, 3), ref_comm[i], tolerance = 1e-3,
                 paste("communality preserved for variable", i))
  }

  rot_ss_table <- find_table(result, "output.factor.rotationSSTitle")
  total_rotated_variance <- sum(vapply(seq_along(retain), function(i) cell_num(rot_ss_table, i, 2), numeric(1)))
  expect_equal(total_rotated_variance, sum(e$values[retain]), tolerance = 1e-3,
               "rotation preserves total extracted variance")

  transform_table <- find_table(result, "output.factor.transformMatrixTitle")
  # The Component Transformation Matrix (rotmat) must be orthogonal: its
  # columns have unit norm and R^T R = I.
  rotmat <- matrix(NA_real_, nrow = length(retain), ncol = length(retain))
  for (i in seq_along(retain)) for (j in seq_along(retain)) {
    rotmat[i, j] <- cell_num(transform_table, i, j + 1)
  }
  expect_equal(as.numeric(t(rotmat) %*% rotmat), as.numeric(diag(length(retain))), tolerance = 5e-3,
               "transformation matrix is orthogonal (R^T R = I)")
})

# ── KMO and Bartlett's Test (Descriptives panel option) ─────────────────────
# Oracle: psych::KMO() / psych::cortest.bartlett() called directly on the same
# correlation matrix — validates wiring/rounding, not psych's own math.
test_that("factor options$kmoBartlett=TRUE emits a KMO/Bartlett table matching psych directly", {
  skip_needs <- !requireNamespace("psych", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: psych not installed)\n")
    return(invisible())
  }
  set.seed(26)
  n <- 100
  x1 <- rnorm(n); x2 <- x1 * 0.7 + rnorm(n) * 0.5
  x3 <- rnorm(n); x4 <- x3 * 0.8 + rnorm(n) * 0.4
  df <- data.frame(col_1 = x1, col_2 = x2, col_3 = x3, col_4 = x4)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "x1", col_2 = "x2", col_3 = "x3", col_4 = "x4"),
    options = list(kmoBartlett = TRUE)
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  mat <- cbind(x1, x2, x3, x4)
  R <- cor(mat)
  ref_kmo <- psych::KMO(R)
  ref_bartlett <- psych::cortest.bartlett(R, n = n)

  kmo_table <- find_table(result, "output.factor.kmoBartlettTitle")
  expect_equal(cell_num(kmo_table, 1, 2), round(ref_kmo$MSA, 3), tolerance = 1e-6, "KMO MSA")
  expect_equal(cell_num(kmo_table, 2, 2), round(ref_bartlett$chisq, 3), tolerance = 1e-6, "Bartlett chi-square")
  expect_equal(cell_num(kmo_table, 3, 2), ref_bartlett$df, tolerance = 1e-9, "Bartlett df")
  expect_equal(cell_num(kmo_table, 4, 2), round(ref_bartlett$p.value, 6), tolerance = 1e-9, "Bartlett p-value")
})

test_that("factor without kmoBartlett option (default) does not emit the KMO/Bartlett table", {
  set.seed(27)
  df <- data.frame(col_1 = rnorm(40), col_2 = rnorm(40), col_3 = rnorm(40))
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_kmo <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.factor.kmoBartlettTitle"), logical(1)))
  expect_true(!has_kmo, "KMO/Bartlett table is opt-in only")
})

test_that("factor with rotation=none (default) is unaffected — no rotated tables emitted", {
  set.seed(22)
  df <- data.frame(
    col_1 = rnorm(50), col_2 = rnorm(50), col_3 = rnorm(50)
  )
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  has_rotated <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.factor.rotatedMatrixTitle"), logical(1)))
  expect_true(!has_rotated, "no Rotated Component Matrix table when rotation is not requested")
})

# ── Oblique rotation (Oblimin/Promax) — B4 extension ────────────────────────
# Oracle: GPArotation::oblimin() / psych::Promax() called directly, not the
# script's own logic — validates wiring, not the packages' own math. Checks
# the key invariant every oblique implementation must satisfy: communality
# reconstructed from Pattern * Structure equals the pre-rotation communality
# (verified analytically in the factor.R header comment).
# The sign of a factor is arbitrary: flipping a whole column of the pattern
# matrix (and the matching row and column of Phi) describes the same solution.
# factor.R therefore reflects each factor so its dominant loading is positive,
# which is the convention SPSS prints. GPArotation and psych::Promax do not,
# so a raw element-by-element comparison fails on the convention rather than
# on the mathematics — as it did the moment `psych` was reinstalled and these
# two tests stopped being skipped.
#
# Applying the SAME rule to the reference keeps the comparison strict about
# everything that matters (magnitudes, structure, Phi's off-diagonals) while
# ignoring the one thing that carries no information. A whole column is
# flipped or nothing is: a single element changing sign would still fail, and
# should.
reflect_reference <- function(pattern, phi) {
  for (j in seq_len(ncol(pattern))) {
    dominant <- which.max(abs(pattern[, j]))
    if (pattern[dominant, j] < 0) {
      pattern[, j] <- -pattern[, j]
      phi[j, ] <- -phi[j, ]
      phi[, j] <- -phi[, j]
    }
  }
  list(pattern = pattern, phi = phi)
}

test_that("factor rotation=oblimin: Pattern/Structure/Phi match GPArotation directly", {
  skip_needs <- !requireNamespace("GPArotation", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: GPArotation not installed)\n")
    return(invisible())
  }
  set.seed(23)
  n <- 150
  x1 <- rnorm(n); x2 <- x1 * 0.7 + rnorm(n) * 0.5
  x3 <- rnorm(n); x4 <- x3 * 0.8 + rnorm(n) * 0.4
  df <- data.frame(col_1 = x1, col_2 = x2, col_3 = x3, col_4 = x4)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "x1", col_2 = "x2", col_3 = "x3", col_4 = "x4"),
    options = list(rotation = "oblimin")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  mat <- cbind(x1, x2, x3, x4)
  R <- cor(mat); e <- eigen(R, symmetric = TRUE)
  retain <- which(e$values > 1)
  load <- e$vectors[, retain, drop = FALSE] %*% diag(sqrt(e$values[retain]), length(retain))
  ob <- GPArotation::oblimin(load)
  .r <- reflect_reference(unclass(ob$loadings), ob$Phi)
  ref_pattern <- .r$pattern; ref_phi <- .r$phi
  ref_structure <- ref_pattern %*% ref_phi
  ref_comm <- rowSums(ref_pattern * ref_structure)

  pat_table <- find_table(result, "output.factor.patternMatrixTitle")
  struct_table <- find_table(result, "output.factor.structureMatrixTitle")
  phi_table <- find_table(result, "output.factor.factorCorrTitle")

  for (i in 1:4) for (j in seq_along(retain)) {
    expect_equal(cell_num(pat_table, i, j + 1), ref_pattern[i, j], tolerance = 1e-2,
                 sprintf("pattern[%d,%d]", i, j))
    expect_equal(cell_num(struct_table, i, j + 1), ref_structure[i, j], tolerance = 1e-2,
                 sprintf("structure[%d,%d]", i, j))
  }
  for (i in seq_along(retain)) for (j in seq_along(retain)) {
    expect_equal(cell_num(phi_table, i, j + 1), ref_phi[i, j], tolerance = 1e-2,
                 sprintf("phi[%d,%d]", i, j))
  }

  # Communality invariant: reconstructing from the script's own OWN output
  # (not just the reference) confirms internal consistency of what's shown.
  comm_table <- find_table(result, "output.factor.commTitle")
  for (i in 1:4) {
    expect_equal(cell_num(comm_table, i, 3), ref_comm[i], tolerance = 1e-3,
                 sprintf("communality preserved for variable %d (oblimin)", i))
  }
})

test_that("factor rotation=promax: Pattern/Structure/Phi match psych::Promax directly", {
  skip_needs <- !requireNamespace("psych", quietly = TRUE) || !requireNamespace("GPArotation", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: psych/GPArotation not installed)\n")
    return(invisible())
  }
  set.seed(24)
  n <- 150
  x1 <- rnorm(n); x2 <- x1 * 0.7 + rnorm(n) * 0.5
  x3 <- rnorm(n); x4 <- x3 * 0.8 + rnorm(n) * 0.4
  df <- data.frame(col_1 = x1, col_2 = x2, col_3 = x3, col_4 = x4)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "x1", col_2 = "x2", col_3 = "x3", col_4 = "x4"),
    options = list(rotation = "promax")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  mat <- cbind(x1, x2, x3, x4)
  R <- cor(mat); e <- eigen(R, symmetric = TRUE)
  retain <- which(e$values > 1)
  load <- e$vectors[, retain, drop = FALSE] %*% diag(sqrt(e$values[retain]), length(retain))
  pm <- psych::Promax(load)
  .r <- reflect_reference(unclass(pm$loadings), pm$Phi)
  ref_pattern <- .r$pattern; ref_phi <- .r$phi

  pat_table <- find_table(result, "output.factor.patternMatrixTitle")
  phi_table <- find_table(result, "output.factor.factorCorrTitle")
  for (i in 1:4) for (j in seq_along(retain)) {
    expect_equal(cell_num(pat_table, i, j + 1), ref_pattern[i, j], tolerance = 1e-2,
                 sprintf("pattern[%d,%d]", i, j))
  }
  for (i in seq_along(retain)) for (j in seq_along(retain)) {
    expect_equal(cell_num(phi_table, i, j + 1), ref_phi[i, j], tolerance = 1e-2,
                 sprintf("phi[%d,%d]", i, j))
  }
})

test_that("factor: oblique rotations do NOT emit a Rotation Sums of Squared Loadings table", {
  set.seed(25)
  n <- 80
  x1 <- rnorm(n); x2 <- x1 * 0.7 + rnorm(n) * 0.5
  x3 <- rnorm(n); x4 <- x3 * 0.8 + rnorm(n) * 0.4
  df <- data.frame(col_1 = x1, col_2 = x2, col_3 = x3, col_4 = x4)
  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "a", col_2 = "b", col_3 = "c", col_4 = "d"),
    options = list(rotation = "oblimin")
  ))
  result <- run_analysis_script("factor.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_ss <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.factor.rotationSSTitle"), logical(1)))
  expect_true(!has_ss, "no misleading variance-% table for correlated (oblique) factors")
})
