# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-glm-univariate-options-2026-09.R — validates the 2026-09 GLM Univariate
# expansion (covariates, WLS/frequency weights, SS Type I/II/III, Post Hoc,
# Estimated Marginal Means) against known oracles: car::Anova() for SS types,
# base predict() for EM Means (no-interaction case), stats::TukeyHSD() for
# Post Hoc, and case-duplication for frequency-weight equivalence.

test_that("glm-univariate: Type II SS matches car::Anova(type=2), unbalanced 2x2 with interaction", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("SKIP: car not installed\n")
    return(invisible())
  }
  set.seed(41)
  a <- factor(c(rep("a1", 9), rep("a2", 6)))
  b <- factor(c(rep("b1", 5), rep("b2", 4), rep("b1", 3), rep("b2", 3)))
  y <- 4 + 1.6 * (a == "a2") + 1.1 * (b == "b2") + 0.7 * (a == "a2" & b == "b2") + rnorm(15, sd = 1.1)
  df <- data.frame(col_y = y, col_a = as.character(a), col_b = as.character(b))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_a", "col_b"), factorNames = list(col_a = "A", col_b = "B"),
    options = list(ssType = "II")
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  op <- options(contrasts = c("contr.sum", "contr.poly"))
  ref <- car::Anova(lm(y ~ a * b, data = data.frame(y = y, a = a, b = b)), type = 2)
  options(op)

  tbl <- find_table(result, "output.glmUni.title")
  expect_equal(cell_num(tbl, 3, 2), ref["a", "Sum Sq"], tolerance = 1e-3, "Type II SS for A")
  expect_equal(cell_num(tbl, 4, 2), ref["b", "Sum Sq"], tolerance = 1e-3, "Type II SS for B")
  expect_equal(cell_num(tbl, 5, 2), ref["a:b", "Sum Sq"], tolerance = 1e-3, "Type II SS for A*B")
})

test_that("glm-univariate: ANCOVA (factor + covariate) Type III matches car::Anova(type=3)", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("SKIP: car not installed\n")
    return(invisible())
  }
  set.seed(42)
  g <- factor(c(rep("g1", 10), rep("g2", 8), rep("g3", 6)))
  cov <- rnorm(24, 10, 2)
  y <- 3 + 0.5 * cov + 2 * (g == "g2") + 3.5 * (g == "g3") + rnorm(24, sd = 1.3)
  df <- data.frame(col_y = y, col_g = as.character(g), col_cov = cov)

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    covariates = list("col_cov"), covariateNames = list(col_cov = "COV")
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  op <- options(contrasts = c("contr.sum", "contr.poly"))
  ref <- car::Anova(lm(y ~ cov + g, data = data.frame(y = y, cov = cov, g = g)), type = 3)
  options(op)

  # Row order: Corrected Model, Intercept, COV, G, Error, Total, Corrected Total.
  tbl <- find_table(result, "output.glmUni.title")
  expect_equal(cell_num(tbl, 3, 2), ref["cov", "Sum Sq"], tolerance = 1e-3, "Type III SS for covariate")
  expect_equal(cell_num(tbl, 4, 2), ref["g", "Sum Sq"], tolerance = 1e-3, "Type III SS for G")
})

test_that("glm-univariate: Estimated Marginal Means match predict() at the covariate mean (no interaction)", {
  set.seed(42)
  g <- factor(c(rep("g1", 10), rep("g2", 8), rep("g3", 6)))
  cov <- rnorm(24, 10, 2)
  y <- 3 + 0.5 * cov + 2 * (g == "g2") + 3.5 * (g == "g3") + rnorm(24, sd = 1.3)
  df <- data.frame(col_y = y, col_g = as.character(g), col_cov = cov)

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    covariates = list("col_cov"), covariateNames = list(col_cov = "COV"),
    options = list(emMeans = list(terms = list("OVERALL", "col_g")))
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  fit <- lm(y ~ cov + g, data = data.frame(y = y, cov = cov, g = g))
  cm <- mean(cov)
  pred_by_g <- vapply(levels(g), function(lv) predict(fit, newdata = data.frame(cov = cm, g = lv)), numeric(1))

  em_overall <- find_table(result, "output.glmUni.emMeansTitle:y|output.col.overall")
  expect_equal(cell_num(em_overall, 1, 1), mean(pred_by_g), tolerance = 1e-3, "EM overall mean")

  em_g <- find_table(result, "output.glmUni.emMeansTitle:y|G")
  for (i in seq_along(levels(g))) {
    expect_equal(cell_num(em_g, i, 2), unname(pred_by_g[i]), tolerance = 1e-3,
                 sprintf("EM mean for G level %d", i))
  }
})

test_that("glm-univariate: Post Hoc (LSD/Tukey, single factor) matches TukeyHSD() and pairwise LSD", {
  set.seed(43)
  g <- factor(c(rep("x1", 7), rep("x2", 5), rep("x3", 9)))
  y <- c(rnorm(7, 5, 1.5), rnorm(5, 7, 1.5), rnorm(9, 6, 1.5))
  df <- data.frame(col_y = y, col_g = as.character(g))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    options = list(postHoc = list(factors = list("col_g"), tukey = TRUE))
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  aov_fit <- aov(y ~ g)
  tk <- TukeyHSD(aov_fit)$g

  ph_tbl <- find_table(result, "output.glmUni.postHocTitle")
  # Row 2 is x1-x2 reversed (x2, x1) per the i/j double loop; row 1 is x1 vs x2.
  row_x2_x1 <- ph_tbl$rows[[3]]  # (i=x2, j=x1)
  expect_equal(as.numeric(row_x2_x1[[4]]), unname(tk["x2-x1", "diff"]), tolerance = 1e-3, "Tukey diff x2-x1")
  expect_equal(as.numeric(row_x2_x1[[6]]), unname(tk["x2-x1", "p adj"]), tolerance = 1e-3, "Tukey p adj x2-x1")
})

test_that("glm-univariate: integer frequency weight matches case-duplication", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("SKIP: car not installed\n")
    return(invisible())
  }
  g <- factor(c("a", "a", "b", "b", "b"))
  y <- c(10, 12, 20, 22, 19)
  wt <- c(2, 1, 1, 3, 2)
  df <- data.frame(col_y = y, col_g = as.character(g), col_w = wt)

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    weightVariable = "col_w"
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  expect_equal(length(result$warnings), 0L, label = "no weight-not-applied warning")

  idx_dup <- rep(seq_along(y), wt)
  gd <- g[idx_dup]; yd <- y[idx_dup]
  op <- options(contrasts = c("contr.sum", "contr.poly"))
  ref <- car::Anova(lm(yd ~ gd), type = 3)
  options(op)

  tbl <- find_table(result, "output.glmUni.title")
  expect_equal(cell_num(tbl, 3, 2), ref["gd", "Sum Sq"], tolerance = 1e-3, "weighted Type III SS matches duplicated rows")
})
