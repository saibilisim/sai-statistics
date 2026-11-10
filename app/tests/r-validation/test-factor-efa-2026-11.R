# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-factor-efa-2026-11.R — the exploratory factor analysis options added to
# factor.R: common factor extraction (PAF / ML), the number-of-factors rules
# (Kaiser threshold, fixed, parallel analysis), quartimax / equamax, sorted and
# suppressed loadings, anti-image correlations, polychoric correlations and the
# item diagnostics. References are hand-computed (iterated PAF, regression-
# residual partial correlations) or come from stats::factanal, GPArotation and
# psych called directly — never from the script's own helpers.

efa_data <- function(n = 300, seed = 7) {
  set.seed(seed)
  f1 <- rnorm(n); f2 <- rnorm(n)
  data.frame(col_1 = f1 + rnorm(n, 0, .7), col_2 = f1 + rnorm(n, 0, .8),
             col_3 = f1 + rnorm(n, 0, .9), col_4 = f2 + rnorm(n, 0, .7),
             col_5 = f2 + rnorm(n, 0, .8), col_6 = f2 + rnorm(n, 0, .9))
}
efa_params <- function(df, options) {
  ids <- names(df)
  list(variables = as.list(ids), varNames = setNames(as.list(paste0("v", seq_along(ids))), ids),
       options = options)
}
efa_run <- function(df, options) run_analysis_script("factor.R", write_fixture(df, efa_params(df, options)))
mat_of <- function(t, nr, nc, offset = 1) {
  m <- matrix(NA_real_, nr, nc)
  for (i in seq_len(nr)) for (j in seq_len(nc)) m[i, j] <- cell_num(t, i, j + offset)
  m
}
# Compare loading matrices up to column order and sign.
same_loadings <- function(a, b, tol) {
  if (!all(dim(a) == dim(b))) return(FALSE)
  for (j in seq_len(ncol(a))) {
    ok <- any(vapply(seq_len(ncol(b)), function(k)
      max(abs(a[, j] - b[, k])) < tol || max(abs(a[, j] + b[, k])) < tol, logical(1)))
    if (!ok) return(FALSE)
  }
  TRUE
}

test_that("efa: principal axis factoring matches a fully iterated hand PAF", {
  df <- efa_data()
  R <- cor(as.matrix(df))
  smc <- unname(1 - 1 / diag(solve(R)))
  h <- smc
  for (i in 1:1000) {
    Rr <- R; diag(Rr) <- h
    ee <- eigen(Rr, symmetric = TRUE)
    L <- ee$vectors[, 1:2] %*% diag(sqrt(ee$values[1:2]))
    hn <- rowSums(L^2)
    if (max(abs(hn - h)) < 1e-9) break
    h <- hn
  }
  res <- efa_run(df, list(extraction = "paf", criterion = "fixed", nFactors = 2))
  expect_true(isTRUE(res$success), "success")
  ct <- find_table(res, "output.factor.commTitle")
  for (v in 1:6) {
    expect_equal(cell_num(ct, v, 2), round(smc[v], 3), tolerance = 1e-3, label = paste("SMC", v))
    expect_equal(cell_num(ct, v, 3), hn[v], tolerance = 2e-3, label = paste("PAF communality", v))
  }
  fm <- find_table(res, "output.factor.factorMatrixTitle")
  expect_true(identical(fm$columns[[2]], "output.factor.factorHdr:1"), "Factor heading, not Component")
  expect_true(same_loadings(mat_of(fm, 6, 2), L, 3e-3), "PAF loadings (up to sign)")
  tve <- find_table(res, "output.factor.tveTitle")
  expect_equal(length(tve$columns), 7, label = "initial + extraction sums columns")
  expect_equal(cell_num(tve, 1, 5) + cell_num(tve, 2, 5), sum(hn), tolerance = 3e-3,
               label = "extraction sums add up to the communalities")
  expect_true(is.na(cell_num(tve, 3, 5)), "no extraction sum past the retained factors")
})

test_that("efa: maximum likelihood matches stats::factanal incl. goodness of fit", {
  df <- efa_data()
  fl <- factanal(covmat = cor(as.matrix(df)), factors = 2, n.obs = nrow(df), rotation = "none")
  res <- efa_run(df, list(extraction = "ml", criterion = "fixed", nFactors = 2))
  expect_true(isTRUE(res$success), "success")
  fm <- find_table(res, "output.factor.factorMatrixTitle")
  expect_true(same_loadings(mat_of(fm, 6, 2), unclass(fl$loadings), 2e-3), "ML loadings")
  g <- find_table(res, "output.factor.gofTitle")
  expect_equal(cell_num(g, 1, 1), unname(fl$STATISTIC), tolerance = 1e-3, label = "chi-square")
  expect_equal(cell_num(g, 1, 2), unname(fl$dof), label = "df")
  expect_equal(cell_num(g, 1, 3), unname(fl$PVAL), tolerance = 1e-4, label = "p")
})

test_that("efa: number of factors — Kaiser threshold, fixed and parallel analysis", {
  df <- efa_data()
  ev <- eigen(cor(as.matrix(df)), symmetric = TRUE)$values
  r <- efa_run(df, list(criterion = "eigen", minEigen = 0.5))
  expect_equal(length(find_table(r, "output.factor.matrixTitle")$columns) - 1, sum(ev > 0.5),
               label = "eigenvalue > 0.5")
  r <- efa_run(df, list(criterion = "fixed", nFactors = 3))
  expect_equal(length(find_table(r, "output.factor.matrixTitle")$columns) - 1, 3, label = "fixed 3")

  r <- efa_run(df, list(criterion = "parallel", scree = TRUE))
  expect_true(isTRUE(r$success), "parallel success")
  expect_equal(length(find_table(r, "output.factor.matrixTitle")$columns) - 1, 2,
               label = "parallel analysis keeps the two true factors")
  pt <- find_table(r, "output.factor.parallelTitle")
  # The eigenvalues of a correlation matrix sum to p, so the random means must.
  expect_equal(sum(vapply(1:6, function(i) cell_num(pt, i, 3), numeric(1))), 6, tolerance = 5e-3,
               label = "random mean eigenvalues sum to p")
  expect_true(all(vapply(1:6, function(i) cell_num(pt, i, 4) >= cell_num(pt, i, 3), logical(1))),
              "95th percentile >= mean")
  expect_true(identical(pt$rows[[2]][[5]], "output.factor.paRetain") &&
              identical(pt$rows[[3]][[5]], "output.factor.paDrop"), "decision column")
  # Against psych::fa.parallel's own simulation (independent RNG): close, not equal.
  if (requireNamespace("psych", quietly = TRUE)) {
    set.seed(99)
    fp <- suppressMessages(suppressWarnings(psych::fa.parallel(
      as.matrix(df), fa = "pc", n.iter = 200, plot = FALSE, sim = TRUE)))
    expect_equal(cell_num(pt, 1, 3), fp$pc.sim[1], tolerance = 0.02,
                 label = "first random mean eigenvalue vs psych::fa.parallel")
  }
  sc <- r$plots[[1]]
  expect_true(identical(sc$titleKey, "output.factor.screeTitle"), "scree plot")
  expect_equal(length(sc$data$data), 2, label = "observed + parallel traces")

  # Pure noise: nothing beats chance; one factor is still shown, with a warning.
  set.seed(5)
  noise <- as.data.frame(matrix(rnorm(200 * 5), 200, 5)); names(noise) <- paste0("col_", 1:5)
  r <- efa_run(noise, list(criterion = "parallel"))
  expect_true("output.factor.parallelNone" %in% unlist(r$warnings), "no factor above chance")
})

test_that("efa: quartimax and equamax match GPArotation and keep communalities", {
  df <- efa_data()
  R <- cor(as.matrix(df)); ee <- eigen(R, symmetric = TRUE)
  L <- ee$vectors[, 1:2] %*% diag(sqrt(ee$values[1:2]))
  for (j in 1:2) if (L[which.max(abs(L[, j])), j] < 0) L[, j] <- -L[, j]
  refs <- list(quartimax = unclass(GPArotation::quartimax(L, normalize = TRUE)$loadings),
               equamax = unclass(GPArotation::cfT(L, kappa = 2 / 12, normalize = TRUE)$loadings))
  for (rot in names(refs)) {
    res <- efa_run(df, list(rotation = rot))
    expect_true(isTRUE(res$success), paste(rot, "success"))
    rm <- find_table(res, "output.factor.rotatedMatrixTitle")
    got <- mat_of(rm, 6, 2)
    expect_equal(as.numeric(got), as.numeric(round(refs[[rot]], 3)), tolerance = 2e-3, label = rot)
    expect_equal(rowSums(got^2), rowSums(L^2), tolerance = 5e-3, label = paste(rot, "communalities"))
    expect_true(startsWith(rm$footnoteKey, "output.factor.rotFootnote:"), paste(rot, "footnote"))
  }
})

test_that("efa: sorted by size and small coefficients suppressed", {
  df <- efa_data()[, c(4, 1, 5, 2, 6, 3)]
  names(df) <- paste0("col_", 1:6)
  res <- efa_run(df, list(rotation = "varimax", sortBySize = TRUE, suppressBelow = 0.4))
  rm <- find_table(res, "output.factor.rotatedMatrixTitle")
  # Rows grouped by factor: three items load on factor 1, then three on factor 2.
  f1 <- vapply(1:6, function(i) !is.na(cell_num(rm, i, 2)), logical(1))
  expect_true(identical(f1, c(TRUE, TRUE, TRUE, FALSE, FALSE, FALSE)), "grouped and blanked")
  first <- vapply(1:3, function(i) abs(cell_num(rm, i, 2)), numeric(1))
  expect_true(!is.unsorted(rev(first)), "descending within the group")
  expect_true(any(startsWith(unlist(res$notes), "output.factor.suppressNote:")), "suppress note")
})

test_that("efa: anti-image correlations against regression-residual partials", {
  df <- efa_data(150, 11)
  X <- as.matrix(df)
  partial <- function(i, j) {
    others <- setdiff(1:6, c(i, j))
    cor(resid(lm(X[, i] ~ X[, others])), resid(lm(X[, j] ~ X[, others])))
  }
  res <- efa_run(df, list(antiImage = TRUE, kmoBartlett = TRUE))
  ai <- find_table(res, "output.factor.antiImageTitle")
  expect_equal(cell_num(ai, 1, 3), round(-partial(1, 2), 3), tolerance = 1e-3, label = "anti-image 1,2")
  expect_equal(cell_num(ai, 4, 7), round(-partial(4, 6), 3), tolerance = 1e-3, label = "anti-image 4,6")
  msa <- psych::KMO(cor(X))$MSAi
  for (v in 1:6) expect_equal(cell_num(ai, v, v + 1), round(unname(msa[v]), 3), tolerance = 1e-3,
                              label = paste("MSA", v))
})

test_that("efa: polychoric matrix for Likert items, Pearson fallback otherwise", {
  df <- efa_data()
  lik <- as.data.frame(lapply(df, function(v) as.integer(cut(v, c(-Inf, -1, -.3, .3, 1, Inf)))))
  rho <- psych::polychoric(as.matrix(lik))$rho
  res <- efa_run(lik, list(matrix = "polychoric", correlation = TRUE, univariate = TRUE))
  expect_true(isTRUE(res$success), "success")
  ct <- find_table(res, "output.factor.corrTitle")
  expect_equal(cell_num(ct, 1, 3), round(rho[1, 2], 3), tolerance = 1e-3, label = "polychoric r12")
  expect_equal(cell_num(ct, 5, 2), round(rho[5, 1], 3), tolerance = 1e-3, label = "polychoric r51")
  expect_true(startsWith(ct$footnoteKey, "output.factor.determinantFootnote:"), "determinant")
  dt <- find_table(res, "output.factor.descTitle")
  expect_equal(cell_num(dt, 1, 2), round(mean(lik$col_1), 3), label = "mean")
  expect_equal(cell_num(dt, 1, 4), nrow(lik), label = "analysis N")

  res2 <- efa_run(df, list(matrix = "polychoric"))
  expect_true("output.factor.polychoricFallback" %in% unlist(res2$warnings), "continuous -> Pearson")
})

test_that("efa: low-loading and cross-loading items are named", {
  df <- efa_data()
  set.seed(3)
  df$col_7 <- rnorm(nrow(df))                                   # loads on nothing
  df$col_8 <- (df$col_1 + df$col_4) / 2 + rnorm(nrow(df), 0, .5) # loads on both
  res <- efa_run(df, list(rotation = "varimax", criterion = "fixed", nFactors = 2))
  nt <- unlist(res$notes)
  expect_true(any(grepl("^output.factor.lowLoadingNote:.*v7", nt)), "v7 low loading")
  expect_true(any(grepl("^output.factor.crossLoadingNote:.*v8", nt)), "v8 cross-loading")
})

test_that("efa: default PCA output is unchanged (no extra tables or plots)", {
  res <- efa_run(efa_data(), list())
  keys <- vapply(res$tables, function(t) t$titleKey, character(1))
  expect_true(identical(keys, c("output.factor.commTitle", "output.factor.tveTitle",
                                "output.factor.matrixTitle")), paste(keys, collapse = " "))
  expect_true(length(res$plots) == 0, "no plots by default")
  expect_true(identical(find_table(res, "output.factor.matrixTitle")$footnoteKey,
                        "output.factor.matrixFootnote"), "classic footnote")
})
