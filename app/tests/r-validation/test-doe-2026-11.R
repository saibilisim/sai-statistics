# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-doe-2026-11.R — Design of Experiments › Analyze Design (doe-analysis.R).
# References: agricolae's own example data and functions called directly
# (sweetpotato with LSD.test / cv.model; plots with sp.plot), aov, and the
# published effect estimates of Montgomery's unreplicated 2^4 filtration-rate
# experiment (Design and Analysis of Experiments, Example 6.2).

doe_run <- function(d, p) run_analysis_script("doe-analysis.R", write_fixture(d, p))
rowv <- function(t, lbl, col) { for (r in t$rows) if (identical(r[[1]], lbl)) return(if (is.null(r[[col]])) NA else as.numeric(r[[col]])); NA }

test_that("doe: CRD matches aov, agricolae LSD groups and CV", {
  suppressMessages(library(agricolae)); data(sweetpotato)
  d <- data.frame(col_1 = sweetpotato$yield, col_2 = as.character(sweetpotato$virus))
  res <- doe_run(d, list(response = "col_1", design = "crd", treatment = "col_2",
                         varNames = list(col_1 = "yield", col_2 = "virus"), options = list(comparison = "lsd")))
  expect_true(isTRUE(res$success), "success")
  m <- aov(yield ~ virus, sweetpotato); a <- anova(m)
  t <- find_table(res, "output.doe.anovaTitle")
  expect_equal(rowv(t, "virus", 2), a$`Sum Sq`[1], tolerance = 1e-4, label = "SS virus")
  expect_equal(rowv(t, "virus", 5), a$`F value`[1], tolerance = 1e-3, label = "F virus")
  expect_true(grepl(sprintf("%.2f", cv.model(m)), t$footnoteKey, fixed = TRUE), "CV% in footnote")
  ref <- LSD.test(sweetpotato$yield, sweetpotato$virus, df.residual(m), deviance(m) / df.residual(m), console = FALSE)$groups
  mt <- find_table(res, "output.doe.meansTitle")
  for (r in mt$rows) expect_true(identical(r[[5]], as.character(ref[r[[1]], "groups"])), paste("LSD group", r[[1]]))
})

test_that("doe: RCBD and Latin square ANOVA match aov; Tukey groups match HSD.test", {
  set.seed(2); t <- 4; b <- 5
  d <- expand.grid(block = 1:b, trt = 1:t); d$y <- 10 + d$trt * 1.5 + d$block * .8 + rnorm(nrow(d))
  dd <- data.frame(col_1 = d$y, col_2 = d$trt, col_3 = d$block)
  res <- doe_run(dd, list(response = "col_1", design = "rcbd", treatment = "col_2", block = "col_3",
                          varNames = list(col_1 = "y", col_2 = "trt", col_3 = "blk"),
                          valueLabels = list(col_2 = list(`1` = "A", `2` = "B", `3` = "C", `4` = "D")),
                          options = list(comparison = "tukey")))
  a <- anova(aov(y ~ factor(block) + factor(trt), d))
  tb <- find_table(res, "output.doe.anovaTitle")
  expect_equal(rowv(tb, "blk", 2), a$`Sum Sq`[1], tolerance = 1e-4, label = "SS block")
  expect_equal(rowv(tb, "trt", 5), a$`F value`[2], tolerance = 1e-3, label = "F trt")
  mse <- a$`Mean Sq`[3]
  ref <- agricolae::HSD.test(d$y, factor(d$trt, labels = c("A", "B", "C", "D")), a$Df[3], mse, console = FALSE)$groups
  mt <- find_table(res, "output.doe.meansTitle")
  for (r in mt$rows) expect_true(identical(r[[5]], as.character(ref[r[[1]], "groups"])), paste("HSD group", r[[1]]))
  # Latin square 4 x 4.
  sq <- matrix(c(1,2,3,4, 2,3,4,1, 3,4,1,2, 4,1,2,3), 4, byrow = TRUE)
  L <- expand.grid(row = 1:4, col = 1:4); L$trt <- sq[cbind(L$row, L$col)]
  L$y <- 20 + L$trt + 0.5 * L$row + rnorm(16)
  lr <- doe_run(data.frame(col_1 = L$y, col_2 = L$trt, col_3 = L$row, col_4 = L$col),
                list(response = "col_1", design = "latin", treatment = "col_2", row = "col_3", column = "col_4",
                     varNames = list(col_1 = "y", col_2 = "trt", col_3 = "r", col_4 = "c")))
  al <- anova(aov(y ~ factor(row) + factor(col) + factor(trt), L))
  tl <- find_table(lr, "output.doe.anovaTitle")
  expect_equal(rowv(tl, "trt", 5), al$`F value`[3], tolerance = 1e-3, label = "Latin F trt")
  expect_equal(rowv(tl, "output.doe.error", 3), al$Df[4], label = "Latin error df")
})

test_that("doe: split-plot matches agricolae::sp.plot incl. CV(a), CV(b)", {
  suppressMessages(library(agricolae)); data(plots)
  d <- data.frame(col_1 = plots$yield, col_2 = as.character(plots$block), col_3 = as.character(plots$A),
                  col_4 = as.character(plots$B))
  res <- doe_run(d, list(response = "col_1", design = "splitplot", block = "col_2", mainFactor = "col_3",
                         subFactor = "col_4", varNames = list(col_1 = "yield", col_2 = "block", col_3 = "A", col_4 = "B")))
  sp <- capture.output(ref <- with(plots, sp.plot(block, A, B, yield)))
  A <- ref$ANOVA
  t <- find_table(res, "output.doe.anovaTitle")
  expect_equal(rowv(t, "A", 2), A["A", "Sum Sq"], tolerance = 1e-3, label = "SS A")
  expect_equal(rowv(t, "A", 5), A["A", "F value"], tolerance = 1e-2, label = "F A against Ea")
  expect_equal(rowv(t, "output.doe.errorA", 2), A["Ea", "Sum Sq"], tolerance = 1e-3, label = "SS Ea")
  expect_equal(rowv(t, "A × B", 5), A["A:B", "F value"], tolerance = 1e-3, label = "F A:B against Eb")
  # Block is a whole-plot effect, so it is tested against Error (a) (Gomez &
  # Gomez 1984); agricolae divides by Error (b) instead — the one deliberate
  # difference from sp.plot.
  expect_equal(rowv(t, "block", 5), A["block", "Mean Sq"] / A["Ea", "Mean Sq"], tolerance = 1e-2, label = "F block against Ea")
  m <- mean(plots$yield)
  expect_true(grepl(sprintf("%.2f|%.2f", 100 * sqrt(ref$Ea) / m, 100 * sqrt(ref$Eb) / m), t$footnoteKey, fixed = TRUE), "CV(a) | CV(b)")
})

test_that("doe: unreplicated 2^4 reproduces Montgomery's filtration-rate effects", {
  y <- c(45, 71, 48, 65, 68, 60, 80, 65, 43, 100, 45, 104, 75, 86, 70, 96)
  g <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1), D = c(-1, 1))
  d <- data.frame(col_1 = y, col_2 = g$A, col_3 = g$B, col_4 = g$C, col_5 = g$D)
  res <- doe_run(d, list(response = "col_1", design = "twok", factors = list("col_2", "col_3", "col_4", "col_5"),
                         varNames = list(col_1 = "rate", col_2 = "A", col_3 = "B", col_4 = "C", col_5 = "D")))
  expect_true(isTRUE(res$success), "success")
  t <- find_table(res, "output.doe.effectsTitle")
  pub <- c(A = 21.625, B = 3.125, C = 9.875, D = 14.625, `A × B` = 0.125, `A × C` = -18.125,
           `A × D` = 16.625, `B × C` = 2.375, `B × D` = -0.375, `C × D` = -1.125,
           `A × B × C` = 1.875, `A × B × D` = 4.125, `A × C × D` = -1.625,
           `B × C × D` = -2.625, `A × B × C × D` = 1.375)
  for (nm in names(pub)) expect_equal(rowv(t, nm, 2), pub[[nm]], tolerance = 1e-6, label = paste("effect", nm))
  # Lenth: s0 = 1.5 median|c|, PSE = 1.5 median(|c| < 2.5 s0) -> A, C, D, AC, AD active (Montgomery).
  a <- abs(pub); s0 <- 1.5 * median(a); pse <- 1.5 * median(a[a < 2.5 * s0])
  expect_true(grepl(format(round(pse, 4)), t$footnoteKey, fixed = TRUE), "Lenth PSE in footnote")
  active <- vapply(t$rows, function(r) !is.null(r[[5]]), TRUE)
  names(active) <- vapply(t$rows, function(r) r[[1]], "")
  expect_true(all(active[c("A", "C", "D", "A × C", "A × D")]) && sum(active) == 5, "active effects A, C, D, AC, AD")
  expect_true(length(res$plots) == 1, "Pareto chart")
})

test_that("doe: replicated 2^3 effects and t tests match lm; factorial ANOVA matches aov", {
  set.seed(8); g <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)); g <- rbind(g, g)
  g$y <- 50 + 4 * g$A - 2 * g$B + 3 * g$A * g$B + rnorm(16, 0, 1.5)
  d <- data.frame(col_1 = g$y, col_2 = g$A, col_3 = g$B, col_4 = g$C)
  res <- doe_run(d, list(response = "col_1", design = "twok", factors = list("col_2", "col_3", "col_4"),
                         varNames = list(col_1 = "y", col_2 = "A", col_3 = "B", col_4 = "C")))
  fit <- summary(lm(y ~ (A + B + C)^3, g))$coefficients
  t <- find_table(res, "output.doe.effectsTitle")
  expect_equal(rowv(t, "A", 2), 2 * fit["A", 1], tolerance = 1e-4, label = "effect A")
  expect_equal(rowv(t, "A × B", 5), fit["A:B", 3], tolerance = 1e-3, label = "t AB")
  set.seed(9); f <- expand.grid(rep = 1:3, A = 1:2, B = 1:3); f$y <- 5 + f$A + f$B * .7 + rnorm(18)
  fr <- doe_run(data.frame(col_1 = f$y, col_2 = f$A, col_3 = f$B), list(response = "col_1", design = "factorial",
                factors = list("col_2", "col_3"), varNames = list(col_1 = "y", col_2 = "A", col_3 = "B")))
  af <- anova(aov(y ~ factor(A) * factor(B), f))
  tf <- find_table(fr, "output.doe.anovaTitle")
  expect_equal(rowv(tf, "A × B", 5), af$`F value`[3], tolerance = 1e-3, label = "factorial F AB")
  expect_true(sum(vapply(fr$tables, function(x) startsWith(x$titleKey, "output.doe.meansTitle"), TRUE)) == 3, "A, B and A x B comparisons")
})
