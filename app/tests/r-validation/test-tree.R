# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-tree.R — validates r-scripts/tree.R's Classification Tree (CRT) output
# against rpart called directly on the same data (validates wiring/rounding,
# not rpart's own math). Node structure cross-checked against rpart's own
# path.rpart() (not hand-parsed split text).

test_that("tree.R matches rpart::rpart()/path.rpart() directly (iris, default options)", {
  skip_needs <- !requireNamespace("rpart", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: rpart not installed)\n")
    return(invisible())
  }
  df <- data.frame(
    col_1 = iris$Sepal.Length, col_2 = iris$Sepal.Width,
    col_3 = iris$Petal.Length, col_4 = iris$Petal.Width,
    col_5 = as.character(iris$Species)
  )
  fixture <- write_fixture(df, list(
    groupVar = "col_5", groupName = "Species",
    independents = list("col_1", "col_2", "col_3", "col_4"),
    varNames = list(col_1 = "SepalLength", col_2 = "SepalWidth",
                     col_3 = "PetalLength", col_4 = "PetalWidth"),
    options = list(minCases = 20, maxDepth = 5)
  ))
  result <- run_analysis_script("tree.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  # Predictor columns use the real display names (SepalLength, ...), matching
  # tree.R's own choice — so path.rpart()'s split-rule text is directly
  # comparable (not an opaque internal x1/x2/... name).
  dat <- data.frame(.g = iris$Species, SepalLength = iris$Sepal.Length, SepalWidth = iris$Sepal.Width,
                     PetalLength = iris$Petal.Length, PetalWidth = iris$Petal.Width)
  ref_fit <- rpart::rpart(.g ~ ., data = dat, method = "class",
                           control = rpart::rpart.control(minsplit = 20, maxdepth = 5, cp = 0.01))
  ref_frame <- ref_fit$frame
  ref_node_ids <- as.integer(row.names(ref_frame))
  ref_ylevels <- attr(ref_fit, "ylevels")
  ref_pred_class <- ref_ylevels[ref_frame$yval]
  ref_paths <- rpart::path.rpart(ref_fit, nodes = ref_node_ids, print.it = FALSE)

  ref_pred <- predict(ref_fit, type = "class")
  ref_tab <- table(actual = iris$Species, predicted = ref_pred)
  ref_acc <- sum(diag(ref_tab)) / sum(ref_tab)
  ref_risk <- 1 - ref_acc
  ref_risk_se <- sqrt(ref_risk * (1 - ref_risk) / nrow(iris))

  # Model Summary: N, node count, terminal count.
  summary_table <- find_table(result, "output.tree.modelSummaryTitle")
  expect_equal(cell_num(summary_table, 1, 2), nrow(iris), tolerance = 1e-9, "N")
  expect_equal(cell_num(summary_table, 2, 2), nrow(ref_frame), tolerance = 1e-9, "node count")
  expect_equal(cell_num(summary_table, 3, 2), sum(ref_frame$var == "<leaf>"), tolerance = 1e-9,
               "terminal node count")

  # Risk.
  risk_table <- find_table(result, "output.tree.riskTitle")
  expect_equal(cell_num(risk_table, 1, 2), round(ref_risk, 3), tolerance = 1e-6, "risk estimate")
  expect_equal(cell_num(risk_table, 2, 2), round(ref_risk_se, 3), tolerance = 1e-6, "risk SE")

  # Classification confusion matrix (same shape as knn.R's).
  class_table <- find_table(result, "output.knn.classTitle")
  lvls <- levels(iris$Species)
  for (i in seq_along(lvls)) {
    for (j in seq_along(lvls)) {
      expect_equal(cell_num(class_table, i, j + 1), as.integer(ref_tab[lvls[i], lvls[j]]),
                   tolerance = 1e-9, sprintf("confusion[%s,%s]", lvls[i], lvls[j]))
    }
  }
  overall_row_idx <- length(lvls) + 1
  expect_equal(cell_num(class_table, overall_row_idx, length(lvls) + 2), round(ref_acc * 100, 1),
               tolerance = 1e-6, "overall percent correct")

  # Tree Structure: node id / parent / N match rpart's own frame exactly.
  struct_table <- find_table(result, "output.tree.structureTitle")
  expect_equal(length(struct_table$rows), nrow(ref_frame), label = "one row per rpart frame node")
  for (i in seq_along(ref_node_ids)) {
    nid <- ref_node_ids[i]
    expected_parent <- if (nid == 1L) NA_real_ else nid %/% 2L
    row <- struct_table$rows[[i]]
    expect_equal(row[[1]], nid, tolerance = 1e-9, sprintf("node %d id", nid))
    if (is.na(expected_parent)) {
      expect_true(is.null(row[[2]]), sprintf("node %d has no parent (root)", nid))
    } else {
      expect_equal(row[[2]], expected_parent, tolerance = 1e-9, sprintf("node %d parent", nid))
    }
    expect_equal(row[[4]], as.integer(ref_frame$n[i]), tolerance = 1e-9, sprintf("node %d N", nid))
    expect_equal(row[[5]], ref_pred_class[i], sprintf("node %d predicted class", nid))
    ref_rule <- ref_paths[[as.character(nid)]]
    ref_rule_text <- if (length(ref_rule) > 1) ref_rule[length(ref_rule)] else "output.tree.root"
    expect_equal(row[[3]], ref_rule_text, sprintf("node %d split rule text", nid))
  }
})

test_that("tree.R rejects fewer than 2 target categories", {
  df <- data.frame(col_1 = c(1, 2, 3, 4), col_2 = c("A", "A", "A", "A"))
  fixture <- write_fixture(df, list(
    groupVar = "col_2", groupName = "grp",
    independents = list("col_1"), varNames = list(col_1 = "x")
  ))
  result <- run_analysis_script("tree.R", fixture)
  expect_true(!isTRUE(result$success), "should fail: only 1 category")
})
