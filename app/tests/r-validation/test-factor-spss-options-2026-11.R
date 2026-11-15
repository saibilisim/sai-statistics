# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-factor-spss-options-2026-11.R — the Factor Analysis options that bring
# the dialog to SPSS's full set: alpha and image factoring, the covariance
# matrix (raw + rescaled), significance levels / determinant / inverse /
# reproduced / anti-image covariance, pairwise deletion and mean substitution,
# the initial / unrotated / rotated display switches, delta and kappa,
# Bartlett and Anderson-Rubin scores with the coefficient matrix, and the
# loading plot. References are hand-computed from the textbook formulas or
# come from base R / GPArotation called directly.

so_data <- function(n = 300, seed = 11) {
  set.seed(seed)
  f1 <- rnorm(n); f2 <- rnorm(n)
  data.frame(col_1 = f1 + rnorm(n, 0, .7), col_2 = f1 + rnorm(n, 0, .8),
             col_3 = f1 + rnorm(n, 0, .9), col_4 = f2 + rnorm(n, 0, .7),
             col_5 = f2 + rnorm(n, 0, .8), col_6 = f2 + rnorm(n, 0, .9))
}
so_run <- function(df, options, createVars = NULL) {
  ids <- names(df)[startsWith(names(df), "col_")]
  prm <- list(variables = as.list(ids),
              varNames = setNames(as.list(paste0("v", seq_along(ids))), ids),
              options = options)
  if (!is.null(createVars)) prm$createVars <- createVars
  run_analysis_script("factor.R", write_fixture(df, prm))
}
so_mat <- function(t, nr, nc, offset = 1) {
  m <- matrix(NA_real_, nr, nc)
  for (i in seq_len(nr)) for (j in seq_len(nc)) m[i, j] <- cell_num(t, i, j + offset)
  m
}
# Loading matrices equal up to column order and sign.
so_same <- function(a, b, tol) {
  if (!all(dim(a) == dim(b))) return(FALSE)
  all(vapply(seq_len(ncol(a)), function(j) any(vapply(seq_len(ncol(b)), function(k)
    max(abs(a[, j] - b[, k])) < tol || max(abs(a[, j] + b[, k])) < tol, logical(1))), logical(1)))
}
so_has <- function(res, key) any(vapply(res$tables, function(t) identical(t$titleKey, key), logical(1)))
so_reflect <- function(P, Phi) {
  for (j in seq_len(ncol(P))) if (P[which.max(abs(P[, j])), j] < 0) {
    P[, j] <- -P[, j]; Phi[j, ] <- -Phi[j, ]; Phi[, j] <- -Phi[, j]
  }
  list(P = P, Phi = Phi)
}

test_that("factor options: alpha factoring matches a hand-iterated Kaiser-Caffrey solution", {
  df <- so_data(); R <- cor(as.matrix(df))
  h <- 1 - 1 / diag(solve(R))
  for (it in 1:5000) {
    Rs <- R; diag(Rs) <- h
    A <- diag(1 / sqrt(h)) %*% Rs %*% diag(1 / sqrt(h))
    ee <- eigen(A, symmetric = TRUE)
    L <- diag(sqrt(h)) %*% ee$vectors[, 1:2] %*% diag(sqrt(ee$values[1:2]))
    hn <- rowSums(L^2)
    if (max(abs(hn - h)) < 1e-10) break
    h <- hn
  }
  res <- so_run(df, list(extraction = "alpha", criterion = "fixed", nFactors = 2))
  expect_true(isTRUE(res$success), "success")
  fm <- find_table(res, "output.factor.factorMatrixTitle")
  expect_true(so_same(so_mat(fm, 6, 2), L, 3e-3), "alpha loadings (up to sign / order)")
  ct <- find_table(res, "output.factor.commTitle")
  expect_equal(cell_num(ct, 1, 2), round(1 - 1 / solve(R)[1, 1], 3), tolerance = 1e-6, label = "initial = SMC")
})

test_that("factor options: image factoring = S W (G - I) G^-1/2, which rebuilds the image covariance", {
  df <- so_data(); R <- cor(as.matrix(df)); Ri <- solve(R)
  s <- 1 / sqrt(diag(Ri))
  ee <- eigen(R / outer(s, s), symmetric = TRUE)
  img <- function(m) (s * ee$vectors[, 1:m, drop = FALSE]) %*% diag((ee$values[1:m] - 1) / sqrt(ee$values[1:m]), m)
  S2 <- diag(s^2)
  G <- R + S2 %*% Ri %*% S2 - 2 * S2
  Lp <- img(6)
  expect_equal(max(abs(Lp %*% t(Lp) - G)), 0, tolerance = 1e-10, label = "all factors reproduce the image covariance")
  res <- so_run(df, list(extraction = "image", criterion = "fixed", nFactors = 2))
  expect_true(isTRUE(res$success), "success")
  fm <- find_table(res, "output.factor.factorMatrixTitle")
  expect_true(so_same(so_mat(fm, 6, 2), img(2), 1.5e-3), "image loadings")
  ct <- find_table(res, "output.factor.commTitle")
  for (v in 1:6) expect_equal(cell_num(ct, v, 3), round(sum(img(2)[v, ]^2), 3), tolerance = 1.5e-3,
                              label = paste("image communality", v))
})

test_that("factor options: covariance matrix — raw and rescaled PCA, Kaiser on the mean eigenvalue", {
  df <- so_data()
  sc <- c(1, 2, 5, 1, 3, 10)
  for (j in 1:6) df[[j]] <- df[[j]] * sc[j]
  C <- cov(as.matrix(df)); sds <- sqrt(diag(C))
  e <- eigen(C, symmetric = TRUE)
  k <- sum(e$values > mean(e$values))
  raw <- e$vectors[, 1:k, drop = FALSE] %*% diag(sqrt(e$values[1:k]), k)
  res <- so_run(df, list(matrix = "covariance"))
  expect_true(isTRUE(res$success), "success")
  cm <- find_table(res, "output.factor.matrixTitle")
  expect_equal(length(cm$columns), 1 + 2 * k, label = "raw + rescaled columns")
  expect_true(identical(cm$columns[[2]], "output.factor.rawCompHdr:1"), "raw heading")
  expect_true(so_same(so_mat(cm, 6, k), raw, 2e-3), "raw loadings")
  expect_true(so_same(so_mat(cm, 6, k, 1 + k), raw / sds, 2e-3), "rescaled loadings")
  ct <- find_table(res, "output.factor.commTitle")
  expect_equal(cell_num(ct, 6, 2), round(C[6, 6], 3), tolerance = 1e-6, label = "raw initial = variance")
  expect_equal(cell_num(ct, 6, 4), 1, label = "rescaled initial = 1")
  tve <- find_table(res, "output.factor.tveTitle")
  expect_equal(cell_num(tve, 1, 3), round(e$values[1] / sum(e$values) * 100, 3), tolerance = 1e-6,
               label = "percent of the total (trace) variance")
  # Methods SPSS does not run on a covariance matrix fall back, with a warning.
  ml <- so_run(df, list(matrix = "covariance", extraction = "ml", criterion = "fixed", nFactors = 2))
  expect_true("output.factor.covarianceMethod" %in% unlist(ml$warnings), "ML falls back to correlations")
})

test_that("factor options: principal axis factoring on the covariance matrix matches a hand PAF", {
  df <- so_data()
  for (j in 1:6) df[[j]] <- df[[j]] * c(1, 2, 3, 1, 2, 3)[j]
  C <- cov(as.matrix(df))
  h <- diag(C) - 1 / diag(solve(C))
  for (it in 1:20000) {
    Cr <- C; diag(Cr) <- h
    ee <- eigen(Cr, symmetric = TRUE)
    L <- ee$vectors[, 1:2] %*% diag(sqrt(ee$values[1:2]))
    hn <- rowSums(L^2)
    if (max(abs(hn - h)) < 1e-10) break
    h <- hn
  }
  res <- so_run(df, list(matrix = "covariance", extraction = "paf", criterion = "fixed", nFactors = 2,
                         maxIter = 2000))
  expect_true(isTRUE(res$success), "success")
  fm <- find_table(res, "output.factor.factorMatrixTitle")
  expect_true(so_same(so_mat(fm, 6, 2), L, 2e-3), "raw PAF loadings on the covariance matrix")
  expect_true(so_same(so_mat(fm, 6, 2, 3), L / sqrt(diag(C)), 3e-3), "rescaled PAF loadings")
  expect_equal(length(res$warnings), 0, label = "converged, no warning")
  # Very unequal variances make raw-metric PAF crawl (~11,000 iterations
  # here): a run stopped at the limit has to say so. psych reports it with
  # message(), which the script used to miss.
  slow <- so_data()
  for (j in 1:6) slow[[j]] <- slow[[j]] * c(1, 2, 5, 1, 3, 10)[j]
  rs <- so_run(slow, list(matrix = "covariance", extraction = "paf", criterion = "fixed",
                          nFactors = 2, maxIter = 100))
  expect_true("output.factor.notConverged:100" %in% unlist(rs$warnings), "non-convergence reported")
})

test_that("factor options: too many common factors give a readable error, not a numerical one", {
  res <- so_run(so_data(), list(extraction = "paf", criterion = "fixed", nFactors = 3))
  expect_true(!isTRUE(res$success), "fails")
  expect_true(grepl("output.factor.extractionFailed", paste(unlist(res), collapse = " "), fixed = TRUE),
              "extractionFailed key")
})

test_that("factor options: correlation descriptives — significance, determinant, inverse, anti-image covariance", {
  df <- so_data(n = 120); X <- as.matrix(df); R <- cor(X)
  res <- so_run(df, list(sigLevels = TRUE, determinant = TRUE, inverse = TRUE, antiImage = TRUE))
  expect_true(isTRUE(res$success), "success")
  sig <- find_table(res, "output.factor.sigTitle")
  p13 <- cor.test(X[, 1], X[, 3], alternative = if (R[1, 3] > 0) "greater" else "less")$p.value
  p14 <- cor.test(X[, 1], X[, 4], alternative = if (R[1, 4] > 0) "greater" else "less")$p.value
  expect_equal(cell_num(sig, 1, 4), round(p13, 3), tolerance = 1e-9, label = "one-tailed p (1,3)")
  expect_equal(cell_num(sig, 1, 5), round(p14, 3), tolerance = 1e-9, label = "one-tailed p (1,4)")
  expect_true(is.na(cell_num(sig, 2, 3)), "diagonal blank")
  dt <- find_table(res, "output.factor.determinantTitle")
  expect_equal(as.numeric(dt$rows[[1]][[2]]), signif(det(R), 3), tolerance = 1e-12, label = "determinant")
  inv <- find_table(res, "output.factor.inverseTitle")
  expect_equal(cell_num(inv, 2, 4), round(solve(R)[2, 3], 3), tolerance = 1e-9, label = "inverse")
  aic <- find_table(res, "output.factor.antiImageCovTitle")
  expect_equal(cell_num(aic, 1, 2), round(1 / solve(R)[1, 1], 3), tolerance = 1e-9, label = "AIC diag = 1 - SMC")
  Ri <- solve(R)
  expect_equal(cell_num(aic, 1, 3), round(Ri[1, 2] / (Ri[1, 1] * Ri[2, 2]), 3), tolerance = 1e-9,
               label = "AIC off-diagonal")
})

test_that("factor options: reproduced correlations and the residual count", {
  df <- so_data(); R <- cor(as.matrix(df))
  e <- eigen(R, symmetric = TRUE)
  L <- e$vectors[, 1:2] %*% diag(sqrt(e$values[1:2]))
  Rh <- L %*% t(L); res_ref <- R - Rh
  big <- sum(abs(res_ref[upper.tri(res_ref)]) > 0.05)
  res <- so_run(df, list(reproduced = TRUE, rotation = "varimax"))
  expect_true(isTRUE(res$success), "success")
  rp <- find_table(res, "output.factor.reproducedTitle")
  expect_equal(cell_num(rp, 1, 5), round(Rh[1, 4], 3), tolerance = 1e-9, label = "reproduced (1,4)")
  expect_equal(cell_num(rp, 3, 4), round(sum(L[3, ]^2), 3), tolerance = 1e-9, label = "diagonal = communality")
  rs <- find_table(res, "output.factor.residualTitle")
  expect_equal(cell_num(rs, 1, 3), round(res_ref[1, 2], 3), tolerance = 1e-9, label = "residual (1,2)")
  expect_true(identical(rs$footnoteKey, paste0("output.factor.residualFootnote:", big, "|", round(100 * big / 15))),
              "nonredundant residual count")
})

test_that("factor options: pairwise deletion and mean substitution", {
  df <- so_data(n = 200)
  df$col_1[c(3, 9, 40)] <- NA; df$col_4[c(5, 9, 77, 120)] <- NA
  X <- as.matrix(df)
  pw <- so_run(df, list(missing = "pairwise", correlation = TRUE, kmoBartlett = TRUE, univariate = TRUE))
  expect_true(isTRUE(pw$success), "pairwise success")
  Rp <- cor(X, use = "pairwise.complete.obs")
  ct <- find_table(pw, "output.factor.corrTitle")
  expect_equal(cell_num(ct, 1, 5), round(Rp[1, 4], 3), tolerance = 1e-9, label = "pairwise r(1,4)")
  nmin <- min(crossprod(!is.na(X)))
  kb <- find_table(pw, "output.factor.kmoBartlettTitle")
  expect_equal(cell_num(kb, 2, 2), round(psych::cortest.bartlett(Rp, n = nmin)$chisq, 3), tolerance = 1e-9,
               label = "Bartlett on the smallest pairwise N")
  ds <- find_table(pw, "output.factor.descTitle")
  expect_equal(cell_num(ds, 1, 4), 197, label = "per-variable N")
  expect_true(paste0("output.factor.pairwiseNote:", nmin) %in% unlist(pw$notes), "pairwise note")

  ms <- so_run(df, list(missing = "mean", correlation = TRUE))
  Xm <- X; for (j in 1:6) Xm[is.na(Xm[, j]), j] <- mean(Xm[, j], na.rm = TRUE)
  ct2 <- find_table(ms, "output.factor.corrTitle")
  expect_equal(cell_num(ct2, 1, 5), round(cor(Xm)[1, 4], 3), tolerance = 1e-9, label = "mean-substituted r(1,4)")
})

test_that("factor options: initial / unrotated / rotated display switches", {
  df <- so_data()
  res <- so_run(df, list(initialSolution = FALSE, unrotated = FALSE, rotatedSolution = FALSE,
                         rotation = "varimax"))
  expect_true(isTRUE(res$success), "success")
  ct <- find_table(res, "output.factor.commTitle")
  expect_equal(length(ct$columns), 2, label = "communalities: extraction column only")
  tve <- find_table(res, "output.factor.tveTitle")
  expect_equal(length(tve$rows), 2, label = "only the retained components")
  expect_true(identical(tve$columns[[2]], "output.factor.extrSSTotal"), "PCA shows its extraction sums")
  expect_true(!so_has(res, "output.factor.matrixTitle"), "no unrotated matrix")
  expect_true(!so_has(res, "output.factor.rotatedMatrixTitle"), "no rotated matrix")
})

test_that("factor options: oblimin delta and promax kappa reach the rotation", {
  df <- so_data(); R <- cor(as.matrix(df))
  e <- eigen(R, symmetric = TRUE)
  L <- e$vectors[, 1:2] %*% diag(sqrt(e$values[1:2]))
  for (j in 1:2) if (L[which.max(abs(L[, j])), j] < 0) L[, j] <- -L[, j]
  ob <- GPArotation::oblimin(L, gam = -0.5, normalize = TRUE)
  ref <- so_reflect(unclass(ob$loadings), ob$Phi)
  res <- so_run(df, list(rotation = "oblimin", delta = -0.5))
  pt <- find_table(res, "output.factor.patternMatrixTitle")
  expect_true(so_same(so_mat(pt, 6, 2), ref$P, 2e-3), "oblimin delta = -0.5 pattern")
  ph <- find_table(res, "output.factor.factorCorrTitle")
  expect_equal(abs(cell_num(ph, 1, 3)), round(abs(ref$Phi[1, 2]), 3), tolerance = 2e-3, label = "oblimin phi")

  pm <- stats::promax(L, m = 2); ui <- solve(pm$rotmat)
  ref2 <- so_reflect(unclass(pm$loadings), ui %*% t(ui))
  res2 <- so_run(df, list(rotation = "promax", kappa = 2))
  pt2 <- find_table(res2, "output.factor.patternMatrixTitle")
  expect_true(so_same(so_mat(pt2, 6, 2), ref2$P, 2e-3), "promax kappa = 2 pattern")
  big <- so_run(df, list(rotation = "oblimin", delta = 2))
  expect_true("output.factor.deltaTooLarge" %in% unlist(big$warnings), "delta capped at 0.8")
})

test_that("factor options: Bartlett and Anderson-Rubin scores and the coefficient matrix", {
  df <- so_data(); df[["__row_idx"]] <- seq_len(nrow(df)) - 1L
  X <- as.matrix(df[, 1:6]); R <- cor(X); Z <- scale(X)
  base <- list(extraction = "paf", criterion = "fixed", nFactors = 2, rotation = "varimax",
               scoreCoef = TRUE)
  cv <- list(score1 = "f1", score2 = "f2")
  bt <- so_run(df, c(base, scoreMethod = "bartlett"), cv)
  expect_true(isTRUE(bt$success), "success")
  rl <- find_table(bt, "output.factor.rotatedFactorMatrixTitle")
  Lr <- so_mat(rl, 6, 2)
  u2 <- 1 - rowSums(Lr^2)
  Wb <- (Lr / u2) %*% solve(t(Lr) %*% (Lr / u2))
  wt <- find_table(bt, "output.factor.factorScoreCoefTitle")
  expect_true(max(abs(so_mat(wt, 6, 2) - Wb)) < 5e-3, "Bartlett coefficients W = U^-2 L (L'U^-2 L)^-1")
  s <- by_name(bt)
  expect_equal(unlist(s[["f1"]]$values), as.numeric(Z %*% Wb[, 1]), tolerance = 5e-3,
               label = "Bartlett scores = Z W")

  ar <- so_run(df, c(base, scoreMethod = "anderson"), cv)
  sa <- by_name(ar)
  F <- cbind(unlist(sa[["f1"]]$values), unlist(sa[["f2"]]$values))
  expect_equal(as.numeric(cov(F)), c(1, 0, 0, 1), tolerance = 1e-6,
               label = "Anderson-Rubin scores: unit variance, uncorrelated")
  sc <- find_table(ar, "output.factor.factorScoreCovTitle")
  expect_equal(cell_num(sc, 1, 3), 0, tolerance = 1e-9, label = "score covariance off-diagonal")

  # Principal components: the three methods give the same component scores.
  pcb <- list(rotation = "varimax")
  get <- function(m) unlist(by_name(so_run(df, c(pcb, scoreMethod = m), cv))[["f1"]]$values)
  reg <- get("regression")
  expect_equal(get("bartlett"), reg, tolerance = 1e-8, label = "PCA: Bartlett = regression")
  expect_equal(get("anderson"), reg, tolerance = 1e-8, label = "PCA: Anderson-Rubin = regression")
})

test_that("factor options: loading plot — 2D, 3D and a single factor", {
  df <- so_data()
  two <- so_run(df, list(loadingPlot = TRUE, rotation = "varimax"))
  expect_equal(length(two$plots), 1, label = "one plot")
  expect_true(identical(two$plots[[1]]$titleKey, "output.factor.compPlotRotTitle"), "rotated-space title")
  tr <- two$plots[[1]]$data$data[[1]]
  expect_true(identical(tr$type, "scatter") && length(tr$x) == 6, "2D scatter of six variables")
  three <- so_run(df, list(loadingPlot = TRUE, criterion = "fixed", nFactors = 3))
  expect_true(identical(three$plots[[1]]$data$data[[1]]$type, "scatter3d"), "3D for three components")
  fa2 <- so_run(df, list(loadingPlot = TRUE, criterion = "fixed", nFactors = 2, extraction = "paf"))
  expect_true(identical(fa2$plots[[1]]$titleKey, "output.factor.factorPlotTitle"), "unrotated factor plot title")
  one <- so_run(df, list(loadingPlot = TRUE, criterion = "fixed", nFactors = 1))
  expect_equal(length(one$plots), 0, label = "no plot for one factor")
  expect_true("output.factor.loadingPlotOne" %in% unlist(one$warnings), "warning instead")
})
