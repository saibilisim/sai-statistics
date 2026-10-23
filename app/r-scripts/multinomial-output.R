# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# PMML 4.4 softmax regression. Derived fields reproduce model.matrix columns,
# including dummy coding and arbitrary interactions, without executable code.
mn_pmml <- function(fit, dat, response, predictors, source_names, covariance, include_covariance) {
  esc <- function(x) {
    x <- gsub('&', '&amp;', as.character(x), fixed = TRUE)
    x <- gsub('"', '&quot;', x, fixed = TRUE)
    x <- gsub('<', '&lt;', x, fixed = TRUE)
    gsub('>', '&gt;', x, fixed = TRUE)
  }
  number <- function(x) format(x, digits = 17, scientific = TRUE, trim = TRUE)
  name <- function(id) if (!is.null(source_names[[id]])) source_names[[id]] else id
  lev <- levels(dat$.y)
  fields <- c(sprintf('<DataField name="%s" optype="categorical" dataType="string">%s</DataField>', esc(name(response)), paste(sprintf('<Value value="%s"/>', esc(lev)), collapse = '')),
    vapply(predictors, function(id) {
      if (is.factor(dat[[id]])) sprintf('<DataField name="%s" optype="categorical" dataType="string">%s</DataField>', esc(name(id)), paste(sprintf('<Value value="%s"/>', esc(levels(dat[[id]]))), collapse = ''))
      else sprintf('<DataField name="%s" optype="continuous" dataType="double"/>', esc(name(id)))
    }, character(1)))
  # model.matrix factor columns are id + level, where ids are internal safe names.
  expressions <- list()
  for (id in predictors) {
    if (is.factor(dat[[id]])) {
      for (level in levels(dat[[id]])) expressions[[paste0(id, level)]] <- sprintf('<NormDiscrete field="%s" value="%s"/>', esc(name(id)), esc(level))
    } else expressions[[id]] <- sprintf('<FieldRef field="%s"/>', esc(name(id)))
  }
  derived <- character(); names <- colnames(fit$x)
  for (j in seq_along(names)) {
    if (names[j] == '(Intercept)') next
    # Match actual products rather than splitting on ':' (factor values may
    # themselves contain ':'), using the term's model.matrix assignment.
    term <- fit$terms[fit$assign[j]]
    ids <- strsplit(term, ':', fixed = TRUE)[[1]]
    components <- lapply(ids, function(id) if (is.factor(dat[[id]])) paste0(id, levels(dat[[id]])) else id)
    combinations <- expand.grid(components, stringsAsFactors = FALSE)
    labels <- apply(combinations, 1, paste, collapse = ':')
    row <- match(names[j], labels)
    if (is.na(row)) stop('output.multinom.extra.xmlDesign')
    atoms <- vapply(as.character(combinations[row, ]), function(a) expressions[[a]], character(1))
    expression <- if (length(atoms) == 1) atoms else paste0('<Apply function="*">', paste(atoms, collapse = ''), '</Apply>')
    derived <- c(derived, sprintf('<DerivedField name="sai_design_%d" optype="continuous" dataType="double">%s</DerivedField>', j, expression))
  }
  tables <- vapply(seq_along(lev), function(k) {
    b <- if (k == 1) rep(0, ncol(fit$x)) else fit$coef[, k - 1L]
    intercept <- if ('(Intercept)' %in% names) b[match('(Intercept)', names)] else 0
    terms <- which(names != '(Intercept)')
    paste0(sprintf('<RegressionTable targetCategory="%s" intercept="%s">', esc(lev[k]), number(intercept)), paste(vapply(terms, function(j) sprintf('<NumericPredictor name="sai_design_%d" coefficient="%s"/>', j, number(b[j])), character(1)), collapse = ''), '</RegressionTable>')
  }, character(1))
  extension <- ''
  if (include_covariance) {
    # PMML allows producer-specific metadata in Extension. The ordering is
    # explicit; the scoring coefficients remain portable standard PMML.
    extension <- paste0('<Extension extender="SAI Statistics" name="parameterCovariance">',
      paste(vapply(seq_len(nrow(covariance)), function(i) sprintf('<row index="%d">%s</row>', i, paste(number(covariance[i, ]), collapse = ' ')), character(1)), collapse = ''), '</Extension>')
  }
  paste0('<?xml version="1.0" encoding="UTF-8"?>\n<PMML xmlns="http://www.dmg.org/PMML-4_4" version="4.4"><Header><Application name="SAI Statistics"/></Header>',
    sprintf('<DataDictionary numberOfFields="%d">', length(fields)), paste(fields, collapse = ''), '</DataDictionary>',
    '<RegressionModel functionName="classification" normalizationMethod="softmax" algorithmName="multinomial logistic regression">', extension,
    '<MiningSchema>', sprintf('<MiningField name="%s" usageType="target"/>', esc(name(response))), paste(sprintf('<MiningField name="%s" usageType="active"/>', esc(vapply(predictors, name, character(1)))), collapse = ''), '</MiningSchema>',
    if (length(derived)) paste0('<LocalTransformations>', paste(derived, collapse = ''), '</LocalTransformations>') else '', paste(tables, collapse = ''), '</RegressionModel></PMML>')
}

# Rank-based measures compare the fitted probability for each non-reference
# category against the reference category. Weighted counts avoid O(n^2) pairs.
mn_association <- function(prob, outcome, weight, categories) {
  rows <- list()
  for (k in 2:length(categories)) {
    keep <- outcome %in% c(1L, k)
    score <- prob[keep, k] / (prob[keep, 1L] + prob[keep, k])
    y <- outcome[keep] == k; w <- weight[keep]
    ord <- order(score); score <- score[ord]; y <- y[ord]; w <- w[ord]
    group <- cumsum(c(TRUE, diff(score) > 1e-12))
    positive <- as.vector(rowsum(w * y, group)); negative <- as.vector(rowsum(w * !y, group))
    conc <- sum(positive * (cumsum(negative) - negative))
    disc <- sum(negative * (cumsum(positive) - positive)); tied <- sum(positive * negative)
    pairs <- conc + disc + tied
    safe <- function(a, b) if (b > 0) a / b else NA_real_
    for (item in list(c('concordant', conc), c('discordant', disc), c('tied', tied),
                     c('somersD', safe(conc - disc, pairs)), c('gamma', safe(conc - disc, conc + disc)),
                     c('tauA', safe(conc - disc, sum(w) * (sum(w) - 1) / 2)), c('concordance', safe(conc + tied / 2, pairs)))) {
      rows[[length(rows) + 1L]] <- list(paste(categories[k], '/', categories[1]), paste0('output.multinom.extra.', item[1]), round(as.numeric(item[2]), 6))
    }
  }
  rows
}
