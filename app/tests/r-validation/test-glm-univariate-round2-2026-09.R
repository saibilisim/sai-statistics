# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-glm-univariate-round2-2026-09.R — validates the second 2026-09 GLM
# Univariate expansion: Homogeneous Subsets post hoc (agricolae-backed),
# Dunnett (vs. control) and interaction-term Estimated Marginal Means
# (emmeans-backed), per-factor Contrasts (Parameter Estimates re-coding), and
# Save (new case variables). Each is checked against an independent oracle:
# agricolae's own SNK.test()/direct MSE-df, emmeans's own contrast()/emmeans(),
# hand-computed contrast coefficients (mean differences), and stats::fitted().

test_that("glm-univariate: Homogeneous Subsets (S-N-K) matches agricolae::SNK.test with the same dfres/MSE", {
  if (!requireNamespace("agricolae", quietly = TRUE)) {
    cat("SKIP: agricolae not installed\n")
    return(invisible())
  }
  set.seed(43)
  g <- factor(c(rep("x1", 7), rep("x2", 5), rep("x3", 9)))
  y <- c(rnorm(7, 5, 1.5), rnorm(5, 7, 1.5), rnorm(9, 6, 1.5))
  df <- data.frame(col_y = y, col_g = as.character(g))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    options = list(postHoc = list(factors = list("col_g"), snk = TRUE))
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  fit <- lm(y ~ g)
  ref <- agricolae::SNK.test(y, g, df.residual(fit), deviance(fit) / df.residual(fit), alpha = 0.05, group = TRUE)
  ref_means <- setNames(ref$groups[[1]], rownames(ref$groups))

  tbl <- find_table(result, "output.glmUni.homogSubsetsTitle:y|G|output.anova.snk")
  # Each row's own mean (in whichever subset column it appears) must match the
  # oracle's per-level mean exactly, regardless of subset-column placement.
  for (row in tbl$rows) {
    lvl <- row[[1]]
    if (identical(lvl, "output.anova.sigRow")) next
    vals <- Filter(Negate(is.null), row[-(1:2)])
    for (v in vals) expect_equal(as.numeric(v), unname(ref_means[lvl]), tolerance = 1e-4, label = paste("mean for", lvl))
  }
})

test_that("glm-univariate: Dunnett (vs. control) matches emmeans::contrast(method='trt.vs.ctrl')", {
  if (!requireNamespace("emmeans", quietly = TRUE)) {
    cat("SKIP: emmeans not installed\n")
    return(invisible())
  }
  set.seed(41)
  a <- factor(c(rep("a1", 9), rep("a2", 6)))
  b <- factor(c(rep("b1", 5), rep("b2", 4), rep("b1", 3), rep("b2", 3)))
  y <- 4 + 1.6 * (a == "a2") + 1.1 * (b == "b2") + rnorm(15, sd = 1.1)
  df <- data.frame(col_y = y, col_a = as.character(a), col_b = as.character(b))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_a", "col_b"), factorNames = list(col_a = "A", col_b = "B"),
    options = list(postHoc = list(factors = list("col_b"), dunnett = TRUE, dunnettControl = "first"))
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  fit <- lm(y ~ a * b, data = data.frame(y = y, a = a, b = b))
  em <- emmeans::emmeans(fit, ~b)
  ref <- summary(emmeans::contrast(em, method = "trt.vs.ctrl", ref = 1))

  tbl <- find_table(result, "output.glmUni.dunnettTitle:y|B")
  expect_equal(cell_num(tbl, 1, 3), ref$estimate[1], tolerance = 1e-4, "Dunnett estimate b2-b1")
  expect_equal(cell_num(tbl, 1, 5), ref$p.value[1], tolerance = 1e-4, "Dunnett p-value b2-b1")
})

test_that("glm-univariate: interaction-term EM Means match emmeans::emmeans(~f1:f2)", {
  if (!requireNamespace("emmeans", quietly = TRUE)) {
    cat("SKIP: emmeans not installed\n")
    return(invisible())
  }
  set.seed(2)
  f1 <- factor(rep(c("a1", "a2"), each = 12))
  f2 <- factor(rep(rep(c("b1", "b2", "b3"), each = 4), 2))
  y <- 3 + 1.5 * (f1 == "a2") + 0.8 * (f2 == "b2") + 1.9 * (f2 == "b3") + rnorm(24, sd = 1)
  df <- data.frame(col_y = y, col_a = as.character(f1), col_b = as.character(f2))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_a", "col_b"), factorNames = list(col_a = "A", col_b = "B"),
    options = list(emMeans = list(terms = list("col_a*col_b")))
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  fit <- lm(y ~ f1 * f2)
  ref <- as.data.frame(emmeans::emmeans(fit, ~f1:f2))

  tbl <- find_table(result, "output.glmUni.emMeansTitle:y|A * B")
  for (i in seq_len(nrow(ref))) {
    expect_equal(cell_num(tbl, i, 3), ref$emmean[i], tolerance = 1e-4, label = paste("emmean row", i))
  }
})

test_that("glm-univariate: Contrasts (Helmert/Difference/Repeated) match their known coefficient formulas", {
  set.seed(7)
  g <- factor(rep(c("g1", "g2", "g3", "g4"), each = 6))
  y <- c(3, 3.2, 2.8, 3.1, 2.9, 3.0, 5, 5.1, 4.9, 5.2, 4.8, 5.0,
         7, 7.2, 6.8, 7.1, 6.9, 7.0, 12, 12.1, 11.9, 12.2, 11.8, 12.0) + rnorm(24, sd = 0.02)
  df <- data.frame(col_y = y, col_g = as.character(g))
  m <- tapply(y, g, mean)

  run_with <- function(ctype) {
    fixture <- write_fixture(df, list(
      dependent = "col_y", dependentName = "y",
      factors = list("col_g"), factorNames = list(col_g = "G"),
      options = list(paramEstimates = TRUE, contrasts = list(col_g = list(type = ctype, reference = "first")))
    ))
    result <- run_analysis_script("glm-univariate.R", fixture)
    expect_true(isTRUE(result$success), paste("result$success for", ctype))
    find_table(result, "output.glmUni.paramTitle")
  }

  # Repeated (MASS::contr.sdif): each coefficient IS the raw adjacent-level
  # mean difference.
  tbl_rep <- run_with("repeated")
  expect_equal(cell_num(tbl_rep, 2, 2), unname(m["g2"] - m["g1"]), tolerance = 1e-3, "Repeated coef 1 (g2-g1)")
  expect_equal(cell_num(tbl_rep, 3, 2), unname(m["g3"] - m["g2"]), tolerance = 1e-3, "Repeated coef 2 (g3-g2)")
  expect_equal(cell_num(tbl_rep, 4, 2), unname(m["g4"] - m["g3"]), tolerance = 1e-3, "Repeated coef 3 (g4-g3)")

  # Difference (contr.helmert as-is): each level vs the mean of PRECEDING levels.
  tbl_dif <- run_with("difference")
  expect_equal(cell_num(tbl_dif, 2, 2), unname((m["g2"] - m["g1"]) / 2), tolerance = 1e-3, "Difference coef 1")

  # Simple, reference=first (contr.treatment, no relevel): each level vs level 1.
  tbl_simp <- run_with("simple")
  expect_equal(cell_num(tbl_simp, 2, 2), unname(m["g2"] - m["g1"]), tolerance = 1e-3, "Simple coef 1 (g2 vs g1)")
  expect_equal(cell_num(tbl_simp, 3, 2), unname(m["g3"] - m["g1"]), tolerance = 1e-3, "Simple coef 2 (g3 vs g1)")

  # Default (no contrasts option at all): unchanged contr.SAS behavior — last
  # level is the reference, coefficient = level_i - level_last.
  fixture0 <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    options = list(paramEstimates = TRUE)
  ))
  result0 <- run_analysis_script("glm-univariate.R", fixture0)
  expect_true(isTRUE(result0$success), "result0$success")
  expect_equal(length(unlist(result0$notes)), 0L, label = "no contrast notes when contrasts option is absent")
  tbl0 <- find_table(result0, "output.glmUni.paramTitle")
  expect_equal(cell_num(tbl0, 2, 2), unname(m["g1"] - m["g4"]), tolerance = 1e-3, "default contr.SAS coef (g1 vs g4)")
})

test_that("glm-univariate: Save (predicted/residual) matches stats::fitted()/residuals()", {
  set.seed(9)
  g <- factor(rep(c("a", "b", "c"), each = 8))
  y <- 3 + 1.5 * (g == "b") + 2.5 * (g == "c") + rnorm(24, sd = 1)
  df <- data.frame(col_y = y, col_g = as.character(g))

  fixture <- write_fixture(df, list(
    dependent = "col_y", dependentName = "y",
    factors = list("col_g"), factorNames = list(col_g = "G"),
    createVars = list(predicted = "pred1", residual = "res1", cooks = "coo1")
  ))
  result <- run_analysis_script("glm-univariate.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  fit <- lm(y ~ g)
  pred_cv <- result$caseVars[[which(vapply(result$caseVars, function(c) c$name == "pred1", logical(1)))]]
  res_cv  <- result$caseVars[[which(vapply(result$caseVars, function(c) c$name == "res1", logical(1)))]]
  expect_equal(unlist(pred_cv$values), unname(fitted(fit)), tolerance = 1e-6, "predicted matches fitted()")
  expect_equal(unlist(res_cv$values), unname(residuals(fit)), tolerance = 1e-6, "residual matches residuals()")
})
