# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-crosstabs-colprop-z-2026-11.R — SPSS's "z-test: Compare column
# proportions" (CROSSTABS /CELLS=PROP | BPROP) in crosstabs.R. p values are
# checked against base R's prop.test(correct = FALSE) (its chi-square is z^2),
# not against the script's own formula; subset letters are hand-derived.
#
# Table (outcome x group):
#           A    B    C    D
#   No     20   35   22    0
#   Yes    30   15   28   10
#   Total  50   50   50   10
# Column D is all "Yes" (proportion 0 in No, 1 in Yes) — SPSS leaves such a
# column out of the comparisons. Within each row, A-B and B-C differ after
# Bonferroni (x3), A-C does not, so A and C share "a" and B is "b".

colprop_df <- function() {
  grp <- c(rep("A", 50), rep("B", 50), rep("C", 50), rep("D", 10))
  out <- c(rep("No", 20), rep("Yes", 30), rep("No", 35), rep("Yes", 15),
           rep("No", 22), rep("Yes", 28), rep("Yes", 10))
  data.frame(col_1 = out, col_2 = grp)
}

colprop_run <- function(cells) {
  run_analysis_script("crosstabs.R", write_fixture(colprop_df(), list(
    rows = list("col_1"), rowNames = list(col_1 = "outcome"),
    cols = list("col_2"), colNames = list(col_2 = "group"),
    options = list(cells = cells, stats = list(chisquare = FALSE)))))
}

test_that("column proportions z-test: z, p and Bonferroni p match prop.test", {
  res <- colprop_run(list(observed = TRUE, colPropZ = TRUE, bonferroni = TRUE))
  expect_true(isTRUE(res$success), "success")
  pt <- find_table(res, "output.crosstabs.colPropTitle")
  # Two rows (No, Yes) x three tested pairs (A-B, A-C, B-C); D is excluded.
  expect_equal(length(pt$rows), 6, label = "6 comparisons")
  n <- c(A = 50, B = 50, C = 50)
  no <- c(A = 20, B = 35, C = 22)
  pairs <- list(c("A", "B"), c("A", "C"), c("B", "C"))
  for (r in 1:2) {
    x <- if (r == 1) no else n - no
    for (q in 1:3) {
      j <- pairs[[q]][1]; k <- pairs[[q]][2]
      row <- (r - 1) * 3 + q
      ref <- suppressWarnings(prop.test(x[c(j, k)], n[c(j, k)], correct = FALSE))
      zref <- sign(x[[j]] / n[[j]] - x[[k]] / n[[k]]) * sqrt(unname(ref$statistic))
      lbl <- paste("row", r, j, "vs", k)
      expect_true(identical(pt$rows[[row]][[2]], j) && identical(pt$rows[[row]][[3]], k),
                  paste(lbl, "labels"))
      expect_equal(cell_num(pt, row, 4), round(x[[j]] / n[[j]] * 100, 1), label = paste(lbl, "% 1"))
      expect_equal(cell_num(pt, row, 6), round(zref, 3), tolerance = 1e-3, label = paste(lbl, "z"))
      expect_equal(cell_num(pt, row, 7), ref$p.value, tolerance = 1e-4, label = paste(lbl, "p"))
      expect_equal(cell_num(pt, row, 8), min(1, 3 * ref$p.value), tolerance = 1e-4,
                   label = paste(lbl, "Bonferroni p"))
    }
  }
  # Row label only on the first comparison of each row category.
  expect_true(identical(pt$rows[[1]][[1]], "No") && identical(pt$rows[[2]][[1]], ""),
              "row label on first line only")
})

test_that("column proportions z-test: subset letters and excluded column", {
  res <- colprop_run(list(observed = TRUE, colPropZ = TRUE, bonferroni = TRUE))
  ct <- find_table(res, "output.crosstabs.crosstabTitle")
  # Sub-rows: No/Count, No/Subset, Yes/Count, Yes/Subset, Total/Count, Total/Subset.
  # Columns: level, measure, A, B, C, D, Total.
  for (r in c(2, 4)) {
    expect_true(identical(ct$rows[[r]][[2]], "output.crosstabs.cellColPropSubset"),
                paste("subset row", r))
    got <- unlist(ct$rows[[r]][3:6])
    expect_true(identical(got, c("a", "b", "a", ".")),
                paste("letters row", r, ":", paste(got, collapse = " ")))
  }
  expect_true(startsWith(ct$footnoteKey, "output.crosstabs.colPropFootnoteBonf:"),
              "Bonferroni footnote")
})

test_that("column proportions z-test: without Bonferroni the raw p decides", {
  # A-C: .40 vs .44 never differs; with raw p, A-B and B-C still differ.
  res <- colprop_run(list(observed = TRUE, colPropZ = TRUE, bonferroni = FALSE))
  pt <- find_table(res, "output.crosstabs.colPropTitle")
  expect_equal(length(pt$columns), 7, label = "no Bonferroni column")
  ct <- find_table(res, "output.crosstabs.crosstabTitle")
  expect_true(startsWith(ct$footnoteKey, "output.crosstabs.colPropFootnote:"), "plain footnote")
})

test_that("compact letter display handles overlapping subsets", {
  # Four columns where only 1-4 differ: {1,2,3} and {2,3,4} -> a, ab, ab, b.
  src <- readLines(file.path(r_scripts_dir(), "crosstabs.R"), warn = FALSE)
  start <- grep("^compact_letters <- function", src)
  end <- start - 1 + grep("^}", src[start:length(src)])[1]
  env <- new.env()
  eval(parse(text = src[start:end]), envir = env)
  got <- env$compact_letters(4, list(c(1, 4)))
  expect_true(identical(got, c("a", "ab", "ab", "b")), paste(got, collapse = " "))
  got2 <- env$compact_letters(3, list(c(1, 2), c(1, 3), c(2, 3)))
  expect_true(identical(got2, c("a", "b", "c")), paste(got2, collapse = " "))
  got3 <- env$compact_letters(3, list())
  expect_true(identical(got3, c("a", "a", "a")), paste(got3, collapse = " "))
})

test_that("column proportions z-test is off by default", {
  res <- colprop_run(list(observed = TRUE))
  has <- any(vapply(res$tables, function(t) startsWith(t$titleKey, "output.crosstabs.colPropTitle"),
                    logical(1)))
  expect_true(!has, "no comparison table unless asked")
})
