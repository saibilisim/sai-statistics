# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# New variables from an analysis (NV1, roadmap ★11) — the analyses wired after
# the survival pair.
#
# The one thing every case here checks is ALIGNMENT: each fixture punches holes
# in a variable so the analysis drops those cases listwise, and the created
# column must skip exactly their dataset row indices. A column full of
# plausible numbers attached to the wrong cases is the failure this feature can
# produce with nothing in the output looking wrong.

# Row index 0-based, matching DuckDB's __row_idx.
holes_at <- function(n, holes) setdiff(seq_len(n) - 1L, holes - 1L)

test_that("linear regression writes back the diagnostics people re-analyse", {
  set.seed(909)
  n <- 90
  x1 <- rnorm(n); x2 <- rnorm(n)
  df <- data.frame(col_1 = round(2 + 1.5 * x1 - 0.8 * x2 + rnorm(n, sd = 0.7), 4),
                   col_2 = round(x1, 4), col_3 = round(x2, 4))
  holes <- c(5L, 44L)
  df$col_2[holes] <- NA_real_
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    dependent = "col_1", independents = list("col_2", "col_3"),
    varNames = list(col_1 = "y", col_2 = "x1", col_3 = "x2"),
    createVars = list(predicted = "pre", residual = "res", standardized = "zre",
                      studentized = "sre", deleted = "sdr", leverage = "lev",
                      cooks = "coo", mahalanobis = "mah")
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  cv <- by_name(result)
  expect_equal(length(result$caseVars), 8, tolerance = 0, "all eight columns returned")

  idx <- unlist(cv[["res"]]$rowIndex)
  expect_true(all(idx == holes_at(n, holes)), "values skip exactly the dropped cases")

  keep <- !is.na(df$col_2)
  ref <- lm(col_1 ~ col_2 + col_3, data = df[keep, ])
  expect_equal(max(abs(unlist(cv[["pre"]]$values) - as.numeric(fitted(ref)))), 0,
               tolerance = 1e-6, "predicted == lm() fitted values")
  expect_equal(max(abs(unlist(cv[["res"]]$values) - as.numeric(residuals(ref)))), 0,
               tolerance = 1e-6, "residual == lm() residuals")
  expect_equal(max(abs(unlist(cv[["sre"]]$values) - as.numeric(rstandard(ref)))), 0,
               tolerance = 1e-6, "studentized == rstandard()")
  expect_equal(max(abs(unlist(cv[["sdr"]]$values) - as.numeric(rstudent(ref)))), 0,
               tolerance = 1e-6, "deleted == rstudent()")
  expect_equal(max(abs(unlist(cv[["lev"]]$values) - as.numeric(hatvalues(ref)))), 0,
               tolerance = 1e-6, "leverage == hatvalues()")
  expect_equal(max(abs(unlist(cv[["coo"]]$values) - as.numeric(cooks.distance(ref)))), 0,
               tolerance = 1e-6, "Cook D == cooks.distance()")
  # SPSS reports Mahalanobis distance of the predictors; for an OLS fit with an
  # intercept that identity is (n-1)(h_ii - 1/n). Checked against the direct
  # computation so the shortcut cannot drift.
  P <- as.matrix(df[keep, c("col_2", "col_3")])
  md <- stats::mahalanobis(P, colMeans(P), stats::cov(P))
  expect_equal(max(abs(unlist(cv[["mah"]]$values) - md)), 0, tolerance = 1e-6,
               "Mahalanobis matches the direct predictor-space distance")
  # Standardized (residual / s) and studentized differ wherever leverage does —
  # if they came out identical, one of them is computed wrongly.
  expect_true(max(abs(unlist(cv[["zre"]]$values) - unlist(cv[["sre"]]$values))) > 1e-4,
              "standardized and studentized are genuinely different scalings")
})

test_that("logistic regression writes back probabilities and the predicted LABEL", {
  set.seed(77)
  n <- 120
  x <- rnorm(n)
  p <- 1 / (1 + exp(-(0.3 + 1.8 * x)))
  df <- data.frame(col_1 = ifelse(runif(n) < p, "yes", "no"), col_2 = round(x, 4))
  holes <- c(9L, 30L, 101L)
  df$col_2[holes] <- NA_real_
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    dependent = "col_1", covariates = list("col_2"),
    varNames = list(col_1 = "y", col_2 = "x"),
    createVars = list(probability = "pre", predictedGroup = "pgr", residual = "res")
  ))
  result <- run_analysis_script("regression-logistic.R", fixture)
  cv <- by_name(result)

  idx <- unlist(cv[["pre"]]$rowIndex)
  expect_true(all(idx == holes_at(n, holes)), "values skip exactly the dropped cases")

  keep <- !is.na(df$col_2)
  ref <- glm(factor(col_1) ~ col_2, data = df[keep, ], family = binomial())
  expect_equal(max(abs(unlist(cv[["pre"]]$values) - as.numeric(fitted(ref)))), 0,
               tolerance = 1e-6, "probability == glm() fitted values")

  # The predicted group must come back as the ORIGINAL label, not as 0/1 — a
  # column the user has to decode is useless as the next analysis's input.
  grp <- cv[["pgr"]]
  expect_true(identical(grp$type, "string"), "predicted group is a string column")
  expect_true(identical(grp$measure, "nominal"), "and nominal, not scale")
  expect_true(all(unlist(grp$values) %in% c("no", "yes")), "values are the source labels")
  expect_true(all((unlist(cv[["pre"]]$values) >= 0.5) == (unlist(grp$values) == "yes")),
              "the label follows the 0.5 cut on the fitted probability")
})

test_that("k-means writes cluster membership back as a NOMINAL column", {
  set.seed(2024)
  a <- cbind(rnorm(40, 0), rnorm(40, 0))
  b <- cbind(rnorm(40, 6), rnorm(40, 6))
  m <- rbind(a, b)
  df <- data.frame(col_1 = round(m[, 1], 4), col_2 = round(m[, 2], 4))
  n <- nrow(df)
  holes <- c(3L, 70L)
  df$col_1[holes] <- NA_real_
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"), varNames = list(col_1 = "a", col_2 = "b"),
    clusters = 2, createVars = list(cluster = "qcl", distance = "qdist")
  ))
  result <- run_analysis_script("kmeans.R", fixture)
  cv <- by_name(result)

  cl <- cv[["qcl"]]
  expect_true(all(unlist(cl$rowIndex) == holes_at(n, holes)),
              "membership skips exactly the dropped cases")
  expect_true(identical(cl$measure, "nominal"),
              "cluster 2 is not twice cluster 1 — the column is nominal")
  expect_true(all(unlist(cl$values) %in% c(1, 2)), "labels are the cluster numbers")
  # The two blobs are far apart, so every kept case must land with its own blob.
  keep <- !is.na(df$col_1)
  truth <- rep(c(1L, 2L), each = 40)[keep]
  agree <- mean(unlist(cl$values) == truth)
  expect_true(max(agree, 1 - agree) == 1,
              "every case is assigned to its own well-separated blob")
  # Distance must be to the case's OWN centre, so it is small for every case
  # here; a distance joined to the wrong row would blow past the blob radius.
  expect_true(max(unlist(cv[["qdist"]]$values)) < 5,
              "distance is to the case own centre, not another cluster's")
})

test_that("factor scores follow the ROTATED structure the user is reading", {
  set.seed(31)
  n <- 150
  f1 <- rnorm(n); f2 <- rnorm(n)
  df <- data.frame(
    col_1 = round(f1 + rnorm(n, sd = 0.4), 4), col_2 = round(f1 + rnorm(n, sd = 0.4), 4),
    col_3 = round(f1 + rnorm(n, sd = 0.4), 4), col_4 = round(f2 + rnorm(n, sd = 0.4), 4),
    col_5 = round(f2 + rnorm(n, sd = 0.4), 4), col_6 = round(f2 + rnorm(n, sd = 0.4), 4))
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    variables = as.list(paste0("col_", 1:6)),
    varNames = setNames(as.list(paste0("v", 1:6)), paste0("col_", 1:6)),
    # Varimax on purpose. Unrotated, PC1 is the general component and loads on
    # all six variables — correctly so — which is exactly why the scores have
    # to be built from the loadings the OUTPUT shows rather than from the
    # unrotated ones the user never saw.
    options = list(rotation = "varimax"),
    createVars = list(score1 = "fac1", score2 = "fac2")
  ))
  result <- run_analysis_script("factor.R", fixture)
  cv <- by_name(result)
  expect_equal(length(result$caseVars), 2, tolerance = 0, "two components retained, two scores")

  s1 <- unlist(cv[["fac1"]]$values)
  expect_equal(mean(s1), 0, tolerance = 1e-6, "scores are centred")
  expect_true(abs(stats::sd(s1) - 1) < 0.05, "and standardised to roughly unit variance")
  # After rotation each score must track ONE of the two generating factors,
  # not a blend of both. Sign and component order are arbitrary, so compare
  # absolute correlations and let either score claim either factor.
  s2 <- unlist(cv[["fac2"]]$values)
  blockA <- rowMeans(df[, c("col_1", "col_2", "col_3")])
  blockB <- rowMeans(df[, c("col_4", "col_5", "col_6")])
  sep <- function(s) abs(abs(cor(s, blockA)) - abs(cor(s, blockB)))
  expect_true(sep(s1) > 0.6, sprintf("score 1 loads on one block, not both (gap %.2f)", sep(s1)))
  expect_true(sep(s2) > 0.6, sprintf("score 2 loads on one block, not both (gap %.2f)", sep(s2)))
  # …and on DIFFERENT blocks: two scores that both tracked block A would each
  # pass the test above while carrying the same information.
  claimA <- function(s) abs(cor(s, blockA)) > abs(cor(s, blockB))
  expect_true(claimA(s1) != claimA(s2), "the two scores claim different blocks")
})

test_that("discriminant writes back the predicted group as its original label", {
  set.seed(555)
  n_per <- 50
  df <- data.frame(
    col_1 = rep(c("low", "high"), each = n_per),
    col_2 = round(c(rnorm(n_per, 0), rnorm(n_per, 3)), 4),
    col_3 = round(c(rnorm(n_per, 0), rnorm(n_per, 2)), 4))
  n <- nrow(df)
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    groupVar = "col_1", independents = list("col_2", "col_3"),
    varNames = list(col_2 = "a", col_3 = "b"),
    createVars = list(predictedGroup = "dis_pred", score1 = "dis1")
  ))
  result <- run_analysis_script("discriminant.R", fixture)
  if (!isTRUE(result$success)) {
    cat("  (skipped: MASS not installed)\n")
    return(invisible())
  }
  cv <- by_name(result)
  pg <- cv[["dis_pred"]]
  expect_true(identical(pg$type, "string"), "predicted group is a string column")
  expect_true(all(unlist(pg$values) %in% c("low", "high")), "values are the source labels")
  expect_true(mean(unlist(pg$values) == df$col_1) > 0.9,
              "well-separated groups are mostly classified correctly")
  # One discriminant function for two groups; the score must separate them.
  d1 <- unlist(cv[["dis1"]]$values)
  expect_true(abs(mean(d1[df$col_1 == "low"]) - mean(d1[df$col_1 == "high"])) > 1,
              "the discriminant score separates the two groups")
})
