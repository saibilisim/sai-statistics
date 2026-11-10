# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-roc-youden-2026-11.R — the "Optimal Cut-off Point (Youden Index)" table
# and its bootstrap intervals, shared by roc.R and roc-analysis.R. References
# are hand-computed or come from pROC, never from the scripts' own helpers.

youden_params <- function(options = list(), extra = list()) {
  c(list(variables = list("col_1"), varNames = list(col_1 = "score"),
         stateVar = "col_2", stateName = "state", stateValue = "1",
         options = options), extra)
}

test_that("youden: hand-computed tie, PPV/NPV/accuracy and likelihood ratios", {
  # Positives {4, 2}, negatives {3, 1}. Cutoffs 5, 3.5, 2.5, 1.5, 0:
  #   >= 3.5: Se .5, Sp 1  -> J .5   (TP1 FP0 FN1 TN2)
  #   >= 2.5: Se .5, Sp .5 -> J 0
  #   >= 1.5: Se 1,  Sp .5 -> J .5   (TP2 FP1 FN0 TN1)
  # Two cutoffs tie for the maximum, both must be listed.
  df <- data.frame(col_1 = c(4, 2, 3, 1), col_2 = c(1, 1, 0, 0))
  for (script in c("roc.R", "roc-analysis.R")) {
    res <- run_analysis_script(script, write_fixture(df, youden_params(list(youden = TRUE))))
    expect_true(isTRUE(res$success), paste(script, "success"))
    t <- find_table(res, "output.roc.youdenTitle")
    expect_equal(length(t$rows), 2, label = paste(script, "both tied cutoffs listed"))
    # Row 1: cutoff 1.5 (ascending order)
    expect_equal(cell_num(t, 1, 2), 1.5, label = paste(script, "cutoff 1"))
    expect_equal(cell_num(t, 1, 3), 0.5, label = "J")
    expect_equal(cell_num(t, 1, 4), 1, label = "Se")
    expect_equal(cell_num(t, 1, 5), 0.5, label = "Sp")
    expect_equal(cell_num(t, 1, 6), 0.667, label = "PPV 2/3")
    expect_equal(cell_num(t, 1, 7), 1, label = "NPV 1/1")
    expect_equal(cell_num(t, 1, 8), 0.75, label = "accuracy 3/4")
    expect_equal(cell_num(t, 1, 9), 2, label = "LR+ 1/.5")
    expect_equal(cell_num(t, 1, 10), 0, label = "LR- 0/.5")
    # Row 2: cutoff 3.5, specificity 1 -> LR+ undefined (blank)
    expect_equal(cell_num(t, 2, 2), 3.5, label = "cutoff 2")
    expect_true(is.na(cell_num(t, 2, 9)), "LR+ blank where specificity is 1")
    expect_equal(cell_num(t, 2, 10), 0.5, label = "LR- .5/1")
    expect_equal(cell_num(t, 2, 7), 0.667, label = "NPV 2/3")
    expect_true(any(startsWith(unlist(res$notes), "output.roc.youdenTiesNote:")),
                paste(script, "tie note"))
  }
})

test_that("youden: optimal cutoffs, sensitivity and specificity match pROC (both directions)", {
  if (!requireNamespace("pROC", quietly = TRUE)) {
    cat("  (skipped: pROC not installed)
")
    return(invisible())
  }
  # This fixture has two cutoffs whose J is exactly equal (0.23 and 0.85:
  # 47/54 + 55/96 - 1 = 38/54 + 71/96 - 1). pROC::coords(best) returns only
  # 0.85 — the two sums differ in the last floating-point bit — so the
  # reference is every pROC threshold within 1e-9 of the maximum J.
  set.seed(1111)
  n <- 150
  state <- rbinom(n, 1, 0.35)
  x <- round(rnorm(n) + 1.1 * state, 2)
  df <- data.frame(col_1 = x, col_2 = state)

  for (dir in c("larger", "smaller")) {
    xx <- if (dir == "larger") x else -x
    df$col_1 <- xx
    rr <- pROC::roc(response = state, predictor = xx, levels = c(0, 1),
                    direction = if (dir == "larger") "<" else ">", quiet = TRUE)
    co <- pROC::coords(rr, "all", ret = c("threshold", "sensitivity", "specificity", "youden"))
    ref <- co[co$youden >= max(co$youden) - 1e-9, ]
    ref <- ref[order(ref$threshold), ]
    expect_equal(nrow(ref), 2, label = "fixture has the documented tie")
    for (script in c("roc.R", "roc-analysis.R")) {
      res <- run_analysis_script(script, write_fixture(df, youden_params(
        list(youden = TRUE, direction = dir))))
      expect_true(isTRUE(res$success), paste(script, dir, "success"))
      t <- find_table(res, "output.roc.youdenTitle")
      expect_equal(length(t$rows), nrow(ref), label = paste(script, dir, "rows"))
      for (i in seq_len(nrow(ref))) {
        lbl <- paste(script, dir, "row", i)
        expect_equal(cell_num(t, i, 2), ref$threshold[i], tolerance = 1e-4, label = paste(lbl, "cutoff"))
        expect_equal(cell_num(t, i, 4), round(ref$sensitivity[i], 3), tolerance = 1e-3,
                     label = paste(lbl, "sensitivity"))
        expect_equal(cell_num(t, i, 5), round(ref$specificity[i], 3), tolerance = 1e-3,
                     label = paste(lbl, "specificity"))
        expect_equal(cell_num(t, i, 3), round(ref$youden[i] - 1, 3), tolerance = 1e-3,
                     label = paste(lbl, "J"))
      }
      # The optimal point (lowest tied cutoff) is marked on the ROC curve.
      tr <- res$plots[[1]]$data$data
      mk <- Filter(function(z) identical(z$mode, "markers+text"), tr)
      expect_equal(length(mk), 1, label = paste(script, dir, "one marker"))
      expect_equal(as.numeric(mk[[1]]$y[[1]]), ref$sensitivity[1], tolerance = 1e-9,
                   label = paste(script, dir, "marker at optimal sensitivity"))
    }
  }
})

test_that("youden: off by default (SPSS's ROC output unchanged)", {
  df <- data.frame(col_1 = c(4, 2, 3, 1, 5, 0), col_2 = c(1, 1, 0, 0, 1, 0))
  for (script in c("roc.R", "roc-analysis.R")) {
    res <- run_analysis_script(script, write_fixture(df, youden_params(list())))
    has <- any(vapply(res$tables, function(t) startsWith(t$titleKey, "output.roc.youden"),
                      logical(1)))
    expect_true(!has, paste(script, "no Youden table unless asked"))
  }
})

test_that("youden: bootstrap CI matches pROC::ci.coords and brackets the estimate", {
  if (!requireNamespace("pROC", quietly = TRUE)) {
    cat("  (skipped: pROC not installed)\n")
    return(invisible())
  }
  set.seed(2222)
  n <- 120
  state <- rbinom(n, 1, 0.4)
  x <- round(rnorm(n) + 1.2 * state, 2)
  # TESTPOS(SMALL): the CI of the cutoff must come back on the user's scale.
  df <- data.frame(col_1 = -x, col_2 = state)
  rr <- pROC::roc(response = state, predictor = x, levels = c(0, 1), direction = "<",
                  quiet = TRUE)
  set.seed(20261111L)
  ref <- pROC::ci.coords(rr, x = "best", best.method = "youden", best.policy = "random",
                         ret = c("youden", "threshold", "sensitivity", "specificity"),
                         conf.level = 0.9, boot.n = 2000, boot.stratified = TRUE)
  lim <- function(nm, k) unname(as.numeric(ref[[nm]][1, k]))
  res <- run_analysis_script("roc.R", write_fixture(df, youden_params(
    list(youden = TRUE, youdenCi = TRUE, direction = "smaller", ciLevel = 0.9))))
  expect_true(isTRUE(res$success), "success")
  ci <- find_table(res, "output.roc.youdenCiTitle")
  expect_true(identical(ci$columns[[3]], "output.col.ciLowerPct:90"), "CI level in heading")
  expect_equal(cell_num(ci, 1, 3), round(lim("youden", 1) - 1, 3), tolerance = 1e-3, label = "J lower")
  expect_equal(cell_num(ci, 1, 4), round(lim("youden", 3) - 1, 3), tolerance = 1e-3, label = "J upper")
  # Cutoff interval: sign flipped back and reordered, lower < upper.
  expect_equal(cell_num(ci, 2, 3), round(-lim("threshold", 3), 3), tolerance = 1e-3, label = "cutoff lower")
  expect_equal(cell_num(ci, 2, 4), round(-lim("threshold", 1), 3), tolerance = 1e-3, label = "cutoff upper")
  expect_equal(cell_num(ci, 3, 3), round(lim("sensitivity", 1), 3), tolerance = 1e-3, label = "Se lower")
  expect_equal(cell_num(ci, 4, 4), round(lim("specificity", 3), 3), tolerance = 1e-3, label = "Sp upper")
  j <- cell_num(find_table(res, "output.roc.youdenTitle"), 1, 3)
  expect_true(cell_num(ci, 1, 3) <= j && j <= cell_num(ci, 1, 4), "J inside its interval")
})

test_that("youden: bootstrap CI skipped with a warning under case weights", {
  set.seed(3333)
  n <- 40
  df <- data.frame(col_1 = rnorm(n), col_2 = rbinom(n, 1, 0.5), col_w = sample(1:3, n, TRUE))
  res <- run_analysis_script("roc.R", write_fixture(df, youden_params(
    list(youden = TRUE, youdenCi = TRUE), list(weightVariable = "col_w"))))
  expect_true(isTRUE(res$success), "success")
  expect_true("output.roc.youdenCiNoWeight" %in% unlist(res$warnings), "weight warning")
  has_ci <- any(vapply(res$tables, function(t) startsWith(t$titleKey, "output.roc.youdenCiTitle"),
                       logical(1)))
  expect_true(!has_ci, "no CI table under weights")
  # The point estimate itself is weight-aware and still shown.
  find_table(res, "output.roc.youdenTitle")
})
