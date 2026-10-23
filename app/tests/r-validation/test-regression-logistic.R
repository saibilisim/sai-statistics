# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-regression-logistic.R — validates r-scripts/regression-logistic.R against
# R's own glm(family = binomial()) (independent implementation). The script
# documents its encoding (lower category = 0, higher = 1) and SPSS-style fit
# measures (-2LL = model deviance, Cox & Snell R², Nagelkerke R², Wald χ²);
# the reference below rebuilds that model from the raw fixture data with base R.

# Helper: 0/1-encode a binary dependent exactly per the documented rule
# (sorted unique levels, higher level = 1) and keep complete cases only.
.logit_ref_data <- function(df, dep, covs) {
  dat <- data.frame(.raw = df[[dep]])
  for (i in seq_along(covs)) dat[[paste0("x", i)]] <- as.numeric(df[[covs[i]]])
  dat <- dat[stats::complete.cases(dat), , drop = FALSE]
  lev <- sort(unique(as.character(dat$.raw)))
  dat$.y <- as.integer(as.character(dat$.raw) == lev[2])
  dat
}

test_that("logistic regression matches glm(binomial) reference (2 covariates)", {
  set.seed(42)
  n <- 200
  x1 <- rnorm(n)
  x2 <- runif(n, -2, 2)
  p <- plogis(-0.3 + 1.1 * x1 - 0.8 * x2)
  df <- data.frame(
    col_1 = ifelse(runif(n) < p, "Yes", "No"), # sorted: "No" < "Yes" → Yes = 1
    col_2 = x1,
    col_3 = x2
  )

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "outcome",
    covariates = list("col_2", "col_3"),
    varNames = list(col_2 = "age", col_3 = "dose")
  ))
  result <- run_analysis_script("regression-logistic.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- .logit_ref_data(df, "col_1", c("col_2", "col_3"))
  ref <- glm(.y ~ x1 + x2, data = dat, family = binomial())
  sm <- summary(ref)
  co <- sm$coefficients
  nref <- nrow(dat)

  # Model Summary: [-2 Log likelihood, Cox & Snell R², Nagelkerke R²]
  cox_ref <- 1 - exp((ref$deviance - ref$null.deviance) / nref)
  nag_ref <- cox_ref / (1 - exp(-ref$null.deviance / nref))
  ms <- find_table(result, "output.logistic.modelSummaryTitle")
  expect_equal(cell_num(ms, 1, 1), ref$deviance, tolerance = 1e-4, "-2 Log likelihood")
  expect_equal(cell_num(ms, 1, 2), cox_ref, tolerance = 1e-5, "Cox & Snell R²")
  expect_equal(cell_num(ms, 1, 3), nag_ref, tolerance = 1e-5, "Nagelkerke R²")

  # Variables in the Equation: [label, B, S.E., Wald, df, Sig., Exp(B)],
  # predictors first, constant last (SPSS order).
  eq <- find_table(result, "output.logistic.equationTitle")
  expect_equal(length(eq$rows), 3L, tolerance = 0, "equation row count")

  # Row 1 = first covariate (age ↔ x1)
  expect_equal(eq$rows[[1]][[1]], "age", tolerance = 0, "row1 label")
  expect_equal(cell_num(eq, 1, 2), co["x1", "Estimate"], tolerance = 1e-4, "x1 B")
  expect_equal(cell_num(eq, 1, 3), co["x1", "Std. Error"], tolerance = 1e-4, "x1 SE")
  expect_equal(cell_num(eq, 1, 4), unname((co["x1", "Estimate"] / co["x1", "Std. Error"])^2),
    tolerance = 1e-4, "x1 Wald")
  expect_equal(cell_num(eq, 1, 5), 1, tolerance = 0, "x1 df")
  expect_equal(cell_num(eq, 1, 6), co["x1", "Pr(>|z|)"], tolerance = 1e-4, "x1 Sig.")
  expect_equal(cell_num(eq, 1, 7), exp(co["x1", "Estimate"]), tolerance = 1e-4, "x1 Exp(B)")

  # Row 2 = second covariate (dose ↔ x2)
  expect_equal(cell_num(eq, 2, 2), co["x2", "Estimate"], tolerance = 1e-4, "x2 B")
  expect_equal(cell_num(eq, 2, 6), co["x2", "Pr(>|z|)"], tolerance = 1e-4, "x2 Sig.")
  expect_equal(cell_num(eq, 2, 7), exp(co["x2", "Estimate"]), tolerance = 1e-4, "x2 Exp(B)")

  # Row 3 = constant, last (SPSS)
  expect_equal(eq$rows[[3]][[1]], "output.col.constant", tolerance = 0, "constant last")
  expect_equal(cell_num(eq, 3, 2), co["(Intercept)", "Estimate"], tolerance = 1e-4, "intercept B")
  expect_equal(cell_num(eq, 3, 3), co["(Intercept)", "Std. Error"], tolerance = 1e-4, "intercept SE")
  expect_equal(cell_num(eq, 3, 6), co["(Intercept)", "Pr(>|z|)"], tolerance = 1e-4, "intercept Sig.")

  # Footnote documents the dependent and which category is coded 1.
  expect_true(grepl("outcome", eq$footnoteKey, fixed = TRUE), "footnote names dependent")
  expect_true(grepl("(Yes = 1)", eq$footnoteKey, fixed = TRUE), "footnote coding (Yes = 1)")
})

test_that("logistic regression drops incomplete cases before fitting", {
  set.seed(7)
  n <- 120
  x1 <- rnorm(n)
  p <- plogis(0.2 + 0.9 * x1)
  df <- data.frame(
    col_1 = ifelse(runif(n) < p, "Yes", "No"),
    col_2 = x1
  )
  df$col_2[c(3, 17, 55)] <- NA_real_   # missing covariate values
  df$col_1[40] <- NA_character_        # missing dependent value

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "outcome",
    covariates = list("col_2"),
    varNames = list(col_2 = "x")
  ))
  result <- run_analysis_script("regression-logistic.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Reference: glm on complete cases only (4 rows dropped).
  dat <- .logit_ref_data(df, "col_1", "col_2")
  expect_equal(nrow(dat), n - 4L, tolerance = 0, "complete-case n")
  ref <- glm(.y ~ x1, data = dat, family = binomial())
  co <- summary(ref)$coefficients

  ms <- find_table(result, "output.logistic.modelSummaryTitle")
  expect_equal(cell_num(ms, 1, 1), ref$deviance, tolerance = 1e-4, "-2LL (complete cases)")

  eq <- find_table(result, "output.logistic.equationTitle")
  expect_equal(length(eq$rows), 2L, tolerance = 0, "1 covariate + constant")
  expect_equal(cell_num(eq, 1, 2), co["x1", "Estimate"], tolerance = 1e-4, "x1 B (complete cases)")
  expect_equal(cell_num(eq, 1, 6), co["x1", "Pr(>|z|)"], tolerance = 1e-4, "x1 Sig. (complete cases)")
})

test_that("logistic regression with numeric 0/1 dependent (single covariate)", {
  set.seed(99)
  n <- 150
  x <- rnorm(n)
  p <- plogis(-0.5 + 1.4 * x)
  df <- data.frame(col_1 = rbinom(n, 1, p), col_2 = x) # numeric 0/1 → lev[2] = "1"

  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "event",
    covariates = list("col_2"),
    varNames = list(col_2 = "x")
  ))
  result <- run_analysis_script("regression-logistic.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  dat <- .logit_ref_data(df, "col_1", "col_2")
  ref <- glm(.y ~ x1, data = dat, family = binomial())
  co <- summary(ref)$coefficients

  eq <- find_table(result, "output.logistic.equationTitle")
  expect_equal(cell_num(eq, 1, 7), exp(co["x1", "Estimate"]), tolerance = 1e-4, "odds ratio")
  expect_equal(cell_num(eq, 1, 4), unname((co["x1", "Estimate"] / co["x1", "Std. Error"])^2),
    tolerance = 1e-4, "Wald")
  expect_true(grepl("(1 = 1)", eq$footnoteKey, fixed = TRUE), "footnote coding (1 = 1)")
})

test_that("logistic regression errors when dependent is not binary", {
  set.seed(1)
  df <- data.frame(
    col_1 = sample(c("A", "B", "C"), 60, replace = TRUE), # 3 categories
    col_2 = rnorm(60)
  )
  fixture <- write_fixture(df, list(
    dependent = "col_1", dependentName = "tri",
    covariates = list("col_2"),
    varNames = list(col_2 = "x")
  ))
  result <- run_analysis_script("regression-logistic.R", fixture)
  expect_true(!isTRUE(result$success), "result$success is FALSE")
  expect_true(grepl("two categories", result$error, fixed = TRUE), "error message")
})
