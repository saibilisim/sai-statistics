# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-r-table-footnote-2026-11.R — the "r table" (critical r) footnotes on
# Pearson correlations (correlation.R) and on Item-Total Statistics
# (reliability.R). Reference values are the published table of critical
# values of Pearson's r at α = .05: two-tailed df = 28 → .361, df = 18 → .444;
# one-tailed df = 28 → .306. Also checked: the critical r is exactly where
# cor.test's p crosses .05.

# Every footnote of a table, in display order (footnoteKey, then footnoteKeys).
.footnotes <- function(table) as.character(c(table$footnoteKey, unlist(table$footnoteKeys)))

# The parameters of the table's footnote whose key starts with `prefix`.
.footnote_params <- function(table, prefix) {
  fk <- Filter(function(k) startsWith(k, prefix), .footnotes(table))
  if (length(fk) != 1) stop(sprintf("expected one '%s' footnote, got %d", prefix, length(fk)), call. = FALSE)
  strsplit(sub("^[^:]+:", "", fk[[1]]), "|", fixed = TRUE)[[1]]
}

test_that("r_critical matches the published r table and cor.test's .05 boundary", {
  source(file.path(getOption("sai.rScriptsDir"), "_bootstrap.R"), local = TRUE)
  expect_true(identical(r_critical(30), "0.361"), "N = 30 two-tailed")
  expect_true(identical(r_critical(20), "0.444"), "N = 20 two-tailed")
  expect_true(identical(r_critical(30, two_tailed = FALSE), "0.306"), "N = 30 one-tailed")
  # At r = critical r, the t-test's two-tailed p is .05 (to the 3dp rounding).
  r <- as.numeric(r_critical(50)); df <- 48
  p <- 2 * pt(-abs(r * sqrt(df) / sqrt(1 - r^2)), df)
  expect_equal(p, 0.05, tolerance = 0.01, "p at critical r")
})

test_that("Pearson table carries the r-table footnote (single N, range under pairwise, none for Spearman)", {
  set.seed(11)
  df <- data.frame(col_1 = rnorm(30), col_2 = rnorm(30), col_3 = rnorm(30))
  base <- list(variables = list("col_1", "col_2", "col_3"),
               varNames = list(col_1 = "a", col_2 = "b", col_3 = "c"),
               methods = list(pearson = TRUE, spearman = TRUE))
  res <- run_analysis_script("correlation.R", write_fixture(df, base))
  pear <- find_table(res, "output.correlate.title:Pearson")
  p <- .footnote_params(pear, "output.correlate.rTableFootnote:")
  expect_true(identical(p, c("0.361", "30", "28", "output.correlate.tailTwo")), "params N = 30")
  spear <- find_table(res, "output.correlate.title:Spearman")
  expect_true(!any(startsWith(.footnotes(spear), "output.correlate.rTable")), "no r table for Spearman")

  one <- run_analysis_script("correlation.R", write_fixture(df, c(base, list(options = list(oneTailed = TRUE)))))
  p1 <- .footnote_params(find_table(one, "output.correlate.title:Pearson"), "output.correlate.rTableFootnote:")
  expect_true(identical(p1, c("0.306", "30", "28", "output.correlate.tailOne")), "one-tailed params")

  df$col_3[1:10] <- NA # pairs with col_3 have N = 20, a-b keeps N = 30
  rng <- run_analysis_script("correlation.R", write_fixture(df, base))
  pr <- find_table(rng, "output.correlate.title:Pearson")
  expect_true(identical(.footnote_params(pr, "output.correlate.rTableFootnoteRange:"), c("0.361", "30", "0.444", "20", "output.correlate.tailTwo")),
              "range params N 30..20")
})

test_that("Item-Total Statistics carries the r-table footnote for N complete cases", {
  set.seed(5)
  f <- rnorm(30)
  df <- as.data.frame(sapply(1:4, function(i) round(3 + f + rnorm(30, sd = .8))))
  names(df) <- paste0("col_", 1:4)
  res <- run_analysis_script("reliability.R", write_fixture(df, list(
    variables = as.list(names(df)), varNames = as.list(setNames(names(df), names(df))))))
  it <- find_table(res, "output.reliability.itemTotalTitle")
  expect_true(identical(.footnote_params(it, "output.reliability.rTableFootnote:"), c("0.361", "30", "28")), "params N = 30")
})

test_that("Significance-flag legend lists only the flag levels present, ** before *, then the r table", {
  # mtcars: mpg-wt r = -.868 (p < .01 → **); qsec-gear r = -.213 (n.s.);
  # drat-qsec r = .091 (n.s.); a 0.05-level pair: mpg-qsec r = .419, p = .017 (*).
  data(mtcars)
  df <- data.frame(col_1 = mtcars$mpg, col_2 = mtcars$wt, col_3 = mtcars$qsec)
  res <- run_analysis_script("correlation.R", write_fixture(df, list(
    variables = list("col_1", "col_2", "col_3"),
    varNames = list(col_1 = "mpg", col_2 = "wt", col_3 = "qsec"),
    methods = list(pearson = TRUE))))
  fn <- .footnotes(find_table(res, "output.correlate.title:Pearson"))
  expect_true(identical(fn[1], "output.correlate.sigFlag:**|0.01|output.correlate.tailTwo"), "** first")
  expect_true(identical(fn[2], "output.correlate.sigFlag:*|0.05|output.correlate.tailTwo"), "* second")
  expect_true(startsWith(fn[3], "output.correlate.rTableFootnote:"), "r table last")
  expect_equal(cor.test(mtcars$mpg, mtcars$qsec)$p.value, 0.0171, tolerance = 0.01, "mpg-qsec p in (.01, .05)")

  # Flagging off → no legend, r table stays.
  off <- run_analysis_script("correlation.R", write_fixture(df, list(
    variables = list("col_1", "col_2"), varNames = list(col_1 = "mpg", col_2 = "wt"),
    methods = list(pearson = TRUE), options = list(flagSignificant = FALSE))))
  fo <- .footnotes(find_table(off, "output.correlate.title:Pearson"))
  expect_true(!any(startsWith(fo, "output.correlate.sigFlag")), "no legend when flagging is off")
  expect_true(length(fo) == 1 && startsWith(fo, "output.correlate.rTableFootnote:"), "r table only")
})
