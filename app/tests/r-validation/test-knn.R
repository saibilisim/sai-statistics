# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-knn.R — validates r-scripts/knn.R's Nearest Neighbor classification
# against class::knn.cv() called directly on the same min-max-normalized data
# (validates wiring/rounding, not class's own math).

test_that("knn.R classification matches class::knn.cv() directly (iris, k=5)", {
  skip_needs <- !requireNamespace("class", quietly = TRUE)
  if (skip_needs) {
    cat("  (skipped: class not installed)\n")
    return(invisible())
  }
  set.seed(1)
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
    options = list(k = 5)
  ))
  result <- run_analysis_script("knn.R", fixture)
  expect_true(isTRUE(result$success), "result$success")

  X <- apply(iris[, 1:4], 2, function(x) (x - min(x)) / diff(range(x)))
  g <- iris$Species
  set.seed(1)
  ref_pred <- class::knn.cv(X, g, k = 5)
  ref_tab <- table(actual = g, predicted = ref_pred)
  ref_overall <- round(sum(diag(ref_tab)) / sum(ref_tab) * 100, 1)

  class_table <- find_table(result, "output.knn.classTitle")
  lvls <- levels(g)
  # Row order matches levels(g): setosa, versicolor, virginica.
  for (i in seq_along(lvls)) {
    row_total <- sum(ref_tab[lvls[i], ])
    ref_pct <- if (row_total > 0) round(ref_tab[lvls[i], lvls[i]] / row_total * 100, 1) else 0
    expect_equal(cell_num(class_table, i, ncol(ref_tab) + 2), ref_pct, tolerance = 1e-6,
                 sprintf("percent correct for %s", lvls[i]))
    for (j in seq_along(lvls)) {
      expect_equal(cell_num(class_table, i, j + 1), as.integer(ref_tab[lvls[i], lvls[j]]),
                   tolerance = 1e-9, sprintf("confusion[%s,%s]", lvls[i], lvls[j]))
    }
  }
  overall_row_idx <- length(lvls) + 1
  expect_equal(cell_num(class_table, overall_row_idx, ncol(ref_tab) + 2), ref_overall,
               tolerance = 1e-6, "overall percent correct")

  summary_table <- find_table(result, "output.knn.modelSummaryTitle")
  expect_equal(cell_num(summary_table, 1, 2), nrow(iris), tolerance = 1e-9, "N")
  expect_equal(cell_num(summary_table, 2, 2), 5, tolerance = 1e-9, "k")
})

test_that("knn.R rejects k >= number of complete cases", {
  df <- data.frame(col_1 = c(1, 2, 3, 4), col_2 = c("A", "A", "B", "B"))
  fixture <- write_fixture(df, list(
    groupVar = "col_2", groupName = "grp",
    independents = list("col_1"), varNames = list(col_1 = "x"),
    options = list(k = 10)
  ))
  result <- run_analysis_script("knn.R", fixture)
  expect_true(!isTRUE(result$success), "should fail: k too large for n")
})
