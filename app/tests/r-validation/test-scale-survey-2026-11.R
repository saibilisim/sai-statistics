# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-scale-survey-2026-11.R — the survey / scale scripts added in 2026-11:
# item-analysis.R, likert-items.R, scale-report.R, harman.R, test-retest.R,
# lawshe.R. References are computed here independently: t.test / cor.test /
# psych::alpha / psych::ICC / psych::fa / eigen / table / pbinom, and the
# published Ayre & Scally (2014) critical values.

likert_data <- function(n = 200, seed = 3) {
  set.seed(seed)
  f1 <- rnorm(n); f2 <- 0.4 * f1 + rnorm(n)
  cut5 <- function(v) as.numeric(cut(v, c(-Inf, -1.2, -0.4, 0.4, 1.2, Inf)))
  d <- data.frame(col_1 = cut5(f1 + rnorm(n, 0, .7)), col_2 = cut5(f1 + rnorm(n, 0, .8)),
                  col_3 = 6 - cut5(f1 + rnorm(n, 0, .7)),  # reverse-keyed
                  col_4 = cut5(f2 + rnorm(n, 0, .7)), col_5 = cut5(f2 + rnorm(n, 0, .8)),
                  col_6 = cut5(f2 + rnorm(n, 0, .9)))
  d
}
ids <- function(d) names(d)[grepl("^col_", names(d))]
nm_of <- function(d) setNames(as.list(sub("col_", "q", ids(d))), ids(d))
run <- function(script, d, p) run_analysis_script(script, write_fixture(d, c(list(varNames = nm_of(d)), p)))
row_lbl <- function(t, lbl) { for (i in seq_along(t$rows)) if (identical(t$rows[[i]][[1]], lbl)) return(i); NA }

test_that("item analysis: item-total, alpha-if-deleted, 27% groups with Welch t", {
  d <- likert_data(); X <- as.matrix(d); n <- nrow(X)
  res <- run("item-analysis.R", d, list(variables = as.list(ids(d))))
  expect_true(isTRUE(res$success), "success")
  pa <- psych::alpha(X, check.keys = FALSE, warnings = FALSE)
  it <- find_table(res, "output.itemAnalysis.itemStatsTitle")
  for (i in 1:6) {
    expect_equal(cell_num(it, i, 5), pa$item.stats$r.drop[i], tolerance = 2e-3, label = paste("r.drop", i))
    expect_equal(cell_num(it, i, 6), pa$alpha.drop$raw_alpha[i], tolerance = 1e-2, label = paste("alpha drop", i))
  }
  expect_equal(cell_num(it, 1, 7), 100 * mean(X[, 1] == min(X)), tolerance = 1e-2, label = "floor %")
  tot <- rowSums(X); g <- floor(n * .27 + .5)
  ord <- order(-tot, seq_len(n)); up <- ord[1:g]; lw <- ord[(n - g + 1):n]
  ul <- find_table(res, "output.itemAnalysis.ulTitle")
  for (i in 1:6) {
    tt <- t.test(X[up, i], X[lw, i])
    expect_equal(cell_num(ul, i, 5), unname(tt$statistic), tolerance = 2e-3, label = paste("t", i))
    expect_equal(cell_num(ul, i, 6), unname(tt$parameter), tolerance = 2e-3, label = paste("df", i))
    expect_equal(cell_num(ul, i, 3) - cell_num(ul, i, 2), mean(X[up, i]) - mean(X[lw, i]), tolerance = 2e-3, label = paste("diff", i))
  }
  lt <- grep("^output.itemAnalysis.lowItemTotal:", unlist(res$notes), value = TRUE)
  expect_true(length(lt) == 1 && grepl("q3", lt), "reverse-keyed item flagged")
})

test_that("item analysis: difficulty and discrimination for 0/1 items", {
  set.seed(9); n <- 120; th <- rnorm(n)
  B <- as.data.frame(sapply(c(-1, -.3, 0, .5, 1.2), function(b) as.numeric(th + rnorm(n, 0, .8) > b)))
  names(B) <- paste0("col_", 1:5)
  res <- run("item-analysis.R", B, list(variables = as.list(ids(B))))
  dt <- find_table(res, "output.itemAnalysis.difficultyTitle")
  X <- as.matrix(B); tot <- rowSums(X); g <- floor(n * .27 + .5)
  ord <- order(-tot, seq_len(n)); up <- ord[1:g]; lw <- ord[(n - g + 1):n]
  for (i in 1:5) {
    expect_equal(cell_num(dt, i, 2), mean(X[, i]), tolerance = 1e-2, label = paste("p", i))
    expect_equal(cell_num(dt, i, 5), mean(X[up, i]) - mean(X[lw, i]), tolerance = 2e-3, label = paste("D", i))
  }
  ts <- find_table(res, "output.itemAnalysis.testStatsTitle")
  expect_equal(cell_num(ts, 2, 2), psych::alpha(X, warnings = FALSE)$total$raw_alpha, tolerance = 2e-3, label = "KR-20 = alpha")
})

test_that("likert items: percentages, reversed statistics, intervals", {
  d <- likert_data()
  lbl <- list(`1` = "Strongly disagree", `2` = "Disagree", `3` = "Neutral", `4` = "Agree", `5` = "Strongly agree")
  res <- run("likert-items.R", d, list(variables = as.list(ids(d)), reverseItems = list("col_3"),
                                       valueLabels = list(col_1 = lbl), options = list(scaleMin = 1, scaleMax = 5)))
  expect_true(isTRUE(res$success), "success")
  pt <- find_table(res, "output.likert.pctTitle")
  tab <- table(factor(d$col_2, 1:5)) / nrow(d) * 100
  for (v in 1:5) expect_equal(cell_num(pt, 2, v + 1), unname(tab[v]), tolerance = 1e-2, label = paste("pct", v))
  expect_true(identical(pt$columns[[2]], "1 – Strongly disagree"), "option labels in headers")
  st <- find_table(res, "output.likert.statsTitle")
  expect_true(identical(st$rows[[3]][[1]], "q3 (R)"), "reverse item marked")
  expect_equal(cell_num(st, 3, 3), mean(6 - d$col_3), tolerance = 1e-2, label = "reversed mean")
  m1 <- mean(d$col_1); lvl <- min(5, max(1, ceiling(round((m1 - 1) / .8, 10))))
  expect_true(identical(st$rows[[1]][[9]], lbl[[lvl]]), "interval label of item 1")
  iv <- find_table(res, "output.likert.intervalTitle")
  expect_true(identical(iv$rows[[1]][[2]], "1.00 – 1.80") && identical(iv$rows[[2]][[2]], "1.81 – 2.60"), "interval bounds")
  expect_true(length(res$plots) == 1, "diverging chart")
})

test_that("scale report: reverse-scored subscale means, normality, APA correlations, saved scores", {
  d <- likert_data(); d$`__row_idx` <- seq_len(nrow(d)) - 1L
  subs <- list(list(name = "A", items = list("col_1", "col_2", "col_3")),
               list(name = "B", items = list("col_4", "col_5", "col_6")))
  res <- run("scale-report.R", d, list(variables = as.list(ids(d)), subscales = subs, reverseItems = list("col_3"),
                                       options = list(score = "mean", total = TRUE, criterion = 1.5),
                                       createVars = list(score1 = "A_score", total = "T_score")))
  expect_true(isTRUE(res$success), "success")
  A <- rowMeans(cbind(d$col_1, d$col_2, 6 - d$col_3)); B <- rowMeans(d[, paste0("col_", 4:6)])
  Tt <- rowMeans(cbind(d$col_1, d$col_2, 6 - d$col_3, d$col_4, d$col_5, d$col_6))
  dt <- find_table(res, "output.scale.descTitle")
  expect_equal(cell_num(dt, 1, 4), mean(A), tolerance = 1e-2, label = "A mean")
  expect_equal(cell_num(dt, 3, 4), mean(Tt), tolerance = 1e-2, label = "total mean")
  n <- length(A); g1 <- n / ((n - 1) * (n - 2)) * sum(((A - mean(A)) / sd(A))^3)
  expect_equal(cell_num(dt, 1, 8), g1, tolerance = 1e-2, label = "skewness G1")
  ct <- find_table(res, "output.scale.corrTitle")
  expect_equal(cell_num(ct, 2, 4), cor(A, B), tolerance = 2e-3, label = "r(A,B) below diagonal")
  expect_equal(cell_num(ct, 1, 5), cor.test(A, B)$p.value, tolerance = 1e-2, label = "p above diagonal")
  aA <- psych::alpha(cbind(d$col_1, d$col_2, 6 - d$col_3), warnings = FALSE)$total$raw_alpha
  expect_equal(cell_num(ct, 1, 4), aA, tolerance = 2e-3, label = "alpha on the diagonal")
  cv <- by_name(res)
  expect_true(!is.null(cv$A_score) && !is.null(cv$T_score) && is.null(cv$B_score), "requested scores saved")
  expect_equal(unlist(cv$A_score$values)[1:5], round(A[1:5], 10), tolerance = 1e-8, label = "saved values")
})

test_that("harman: first eigenvalue share and single PAF factor", {
  d <- likert_data(); X <- as.matrix(d)
  res <- run("harman.R", d, list(variables = as.list(ids(d))))
  t <- find_table(res, "output.harman.varTitle")
  ev <- eigen(cor(X))$values[1]
  expect_equal(cell_num(t, 1, 3), 100 * ev / 6, tolerance = 1e-2, label = "PCA % variance")
  f <- psych::fa(cor(X), 1, n.obs = nrow(X), fm = "pa", rotate = "none", min.err = 1e-6, max.iter = 100)
  expect_equal(cell_num(t, 2, 3), 100 * sum(f$loadings^2) / 6, tolerance = 1e-2, label = "PAF % variance")
  expect_true(identical(t$rows[[1]][[4]], if (100 * ev / 6 >= 50) "output.harman.biasLikely" else "output.harman.biasUnlikely"), "verdict")
  expect_true(!is.null(find_table(res, "output.harman.cfaTitle")), "one-factor CFA fit")
})

test_that("test-retest: r, ICC (A,1) and paired t", {
  set.seed(4); n <- 60; x <- rnorm(n, 50, 10); y <- x + rnorm(n, 1.5, 4)
  d <- data.frame(col_1 = x, col_2 = y)
  res <- run_analysis_script("test-retest.R", write_fixture(d, list(first = list("col_1"), second = list("col_2"),
                             varNames = list(col_1 = "t1", col_2 = "t2"))))
  t <- find_table(res, "output.retest.relTitle")
  expect_equal(cell_num(t, 1, 2), cor(x, y), tolerance = 1e-3, label = "r")
  ic <- psych::ICC(cbind(x, y), lmer = FALSE)$results
  expect_equal(cell_num(t, 1, 4), ic$ICC[ic$type == "ICC2"], tolerance = 2e-3, label = "ICC(A,1)")
  expect_equal(cell_num(t, 1, 5), ic$`lower bound`[ic$type == "ICC2"], tolerance = 3e-3, label = "ICC lower")
  tt <- t.test(x, y, paired = TRUE)
  expect_equal(cell_num(t, 1, 7), unname(tt$statistic), tolerance = 1e-3, label = "paired t")
  expect_equal(cell_num(t, 1, 10), mean(x - y) / sd(x - y), tolerance = 3e-2, label = "dz")
})

test_that("lawshe: CVR, exact critical values (Ayre & Scally 2014) and CVI", {
  # 10 experts; item i has ne_i experts coding 1 (essential), the rest 2 or 3.
  ne <- c(10, 9, 8, 7, 5)
  d <- as.data.frame(sapply(ne, function(k) c(rep(1, k), rep(c(2, 3), length.out = 10 - k))))
  names(d) <- paste0("col_", 1:5)
  res <- run("lawshe.R", d, list(variables = as.list(ids(d)), options = list(essential = 1)))
  t <- find_table(res, "output.lawshe.itemTitle")
  for (i in 1:5) expect_equal(cell_num(t, i, 4), (ne[i] - 5) / 5, tolerance = 1e-6, label = paste("CVR", i))
  # Ayre & Scally (2014) Table 2: N = 10 -> critical CVR .800.
  expect_equal(cell_num(t, 1, 5), 0.8, tolerance = 1e-6, label = "critical CVR, N = 10")
  expect_true(identical(t$rows[[2]][[6]], "output.lawshe.retain") && identical(t$rows[[3]][[6]], "output.lawshe.remove"), "decisions")
  s <- find_table(res, "output.lawshe.scaleTitle")
  expect_equal(cell_num(s, 3, 2), mean(c(1, .8)), tolerance = 1e-6, label = "CVI of retained items")
  # Other published exact values: N = 5 -> 1.00, N = 15 -> .600 (ne 12), N = 20 -> .500 (ne 15).
  for (N in c(5, 15, 20)) {
    dd <- data.frame(col_1 = c(rep(1, N - 1), 2))
    r2 <- run("lawshe.R", dd, list(variables = list("col_1")))
    ref <- c(`5` = 1, `15` = .6, `20` = .5)[as.character(N)]
    expect_equal(cell_num(find_table(r2, "output.lawshe.itemTitle"), 1, 5), unname(ref), tolerance = 1e-6, label = paste("critical N =", N))
  }
  lw <- run("lawshe.R", d, list(variables = as.list(ids(d)), options = list(criterion = "lawshe")))
  expect_equal(cell_num(find_table(lw, "output.lawshe.itemTitle"), 1, 5), .62, tolerance = 1e-6, label = "Lawshe table N = 10")
})
