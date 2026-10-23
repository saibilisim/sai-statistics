# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Exercise production JSON/R path against independent public clm/polr fits.
suppressPackageStartupMessages(library(ordinal))
data(wine, package = "ordinal")
ordinal_df <- data.frame(y = as.numeric(wine$rating), temp = as.character(wine$temp),
                         contact = as.character(wine$contact), x = as.numeric(wine$temp))
ordinal_run <- function(settings = list(), extra = list(), data = ordinal_df) {
  args <- list(dependent = "y", factors = list("temp", "contact"),
    settings = settings, varNames = list(temp = "Temperature", contact = "Contact"))
  for (key in names(extra)) args[[key]] <- extra[[key]]
  run_analysis_script("regression-ordinal.R", write_fixture(data, args))
}
ordinal_table <- function(result, key) {
  hit <- Filter(function(tab) tab$titleKey == key, result$tables)
  if (!length(hit)) stop(paste("Missing table", key, result$error))
  hit[[1]]
}
ordinal_coefficients <- function(result) vapply(ordinal_table(result, "output.ordinal.paramTitle")$rows, function(row) as.numeric(row[[3]]), numeric(1))

test_that("ordinal estimates and Wald intervals agree with independent clm and published wine fit", {
  result <- ordinal_run(list(options = list(ciLevel = 90), output = list(includeConstant = FALSE, covariances = TRUE, correlations = TRUE)))
  expect_true(result$success)
  ref <- clm(rating ~ temp + contact, data = wine)
  expect_equal(unname(ordinal_coefficients(result)), unname(coef(ref)), tolerance = 1e-5)
  fit <- ordinal_table(result, "output.ordinal.fitTitle")
  expect_equal(fit$rows[[1]][[2]], -2 * as.numeric(logLik(ref)), tolerance = 1e-5)
  expect_equal(as.numeric(logLik(ref)), -86.49192, tolerance = 1e-5)
  rows <- ordinal_table(result, "output.ordinal.paramTitle")$rows
  expect_equal(vapply(rows, function(row) row[[4]], numeric(1)), unname(sqrt(diag(vcov(ref)))), tolerance = 1e-5)
  expect_equal(vapply(rows, function(row) row[[8]], numeric(1)), unname(coef(ref) - qnorm(.95) * sqrt(diag(vcov(ref)))), tolerance = 1e-5)
  corr <- ordinal_table(result, "output.ordinal.extra.correlations")
  expect_true(is.null(names(corr$columns)))
  expect_true(is.null(names(corr$rows[[1]])))
  expect_equal(as.numeric(unlist(corr$rows[[1]][-1])), unname(cov2cor(vcov(ref))[1, ]), tolerance = 1e-5)
})

test_that("scale, custom interactions and every link match independent package fits", {
  for (link in c("logit", "probit", "cloglog", "loglog", "cauchit")) {
    settings <- list(location = list(mode = "custom", terms = list(list("temp"), list("contact"), list("temp", "contact"))),
      scale = list(terms = list(list("temp"))), options = list(link = link, maxStepHalving = 20))
    result <- ordinal_run(settings)
    expect_true(result$success, paste("link", link))
    ref <- clm(rating ~ temp * contact, scale = ~ temp, data = wine, link = link)
    expect_equal(unname(ordinal_coefficients(result)), unname(coef(ref)), tolerance = 1e-4)
  }
})

test_that("cell information, goodness of fit and multinomial constant use predictor patterns", {
  included <- ordinal_run(list(output = list(cellInfo = TRUE)))
  excluded <- ordinal_run(list(output = list(includeConstant = FALSE)))
  counts <- as.matrix(xtabs(~ interaction(temp, contact) + rating, wine))
  constant <- sum(lgamma(rowSums(counts) + 1) - rowSums(lgamma(counts + 1)))
  a <- ordinal_table(included, "output.ordinal.fitTitle")$rows[[1]]
  b <- ordinal_table(excluded, "output.ordinal.fitTitle")$rows[[1]]
  expect_equal(b[[2]] - a[[2]], 2 * constant, tolerance = 1e-5)
  expect_equal(a[[3]], b[[3]])
  cells <- ordinal_table(included, "output.ordinal.extra.cellInfo")
  obs <- vapply(cells$rows, function(row) row[[5]], numeric(1))
  exp <- vapply(cells$rows, function(row) row[[6]], numeric(1))
  expect_equal(sum(obs), 72)
  expect_equal(sum(exp), 72)
  gof <- ordinal_table(included, "output.ordinal.extra.goodnessOfFit")
  expect_equal(gof$rows[[1]][[2]], sum((obs - exp)^2 / exp))
  expect_equal(gof$rows[[1]][[3]], 4 * 4 - 6)
})

test_that("parallel lines uses the nested nominal-effects likelihood ratio", {
  # Complete cells avoid the separated unrestricted model in the wine data.
  cells <- expand.grid(y = 1:5, temp = c("cold", "warm"), contact = c("no", "yes"))
  counts <- 10L + (seq_len(nrow(cells)) * 7L) %% 13L
  d <- cells[rep(seq_len(nrow(cells)), counts), ]
  d$rating <- ordered(d$y)
  result <- ordinal_run(list(output = list(parallelLines = TRUE), options = list(maxStepHalving = 20)), data = d)
  a <- clm(rating ~ temp + contact, data = d)
  b <- clm(rating ~ 1, nominal = ~ temp + contact, data = d)
  tab <- ordinal_table(result, "output.ordinal.extra.parallelLines")
  lr <- 2 * (as.numeric(logLik(b)) - as.numeric(logLik(a)))
  expect_equal(tab$rows[[1]][[2]], lr, tolerance = 1e-5)
  expect_equal(tab$rows[[1]][[3]], b$edf - a$edf)
})

test_that("saved probabilities preserve row alignment and numeric category order", {
  d <- ordinal_df
  d$y <- c(1, 2, 10, 11, 20)[d$y]
  d$x[c(3, 17)] <- NA
  d$`__row_idx` <- seq_len(nrow(d)) - 1L
  result <- ordinal_run(extra = list(factors = list(), covariates = list("x"),
    createVars = list(predictedGroup = "grp", probability = "prob", actualProbability = "act", estimatedProbabilities = "est")), data = d)
  expect_true(result$success)
  cv <- by_name(result)
  expect_equal(length(cv), 8L)
  d$response <- ordered(d$y)
  ref <- clm(response ~ x, data = d)
  pp <- predict(ref, newdata = d[!is.na(d$x), "x", drop = FALSE])$fit
  expect_equal(unlist(cv$est3$values), unname(pp[, 3]), tolerance = 1e-5)
  expect_equal(unlist(cv$act$values), unname(pp[cbind(seq_len(nrow(pp)), as.integer(ordered(d$y[!is.na(d$x)])))]), tolerance = 1e-5)
  expect_equal(unlist(cv$prob$rowIndex), d$`__row_idx`[!is.na(d$x)])
  expect_true(cv$grp$measure == "ordinal")
})

test_that("history, zero iterations, stopping criteria and output suppression work", {
  result <- ordinal_run(list(options = list(maxIterations = 0), output = list(history = TRUE, estimates = FALSE, summary = FALSE, goodnessOfFit = FALSE)))
  expect_true(result$success)
  expect_equal(length(result$tables), 2L)
  expect_equal(length(ordinal_table(result, "output.ordinal.extra.history")$rows), 1L)
  expect_true("output.ordinal.extra.notConverged" %in% unlist(result$warnings))
  result <- ordinal_run(list(options = list(logLikelihood = 100, parameter = 0), output = list(history = TRUE)))
  expect_equal(length(ordinal_table(result, "output.ordinal.extra.history")$rows), 2L)
  result <- ordinal_run(list(output = list(history = TRUE, historyEvery = 2)))
  history <- ordinal_table(result, "output.ordinal.extra.history")$rows
  expect_true(all(vapply(history, function(row) row[[1]] %% 2 == 0, logical(1))))
})

test_that("delta adjusts only zero cells and weights match replicated cases", {
  result <- ordinal_run(list(options = list(delta = .25)))
  counts <- as.data.frame(xtabs(~ rating + temp + contact, wine))
  counts$Freq[counts$Freq == 0] <- .25
  ref <- clm(ordered(rating) ~ temp + contact, data = counts, weights = Freq)
  expect_equal(unname(ordinal_coefficients(result)), unname(coef(ref)), tolerance = 1e-5)
  d <- ordinal_df; d$w <- rep(c(1, 2), length.out = nrow(d))
  weighted <- ordinal_run(extra = list(weightVariable = "w"), data = d)
  replicated <- ordinal_run(data = d[rep(seq_len(nrow(d)), d$w), ])
  expect_equal(ordinal_coefficients(weighted), ordinal_coefficients(replicated), tolerance = 1e-5)
})

test_that("invalid model terms and numerical criteria are rejected", {
  result <- ordinal_run(list(scale = list(terms = list(list("not_a_column")))))
  expect_true(!result$success)
  result <- ordinal_run(list(options = list(ciLevel = 100)))
  expect_true(!result$success)
  result <- ordinal_run(list(options = list(maxIterations = -1)))
  expect_true(!result$success)
})

test_that("threshold-only and redundant models remain valid JSON with honest inference", {
  result <- ordinal_run(extra = list(factors = list()))
  expect_true(result$success)
  ref <- clm(rating ~ 1, data = wine)
  expect_equal(unname(ordinal_coefficients(result)), unname(coef(ref)), tolerance = 1e-5)
  d <- ordinal_df; d$x2 <- d$x
  result <- ordinal_run(extra = list(factors = list(), covariates = list("x", "x2")), data = d)
  expect_true(result$success)
  expect_true("output.ordinal.extra.aliased" %in% unlist(result$warnings))
  rows <- ordinal_table(result, "output.ordinal.paramTitle")$rows
  expect_true(all(vapply(rows, function(row) is.null(row[[4]]), logical(1))))
})
