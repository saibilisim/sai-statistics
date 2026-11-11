# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-reliability-models-2026-11.R — the reliability models and statistics
# added in 2026-11 (reliability.R + _reliability_models.R): Guttman's lambdas,
# parallel / strictly parallel ML models, McDonald's omega, the ICC family,
# Hotelling's T², the cases x items ANOVA with Tukey's nonadditivity,
# Friedman and Cochran. References are independent: regression residuals for
# lambda 6, psych::splitHalf, lavaan fits of the constrained one-factor models,
# psych::ICC, aov / lm with the squared-fit term, coin's symmetry test.

rel_data <- function(n = 150, seed = 11) {
  set.seed(seed)
  f <- rnorm(n)
  d <- as.data.frame(sapply(c(.8, .7, .9, .6, .75), function(l)
    pmin(5, pmax(1, round(3 + l * f + rnorm(n, 0, .8))))))
  names(d) <- paste0("col_", 1:5)
  d
}
rel_run <- function(df, options) {
  ids <- names(df)
  run_analysis_script("reliability.R", write_fixture(df, list(
    variables = as.list(ids), varNames = setNames(as.list(sub("col_", "i", ids)), ids),
    options = options)))
}
val <- function(t, label) {
  for (r in t$rows) if (identical(r[[1]], label)) return(as.numeric(r[[2]]))
  NA_real_
}

test_that("reliability: Guttman lambdas follow their definitions", {
  df <- rel_data(); X <- as.matrix(df); C <- cov(X); vt <- sum(C); k <- 5
  res <- rel_run(df, list(model = "guttman"))
  t <- find_table(res, "output.reliability.guttmanTitle")
  l1 <- 1 - sum(diag(C)) / vt
  expect_equal(val(t, "output.reliability.lambda1"), l1, tolerance = 1e-3, label = "L1")
  sh <- psych::splitHalf(X, covar = TRUE)
  expect_equal(val(t, "output.reliability.lambda2"), sh$lambda2, tolerance = 1e-3, label = "L2 = psych::splitHalf")
  a <- psych::alpha(X, warnings = FALSE)$total$raw_alpha
  expect_equal(val(t, "output.reliability.lambda3"), a, tolerance = 1e-3, label = "L3 = alpha")
  s1 <- rowSums(X[, 1:3]); s2 <- rowSums(X[, 4:5])
  expect_equal(val(t, "output.reliability.lambda4"), 2 * (1 - (var(s1) + var(s2)) / vt), tolerance = 1e-3, label = "L4")
  e2 <- vapply(1:k, function(i) sum(resid(lm(X[, i] ~ X[, -i]))^2) / (nrow(X) - 1), 0)
  expect_equal(val(t, "output.reliability.lambda6"), 1 - sum(e2) / vt, tolerance = 1e-3, label = "L6 from regression residuals")
  off <- C; diag(off) <- 0
  expect_equal(val(t, "output.reliability.lambda5"), l1 + 2 * sqrt(max(colSums(off^2))) / vt, tolerance = 1e-3, label = "L5")
})

test_that("reliability: parallel and strictly parallel models match lavaan", {
  df <- rel_data(); d <- setNames(df, paste0("x", 1:5))
  m <- "F =~ a*x1 + a*x2 + a*x3 + a*x4 + a*x5\nF ~~ 1*F\nx1 ~~ e*x1\nx2 ~~ e*x2\nx3 ~~ e*x3\nx4 ~~ e*x4\nx5 ~~ e*x5"
  for (strict in c(FALSE, TRUE)) {
    mm <- if (strict) paste0(m, "\nx1 ~ mu*1\nx2 ~ mu*1\nx3 ~ mu*1\nx4 ~ mu*1\nx5 ~ mu*1") else m
    fit <- lavaan::cfa(mm, d, meanstructure = TRUE, std.lv = TRUE)
    pe <- lavaan::parameterEstimates(fit)
    la <- pe$est[pe$label == "a"][1]; e <- pe$est[pe$label == "e"][1]
    res <- rel_run(df, list(model = if (strict) "strict" else "parallel"))
    ft <- find_table(res, "output.reliability.fitTitle")
    lbl <- if (strict) "strict" else "parallel"
    expect_equal(val(ft, "output.col.chiSquare"), as.numeric(lavaan::fitMeasures(fit, "chisq")), tolerance = 1e-3, label = paste(lbl, "chi-square"))
    expect_equal(val(ft, "output.col.df"), as.numeric(lavaan::fitMeasures(fit, "df")), label = paste(lbl, "df"))
    st <- find_table(res, if (strict) "output.reliability.strictStatsTitle" else "output.reliability.parallelStatsTitle")
    expect_equal(val(st, "output.reliability.commonVariance"), la^2 + e, tolerance = 1e-3, label = paste(lbl, "common variance"))
    expect_equal(val(st, "output.reliability.trueVariance"), la^2, tolerance = 1e-3, label = paste(lbl, "true variance"))
    expect_equal(val(st, "output.reliability.scaleReliability"), 5 * la^2 / (5 * la^2 + e), tolerance = 1e-3, label = paste(lbl, "reliability"))
    if (strict) expect_equal(val(st, "output.reliability.commonMean"), pe$est[pe$label == "mu"][1], tolerance = 1e-3, label = "common mean")
  }
})

test_that("reliability: omega from a one-factor lavaan model", {
  df <- rel_data(); d <- setNames(df, paste0("x", 1:5))
  fit <- lavaan::cfa("F =~ x1 + x2 + x3 + x4 + x5", d, std.lv = TRUE)
  pe <- lavaan::parameterEstimates(fit)
  lam <- pe$est[pe$op == "=~"]; th <- pe$est[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs != "F"]
  res <- rel_run(df, list(model = "omega"))
  t <- find_table(res, "output.reliability.omegaTitle")
  expect_equal(as.numeric(t$rows[[1]][[1]]), sum(lam)^2 / (sum(lam)^2 + sum(th)), tolerance = 1e-3, label = "omega")
})

test_that("reliability: ICC models match psych::ICC", {
  df <- rel_data(); X <- as.matrix(df)
  ref <- psych::ICC(X, lmer = FALSE)$results
  cases <- list(list("oneway", "consistency", "ICC1", "ICC1k"),
                list("random", "absolute", "ICC2", "ICC2k"),
                list("mixed", "consistency", "ICC3", "ICC3k"),
                list("random", "consistency", "ICC3", "ICC3k"),
                list("mixed", "absolute", "ICC2", "ICC2k"))
  for (cs in cases) {
    res <- rel_run(df, list(icc = list(enabled = TRUE, model = cs[[1]], type = cs[[2]], ci = 95, testValue = 0)))
    t <- find_table(res, "output.reliability.iccTitle")
    for (w in 1:2) {
      r <- ref[ref$type == cs[[2 + w]], ]
      lbl <- paste(cs[[1]], cs[[2]], cs[[2 + w]])
      expect_equal(cell_num(t, w, 2), r$ICC, tolerance = 1e-3, label = paste(lbl, "estimate"))
      expect_equal(cell_num(t, w, 3), r$`lower bound`, tolerance = 2e-3, label = paste(lbl, "lower"))
      expect_equal(cell_num(t, w, 4), r$`upper bound`, tolerance = 2e-3, label = paste(lbl, "upper"))
      expect_equal(cell_num(t, w, 5), r$F, tolerance = 1e-3, label = paste(lbl, "F"))
    }
  }
})

test_that("reliability: ICC F test against a non-zero true value (one-way)", {
  df <- rel_data(); X <- as.matrix(df); n <- nrow(X); k <- ncol(X)
  a <- anova(lm(as.vector(X) ~ factor(rep(1:n, k))))
  msr <- a$`Mean Sq`[1]; msw <- a$`Mean Sq`[2]
  res <- rel_run(df, list(icc = list(enabled = TRUE, model = "oneway", ci = 95, testValue = 0.3)))
  t <- find_table(res, "output.reliability.iccTitle")
  expect_equal(cell_num(t, 1, 5), msr / msw * (1 - .3) / (1 + (k - 1) * .3), tolerance = 1e-3, label = "single F(r0)")
  expect_equal(cell_num(t, 2, 5), msr / msw * (1 - .3), tolerance = 1e-3, label = "average F(r0)")
})

test_that("reliability: Hotelling, ANOVA with Tukey nonadditivity, Friedman", {
  df <- rel_data(); X <- as.matrix(df); n <- nrow(X); k <- ncol(X)
  long <- data.frame(y = as.vector(X), s = factor(rep(1:n, k)), i = factor(rep(1:k, each = n)))
  av <- anova(lm(y ~ s + i, long))
  res <- rel_run(df, list(hotelling = TRUE, anova = "f", tukey = TRUE))
  at <- find_table(res, "output.reliability.anovaTitle")
  expect_equal(cell_num(at, 3, 2), av$`Sum Sq`[2], tolerance = 1e-4, label = "SS items")
  expect_equal(cell_num(at, 3, 5), av$`F value`[2], tolerance = 1e-3, label = "F items")
  expect_equal(cell_num(at, 4, 2), av$`Sum Sq`[3], tolerance = 1e-4, label = "SS residual")
  long$fit2 <- fitted(lm(y ~ s + i, long))^2
  tk <- anova(lm(y ~ s + i, long), lm(y ~ s + i + fit2, long))
  expect_equal(cell_num(at, 5, 5), tk$F[2], tolerance = 1e-3, label = "Tukey nonadditivity F")
  # Hotelling via Wilks' lambda of the difference scores.
  D <- X[, -1] - X[, 1]; d <- colMeans(D); E <- (n - 1) * cov(D)
  wl <- det(E) / det(E + n * tcrossprod(d))
  t2 <- (n - 1) * (1 / wl - 1)
  ht <- find_table(res, "output.reliability.hotellingTitle")
  expect_equal(cell_num(ht, 1, 1), t2, tolerance = 1e-3, label = "Hotelling T2")
  expect_equal(cell_num(ht, 1, 2), (n - k + 1) / ((n - 1) * (k - 1)) * t2, tolerance = 1e-3, label = "Hotelling F")
  fr <- rel_run(df, list(anova = "friedman"))
  ft <- find_table(fr, "output.reliability.anovaTitle")
  expect_equal(cell_num(ft, 3, 5), unname(friedman.test(X)$statistic), tolerance = 1e-3, label = "Friedman chi-square")
  expect_true(identical(ft$columns[[5]], "output.reliability.friedmanChi"), "Friedman column")
})

test_that("reliability: Cochran's Q matches coin's symmetry test", {
  set.seed(5); n <- 80
  B <- data.frame(col_1 = rbinom(n, 1, .3), col_2 = rbinom(n, 1, .5), col_3 = rbinom(n, 1, .6), col_4 = rbinom(n, 1, .45))
  res <- rel_run(B, list(anova = "cochran"))
  t <- find_table(res, "output.reliability.anovaTitle")
  long <- data.frame(y = factor(unlist(B)), x = factor(rep(1:4, each = n)), b = factor(rep(1:n, 4)))
  q <- coin::statistic(coin::symmetry_test(y ~ x | b, data = long, teststat = "quadratic"))
  expect_equal(cell_num(t, 3, 5), unname(q), tolerance = 1e-3, label = "Cochran Q")
  bad <- rel_run(rel_data(), list(anova = "cochran"))
  expect_true("output.reliability.cochranBinary" %in% unlist(bad$warnings), "non-binary items -> F with warning")
})
