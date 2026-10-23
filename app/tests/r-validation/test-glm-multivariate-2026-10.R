# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# test-glm-multivariate-2026-10.R — GLM Multivariate (glm-multivariate.R).
#
# References, none of them the script's own code:
#   * Type I multivariate tests: base R's summary.manova() (sequential SSCP)
#   * Type III multivariate tests: car::Anova(mlm, type = 3) when car is present
#   * Box's M: rstatix::box_m() (its chi-square is M * (1 - c1), so M is
#     recovered from it) and the F approximation written out from the SPSS
#     Statistics Algorithms manual, Appendix J
#   * per-dependent tables: glm-univariate.R itself on the same cases — the
#     contract is that Multivariate prints exactly what Univariate prints.

set.seed(2026)
mv_n <- 90
mv_df <- data.frame(
  col_a = factor(sample(c("a1", "a2", "a3"), mv_n, replace = TRUE)),
  col_b = factor(sample(c("b1", "b2"), mv_n, replace = TRUE))
)
mv_df$col_y1 <- rnorm(mv_n, 10 + 2 * (mv_df$col_a == "a2"), 2)
mv_df$col_y2 <- rnorm(mv_n, 5 + 1.5 * (mv_df$col_b == "b2"), 1.5) + 0.4 * mv_df$col_y1
mv_df$col_y3 <- rnorm(mv_n, 0, 1) + 0.3 * mv_df$col_y2
mv_df$col_a <- as.character(mv_df$col_a); mv_df$col_b <- as.character(mv_df$col_b)

mv_params <- function(options = list()) list(
  dependents = list("col_y1", "col_y2", "col_y3"),
  dependentNames = list(col_y1 = "y1", col_y2 = "y2", col_y3 = "y3"),
  factors = list("col_a", "col_b"), factorNames = list(col_a = "A", col_b = "B"),
  options = options)

mv_stat <- function(tbl, effect, stat_key) {
  cur <- NULL
  for (r in tbl$rows) {
    if (nzchar(r[[1]])) cur <- r[[1]]
    if (identical(cur, effect) && identical(r[[2]], stat_key)) return(r)
  }
  stop("row not found: ", effect, " / ", stat_key)
}

test_that("glm-multivariate: Type I tests match summary.manova()", {
  res <- run_analysis_script("glm-multivariate.R", write_fixture(mv_df, mv_params(list(ssType = "I"))))
  expect_true(isTRUE(res$success), "success")
  mv <- find_table(res, "output.glmMulti.mvTitle")
  Y <- as.matrix(mv_df[, c("col_y1", "col_y2", "col_y3")])
  fit <- manova(Y ~ col_a * col_b, data = mv_df)
  for (pair in list(c("Pillai", "output.col.pillai"), c("Wilks", "output.col.wilks"),
                    c("Hotelling-Lawley", "output.col.hotelling"), c("Roy", "output.col.roy"))) {
    ref <- summary(fit, test = pair[1])$stats
    for (eff in list(c("col_a", "A"), c("col_b", "B"), c("col_a:col_b", "A * B"))) {
      r <- mv_stat(mv, eff[2], pair[2])
      expect_equal(as.numeric(r[[3]]), round(ref[eff[1], 2], 3), tolerance = 1e-9,
                   paste(pair[1], eff[2], "statistic"))
      expect_equal(as.numeric(r[[4]]), round(ref[eff[1], 3], 3), tolerance = 1e-9,
                   paste(pair[1], eff[2], "F"))
      expect_equal(as.numeric(r[[7]]), round(ref[eff[1], 6], 6), tolerance = 1e-6,
                   paste(pair[1], eff[2], "Sig."))
    }
  }
})

test_that("glm-multivariate: Type III Pillai's trace matches car::Anova(type = 3)", {
  if (!requireNamespace("car", quietly = TRUE)) {
    cat("  (skipped: car not installed)\n")
    return(invisible())
  }
  res <- run_analysis_script("glm-multivariate.R", write_fixture(mv_df, mv_params()))
  mv <- find_table(res, "output.glmMulti.mvTitle")
  old <- options(contrasts = c("contr.sum", "contr.poly")); on.exit(options(old))
  fit <- lm(cbind(col_y1, col_y2, col_y3) ~ col_a * col_b, data = mv_df)
  av <- car::Anova(fit, type = 3, test.statistic = "Pillai")
  pillai_of <- function(term) {
    # car stores per-term SSPH / SSPE; Pillai = sum(eig / (1 + eig)).
    eig <- Re(eigen(solve(av$SSPE) %*% av$SSP[[term]], only.values = TRUE)$values)
    sum(eig / (1 + eig))
  }
  expect_equal(as.numeric(mv_stat(mv, "output.col.intercept", "output.col.pillai")[[3]]),
               round(pillai_of("(Intercept)"), 3), tolerance = 1e-9, "intercept")
  expect_equal(as.numeric(mv_stat(mv, "A", "output.col.pillai")[[3]]),
               round(pillai_of("col_a"), 3), tolerance = 1e-9, "A")
  expect_equal(as.numeric(mv_stat(mv, "A * B", "output.col.pillai")[[3]]),
               round(pillai_of("col_a:col_b"), 3), tolerance = 1e-9, "A * B")
})

test_that("glm-multivariate: per-dependent tables are Univariate's, case for case", {
  # A missing y3 must drop that case from y1's table too (listwise), so the
  # Univariate reference is run on the listwise frame.
  d2 <- mv_df; d2$col_y3[c(3, 17)] <- NA
  res <- run_analysis_script("glm-multivariate.R", write_fixture(d2, mv_params(list(descriptives = TRUE))))
  lw <- d2[stats::complete.cases(d2), ]
  uni <- run_analysis_script("glm-univariate.R", write_fixture(lw, list(
    dependent = "col_y1", dependentName = "y1",
    factors = list("col_a", "col_b"), factorNames = list(col_a = "A", col_b = "B"),
    options = list(descriptives = TRUE))))
  for (title in c("output.glmUni.title:y1", "output.glmUni.descriptivesTitle:y1")) {
    a <- find_table(res, title); b <- find_table(uni, title)
    expect_true(identical(a$rows, b$rows), paste(title, "identical to Univariate"))
  }
})

test_that("glm-multivariate: Box's M and its F match the SPSS formula", {
  res <- run_analysis_script("glm-multivariate.R", write_fixture(mv_df, mv_params(list(homogeneity = TRUE))))
  box <- find_table(res, "output.glmMulti.boxTitle")
  Y <- as.matrix(mv_df[, c("col_y1", "col_y2", "col_y3")])
  grp <- interaction(mv_df$col_a, mv_df$col_b, drop = TRUE)
  ns <- as.numeric(table(grp)); g <- length(ns); p <- 3; N <- sum(ns)
  c1 <- (sum(1 / (ns - 1)) - 1 / (N - g)) * (2 * p^2 + 3 * p - 1) / (6 * (p + 1) * (g - 1))
  c2 <- (sum(1 / (ns - 1)^2) - 1 / (N - g)^2) * (p - 1) * (p + 2) / (6 * (g - 1))
  M_ref <- if (requireNamespace("rstatix", quietly = TRUE)) {
    unname(rstatix::box_m(as.data.frame(Y), grp)$statistic) / (1 - c1)
  } else {
    S <- lapply(split(as.data.frame(Y), grp), cov)
    Sp <- Reduce(`+`, Map(function(s, n) (n - 1) * s, S, ns)) / (N - g)
    (N - g) * log(det(Sp)) - sum((ns - 1) * vapply(S, function(s) log(det(s)), numeric(1)))
  }
  f1 <- (g - 1) * p * (p + 1) / 2
  f2 <- (f1 + 2) / abs(c2 - c1^2)
  F_ref <- M_ref * ((1 - c1) - f1 / f2) / f1
  expect_equal(cell_num(box, 1, 1), round(M_ref, 3), tolerance = 1e-9, "Box's M")
  expect_equal(cell_num(box, 1, 2), round(F_ref, 3), tolerance = 1e-9, "F")
  expect_equal(cell_num(box, 1, 3), f1, tolerance = 1e-9, "df1")
  expect_equal(cell_num(box, 1, 5), round(pf(F_ref, f1, f2, lower.tail = FALSE), 6),
               tolerance = 1e-6, "Sig.")
})

test_that("glm-multivariate: effect size and power columns appear when asked", {
  res <- run_analysis_script("glm-multivariate.R", write_fixture(mv_df, mv_params(
    list(effectSize = TRUE, power = TRUE))))
  mv <- find_table(res, "output.glmMulti.mvTitle")
  expect_true(length(mv$columns) == 9, "Partial Eta Squared + Observed Power")
  r <- mv_stat(mv, "A", "output.col.pillai")
  # SPSS: partial eta squared for Pillai = V / s, s = min(p, q) = min(3, 2).
  # (V is printed to 3 dp, so the check allows that rounding.)
  expect_equal(as.numeric(r[[8]]), round(as.numeric(r[[3]]) / 2, 3), tolerance = 2e-2,
               "partial eta squared = V / s")
})
