# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-regression-assumptions-2026-11.R — regression-linear.R's
# options$assumptions table (classical assumption tests) against independent
# references: nortest::lillie.test / shapiro.test on lm() residuals, VIF from
# the inverse correlation matrix (not the script's 1/(1-R²_j) route), Glejser
# from summary(lm()), and — when installed — lmtest::bptest / lmtest::bgtest
# (Breusch-Pagan Koenker, Breusch-Godfrey order 1) and car::vif. lmtest/car are
# not bundled, which is why the script rebuilds those statistics; these
# comparisons are what show the rebuild is exact.

.assume_fixture <- function(extra = list()) {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$hp)
  write_fixture(df, c(list(
    dependent = "col_1", dependentName = "mpg",
    independents = list("col_2", "col_3"),
    varNames = list(col_1 = "mpg", col_2 = "wt", col_3 = "hp"),
    options = list(assumptions = TRUE)
  ), extra))
}

.assume_row <- function(table, test_key) {
  for (r in table$rows) if (identical(r[[2]], test_key)) return(r)
  stop(sprintf("No assumption row '%s'", test_key), call. = FALSE)
}

test_that("Classical assumption tests match lillie/shapiro/VIF/Glejser/BP/BG references (mtcars mpg ~ wt + hp)", {
  result <- run_analysis_script("regression-linear.R", .assume_fixture())
  expect_true(isTRUE(result$success), "result$success")
  table <- find_table(result, "output.regression.assume.title")

  fit <- lm(mpg ~ wt + hp, data = mtcars)
  e <- residuals(fit); n <- nrow(mtcars)

  lt <- nortest::lillie.test(e)
  ks <- .assume_row(table, "output.regression.assume.ks")
  expect_equal(as.numeric(ks[[3]]), unname(lt$statistic), tolerance = 1e-5, "K-S Lilliefors D")
  expect_equal(as.numeric(ks[[5]]), lt$p.value, tolerance = 1e-5, "K-S Lilliefors p")

  sw <- shapiro.test(e)
  swr <- .assume_row(table, "output.regression.assume.sw")
  expect_equal(as.numeric(swr[[3]]), unname(sw$statistic), tolerance = 1e-5, "Shapiro-Wilk W")
  expect_equal(as.numeric(swr[[5]]), sw$p.value, tolerance = 1e-5, "Shapiro-Wilk p")
  expect_true(identical(swr[[6]], if (sw$p.value > 0.05) "output.regression.assume.met"
                                  else "output.regression.assume.violated"), "S-W decision")

  # VIF = diagonal of the inverse predictor correlation matrix.
  vif_ref <- diag(solve(cor(mtcars[, c("wt", "hp")])))
  expect_equal(as.numeric(.assume_row(table, "output.regression.assume.vif:wt")[[3]]),
               unname(vif_ref["wt"]), tolerance = 1e-5, "VIF wt")
  expect_equal(as.numeric(.assume_row(table, "output.regression.assume.vif:hp")[[3]]),
               unname(vif_ref["hp"]), tolerance = 1e-5, "VIF hp")
  if (requireNamespace("car", quietly = TRUE)) {
    expect_equal(unname(car::vif(fit)), unname(vif_ref), tolerance = 1e-8, "car::vif agrees")
  }

  gl <- summary(lm(abs(e) ~ wt + hp, data = mtcars))$coefficients
  glw <- .assume_row(table, "output.regression.assume.glejser:wt")
  expect_equal(as.numeric(glw[[3]]), gl["wt", 3], tolerance = 1e-5, "Glejser t (wt)")
  expect_equal(as.numeric(glw[[5]]), gl["wt", 4], tolerance = 1e-5, "Glejser p (wt)")
  expect_true(identical(glw[[4]], as.character(n - 3L)), "Glejser df = n - k - 1")

  bpr <- .assume_row(table, "output.regression.assume.bp")
  bgr <- .assume_row(table, "output.regression.assume.bg")
  if (requireNamespace("lmtest", quietly = TRUE)) {
    bp <- lmtest::bptest(fit)
    expect_equal(as.numeric(bpr[[3]]), unname(bp$statistic), tolerance = 1e-5, "BP vs lmtest::bptest")
    expect_equal(as.numeric(bpr[[5]]), unname(bp$p.value), tolerance = 1e-5, "BP p vs lmtest::bptest")
    bg <- lmtest::bgtest(fit, order = 1)
    expect_equal(as.numeric(bgr[[3]]), unname(bg$statistic), tolerance = 1e-5, "BG vs lmtest::bgtest")
    expect_equal(as.numeric(bgr[[5]]), unname(bg$p.value), tolerance = 1e-5, "BG p vs lmtest::bgtest")
  } else {
    # Koenker BP by hand: n · R² of e² on the predictors.
    r2 <- summary(lm(I(e^2) ~ wt + hp, data = mtcars))$r.squared
    expect_equal(as.numeric(bpr[[3]]), n * r2, tolerance = 1e-5, "BP = n·R² (Koenker)")
  }

  dwr <- .assume_row(table, "output.regression.assume.dw")
  expect_equal(as.numeric(dwr[[3]]), sum(diff(e)^2) / sum(e^2), tolerance = 1e-5, "Durbin-Watson d")
  expect_true(identical(dwr[[6]], ""), "DW has no decision (no p-value)")
})

test_that("Assumption table: one predictor drops the VIF rows; option off emits no table", {
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt)
  one <- run_analysis_script("regression-linear.R", write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg", independents = list("col_2"),
    varNames = list(col_1 = "mpg", col_2 = "wt"), options = list(assumptions = TRUE))))
  expect_true(isTRUE(one$success), "one-predictor success")
  t1 <- find_table(one, "output.regression.assume.title")
  keys <- vapply(t1$rows, function(r) as.character(r[[2]]), character(1))
  expect_true(!any(startsWith(keys, "output.regression.assume.vif")), "no VIF rows with k = 1")
  expect_true("output.regression.assume.glejser:wt" %in% keys, "Glejser row present with k = 1")

  off <- run_analysis_script("regression-linear.R", write_fixture(df, list(
    dependent = "col_1", dependentName = "mpg", independents = list("col_2"),
    varNames = list(col_1 = "mpg", col_2 = "wt"))))
  titles <- vapply(off$tables, function(t) t$titleKey, character(1))
  expect_true(!any(titles == "output.regression.assume.title"), "no table when option is off")
})
