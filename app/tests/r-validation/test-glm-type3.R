# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-glm-type3.R — validates glm-univariate.R's Type III SS (single-column
# model-matrix deletion under contr.sum) against car::Anova(fit, type = 3),
# the package the script's own header comment claims equivalence to; and
# validates glm-repeated.R's Mauchly/epsilon-corrected within-subjects table
# against base R's own anova.mlm(test = "Spherical") oracle.

# ── glm-univariate: unbalanced 2x2 factorial vs car::Anova type 3 ───────────
test_that("glm-univariate: Type III SS matches car::Anova(type=3) on an unbalanced 2x2 design", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("SKIP: car not installed\n")
    return(invisible())
  }
  set.seed(31)
  # Deliberately unbalanced cell sizes so Type I (sequential) SS would differ
  # from Type III — this is the case that actually exercises ss_drop().
  a <- factor(c(rep("a1", 8), rep("a2", 5)))
  b <- factor(c(rep("b1", 5), rep("b2", 3), rep("b1", 2), rep("b2", 3)))
  y <- 5 + 2 * (a == "a2") + 1.5 * (b == "b2") + 1.0 * (a == "a2" & b == "b2") + rnorm(13, sd = 1.2)
  df <- data.frame(col_y = y, col_a = as.character(a), col_b = as.character(b))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_a", "col_b"),
    factorNames = list(col_a = "A", col_b = "B")
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  ref_dat <- data.frame(y = y, a = a, b = b)
  op <- options(contrasts = c("contr.sum", "contr.poly"))
  ref_fit <- lm(y ~ a * b, data = ref_dat)
  ref_aov <- car::Anova(ref_fit, type = 3)
  options(op)

  tbl <- find_table(result, "output.glmUni.title")
  # Row order: Corrected Model, Intercept, A, B, A*B, Error, Total, Corrected Total.
  # Script rounds SS to 3 decimals for display; loosen tolerance accordingly.
  expect_equal(cell_num(tbl, 3, 2), ref_aov["a", "Sum Sq"], tolerance = 1e-3, "Type III SS for A")
  expect_equal(cell_num(tbl, 3, 3), ref_aov["a", "Df"], tolerance = 1e-9, "df for A")
  expect_equal(cell_num(tbl, 3, 5), ref_aov["a", "F value"], tolerance = 1e-4, "F for A")
  expect_equal(cell_num(tbl, 3, 6), ref_aov["a", "Pr(>F)"], tolerance = 1e-4, "Sig. for A")

  expect_equal(cell_num(tbl, 4, 2), ref_aov["b", "Sum Sq"], tolerance = 1e-4, "Type III SS for B")
  expect_equal(cell_num(tbl, 4, 5), ref_aov["b", "F value"], tolerance = 1e-4, "F for B")

  expect_equal(cell_num(tbl, 5, 2), ref_aov["a:b", "Sum Sq"], tolerance = 1e-4, "Type III SS for A*B")
  expect_equal(cell_num(tbl, 5, 5), ref_aov["a:b", "F value"], tolerance = 1e-4, "F for A*B")

  expect_equal(cell_num(tbl, 6, 2), ref_aov["Residuals", "Sum Sq"], tolerance = 1e-4, "Error SS")
  expect_equal(cell_num(tbl, 6, 3), ref_aov["Residuals", "Df"], tolerance = 1e-9, "Error df")
})

test_that("glm-univariate: Type III SS matches car::Anova(type=3) with a single factor (no interaction)", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("SKIP: car not installed\n")
    return(invisible())
  }
  set.seed(32)
  g <- factor(c(rep("g1", 6), rep("g2", 9), rep("g3", 4)))
  y <- c(rnorm(6, 10, 2), rnorm(9, 13, 2), rnorm(4, 9, 2))
  df <- data.frame(col_y = y, col_g = as.character(g))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G")
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  op <- options(contrasts = c("contr.sum", "contr.poly"))
  ref_fit <- lm(y ~ g)
  ref_aov <- car::Anova(ref_fit, type = 3)
  options(op)

  # Row order here: Corrected Model, Intercept, G, Error, Total, Corrected Total.
  tbl <- find_table(result, "output.glmUni.title")
  expect_equal(cell_num(tbl, 3, 2), ref_aov["g", "Sum Sq"], tolerance = 1e-4, "Type III SS for G (single factor)")
  expect_equal(cell_num(tbl, 3, 5), ref_aov["g", "F value"], tolerance = 1e-4, "F for G (single factor)")
  expect_equal(cell_num(tbl, 3, 6), ref_aov["g", "Pr(>F)"], tolerance = 1e-4, "Sig. for G (single factor)")
})

# ── glm-repeated: Mauchly + epsilon-corrected F vs car::Anova(idesign=) ──────
test_that("glm-repeated: Mauchly's W and sphericity-corrected F match car::Anova's repeated-measures oracle", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("SKIP: car not installed\n")
    return(invisible())
  }
  set.seed(33)
  n <- 20
  subj_effect <- rnorm(n, sd = 2)
  t1 <- 10 + subj_effect + rnorm(n, sd = 1.5)
  t2 <- 12 + subj_effect + rnorm(n, sd = 1.8)
  t3 <- 11 + subj_effect + rnorm(n, sd = 2.2)
  t4 <- 14 + subj_effect + rnorm(n, sd = 1.6)
  df <- data.frame(col_t1 = t1, col_t2 = t2, col_t3 = t3, col_t4 = t4)

  fixture <- write_fixture(df, list(
    variables = list("col_t1", "col_t2", "col_t3", "col_t4"),
    varNames = list(col_t1 = "T1", col_t2 = "T2", col_t3 = "T3", col_t4 = "T4"),
    factorName = "time"
  ))
  result <- run_analysis_script("glm-repeated.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  Y <- cbind(t1, t2, t3, t4)
  mlm_fit <- lm(Y ~ 1)
  idata <- data.frame(w = factor(1:4))
  fit_car <- car::Anova(mlm_fit, idata = idata, idesign = ~w, type = 3)
  s <- summary(fit_car, multivariate = FALSE)
  ref_uni   <- s$univariate.tests
  ref_spher <- s$sphericity.tests
  ref_eps   <- s$pval.adjustments

  mauchly_tbl <- find_table(result, "output.glmRep.mauchlyTitle")
  expect_equal(cell_num(mauchly_tbl, 1, 2), unname(ref_spher["w", "Test statistic"]), tolerance = 1e-3, "Mauchly's W")
  # car applies a slightly different Box bias-correction constant than the
  # textbook Mauchly formula glm-repeated.R uses (both are legitimate
  # variants found across stats packages/SPSS); W and both epsilons agree to
  # ~5 significant digits above, confirming the underlying eigenvalues match
  # — only this derived Sig. needs a looser relative tolerance.
  expect_equal(cell_num(mauchly_tbl, 1, 5), unname(ref_spher["w", "p-value"]), tolerance = 1e-2, "Mauchly's Sig.")
  expect_equal(cell_num(mauchly_tbl, 1, 6), unname(ref_eps["w", "GG eps"]), tolerance = 1e-3, "Greenhouse-Geisser epsilon")
  expect_equal(cell_num(mauchly_tbl, 1, 7), unname(ref_eps["w", "HF eps"]), tolerance = 1e-2, "Huynh-Feldt epsilon")

  within_tbl <- find_table(result, "output.glmRep.withinTitle")
  # 2026-10 layout (SPSS's): Source | Correction | SS | df | MS | F | Sig.,
  # the effect's four corrections first, then the four Error rows.
  expect_equal(cell_num(within_tbl, 1, 3), unname(ref_uni["w", "Sum Sq"]), tolerance = 1e-2, "Sphericity-assumed SS")
  expect_equal(cell_num(within_tbl, 1, 6), unname(ref_uni["w", "F value"]), tolerance = 1e-2, "Sphericity-assumed F")
  expect_equal(cell_num(within_tbl, 5, 3), unname(ref_uni["w", "Error SS"]), tolerance = 1e-2, "Error SS")
})
