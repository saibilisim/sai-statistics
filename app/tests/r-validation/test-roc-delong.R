# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-roc-delong.R — validates RA4 (spss-parity-findings-2026-07-07 §B5):
# roc-analysis.R's pairwise DeLong AUC comparison. Oracle: pROC::roc.test()
# called directly (independent of the script — this validates the SCRIPT's
# data wiring: direction convention, common-case masking, column mapping —
# not pROC's own DeLong math, which is the package's job to get right).

test_that("ROC Analysis: DeLong comparison matches pROC::roc.test directly", {
  skip_needs <- !requireNamespace("pROC", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: pROC not installed)\n")
    return(invisible())
  }

  set.seed(42)
  n <- 80
  state <- sample(c("no", "yes"), n, replace = TRUE, prob = c(0.6, 0.4))
  x1 <- rnorm(n) + ifelse(state == "yes", 1.0, 0)
  x2 <- rnorm(n) + ifelse(state == "yes", 0.4, 0)
  df <- data.frame(col_state = state, col_1 = x1, col_2 = x2)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "test1", col_2 = "test2"),
    stateVar = "col_state", stateName = "state", stateValue = "yes",
    options = list(direction = "larger", ciLevel = 0.95, compareAuc = TRUE)
  ))
  result <- run_analysis_script("roc-analysis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  resp <- ifelse(state == "yes", "case", "control")
  r1 <- pROC::roc(response = resp, predictor = x1, levels = c("control", "case"),
                   direction = "<", quiet = TRUE)
  r2 <- pROC::roc(response = resp, predictor = x2, levels = c("control", "case"),
                   direction = "<", quiet = TRUE)
  rt <- pROC::roc.test(r1, r2, method = "delong", paired = TRUE, conf.level = 0.95)

  cmp <- find_table(result, "output.rocAnalysis.compareTitle")
  expect_equal(length(cmp$rows), 1L, label = "one comparison row for 2 test variables")
  expect_equal(cmp$rows[[1]][[1]], "test1", label = "variable1 column")
  expect_equal(cmp$rows[[1]][[2]], "test2", label = "variable2 column")
  ref_diff <- unname(rt$estimate[1] - rt$estimate[2])
  expect_equal(cell_num(cmp, 1, 3), ref_diff, tolerance = 1e-4, label = "AUC difference")
  expect_equal(cell_num(cmp, 1, 4), unname(rt$statistic), tolerance = 1e-4, label = "z statistic")
  expect_equal(cell_num(cmp, 1, 5), rt$p.value, tolerance = 1e-4, label = "sig")
  expect_equal(cell_num(cmp, 1, 6), rt$conf.int[1], tolerance = 1e-3, label = "CI lower")
  expect_equal(cell_num(cmp, 1, 7), rt$conf.int[2], tolerance = 1e-3, label = "CI upper")

  # AUC table's own AUCs (independent formula) should match pROC's too — both
  # describe the same classifiers.
  auc_tbl <- find_table(result, "output.rocAnalysis.aucTitle")
  # pROC::auc() returns an S3 "auc" object; all.equal() treats its extra
  # attributes (embedded roc object etc.) as a mismatch even when the plain
  # numeric values agree — as.numeric() strips the class for a clean compare.
  expect_equal(cell_num(auc_tbl, 1, 2), as.numeric(pROC::auc(r1)), tolerance = 1e-3, "AUC1 matches pROC")
  expect_equal(cell_num(auc_tbl, 2, 2), as.numeric(pROC::auc(r2)), tolerance = 1e-3, "AUC2 matches pROC")
})

test_that("ROC Analysis: no comparison table when compareAuc is not requested", {
  set.seed(43)
  n <- 40
  state <- sample(c("no", "yes"), n, replace = TRUE)
  x1 <- rnorm(n); x2 <- rnorm(n)
  df <- data.frame(col_state = state, col_1 = x1, col_2 = x2)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "test1", col_2 = "test2"),
    stateVar = "col_state", stateName = "state", stateValue = "yes",
    options = list(direction = "larger", ciLevel = 0.95)
  ))
  result <- run_analysis_script("roc-analysis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_cmp <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.rocAnalysis.compareTitle"), logical(1)))
  expect_true(!has_cmp, "no comparison table when compareAuc is FALSE")
})

test_that("ROC Analysis: DeLong comparison is honestly skipped (with a note) when weighted", {
  skip_needs <- !requireNamespace("pROC", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: pROC not installed)\n")
    return(invisible())
  }
  set.seed(44)
  n <- 40
  state <- sample(c("no", "yes"), n, replace = TRUE)
  x1 <- rnorm(n); x2 <- rnorm(n)
  w <- sample(1:3, n, replace = TRUE)
  df <- data.frame(col_state = state, col_1 = x1, col_2 = x2, col_w = w)

  fixture <- write_fixture(df, list(
    variables = list("col_1", "col_2"),
    varNames = list(col_1 = "test1", col_2 = "test2"),
    stateVar = "col_state", stateName = "state", stateValue = "yes",
    weightVariable = "col_w",
    options = list(direction = "larger", ciLevel = 0.95, compareAuc = TRUE)
  ))
  result <- run_analysis_script("roc-analysis.R", fixture)
  expect_true(isTRUE(result$success), "result$success")
  has_cmp <- any(vapply(result$tables, function(t)
    startsWith(t$titleKey, "output.rocAnalysis.compareTitle"), logical(1)))
  expect_true(!has_cmp, "no comparison table when weighted (pROC has no weight support)")
  expect_true("output.rocAnalysis.compareAucNoWeight" %in% unlist(result$notes),
              "honest note explaining why comparison was skipped")
})
