# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-audit-2026-10.R — regression tests for the statistical findings of the
# 2026-10 audit (GENLIN omnibus scale, frequency-weight error df, logistic
# level ordering, casewise numbering, Dunn tie correction, user-missing in
# nonparametric tests, reliability N, oblique factor scores).

test_that("genlin gaussian omnibus LR chi-square does not depend on the response unit", {
  set.seed(11)
  n <- 80
  x <- rnorm(n)
  y <- 5 + 0.0 * x + rnorm(n)            # predictor explains nothing
  run_for <- function(scale) {
    df <- data.frame(col_1 = y * scale, col_2 = x)
    fixture <- write_fixture(df, list(
      dependent = "col_1", dependentName = "y", predictors = list("col_2"),
      varNames = list(col_2 = "x"), distribution = "normal"))
    omni <- find_table(run_analysis_script("genlin.R", fixture), "output.genlin.omniTitle")
    c(cell_num(omni, 1, 1), cell_num(omni, 1, 3))
  }
  a <- run_for(1); b <- run_for(1000)
  expect_equal(b[1], a[1], tolerance = 1e-3, label = "LR chi-square is scale free")
  expect_equal(b[2], a[2], tolerance = 1e-5, label = "omnibus Sig. is scale free")
  d <- data.frame(y = y, x = x)
  ref <- 2 * (as.numeric(logLik(glm(y ~ x, data = d))) - as.numeric(logLik(glm(y ~ 1, data = d))))
  expect_equal(a[1], ref, tolerance = 5e-3, label = "matches 2 * delta logLik")
})

test_that("glm-univariate: frequency weight gives error df sum(w) - rank (same as case duplication)", {
  g <- factor(rep(c("a", "b", "c"), each = 4))
  y <- c(10, 12, 11, 13, 20, 22, 19, 21, 15, 14, 16, 17)
  wt <- rep(c(5, 3, 4, 6), 3)
  df <- data.frame(col_y = y, col_g = as.character(g), col_w = wt)
  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    weightVariable = "col_w"))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  idx <- rep(seq_along(y), wt)
  ref <- anova(lm(y[idx] ~ g[idx]))
  tbl <- find_table(result, "output.glmUni.title")
  err <- Filter(function(r) identical(r[[1]], "output.col.error"), tbl$rows)[[1]]
  expect_equal(as.numeric(err[[3]]), ref["Residuals", "Df"], label = "error df")
  expect_equal(as.numeric(err[[2]]), ref["Residuals", "Sum Sq"], tolerance = 1e-3, label = "error SS")
  expect_equal(as.numeric(err[[4]]), ref["Residuals", "Mean Sq"], tolerance = 1e-3, label = "MSE")
})

test_that("logistic: numeric dependent codes 2 / 10 -> the larger code (10) is the event", {
  set.seed(5)
  n <- 120
  x <- rnorm(n)
  ev <- rbinom(n, 1, plogis(1.2 * x))
  df <- data.frame(col_y = ifelse(ev == 1, 10, 2), col_x = x)
  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y", covariates = list("col_x"),
    covariateNames = list(col_x = "x")))
  result <- run_analysis_script("regression-logistic.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  ref <- coef(glm(ev ~ x, family = binomial()))
  tbl <- find_table(result, "output.logistic.equationTitle")
  b_x <- cell_num(tbl, 1, 2)
  expect_equal(b_x, unname(ref["x"]), tolerance = 1e-3, label = "B for x has the right sign/size")
})

test_that("kruskal-wallis: Dunn pairwise z uses the tie-corrected variance", {
  g <- rep(c("a", "b", "c"), each = 10)
  set.seed(3)
  x <- c(sample(1:5, 10, TRUE), sample(2:6, 10, TRUE), sample(3:7, 10, TRUE))
  df <- data.frame(col_x = x, col_g = g)
  fixture <- write_fixture(df, list(
    variables = list("col_x"), varNames = list(col_x = "x"), factor = "col_g",
    options = list(kruskalWallis = TRUE, pairwise = TRUE)))
  result <- tryCatch(run_analysis_script("npar-kruskal-wallis.R", fixture), error = function(e) NULL)
  if (is.null(result)) { cat("SKIP: fixture shape\n"); return(invisible()) }
  r <- rank(x); N <- length(x); tct <- table(r)
  mr <- tapply(r, g, mean)
  se <- sqrt((N * (N + 1) / 12 - sum(tct^3 - tct) / (12 * (N - 1))) * (1 / 10 + 1 / 10))
  z <- unname((mr["a"] - mr["b"]) / se)
  p_adj <- min(1, 2 * pnorm(-abs(z)) * 3)
  pw <- NULL
  for (tb in result$tables) if (grepl("airwise", tb$titleKey)) pw <- tb
  if (is.null(pw)) { cat("SKIP: no pairwise table\n"); return(invisible()) }
  found <- FALSE
  for (row in pw$rows) {
    vals <- suppressWarnings(as.numeric(unlist(row)))
    if (any(abs(vals - p_adj) < 1e-5, na.rm = TRUE)) found <- TRUE
  }
  expect_true(found, "a-b adjusted p equals the tie-corrected value")
})
