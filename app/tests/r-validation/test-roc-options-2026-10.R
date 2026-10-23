# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-roc-options-2026-10.R — the SPSS Options / Display sub-dialog settings
# added to roc.R and roc-analysis.R (Classification, Distribution assumption,
# Confidence level, Missing Values, ROC/PR display toggles, Case Processing
# Summary). References are hand-computed or come from pROC, never from the
# scripts' own helpers.

roc_opt_params <- function(options = list(), extra = list()) {
  c(list(variables = list("col_1"), varNames = list(col_1 = "score"),
         stateVar = "col_2", stateName = "state", stateValue = "1",
         options = options), extra)
}

test_that("roc: DISTRIBUTION(NEGEXPO) gives Hanley & McNeil's SE and the CI level is honored", {
  if (!requireNamespace("pROC", quietly = TRUE)) {
    cat("  (skipped: pROC not installed)\n")
    return(invisible())
  }
  set.seed(1010)
  n <- 90
  state <- rbinom(n, 1, 0.4)
  x <- rnorm(n) + 0.8 * state
  df <- data.frame(col_1 = x, col_2 = state)

  r <- pROC::roc(response = state, predictor = x, levels = c(0, 1), direction = "<",
                 quiet = TRUE)
  A <- as.numeric(pROC::auc(r))
  np <- sum(state == 1); nn <- sum(state == 0)
  q1 <- A / (2 - A); q2 <- 2 * A^2 / (1 + A)
  ref_se <- sqrt((A * (1 - A) + (np - 1) * (q1 - A^2) + (nn - 1) * (q2 - A^2)) / (np * nn))

  for (script in c("roc.R", "roc-analysis.R")) {
    res <- run_analysis_script(script, write_fixture(df, roc_opt_params(
      list(distribution = "negexpo", ciLevel = 0.9))))
    expect_true(isTRUE(res$success), paste(script, "success"))
    t <- res$tables[[2]] # Area Under the (ROC) Curve, after the case summary
    expect_equal(cell_num(t, 1, 3), round(ref_se, 3), tolerance = 1e-3,
                 paste(script, "bi-negative exponential SE"))
    z <- qnorm(0.95)
    expect_equal(cell_num(t, 1, 5), round(A - z * ref_se, 3), tolerance = 1.5e-3,
                 paste(script, "90% CI lower"))
    expect_true(identical(t$columns[[5]], "output.col.ciLowerPct:90"),
                paste(script, "CI column carries the level"))
  }
})

test_that("roc: listwise case processing summary and user-missing as valid", {
  # Cases: 4 positive, 4 negative, one system-missing score, one score of 99
  # declared user-missing.
  df <- data.frame(
    col_1 = c(5, 4, 3, 2, 3, 2, 1, 0, NA, 99),
    col_2 = c(1, 1, 1, 1, 0, 0, 0, 0, 1, 0)
  )
  mv <- list(col_1 = list(type = "discrete", discrete = list(99)))

  res <- run_analysis_script("roc.R", write_fixture(df, roc_opt_params(
    list(), list(missingValues = mv))))
  cps <- find_table(res, "output.roc.cpsTitle")
  expect_equal(cell_num(cps, 1, 2), 4, label = "positive N (user-missing excluded)")
  expect_equal(cell_num(cps, 2, 2), 4, label = "negative N (user-missing excluded)")
  expect_equal(cell_num(cps, 3, 2), 2, label = "missing N")

  res2 <- run_analysis_script("roc.R", write_fixture(df, roc_opt_params(
    list(userMissingValid = TRUE), list(missingValues = mv))))
  cps2 <- find_table(res2, "output.roc.cpsTitle")
  expect_equal(cell_num(cps2, 2, 2), 5, label = "negative N with user-missing valid")
  expect_true(length(res2$warnings) == 0, "no 'missing not applied' warning")
  # Hand count for the user-missing-valid frame: positives {5,4,3,2} vs
  # negatives {3,2,1,0,99}: 5 -> 4, 4 -> 4, 3 -> 3.5, 2 -> 2.5 = 14 of 20 pairs.
  expect_equal(cell_num(find_table(res2, "output.roc.aucTitle"), 1, 2), 14 / 20,
               label = "AUC with 99 counted as a negative score")
})

test_that("roc: cutoff column heading follows CUTOFF and TESTPOS", {
  df <- data.frame(col_1 = c(5, 4, 3, 2, 3, 2, 1, 0), col_2 = c(1, 1, 1, 1, 0, 0, 0, 0))
  heading <- function(opts) {
    res <- run_analysis_script("roc.R", write_fixture(df, roc_opt_params(
      c(list(coordinates = TRUE), opts))))
    find_table(res, "output.roc.coordsTitle")$columns[[2]]
  }
  expect_true(identical(heading(list()), "output.col.positiveIfGe"), "include/larger")
  expect_true(identical(heading(list(cutoff = "exclude")), "output.col.positiveIfGt"),
              "exclude/larger")
  expect_true(identical(heading(list(direction = "smaller")), "output.col.positiveIfLe"),
              "include/smaller")
  expect_true(identical(heading(list(direction = "smaller", cutoff = "exclude")),
                        "output.col.positiveIfLt"), "exclude/smaller")
})

test_that("roc: Display toggles drop the plot, the diagonal and the SE columns", {
  df <- data.frame(col_1 = c(5, 4, 3, 2, 3, 2, 1, 0), col_2 = c(1, 1, 1, 1, 0, 0, 0, 0))
  res <- run_analysis_script("roc.R", write_fixture(df, roc_opt_params(
    list(plotCurve = FALSE, seCi = FALSE))))
  expect_true(length(res$plots) == 0, "no plot when ROC Curve is off")
  expect_true(length(find_table(res, "output.roc.aucTitle")$columns) == 2,
              "Area only without SE and CI")

  res2 <- run_analysis_script("roc.R", write_fixture(df, roc_opt_params(
    list(diagonal = FALSE))))
  expect_true(length(res2$plots[[1]]$data$data) == 1, "no reference line trace")
})

test_that("roc-analysis: PR interpolation along TP / FP matches the hand computation", {
  # Positives {3,2,2}, negatives {2,1}. Cutoff points (TP,FP): (0,0) (1,0)
  # (3,1) (3,2). The (1,0)->(3,1) segment is where the schemes differ:
  #   along TP: extra point (2, 0.5) -> area 1/3 + 0.3 + 0.258333 = 0.891667
  #   along FP: straight to (3, 1)   -> area 1/3 + (2/3)(1 + .75)/2 = 0.916667
  df <- data.frame(col_1 = c(3, 2, 2, 2, 1), col_2 = c(1, 1, 1, 0, 0))
  pr_area <- function(interp) {
    res <- run_analysis_script("roc-analysis.R", write_fixture(df, roc_opt_params(
      list(prCurve = TRUE, prInterp = interp, prCoordinates = TRUE, modelQuality = TRUE))))
    expect_true(isTRUE(res$success), paste("success", interp))
    expect_true(length(res$plots) == 3, "ROC + PR + model quality plots")
    find_table(res, "output.rocAnalysis.prCoordsTitle")
    cell_num(find_table(res, "output.rocAnalysis.prAucTitle"), 1, 2)
  }
  expect_equal(pr_area("tp"), 0.892, tolerance = 1e-9, "PR area along true positives")
  expect_equal(pr_area("fp"), 0.917, tolerance = 1e-9, "PR area along false positives")
})

test_that("roc: SPSS output layout — total row, labels, ascending coordinates, PR anchor", {
  df <- data.frame(col_1 = c(5, 4, 3, 2, 3, 2, 1, 0, NA), col_2 = c(1, 1, 1, 1, 0, 0, 0, 0, 1))
  res <- run_analysis_script("roc-analysis.R", write_fixture(df, roc_opt_params(
    list(coordinates = TRUE, prCoordinates = TRUE),
    list(stateLabel = "Outcome (severe)", stateValueLabels = list(`1` = "Severe")))))
  expect_true(isTRUE(res$success), "success")

  cps <- find_table(res, "output.roc.cpsTitle")
  expect_true(identical(cps$columns[[1]], "output.roc.stateCol:Outcome (severe)"),
              "heading is the state variable's label")
  expect_true(identical(cps$rows[[4]][[1]], "output.roc.total"), "Total row")
  expect_equal(cell_num(cps, 4, 2), 9, label = "total = positive + negative + missing")
  expect_true(startsWith(cps$footnoteKey, "output.roc.cpsFootnote:Severe|"),
              "footnote names the positive state by its value label")

  auc <- find_table(res, "output.rocAnalysis.aucTitle")
  expect_true(identical(auc$footnoteKey, "output.roc.aucFootnote"), "a/b footnote")

  rc <- find_table(res, "output.rocAnalysis.coordsTitle")
  cuts <- vapply(rc$rows, function(r) as.numeric(r[[2]]), numeric(1))
  expect_true(identical(cuts, sort(cuts)), "cutoffs ascend, as SPSS prints them")
  expect_equal(cuts[1], -1, label = "first cutoff = min - 1")
  expect_true(identical(rc$rows[[1]][[1]], "score") && identical(rc$rows[[2]][[1]], ""),
              "variable name on its first row only")

  pr <- find_table(res, "output.rocAnalysis.prCoordsTitle")
  expect_true(identical(pr$columns[[3]], "output.col.precision"), "Precision before Recall")
  last <- pr$rows[[length(pr$rows)]]
  expect_equal(as.numeric(last[[3]]), 1, label = "precision is 1 above the maximum (SPSS)")
  expect_equal(as.numeric(last[[4]]), 0, label = "recall is 0 there")
})
