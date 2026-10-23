# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-proportions-methods-2026-10.R — the Confidence Intervals and Tests
# sub-dialogs of proportions.R (SPSS 27+ PROPORTIONS methods).
#
# References: DescTools::BinomCI / BinomDiffCI (independent implementations
# of the same published intervals), base R prop.test / mcnemar.test /
# binom.test for the tests — never proportions.R's own helpers.

pr_row <- function(tbl, key) {
  for (r in tbl$rows) if (identical(r[[1]], key)) return(r)
  stop("row not found: ", key)
}

test_that("proportions one-sample: CI methods match DescTools::BinomCI", {
  if (!requireNamespace("DescTools", quietly = TRUE)) { cat("  (skipped: DescTools)\n"); return(invisible()) }
  x <- c(rep(1, 17), rep(0, 43))
  res <- run_analysis_script("proportions.R", write_fixture(data.frame(col_v = x), list(
    design = "one", variable = "col_v", varName = "v", successValue = "1", testValue = 0.3, ciLevel = 95,
    ciMethods = list("agrestiCoull", "clopperPearson", "jeffreys", "logit", "wald", "waldCC",
                     "wilson", "wilsonCC", "anscombe"),
    testMethods = list("exact", "midP", "score", "scoreCC", "wald", "waldCC"))))
  expect_true(isTRUE(res$success), "success")
  ci <- find_table(res, "output.proportions.ciTitle")
  map <- list(agrestiCoull = "agresti-coull", clopperPearson = "clopper-pearson", jeffreys = "jeffreys",
              logit = "logit", wald = "wald", waldCC = "waldcc", wilson = "wilson", wilsonCC = "wilsoncc")
  for (k in names(map)) {
    ref <- DescTools::BinomCI(17, 60, conf.level = 0.95, method = map[[k]])
    r <- pr_row(ci, paste0("output.proportions.ci.", k))
    expect_equal(as.numeric(r[[2]]), round(unname(ref[1, "lwr.ci"]), 6), tolerance = 1e-5, paste(k, "lower"))
    expect_equal(as.numeric(r[[3]]), round(unname(ref[1, "upr.ci"]), 6), tolerance = 1e-5, paste(k, "upper"))
  }
  # Anscombe: no package ships it; the manual's formula written out here.
  z <- qnorm(.975); r <- 17; n <- 60
  cen <- log((r + .5) / (n - r + .5)); hw <- z * sqrt((n + 1) * (n + 2) / (n * (r + 1) * (n - r + 1)))
  ar <- pr_row(ci, "output.proportions.ci.anscombe")
  expect_equal(as.numeric(ar[[2]]), round(1 / (1 + exp(-(cen - hw))), 6), tolerance = 1e-6, "Anscombe lower")

  tt <- find_table(res, "output.proportions.testsTitle")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.score")[[3]]),
               round(prop.test(17, 60, p = 0.3, correct = FALSE)$p.value, 6), tolerance = 1e-6, "score")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.scoreCC")[[3]]),
               round(prop.test(17, 60, p = 0.3, correct = TRUE)$p.value, 6), tolerance = 1e-6, "score CC")
  p1 <- min(pbinom(17, 60, .3), 1 - pbinom(16, 60, .3))
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.exact")[[3]]), round(2 * p1, 6),
               tolerance = 1e-6, "exact = 2 x smaller tail (SPSS)")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.midP")[[3]]),
               round(2 * (p1 - .5 * dbinom(17, 60, .3)), 6), tolerance = 1e-6, "mid-p")
})

test_that("proportions independent: CI methods match DescTools::BinomDiffCI", {
  if (!requireNamespace("DescTools", quietly = TRUE)) { cat("  (skipped: DescTools)\n"); return(invisible()) }
  d <- data.frame(col_v = c(rep(1, 22), rep(0, 18), rep(1, 12), rep(0, 33)),
                  col_g = c(rep("A", 40), rep("B", 45)))
  res <- run_analysis_script("proportions.R", write_fixture(d, list(
    design = "independent", variable = "col_v", varName = "v", groupVar = "col_g", groupVarName = "g",
    successValue = "1", ciLevel = 95,
    ciMethods = list("agrestiCaffo", "brownLi", "hauckAnderson", "newcombe", "newcombeCC", "wald", "waldCC"),
    testMethods = list("wald", "waldH0", "waldH0CC"))))
  expect_true(isTRUE(res$success), "success")
  ci <- find_table(res, "output.proportions.ciTitle")
  map <- list(agrestiCaffo = "ac", brownLi = "blj", hauckAnderson = "ha", newcombe = "score",
              newcombeCC = "scorecc", wald = "wald", waldCC = "waldcc")
  for (k in names(map)) {
    ref <- DescTools::BinomDiffCI(22, 40, 12, 45, conf.level = 0.95, method = map[[k]])
    r <- pr_row(ci, paste0("output.proportions.ci.", k))
    expect_equal(as.numeric(r[[2]]), round(unname(ref[1, "lwr.ci"]), 6), tolerance = 1e-5, paste(k, "lower"))
    expect_equal(as.numeric(r[[3]]), round(unname(ref[1, "upr.ci"]), 6), tolerance = 1e-5, paste(k, "upper"))
  }
  tt <- find_table(res, "output.proportions.testsTitle")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.waldH0")[[3]]),
               round(prop.test(c(22, 12), c(40, 45), correct = FALSE)$p.value, 6), tolerance = 1e-6,
               "pooled Wald = uncorrected chi-square")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.waldH0CC")[[3]]),
               round(prop.test(c(22, 12), c(40, 45), correct = TRUE)$p.value, 6), tolerance = 1e-6,
               "pooled Wald CC = Yates")
})

test_that("proportions paired: McNemar tests and intervals", {
  # n11 = 20, n10 = 14, n01 = 5, n00 = 21
  d <- data.frame(col_a = c(rep(1, 20), rep(1, 14), rep(0, 5), rep(0, 21)),
                  col_b = c(rep(1, 20), rep(0, 14), rep(1, 5), rep(0, 21)))
  res <- run_analysis_script("proportions.R", write_fixture(d, list(
    design = "paired", variable1 = "col_a", varName1 = "a", variable2 = "col_b", varName2 = "b",
    successValue = "1", ciLevel = 95,
    ciMethods = list("agrestiMin", "bonettPrice", "newcombe", "wald", "waldCC"),
    testMethods = list("exact", "midP", "mcnemar", "mcnemarCC", "wald", "waldCC"))))
  expect_true(isTRUE(res$success), "success")
  tt <- find_table(res, "output.proportions.testsTitle")
  tab <- matrix(c(20, 5, 14, 21), 2)
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.mcnemar")[[3]]),
               round(mcnemar.test(tab, correct = FALSE)$p.value, 6), tolerance = 1e-6, "McNemar")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.mcnemarCC")[[3]]),
               round(mcnemar.test(tab, correct = TRUE)$p.value, 6), tolerance = 1e-6, "McNemar CC")
  expect_equal(as.numeric(pr_row(tt, "output.proportions.test.exact")[[3]]),
               round(binom.test(5, 19)$p.value, 6), tolerance = 1e-6, "exact McNemar")
  ci <- find_table(res, "output.proportions.ciTitle")
  z <- qnorm(.975); n <- 60
  wald_ref <- (14 - 5) / n + c(-1, 1) * z * sqrt((14 / n + 5 / n - ((14 - 5) / n)^2) / n)
  w <- pr_row(ci, "output.proportions.ci.wald")
  expect_equal(as.numeric(w[[2]]), round(wald_ref[1], 6), tolerance = 1e-6, "paired Wald lower")
  am <- (14 - 5) / (n + 2) - z * sqrt(((14.5) / (n + 2) + (5.5) / (n + 2) - ((14 - 5) / (n + 2))^2) / (n + 2))
  expect_equal(as.numeric(pr_row(ci, "output.proportions.ci.agrestiMin")[[2]]), round(am, 6),
               tolerance = 1e-6, "Agresti-Min lower")
})
