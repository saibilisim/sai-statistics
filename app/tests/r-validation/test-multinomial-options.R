# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Numerical references use nnet / stats, independently of the production solver.
source(file.path(r_scripts_dir(), "multinomial-engine.R"))

mn_fixture <- function() {
  set.seed(4819)
  n <- 240; x <- rnorm(n); f <- factor(sample(c('A', 'B', 'C'), n, TRUE))
  eta <- cbind(0, .4 + .8 * x + .5 * (f == 'B'), -.2 - .6 * x + .7 * (f == 'C'))
  p <- exp(eta); p <- p / rowSums(p)
  y <- apply(p, 1, function(pr) sample(c('a','b','c'), 1, prob = pr))
  dat <- data.frame(col_1 = y, col_2 = x, col_3 = f)
  dat[['__row_idx']] <- seq_len(n) * 2L
  dat
}
mn_run <- function(dat, extra = list()) {
  # nnet contrasts against the first level; the dialog's default is SPSS's last.
  params <- list(dependent = 'col_1', covariates = list('col_2'), factors = list('col_3'), varNames = list(col_2 = 'x', col_3 = 'f'), reference = list(category = 'first'))
  for (name in names(extra)) params[name] <- extra[name]
  result <- run_analysis_script('regression-multinomial.R', write_fixture(dat, params))
  expect_true(isTRUE(result$success), if (!is.null(result$error)) result$error else 'multinomial succeeds')
  result
}
mn_table <- function(result, key) {
  matches <- Filter(function(t) identical(t$titleKey, key), result$tables)
  if (!length(matches)) stop(paste('Missing table:', key))
  matches[[1]]
}

test_that('multinomial coefficients, covariance, CI and fit match nnet', {
  dat <- mn_fixture()
  result <- mn_run(dat, list(statistics = list(covariances = TRUE, ciLevel = 90, informationCriteria = TRUE)))
  ref <- nnet::multinom(factor(col_1) ~ col_2 + col_3, dat, trace = FALSE, Hess = TRUE, abstol = 1e-12, reltol = 1e-12)
  pe <- mn_table(result, 'output.multinom.paramTitle')
  # Production orders factors then covariates; align using output term labels.
  target <- c('(Intercept)', 'col_2', 'col_3B', 'col_3C')
  expect_equal(vapply(pe$rows, function(r) r[[3]], numeric(1)), as.vector(t(coef(ref)[, target])), tolerance = 1e-5)
  se <- as.vector(t(summary(ref)$standard.errors[, target]))
  expect_equal(vapply(pe$rows, function(r) r[[4]], numeric(1)), se, tolerance = 1e-5)
  expect_equal(vapply(pe$rows, function(r) r[[9]], numeric(1)), exp(as.vector(t(coef(ref)[, target])) - qnorm(.95) * se), tolerance = 1e-5)
  fit <- mn_table(result, 'output.multinom.fitTitle')
  expect_equal(fit$rows[[2]][[2]], ref$deviance, tolerance = 1e-5)
  null <- nnet::multinom(factor(col_1) ~ 1, dat, trace = FALSE)
  expect_equal(fit$rows[[2]][[5]], pchisq(null$deviance - ref$deviance, ref$edf - null$edf, lower.tail = FALSE), tolerance = 1e-5)
  # Information Criteria must cover BOTH the intercept-only and final model
  # (SPSS's Model Fitting Information table has an AIC/BIC pair for each), not
  # just the final one.
  ic <- mn_table(result, 'output.multinom.extra.informationCriteria')
  expect_equal(ic$rows[[1]][[2]], AIC(null), tolerance = 1e-4)
  expect_equal(ic$rows[[1]][[3]], BIC(null), tolerance = 1e-4)
  expect_equal(ic$rows[[2]][[2]], AIC(ref), tolerance = 1e-4)
  expect_equal(ic$rows[[2]][[3]], BIC(ref), tolerance = 1e-4)
})

test_that('near-complete separation reports a diverging standard error, never a fabricated tiny one', {
  # A rare factor level pure in one outcome category (the same shape as a real
  # SPSS NOMREG run with many sparse age categories, one of which is 100%
  # female): the coefficient runs to the boundary, exactly as it should, but
  # its standard error must diverge with it (the Hauck-Donner effect) rather
  # than collapse toward zero and manufacture a spuriously significant Wald
  # statistic and p-value.
  set.seed(101)
  n <- 60; x <- rnorm(n)
  grp <- factor(rep(c('common', 'rare'), c(n - 3, 3)))
  y <- ifelse(grp == 'rare', 'b', sample(c('a', 'b'), n - 3, TRUE))
  dat <- data.frame(col_1 = y, col_2 = x, col_3 = grp)
  dat[['__row_idx']] <- seq_len(n) * 2L
  result <- mn_run(dat, list(covariates = list('col_2'), factors = list('col_3')))
  pe <- mn_table(result, 'output.multinom.paramTitle')
  rare <- pe$rows[[which(vapply(pe$rows, function(r) r[[2]], character(1)) == 'frare')]]
  expect_true(abs(rare[[3]]) > 5, 'coefficient should run toward the boundary')
  expect_true(is.numeric(rare[[4]]) && rare[[4]] > 100, 'SE should diverge, not collapse near zero')
  expect_true(is.numeric(rare[[7]]) && rare[[7]] > .5, 'a separation artifact must not read as significant')
})

test_that('mn_report_inverse diverges under near-singularity and reports missing under exact singularity', {
  # Near-singular (as under separation): must invert to a large FINITE
  # variance, not be truncated away to a deceptive near-zero one.
  near_singular <- diag(c(4, 1e-10))
  inv <- mn_report_inverse(near_singular)
  expect_equal(inv[1, 1], .25, tolerance = 1e-8)
  expect_true(is.finite(inv[2, 2]) && inv[2, 2] > 1e8)
  # Exactly singular: genuinely no identifiable variance — missing, not zero.
  singular <- diag(c(4, 0))
  inv2 <- mn_report_inverse(singular)
  expect_equal(inv2[1, 1], .25, tolerance = 1e-8)
  expect_true(is.na(inv2[2, 2]))
})

test_that('custom factor-covariate interactions and no-intercept models match nnet', {
  dat <- mn_fixture()
  for (intercept in c(TRUE, FALSE)) {
    result <- mn_run(dat, list(model = list(mode = 'custom', intercept = intercept, forced = list(list('col_2'), list('col_3'), list('col_2','col_3')))))
    ref <- nnet::multinom(if (intercept) factor(col_1) ~ col_2 * col_3 else factor(col_1) ~ 0 + col_2 * col_3, dat, trace = FALSE, abstol = 1e-12, reltol = 1e-12)
    fit <- mn_table(result, 'output.multinom.fitTitle')
    expect_equal(fit$rows[[2]][[2]], ref$deviance, tolerance = 1e-5)
  }
})

test_that('all saved probabilities preserve category and missing-case alignment', {
  dat <- mn_fixture(); dat$col_2[c(2,9)] <- NA
  result <- mn_run(dat, list(createVars = list(estimatedProbabilities = 'est', predictedGroup = 'pgr', probability = 'pre', actualProbability = 'act')))
  vars <- setNames(result$caseVars, vapply(result$caseVars, function(v) v$name, character(1)))
  expect_equal(length(vars), 6L)
  p <- do.call(cbind, lapply(vars[c('est1','est2','est3')], function(v) unlist(v$values)))
  expect_equal(rowSums(p), rep(1, nrow(p)), tolerance = 1e-12)
  expect_equal(unlist(vars$pre$values), apply(p, 1, max))
  expect_equal(unlist(vars$act$values), p[cbind(seq_len(nrow(p)), match(dat$col_1[-c(2,9)], c('a','b','c')))])
  expect_equal(unlist(vars$act$rowIndex), dat[['__row_idx']][-c(2,9)])
})

test_that('fixed dispersion scales standard errors without changing estimates', {
  dat <- mn_fixture()
  base <- mn_table(mn_run(dat), 'output.multinom.paramTitle')
  scaled <- mn_table(mn_run(dat, list(options = list(scale = 'fixed', scaleValue = 4))), 'output.multinom.paramTitle')
  expect_equal(vapply(scaled$rows, function(r) r[[3]], numeric(1)), vapply(base$rows, function(r) r[[3]], numeric(1)))
  expect_equal(vapply(scaled$rows, function(r) r[[4]], numeric(1)), 2 * vapply(base$rows, function(r) r[[4]], numeric(1)))
})

test_that('subpopulation Pearson and deviance match independently aggregated frequencies', {
  dat <- mn_fixture()
  result <- mn_run(dat, list(statistics = list(goodnessOfFit = TRUE, cellProbabilities = TRUE, subpopulationMode = 'custom', subpopulations = list('col_3'))))
  ref <- nnet::multinom(factor(col_1) ~ col_2 + col_3, dat, trace = FALSE, abstol = 1e-12, reltol = 1e-12)
  obs <- table(dat$col_3, dat$col_1)
  expected <- rowsum(predict(ref, type = 'probs'), dat$col_3)
  gof <- mn_table(result, 'output.multinom.extra.goodnessOfFit')
  expect_equal(gof$rows[[1]][[2]], sum((obs - expected)^2 / expected), tolerance = 1e-5)
  expect_equal(gof$rows[[2]][[2]], 2 * sum(obs * log(obs / expected)), tolerance = 1e-5)
  # A coarse custom grouping has negative residual df: no fabricated p-value.
  expect_true(is.null(gof$rows[[1]][[4]]))
})

test_that('convergence controls, print switches and XML covariance are effective', {
  dat <- mn_fixture()
  result <- mn_run(dat, list(criteria = list(maxIterations = 1, printHistory = TRUE), statistics = list(estimates = FALSE, likelihoodRatio = FALSE)))
  expect_true('output.multinom.extra.notConverged' %in% unlist(result$warnings))
  expect_equal(length(mn_table(result, 'output.multinom.extra.history')$rows), 1L)
  expect_true(!any(vapply(result$tables, function(t) t$titleKey == 'output.multinom.paramTitle', logical(1))))
  xml <- mn_run(dat, list(exportModel = list(enabled = TRUE, covariance = TRUE)))$modelXml
  expect_true(grepl('normalizationMethod="softmax"', xml, fixed = TRUE))
  expect_true(grepl('parameterCovariance', xml, fixed = TRUE))
  expect_true(grepl('NormDiscrete', xml, fixed = TRUE))
  without <- mn_run(dat, list(exportModel = list(enabled = TRUE, covariance = FALSE)))$modelXml
  expect_true(!grepl('parameterCovariance', without, fixed = TRUE))
})

test_that('forward score entry and backward Wald removal select a strong predictor', {
  dat <- mn_fixture(); set.seed(319); dat$col_4 <- rnorm(nrow(dat))
  for (method in c('forward', 'backward', 'forwardStepwise', 'backwardStepwise')) {
    result <- mn_run(dat, list(factors = list(), covariates = list('col_2','col_4'), model = list(mode = 'custom', method = method, forced = list(), stepped = list(list('col_2'),list('col_4'))), options = list(entryTest = 'score', removalTest = 'wald')))
    pe <- mn_table(result, 'output.multinom.paramTitle')
    labels <- vapply(pe$rows, function(r) r[[2]], character(1))
    expect_true('x' %in% labels, method)
    expect_true(!'col_4' %in% labels, method)
  }
})

test_that('case weights agree with nnet weighted maximum likelihood', {
  dat <- mn_fixture(); dat$col_4 <- rep(1:3, length.out = nrow(dat))
  result <- mn_run(dat, list(weightVariable = 'col_4'))
  ref <- nnet::multinom(factor(col_1) ~ col_2 + col_3, dat, weights = dat$col_4, trace = FALSE, abstol = 1e-12, reltol = 1e-12)
  pe <- mn_table(result, 'output.multinom.paramTitle')
  target <- c('(Intercept)', 'col_2', 'col_3B', 'col_3C')
  expect_equal(vapply(pe$rows, function(r) r[[3]], numeric(1)), as.vector(t(coef(ref)[, target])), tolerance = 1e-5)
})

test_that('full factorial adds factor interactions but not covariate interactions', {
  dat <- mn_fixture(); dat$col_4 <- factor(rep(c('no','yes'), length.out = nrow(dat)))
  result <- mn_run(dat, list(factors = list('col_3','col_4'), model = list(mode = 'factorial')))
  ref <- nnet::multinom(factor(col_1) ~ col_2 + col_3 * col_4, dat, trace = FALSE, abstol = 1e-12, reltol = 1e-12)
  expect_equal(mn_table(result, 'output.multinom.fitTitle')$rows[[2]][[2]], ref$deviance, tolerance = 1e-5)
})

test_that('delta adjusts zero cells and Pearson scale adjusts covariance', {
  dat <- mn_fixture()
  # A zero response cell without complete separation in every group.
  dat$col_1[dat$col_3 == 'A' & dat$col_1 == 'c'] <- 'b'
  result <- mn_run(dat, list(covariates = list(), criteria = list(delta = .25), createVars = list(estimatedProbabilities = 'est')))
  counts <- table(dat$col_3, dat$col_1); counts[counts == 0] <- .25
  probs <- counts / rowSums(counts)
  est <- setNames(result$caseVars, vapply(result$caseVars, function(v) v$name, character(1)))
  for (j in 1:3) expect_equal(unlist(est[[paste0('est', j)]]$values), as.numeric(probs[as.character(dat$col_3), j]), tolerance = 1e-5)
  dat <- mn_fixture()
  result <- mn_run(dat, list(options = list(scale = 'pearson'), statistics = list(goodnessOfFit = TRUE)))
  ref <- nnet::multinom(factor(col_1) ~ col_2 + col_3, dat, trace = FALSE, Hess = TRUE, abstol = 1e-12, reltol = 1e-12)
  p <- predict(ref, type = 'probs'); y <- diag(3)[match(dat$col_1, c('a','b','c')), ]
  scale <- sum((y - p)^2 / p) / (nrow(dat) * 2 - ref$edf)
  se <- as.vector(t(summary(ref)$standard.errors)) * sqrt(scale)
  expect_equal(vapply(mn_table(result, 'output.multinom.paramTitle')$rows, function(r) r[[4]], numeric(1)), se, tolerance = 1e-5)
})

test_that('reference category (BASE=LAST / custom, ORDER=DESCENDING) matches nnet on a relevelled outcome', {
  dat <- mn_fixture()
  target <- c('(Intercept)', 'col_2', 'col_3B', 'col_3C')
  for (case in list(
    list(ref = list(category = 'last'), levels = c('c', 'a', 'b')),
    list(ref = list(category = 'custom', customValue = 'b'), levels = c('b', 'a', 'c')),
    list(ref = list(category = 'first', order = 'descending'), levels = c('c', 'b', 'a')),
    list(ref = list(category = 'last', order = 'descending'), levels = c('a', 'c', 'b'))
  )) {
    result <- mn_run(dat, list(reference = case$ref, statistics = list(classification = TRUE)))
    dd <- dat; dd$col_1 <- factor(dd$col_1, levels = case$levels)
    ref <- nnet::multinom(col_1 ~ col_2 + col_3, dd, trace = FALSE, Hess = TRUE, abstol = 1e-12, reltol = 1e-12)
    pe <- mn_table(result, 'output.multinom.paramTitle')
    expect_equal(vapply(pe$rows, function(r) r[[3]], numeric(1)), as.vector(t(coef(ref)[, target])), tolerance = 1e-5)
    expect_equal(unique(vapply(pe$rows, function(r) as.character(r[[1]]), '')), case$levels[-1])
    expect_equal(pe$footnoteKey, paste0('output.multinom.extra.reference:', case$levels[1]))
    # Category listings follow the requested order, not the reference-first fitting order.
    order <- if (identical(case$ref$order, 'descending')) c('c', 'b', 'a') else c('a', 'b', 'c')
    cs <- mn_table(result, 'output.multinom.extra.caseSummary')
    expect_equal(vapply(cs$rows[1:3], function(r) as.character(r[[1]]), ''), order)
    expect_equal(vapply(cs$rows[1:3], function(r) as.numeric(r[[2]]), 0), as.numeric(table(dat$col_1)[order]))
    cl <- mn_table(result, 'output.multinom.extra.classification')
    expect_equal(unlist(cl$columns[2:4]), order)
  }
  bad <- run_analysis_script('regression-multinomial.R', write_fixture(dat, list(dependent = 'col_1', covariates = list('col_2'), reference = list(category = 'custom', customValue = 'zz'))))
  expect_true(!isTRUE(bad$success))
  expect_true(grepl('referenceNotFound', bad$error, fixed = TRUE))
})

test_that('a numeric custom reference matches by value', {
  dat <- mn_fixture(); dat$col_1 <- match(dat$col_1, c('a', 'b', 'c'))
  result <- mn_run(dat, list(reference = list(category = 'custom', customValue = '2.0')))
  expect_equal(mn_table(result, 'output.multinom.paramTitle')$footnoteKey, 'output.multinom.extra.reference:2')
})
