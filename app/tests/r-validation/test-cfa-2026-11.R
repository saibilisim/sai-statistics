# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-cfa-2026-11.R — Confirmatory Factor Analysis (cfa.R).
# References: the three-factor Holzinger & Swineford (1939) model as published
# in the lavaan tutorial (fit indices, loadings, factor covariances, top
# modification indices, the school invariance sequence); CR / AVE / HTMT
# computed by hand from their definitions; Cronbach's alpha from psych::alpha;
# the WLSMV and MLR values from lavaan called directly with the same options.

hs <- function() {
  d <- lavaan::HolzingerSwineford1939
  out <- as.data.frame(setNames(lapply(paste0("x", 1:9), function(v) d[[v]]), paste0("col_", 1:9)))
  out$col_school <- as.character(d$school)
  out
}
hs_factors <- list(
  list(name = "visual", items = list("col_1", "col_2", "col_3")),
  list(name = "textual", items = list("col_4", "col_5", "col_6")),
  list(name = "speed", items = list("col_7", "col_8", "col_9")))
cfa_run <- function(df, options = list(), factors = hs_factors, extra = list()) {
  ids <- grep("^col_[0-9]+$", names(df), value = TRUE)
  p <- c(list(variables = as.list(ids),
              varNames = setNames(as.list(sub("col_", "x", ids)), ids),
              factors = factors, options = options), extra)
  run_analysis_script("cfa.R", write_fixture(df, p))
}
row_of <- function(t, label, col = 1) {
  for (i in seq_along(t$rows)) if (identical(t$rows[[i]][[col]], label)) return(i)
  NA_integer_
}

test_that("cfa: ML Holzinger-Swineford matches the published lavaan solution", {
  res <- cfa_run(hs(), list(estimator = "ml"))
  expect_true(isTRUE(res$success), "success")
  f <- find_table(res, "output.cfa.fitTitle")
  v <- function(lbl) cell_num(f, row_of(f, lbl), 2)
  expect_equal(v("χ²"), 85.306, tolerance = 1e-3, label = "chi-square")
  expect_equal(v("df"), 24, label = "df")
  expect_equal(v("χ²/df"), 85.306 / 24, tolerance = 1e-3, label = "chi-square / df")
  expect_equal(v("CFI"), 0.931, tolerance = 1e-3, label = "CFI")
  expect_equal(v("TLI"), 0.896, tolerance = 1e-3, label = "TLI")
  expect_equal(v("RMSEA"), 0.092, tolerance = 1e-3, label = "RMSEA")
  expect_equal(v("output.cfa.rmseaLo"), 0.071, tolerance = 1e-3, label = "RMSEA lower")
  expect_equal(v("output.cfa.rmseaHi"), 0.114, tolerance = 1e-3, label = "RMSEA upper")
  expect_equal(v("SRMR"), 0.065, tolerance = 1e-3, label = "SRMR")
  expect_equal(v("AIC"), 7517.490, tolerance = 1e-2, label = "AIC")
  expect_equal(v("BIC"), 7595.339, tolerance = 1e-2, label = "BIC")
  expect_true(identical(f$rows[[row_of(f, "CFI")]][[5]], "output.cfa.fitAcceptable"), "CFI .931 acceptable")
  expect_true(identical(f$rows[[row_of(f, "RMSEA")]][[5]], "output.cfa.fitPoor"), "RMSEA .092 poor")
  expect_true(identical(f$rows[[row_of(f, "SRMR")]][[5]], "output.cfa.fitAcceptable"), "SRMR .065 acceptable")

  ld <- find_table(res, "output.cfa.loadingsTitle")
  std <- c(.772, .424, .581, .852, .855, .838, .570, .723, .665)
  for (i in 1:9) expect_equal(cell_num(ld, i, 7), std[i], tolerance = 1.5e-3, label = paste("std loading x", i))
  est <- c(NA, .554, .729, NA, 1.113, .926, NA, 1.180, 1.082)
  se  <- c(NA, .100, .109, NA, .065, .055, NA, .165, .151)
  for (i in c(2, 3, 5, 6, 8, 9)) {
    expect_equal(cell_num(ld, i, 3), est[i], tolerance = 1.5e-3, label = paste("loading x", i))
    expect_equal(cell_num(ld, i, 4), se[i], tolerance = 1.5e-3, label = paste("SE x", i))
  }
  for (i in c(1, 4, 7)) {
    expect_equal(cell_num(ld, i, 3), 1, label = paste("marker x", i))
    expect_true(is.na(cell_num(ld, i, 4)) && is.na(cell_num(ld, i, 6)), paste("marker x", i, "has no SE / p"))
  }
  expect_equal(cell_num(ld, 2, 8), .424^2, tolerance = 1e-2, label = "R-square = squared std loading")

  fc <- find_table(res, "output.cfa.factorCovTitle")
  expect_equal(cell_num(fc, 1, 2), .408, tolerance = 1.5e-3, label = "visual~~textual")
  expect_equal(cell_num(fc, 1, 3), .074, tolerance = 1.5e-3, label = "its SE")
  expect_equal(cell_num(fc, 2, 2), .262, tolerance = 1.5e-3, label = "visual~~speed")
  expect_equal(cell_num(fc, 3, 2), .173, tolerance = 1.5e-3, label = "textual~~speed")
  expect_equal(cell_num(fc, 1, 6), .459, tolerance = 1.5e-3, label = "visual-textual correlation")
  expect_true(any(startsWith(unlist(res$notes), "output.cfa.lowLoadings:x2")), "x2 flagged below .50")
  expect_true(length(res$plots) == 1 && identical(res$plots[[1]]$type, "svg"), "path diagram")
})

test_that("cfa: CR, AVE, Fornell-Larcker, HTMT and alpha follow their definitions", {
  df <- hs()
  res <- cfa_run(df, list(estimator = "ml"))
  lam <- list(c(.772, .424, .581), c(.852, .855, .838), c(.570, .723, .665))
  rt <- find_table(res, "output.cfa.reliabilityTitle")
  X <- as.matrix(df[paste0("col_", 1:9)])
  for (f in 1:3) {
    l <- lam[[f]]
    cr <- sum(l)^2 / (sum(l)^2 + sum(1 - l^2)); ave <- mean(l^2)
    a <- psych::alpha(X[, (3 * f - 2):(3 * f)], warnings = FALSE)$total$raw_alpha
    expect_equal(cell_num(rt, f, 3), a, tolerance = 1e-3, label = paste("alpha", f))
    expect_equal(cell_num(rt, f, 4), cr, tolerance = 3e-3, label = paste("CR", f))
    expect_equal(cell_num(rt, f, 5), ave, tolerance = 3e-3, label = paste("AVE", f))
    expect_equal(cell_num(rt, f, 6), sqrt(ave), tolerance = 3e-3, label = paste("sqrt AVE", f))
  }
  # MSV of visual = its largest squared correlation (.471 with speed).
  expect_equal(cell_num(rt, 1, 7), .471^2, tolerance = 1e-2, label = "MSV visual")
  fl <- find_table(res, "output.cfa.fornellTitle")
  expect_equal(cell_num(fl, 2, 2), .459, tolerance = 1.5e-3, label = "Fornell-Larcker off-diagonal")
  expect_true(is.na(cell_num(fl, 1, 3)), "upper triangle blank")
  # HTMT by hand (Henseler et al. 2015, absolute correlations).
  R <- abs(cor(X)); blk <- list(1:3, 4:6, 7:9)
  mono <- vapply(blk, function(b) { s <- R[b, b]; mean(s[upper.tri(s)]) }, 0)
  ht <- find_table(res, "output.cfa.htmtTitle")
  for (i in 2:3) for (j in 1:(i - 1)) {
    h <- mean(R[blk[[i]], blk[[j]]]) / sqrt(mono[i] * mono[j])
    expect_equal(cell_num(ht, i, j + 1), h, tolerance = 5e-3, label = paste("HTMT", i, j))
  }
})

test_that("cfa: standardized-latent identification gives the same fit, loadings free", {
  res <- cfa_run(hs(), list(estimator = "ml", identification = "std"))
  f <- find_table(res, "output.cfa.fitTitle")
  expect_equal(cell_num(f, row_of(f, "χ²"), 2), 85.306, tolerance = 1e-3, label = "same chi-square")
  ld <- find_table(res, "output.cfa.loadingsTitle")
  expect_true(!is.na(cell_num(ld, 1, 4)), "first loading has an SE")
  vt <- find_table(res, "output.cfa.varianceTitle")
  expect_equal(cell_num(vt, row_of(vt, "visual"), 2), 1, label = "factor variance fixed at 1")
})

test_that("cfa: orthogonal factors, error covariance and the modification indices", {
  ort <- cfa_run(hs(), list(estimator = "ml", correlated = FALSE))
  f <- find_table(ort, "output.cfa.fitTitle")
  expect_equal(cell_num(f, row_of(f, "df"), 2), 27, label = "orthogonal df = 24 + 3")
  ec <- cfa_run(hs(), list(estimator = "ml", errorCov = list(list("col_7", "col_8")), mi = TRUE))
  f2 <- find_table(ec, "output.cfa.fitTitle")
  expect_equal(cell_num(f2, row_of(f2, "df"), 2), 23, label = "one residual covariance frees a df")
  expect_true(!is.null(find_table(ec, "output.cfa.errorCovTitle")), "error covariance table")
  base <- cfa_run(hs(), list(estimator = "ml", mi = TRUE))
  mi <- find_table(base, "output.cfa.miTitle")
  expect_true(identical(mi$rows[[1]][[1]], "visual → x9"), "largest MI is visual =~ x9")
  expect_equal(cell_num(mi, 1, 2), 36.411, tolerance = 1e-2, label = "its MI")
  expect_true(identical(mi$rows[[2]][[1]], "x7 ↔ x8"), "then x7 ~~ x8")
  expect_true(identical(mi$rows[[2]][[5]], "output.cfa.yes"), "x7, x8 share a factor")
  expect_true(all(vapply(mi$rows, function(r) r[[2]] >= 3.84, TRUE)), "all MI >= 3.84")
})

test_that("cfa: invariance across schools matches the lavaan tutorial", {
  res <- cfa_run(hs(), list(estimator = "ml"), extra = list(groupVar = "col_school", groupName = "school"))
  t <- find_table(res, "output.cfa.invTitle")
  expect_equal(cell_num(t, 1, 2), 115.851, tolerance = 1e-3, label = "configural chi-square")
  expect_equal(cell_num(t, 1, 3), 48, label = "configural df")
  expect_equal(cell_num(t, 2, 2), 124.044, tolerance = 1e-3, label = "metric chi-square")
  expect_equal(cell_num(t, 3, 2), 164.103, tolerance = 1e-3, label = "scalar chi-square")
  expect_equal(cell_num(t, 2, 8), 8.192, tolerance = 1e-3, label = "metric delta chi-square")
  expect_equal(cell_num(t, 2, 9), 6, label = "metric delta df")
  expect_equal(cell_num(t, 2, 10), 0.2244, tolerance = 1e-3, label = "metric p")
  expect_equal(cell_num(t, 3, 8), 40.059, tolerance = 1e-3, label = "scalar delta chi-square")
  expect_lt(cell_num(t, 3, 10), 0.001, label = "scalar p")
  expect_true(identical(t$rows[[3]][[13]], "output.cfa.invFails"), "scalar invariance rejected")
  expect_true(length(t$rows) == 4, "strict step for continuous items")
})

test_that("cfa: auto picks WLSMV for 5-point items and matches lavaan directly", {
  d <- lavaan::HolzingerSwineford1939
  lik <- as.data.frame(lapply(paste0("x", 1:9), function(v) as.numeric(cut(d[[v]], 5, labels = FALSE))))
  names(lik) <- paste0("col_", 1:9)
  res <- cfa_run(lik)
  expect_true(isTRUE(res$success), "success")
  expect_true("output.cfa.estimatorAuto:WLSMV" %in% unlist(res$notes), "auto chose WLSMV")
  m <- "visual=~x1+x2+x3\ntextual=~x4+x5+x6\nspeed=~x7+x8+x9"
  ref <- setNames(lik, paste0("x", 1:9))
  fit <- lavaan::cfa(m, ref, estimator = "WLSMV", ordered = paste0("x", 1:9))
  fm <- lavaan::fitMeasures(fit)
  f <- find_table(res, "output.cfa.fitTitle")
  expect_true(identical(f$columns[[3]], "output.cfa.robust"), "robust column")
  rr <- function(lbl) cell_num(f, row_of(f, lbl), 3)
  expect_equal(rr("χ²"), unname(fm["chisq.scaled"]), tolerance = 1e-3, label = "scaled chi-square")
  cfi_ref <- if (is.finite(fm["cfi.robust"])) fm["cfi.robust"] else fm["cfi.scaled"]
  expect_equal(rr("CFI"), unname(cfi_ref), tolerance = 1e-3, label = "robust CFI")
  expect_equal(cell_num(f, row_of(f, "CFI"), 2), unname(fm["cfi"]), tolerance = 1e-3, label = "standard CFI")
  ld <- find_table(res, "output.cfa.loadingsTitle")
  pe <- lavaan::standardizedSolution(fit); pe <- pe[pe$op == "=~", ]
  for (i in 1:9) expect_equal(cell_num(ld, i, 7), pe$est.std[i], tolerance = 1e-3, label = paste("WLSMV std loading", i))
})

test_that("cfa: MLR with FIML matches lavaan, listwise drops incomplete cases", {
  df <- hs(); df$col_2[c(3, 10, 50)] <- NA
  res <- cfa_run(df, list(estimator = "mlr", missingMethod = "fiml"))
  ref <- setNames(df[paste0("col_", 1:9)], paste0("x", 1:9))
  fit <- lavaan::cfa("visual=~x1+x2+x3\ntextual=~x4+x5+x6\nspeed=~x7+x8+x9", ref,
                     estimator = "MLR", missing = "ml")
  fm <- lavaan::fitMeasures(fit)
  f <- find_table(res, "output.cfa.fitTitle")
  expect_equal(cell_num(f, row_of(f, "χ²"), 3), unname(fm["chisq.scaled"]), tolerance = 1e-3, label = "MLR scaled chi-square")
  expect_equal(cell_num(f, row_of(f, "RMSEA"), 3), unname(fm["rmsea.robust"]), tolerance = 1e-2, label = "MLR robust RMSEA")
  s <- find_table(res, "output.cfa.summaryTitle")
  expect_equal(cell_num(s, row_of(s, "output.cfa.nUsed"), 2), 301, label = "FIML keeps every case")
  lw <- cfa_run(df, list(estimator = "ml"))
  s2 <- find_table(lw, "output.cfa.summaryTitle")
  expect_equal(cell_num(s2, row_of(s2, "output.cfa.nUsed"), 2), 298, label = "listwise N")
  expect_equal(cell_num(s2, row_of(s2, "output.cfa.nExcluded"), 2), 3, label = "excluded")
})

test_that("cfa: path diagram is valid SVG with escaped names", {
  fac <- hs_factors; fac[[1]]$name <- "A&B <vis>"
  res <- cfa_run(hs(), list(estimator = "ml"), factors = fac)
  svg <- rawToChar(jsonlite::base64_dec(res$plots[[1]]$data))
  expect_true(startsWith(svg, "<svg") && endsWith(svg, "</svg>"), "svg document")
  expect_true(grepl("A&amp;B &lt;vis&gt;", svg, fixed = TRUE), "escaped factor name")
  expect_true(grepl(">.77<", svg, fixed = TRUE), "standardized loading on the arrow")
  expect_true(grepl(">.46<", svg, fixed = TRUE), "factor correlation on the arc")
  expect_true(!grepl(">NA<", svg, fixed = TRUE), "no NA labels")
})

test_that("cfa: model errors surface instead of silent output", {
  bad <- list(list(name = "one", items = list("col_1", "col_2")))
  res <- tryCatch(cfa_run(hs(), list(estimator = "ml"), factors = bad), error = function(e) NULL)
  expect_true(is.null(res) || !isTRUE(res$success), "two items, one factor -> refused")
})
