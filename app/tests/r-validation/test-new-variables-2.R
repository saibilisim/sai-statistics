# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# New variables (NV1, roadmap ★11) — part 2: the dot-formula conversions and
# the per-coefficient (stem-named) columns.
#
# Ordinal, multinomial, probit and tree all fitted `y ~ .` before they carried
# the row index. That silently enrols __row_idx as a predictor — it did exactly
# that in discriminant.R — so these assertions check the CONVERTED models
# against an independent reference fitted on the predictors alone. A leaked row
# number would move every coefficient and show up here.
#
# Split from test-new-variables.R only for size; the helpers come from there,
# and run-all.R sources both.

test_that("ordinal regression is unaffected by the row index it now carries", {
  set.seed(1212)
  n <- 150
  x <- rnorm(n)
  z <- 0.9 * x + rnorm(n)
  df <- data.frame(
    col_1 = as.character(cut(z, breaks = c(-Inf, -0.6, 0.6, Inf), labels = c("1", "2", "3"))),
    col_2 = round(x, 4))
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    dependent = "col_1", covariates = list("col_2"), varNames = list(col_2 = "x"),
    createVars = list(predictedGroup = "pgr", probability = "pre")
  ))
  result <- run_analysis_script("regression-ordinal.R", fixture)
  if (!isTRUE(result$success)) { cat("  (skipped: MASS not installed)\n"); return(invisible()) }

  ref <- MASS::polr(factor(col_1, ordered = TRUE) ~ col_2, data = df, Hess = TRUE)
  # Prefix must reach the parameter estimates — "output.ordinal" alone lands on
  # the model fit table, which carries no coefficients at all.
  pe <- find_table(result, "output.ordinal.paramTitle")
  # The reported slope must equal the reference; had the row index leaked into
  # the model it would not.
  # The estimate is not always the same column across the parameter table's
  # blocks, so every numeric cell is scanned rather than one hard-coded index.
  found <- FALSE
  for (r in pe$rows) {
    for (cell in r) {
      v <- suppressWarnings(as.numeric(cell))
      if (!is.na(v) && abs(v - unname(coef(ref)[1])) < 1e-3) found <- TRUE
    }
  }
  expect_true(found, "the reported slope matches a reference fitted on x alone")

  cv <- by_name(result)
  expect_true(identical(cv[["pgr"]]$measure, "ordinal"),
              "predicted category keeps the ordinal measure")
  expect_true(all(unlist(cv[["pgr"]]$values) %in% c("1", "2", "3")), "values are source labels")
  pr <- unlist(cv[["pre"]]$values)
  expect_true(all(pr > 0 & pr <= 1), "probability of the predicted category is a probability")
  expect_true(min(pr) >= 1 / 3 - 1e-9, "and is the LARGEST of the three, so never below 1/3")
})

test_that("multinomial regression is unaffected by the row index it now carries", {
  set.seed(808)
  n <- 180
  x <- rnorm(n)
  lin <- 1.4 * x
  pr <- cbind(1, exp(lin), exp(-lin))
  pr <- pr / rowSums(pr)
  pick <- apply(pr, 1, function(p) sample(c("a", "b", "c"), 1, prob = p))
  df <- data.frame(col_1 = pick, col_2 = round(x, 4))
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    dependent = "col_1", covariates = list("col_2"), varNames = list(col_2 = "x"),
    createVars = list(predictedGroup = "pgr", probability = "pre")
  ))
  result <- run_analysis_script("regression-multinomial.R", fixture)
  if (!isTRUE(result$success)) { cat("  (skipped: nnet not installed)\n"); return(invisible()) }

  cv <- by_name(result)
  expect_true(all(unlist(cv[["pgr"]]$values) %in% c("a", "b", "c")), "values are source labels")
  p <- unlist(cv[["pre"]]$values)
  expect_true(all(p > 1 / 3 - 1e-9 & p <= 1), "the winning probability is the largest of three")
  # The model has to have learnt something: the predicted label must track x.
  lab <- unlist(cv[["pgr"]]$values)
  mb <- mean(df$col_2[lab == "b"])
  mc <- mean(df$col_2[lab == "c"])
  expect_true(mb > mc, "category b is predicted at high x and c at low x, as generated")
})

test_that("probit fits a grouped dose-response model matching a direct glm() reference", {
  # Probit Analysis (2026-09) moved from a per-case 0/1 model to SPSS's real
  # PROBIT shape — grouped Response Frequency / Total Observed counts, fit as
  # cbind(freq, total-freq) ~ covariates via a probit/logit-link GLM (or, with
  # a non-zero natural response rate, a custom MLE — not exercised here).
  set.seed(4004)
  ngroups <- 30
  dose <- seq(0.5, 5, length.out = ngroups)
  total <- rep(80L, ngroups)
  b0_true <- -1.5; b1_true <- 0.9
  p_true <- pnorm(b0_true + b1_true * dose)
  freq <- rbinom(ngroups, total, p_true)
  df <- data.frame(col_1 = freq, col_2 = total, col_3 = round(dose, 6))

  fixture <- write_fixture(df, list(
    responseFreq = "col_1", totalObserved = "col_2",
    covariates = list("col_3"), varNames = list(col_3 = "dose"),
    transform = "none", modelType = "probit",
    options = list(frequencies = TRUE, parallelism = FALSE, fiducialCI = TRUE,
                    heterogeneitySig = 0.15, naturalResponseMode = "none",
                    maxIterations = 20),
    createVars = list(probability = "pre", expected = "exp", residual = "res")
  ))
  result <- run_analysis_script("regression-probit.R", fixture)
  expect_true(isTRUE(result$success),
              if (isTRUE(result$success)) "script ran" else paste("script error:", result$error))

  ref <- glm(cbind(col_1, col_2 - col_1) ~ col_3, data = df, family = binomial(link = "probit"))
  ref_b <- unname(coef(ref))

  # Parameter Estimates lists predictors before the constant (SPSS order), so
  # the reported B is matched against the reference by VALUE, not position —
  # the same defensive style test-new-variables.R's ordinal test above uses.
  pe <- find_table(result, "output.probit.paramTitle")
  found_b0 <- FALSE; found_b1 <- FALSE
  for (r in pe$rows) {
    v <- suppressWarnings(as.numeric(r[[2]]))
    if (is.na(v)) next
    if (abs(v - ref_b[1]) < 1e-5) found_b0 <- TRUE
    if (abs(v - ref_b[2]) < 1e-5) found_b1 <- TRUE
  }
  expect_true(found_b0, "constant B matches a glm(cbind(freq, total-freq) ~ dose) reference")
  expect_true(found_b1, "dose slope B matches the same reference")

  cv <- by_name(result)
  fit_ref <- as.numeric(fitted(ref))
  expect_equal(max(abs(unlist(cv[["pre"]]$values) - fit_ref)), 0,
               tolerance = 1e-6, "fitted probabilities match the glm() reference")
  expect_equal(max(abs(unlist(cv[["exp"]]$values) - df$col_2 * fit_ref)), 0,
               tolerance = 1e-6, "expected responses = total * fitted probability")
  expect_equal(max(abs(unlist(cv[["res"]]$values) - (df$col_1 - df$col_2 * fit_ref))), 0,
               tolerance = 1e-6, "residuals = observed - expected responses")

  # Pearson goodness-of-fit chi-square, computed independently here rather
  # than trusting the script's own formula for it.
  chi <- find_table(result, "output.probit.chiSquareTitle")
  expected_ref <- df$col_2 * fit_ref
  pearson_ref <- sum((df$col_1 - expected_ref)^2 / (expected_ref * (1 - fit_ref)))
  expect_equal(cell_num(chi, 1, 1), pearson_ref, tolerance = 1e-4,
               "Pearson chi-square matches an independent computation")
})

test_that("tree writes back the terminal node the reported tree actually uses", {
  set.seed(616)
  n <- 200
  x1 <- runif(n); x2 <- runif(n)
  df <- data.frame(col_1 = ifelse(x1 > 0.5, "A", "B"),
                   col_2 = round(x1, 4), col_3 = round(x2, 4))
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    groupVar = "col_1", independents = list("col_2", "col_3"),
    varNames = list(col_2 = "x1", col_3 = "x2"),
    options = list(minCases = 10, maxDepth = 3),
    createVars = list(predictedGroup = "pgr", probability = "pre", node = "nod")
  ))
  result <- run_analysis_script("tree.R", fixture)
  if (!isTRUE(result$success)) { cat("  (skipped: rpart not installed)\n"); return(invisible()) }
  cv <- by_name(result)

  # x1 alone determines the class, so a tree that did not get the row number as
  # a competing splitter classifies essentially perfectly.
  expect_true(mean(unlist(cv[["pgr"]]$values) == df$col_1) > 0.95,
              "the tree recovers the rule from x1")
  # Node ids must be the ones the Tree Structure table prints.
  # Must be the Tree Structure table specifically — a bare "output.tree" prefix
  # matches the model summary first, whose first column is a label, not a node id.
  nodes <- find_table(result, "output.tree.structureTitle")
  printed <- vapply(nodes$rows, function(r) as.integer(r[[1]]), integer(1))
  expect_true(all(unlist(cv[["nod"]]$values) %in% printed),
              "every node id written back appears in the reported tree")
  expect_true(length(unique(unlist(cv[["nod"]]$values))) >= 2,
              "cases land in more than one terminal node")
})

test_that("hierarchical clustering writes membership only once a cut is chosen", {
  set.seed(99)
  m <- rbind(cbind(rnorm(30, 0), rnorm(30, 0)), cbind(rnorm(30, 8), rnorm(30, 8)))
  df <- data.frame(col_1 = round(m[, 1], 4), col_2 = round(m[, 2], 4))
  n <- nrow(df)
  df[["__row_idx"]] <- seq_len(n) - 1L
  base <- list(variables = list("col_1", "col_2"), varNames = list(col_1 = "a", col_2 = "b"),
               method = "ward.D2")

  # No cut requested -> nothing to write, and the honesty warning fires rather
  # than the run inventing a k of its own.
  none <- run_analysis_script(
    "hierarchical.R",
    write_fixture(df, c(base, list(clusters = 0, createVars = list(cluster = "clu")))))
  expect_equal(length(none$caseVars), 0, tolerance = 0, "no cut, no column")
  expect_true("output.warn.newVarsNotApplied" %in% unlist(none$warnings),
              "and it says so instead of staying silent")

  cut2 <- run_analysis_script(
    "hierarchical.R",
    write_fixture(df, c(base, list(clusters = 2, createVars = list(cluster = "clu")))))
  cv <- by_name(cut2)
  cl <- cv[["clu"]]
  expect_equal(length(unlist(cl$rowIndex)), n, tolerance = 0, "one value per case")
  expect_true(identical(cl$measure, "nominal"), "membership is nominal")
  truth <- rep(c(1L, 2L), each = 30)
  agree <- mean(unlist(cl$values) == truth)
  expect_true(max(agree, 1 - agree) == 1, "the two well-separated blobs are recovered exactly")
})

test_that("per-coefficient columns use the typed name as a stem", {
  set.seed(313)
  n <- 100
  x1 <- rnorm(n); x2 <- rnorm(n)
  df <- data.frame(col_1 = round(1 + 2 * x1 - x2 + rnorm(n, sd = 0.5), 4),
                   col_2 = round(x1, 4), col_3 = round(x2, 4))
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    dependent = "col_1", independents = list("col_2", "col_3"),
    varNames = list(col_1 = "y", col_2 = "x1", col_3 = "x2"),
    createVars = list(dfbeta = "dfb", partial = "par")
  ))
  result <- run_analysis_script("regression-linear.R", fixture)
  nms <- vapply(result$caseVars, function(c) c$name, character(1))

  # Three coefficients (intercept + two predictors) and two partial residuals.
  expect_true(all(c("dfb1", "dfb2", "dfb3") %in% nms), "one DfBeta column per coefficient")
  expect_true(all(c("par1", "par2") %in% nms), "one partial residual per predictor")

  cv <- by_name(result)
  ref <- lm(col_1 ~ col_2 + col_3, data = df)
  dfb <- stats::dfbeta(ref)
  for (j in 1:3) {
    expect_equal(max(abs(unlist(cv[[paste0("dfb", j)]]$values) - dfb[, j])), 0,
                 tolerance = 1e-8, sprintf("dfb%d matches dfbeta()[, %d]", j, j))
  }
  pres <- stats::residuals(ref, type = "partial")
  expect_equal(max(abs(unlist(cv[["par1"]]$values) - pres[, 1])), 0, tolerance = 1e-8,
               "par1 matches the partial residual of the first predictor")
  # Each label carries WHICH coefficient it belongs to, or the columns would be
  # indistinguishable in Variable View.
  expect_true(grepl("dfbeta", cv[["dfb2"]]$label, fixed = TRUE) &&
                grepl(":", cv[["dfb2"]]$label, fixed = TRUE),
              "the label names the coefficient")
})

test_that("Cox DfBeta and Schoenfeld residuals come back per coefficient", {
  set.seed(1717)
  n <- 140
  x1 <- rnorm(n); x2 <- rnorm(n)
  df <- data.frame(
    col_1 = round(rexp(n, rate = 0.05 * exp(0.9 * x1)) + 0.3, 3),
    col_2 = ifelse(runif(n) < 0.75, "1", "0"),
    col_3 = round(x1, 4), col_4 = round(x2, 4))
  df[["__row_idx"]] <- seq_len(n) - 1L

  fixture <- write_fixture(df, list(
    timeVar = "col_1", statusVar = "col_2", eventValue = "1",
    covariates = list("col_3", "col_4"), varNames = list(col_3 = "x1", col_4 = "x2"),
    createVars = list(dfbeta = "dfb", schoenfeld = "sch")
  ))
  result <- run_analysis_script("survival-cox.R", fixture)
  nms <- vapply(result$caseVars, function(c) c$name, character(1))
  expect_true(all(c("dfb1", "dfb2", "sch1", "sch2") %in% nms),
              "two coefficients -> two DfBeta and two Schoenfeld columns")

  cv <- by_name(result)
  # Schoenfeld residuals exist only for EVENTS, so that column is shorter than
  # DfBeta by exactly the number of censored cases — the honest blank, not a
  # bug. Comparing the two counts pins that relationship.
  n_event <- sum(df$col_2 == "1")
  expect_equal(length(unlist(cv[["sch1"]]$rowIndex)), n_event, tolerance = 0,
               "one Schoenfeld residual per event")
  expect_equal(length(unlist(cv[["dfb1"]]$rowIndex)), n, tolerance = 0,
               "but a DfBeta for every case")
  # And the rows it does fill must BE the events.
  ev_idx <- which(df$col_2 == "1") - 1L
  expect_true(all(sort(unlist(cv[["sch1"]]$rowIndex)) == sort(ev_idx)),
              "the filled rows are exactly the events")
  # Schoenfeld residuals sum to zero at the MLE — the score equation.
  expect_equal(sum(unlist(cv[["sch1"]]$values)), 0, tolerance = 1e-4,
               "Schoenfeld residuals sum to zero at the fitted coefficients")
})
