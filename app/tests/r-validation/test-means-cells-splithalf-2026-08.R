# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-means-cells-splithalf-2026-08.R — two feature gaps the SPSS parity work
# turned up, and the properties that keep them honest.
#
# 1. MEANS /CELLS: the Cells sub-dialog was parsed and thrown away, so every
#    MEANS run printed Mean / N / Std. Deviation whatever was asked for. The
#    tests below check that the requested cells appear, that they are the right
#    numbers, and — the part that matters and is easy to lose — that they are
#    WEIGHTED, since MEANS is one of the procedures Weight Cases feeds.
# 2. RELIABILITY /MODEL=SPLIT: the split-half model did not exist. Its
#    coefficients are pinned to the definitions computed here.

cells_fixture <- function() {
  data.frame(
    col_1 = c(4, 8, 15, 16, 23, 42, 7, 11, 19, 27, 3, 5),
    col_2 = rep(c("a", "b"), each = 6),
    col_3 = rep(c(1L, 3L), 6)   # weights: case replication by 1 and 3
  )
}

cells_params <- function(cells, weighted = FALSE) {
  p <- list(variables = list("col_1"), varNames = list(col_1 = "score"),
            factor = "col_2", factorName = "grp",
            options = list(cells = cells))
  if (weighted) p$weightVariable <- "col_3"
  p
}

test_that("means: the Cells sub-dialog's statistics reach the table", {
  df <- cells_fixture()
  result <- run_analysis_script("means.R", write_fixture(df, cells_params(
    list(mean = TRUE, n = TRUE, sd = TRUE, median = TRUE, min = TRUE, max = TRUE,
         range = TRUE, sum = TRUE, variance = TRUE))))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.means.reportTitle")

  cols <- unlist(t$columns)
  for (key in c("output.col.median", "output.col.min", "output.col.max",
                "output.col.range", "output.col.sum", "output.col.variance")) {
    expect_true(key %in% cols, sprintf("%s is a column", key))
  }

  # Group "a" is the first six values.
  a <- df$col_1[1:6]
  idx <- function(key) which(cols == key)
  expect_equal(cell_num(t, 1, idx("output.col.median")), median(a), tolerance = 1e-6,
               "group a median")
  expect_equal(cell_num(t, 1, idx("output.col.range")), diff(range(a)), tolerance = 1e-6,
               "group a range")
  expect_equal(cell_num(t, 1, idx("output.col.sum")), sum(a), tolerance = 1e-6,
               "group a sum")
  expect_equal(cell_num(t, 1, idx("output.col.variance")), var(a), tolerance = 1e-6,
               "group a variance")
})

test_that("means: an unticked cell is absent, not blank", {
  # The failure this guards against is the opposite of the original defect:
  # emitting every statistic and letting the renderer hide the unwanted ones.
  df <- cells_fixture()
  result <- run_analysis_script("means.R", write_fixture(df, cells_params(
    list(mean = TRUE, n = TRUE))))
  cols <- unlist(find_table(result, "output.means.reportTitle")$columns)
  expect_true("output.col.mean" %in% cols, "mean present")
  expect_true(!("output.col.variance" %in% cols), "variance not requested, so not a column")
  expect_true(!("output.col.stdDeviation" %in% cols), "sd not requested, so not a column")
})

test_that("means: the new cells are weighted, like mean and N already were", {
  # Integer weights are case replication, so every cell must equal the value
  # computed on the expanded frame. A cell implemented with plain median()/
  # var()/sum() would pass the unweighted test above and silently ignore the
  # weight here — which is the whole point of checking it.
  df <- cells_fixture()
  expanded <- df[rep(seq_len(nrow(df)), df$col_3), ]
  a <- expanded$col_1[expanded$col_2 == "a"]

  result <- run_analysis_script("means.R", write_fixture(df, cells_params(
    list(mean = TRUE, n = TRUE, median = TRUE, sum = TRUE, variance = TRUE), weighted = TRUE)))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.means.reportTitle")
  cols <- unlist(t$columns)
  idx <- function(key) which(cols == key)

  expect_equal(cell_num(t, 1, idx("output.col.mean")), mean(a), tolerance = 1e-6,
               "weighted mean = replicated-frame mean")
  expect_equal(cell_num(t, 1, idx("output.col.sum")), sum(a), tolerance = 1e-6,
               "weighted sum = replicated-frame sum")
  expect_equal(cell_num(t, 1, idx("output.col.variance")), var(a), tolerance = 1e-4,
               "weighted variance = replicated-frame variance")
  expect_equal(cell_num(t, 1, idx("output.col.median")), median(a), tolerance = 1e-6,
               "weighted median = replicated-frame median")
})

# ── Reliability: split-half ─────────────────────────────────────────────────

split_fixture <- function() {
  set.seed(20260809)
  n <- 150
  lat <- rnorm(n)
  item <- function(load) round(pmin(5, pmax(1, 3 + load * lat + rnorm(n, 0, 0.7))))
  data.frame(col_1 = item(1.0), col_2 = item(0.9), col_3 = item(0.8),
             col_4 = item(1.1), col_5 = item(0.7))
}

split_params <- list(
  variables = list("col_1", "col_2", "col_3", "col_4", "col_5"),
  varNames = list(col_1 = "q1", col_2 = "q2", col_3 = "q3", col_4 = "q4", col_5 = "q5"),
  options = list(model = "split")
)

test_that("reliability: split-half coefficients match their definitions", {
  df <- split_fixture()
  X <- as.matrix(df)
  n1 <- 3
  s1 <- rowSums(X[, 1:n1]); s2 <- rowSums(X[, (n1 + 1):5])
  cron <- function(m) {
    kk <- ncol(m)
    kk / (kk - 1) * (1 - sum(apply(m, 2, var)) / var(rowSums(m)))
  }
  r12 <- cor(s1, s2)
  L <- n1 / 5

  result <- run_analysis_script("reliability.R", write_fixture(df, split_params))
  expect_true(isTRUE(result$success), "result$success")
  t <- find_table(result, "output.reliability.splitTitle")
  at_row <- function(label) {
    for (r in t$rows) if (identical(as.character(r[[1]]), label)) return(as.numeric(r[[2]]))
    NA_real_
  }

  expect_equal(at_row("output.reliability.alphaPart1"), cron(X[, 1:n1]), tolerance = 1e-4,
               "part 1 alpha")
  expect_equal(at_row("output.reliability.alphaPart2"), cron(X[, (n1 + 1):5]), tolerance = 1e-4,
               "part 2 alpha")
  expect_equal(at_row("output.reliability.corrBetweenForms"), r12, tolerance = 1e-4,
               "correlation between forms")
  expect_equal(at_row("output.reliability.sbEqual"), 2 * r12 / (1 + r12), tolerance = 1e-4,
               "Spearman-Brown, equal length")
  expect_equal(at_row("output.reliability.sbUnequal"),
               r12 / (2 * L * (1 - L) + r12 * (1 - 2 * L * (1 - L))), tolerance = 1e-4,
               "Spearman-Brown, unequal length")
  expect_equal(at_row("output.reliability.guttman"),
               2 * (1 - (var(s1) + var(s2)) / var(s1 + s2)), tolerance = 1e-4,
               "Guttman split-half")
  expect_equal(at_row("output.reliability.nItemsPart1"), 3, tolerance = 1e-9, "part 1 item count")
  expect_equal(at_row("output.reliability.nItemsPart2"), 2, tolerance = 1e-9, "part 2 item count")

  # The two halves must be genuinely different, otherwise equal- and
  # unequal-length Spearman-Brown coincide and the pair of assertions above
  # stops distinguishing them.
  expect_true(abs(2 * r12 / (1 + r12) -
                  r12 / (2 * L * (1 - L) + r12 * (1 - 2 * L * (1 - L)))) > 1e-3,
              "the split is uneven enough to separate the two coefficients")
})

test_that("reliability: alpha stays the default model", {
  df <- split_fixture()
  p <- split_params
  p$options <- list()
  result <- run_analysis_script("reliability.R", write_fixture(df, p))
  titles <- vapply(result$tables, function(x) x$titleKey, character(1))
  expect_true(!any(startsWith(titles, "output.reliability.splitTitle")),
              "no split-half table unless the model asks for it")
  expect_true(any(startsWith(titles, "output.reliability.statsTitle")),
              "alpha table still produced")
})

test_that("reliability: too few items for a split says so", {
  # Three items cannot be split into two halves that each have an alpha, and
  # a requested model that produces nothing must not do it silently.
  df <- split_fixture()[, 1:3]
  p <- list(variables = list("col_1", "col_2", "col_3"),
            varNames = list(col_1 = "q1", col_2 = "q2", col_3 = "q3"),
            options = list(model = "split"))
  result <- run_analysis_script("reliability.R", write_fixture(df, p))
  expect_true(isTRUE(result$success), "result$success")
  expect_true("output.reliability.warnSplitItems" %in% unlist(result$warnings),
              "warns instead of dropping the model quietly")
})
