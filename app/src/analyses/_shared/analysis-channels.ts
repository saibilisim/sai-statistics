// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dialog Recall (SPSS-style): maps each analysisId (the same string every
 * dialog already passes as `run()`'s payload.analysisId) to the menu channel
 * that reopens its dialog. Built once, by hand, from App.tsx's
 * `menu:analyze:*`/`menu:graphs:*` switch — kept here instead of scattering a
 * channel string into all ~54 dialog files' `run()` calls, since the
 * analysisId already uniquely identifies each dialog (including its
 * frequentist/Bayesian variant).
 *
 * A missing entry just means that analysis's run won't be recorded for
 * Dialog Recall (useRunAnalysis.ts no-ops silently) — not a crash.
 */
export const ANALYSIS_ID_TO_CHANNEL: Record<string, string> = {
  caseSummaries: 'menu:analyze:case-summaries',
  olapCubes: 'menu:analyze:olap-cubes',
  reportSummaries: 'menu:analyze:report-summaries',
  reportColumns: 'menu:analyze:report-columns',
  descriptives: 'menu:analyze:descriptives',
  frequencies: 'menu:analyze:frequencies',
  explore: 'menu:analyze:explore',
  crosstabs: 'menu:analyze:crosstabs',
  ttest1: 'menu:analyze:onesample-ttest',
  bayesTTest1: 'menu:analyze:bayes-ttest-onesample',
  ttestInd: 'menu:analyze:independent-ttest',
  bayesTTestInd: 'menu:analyze:bayes-ttest-independent',
  ttestPaired: 'menu:analyze:paired-ttest',
  bayesTTestPaired: 'menu:analyze:bayes-ttest-paired',
  anova: 'menu:analyze:oneway-anova',
  bayesAnova: 'menu:analyze:bayes-anova',
  proportionsOne: 'menu:analyze:proportions-one',
  proportionsIndep: 'menu:analyze:proportions-independent',
  proportionsPaired: 'menu:analyze:proportions-paired',
  correlate: 'menu:analyze:correlate-bivariate',
  bayesCorrelate: 'menu:analyze:bayes-correlation',
  partialCorr: 'menu:analyze:correlate-partial',
  regression: 'menu:analyze:regression-linear',
  bayesRegression: 'menu:analyze:bayes-regression',
  logistic: 'menu:analyze:regression-logistic',
  curve: 'menu:analyze:regression-curve',
  nparMW: 'menu:analyze:npar-2indep',
  nparKW: 'menu:analyze:npar-kindep',
  nparWilcoxon: 'menu:analyze:npar-2related',
  nparFriedman: 'menu:analyze:npar-krelated',
  nparChiSq: 'menu:analyze:npar-chisquare',
  nparBinomial: 'menu:analyze:npar-binomial',
  nparRuns: 'menu:analyze:npar-runs',
  nparKS: 'menu:analyze:npar-ks',
  roc: 'menu:analyze:roc',
  rocAnalysis: 'menu:analyze:roc-analysis',
  survivalKM: 'menu:analyze:survival-km',
  survivalCox: 'menu:analyze:survival-cox',
  reliability: 'menu:analyze:reliability',
  means: 'menu:analyze:means',
  glmUni: 'menu:analyze:glm-univariate',
  glmMulti: 'menu:analyze:glm-multivariate',
  glmRep: 'menu:analyze:glm-repeated',
  factor: 'menu:analyze:factor',
  kmeans: 'menu:analyze:kmeans',
  hier: 'menu:analyze:hierarchical',
  discriminant: 'menu:analyze:discriminant',
  knn: 'menu:analyze:knn',
  tree: 'menu:analyze:tree',
  multinom: 'menu:analyze:regression-multinomial',
  ordinal: 'menu:analyze:regression-ordinal',
  probit: 'menu:analyze:regression-probit',
  distances: 'menu:analyze:distances',
  genlin: 'menu:analyze:genlin',
  mixed: 'menu:analyze:mixed-models',
  gee: 'menu:analyze:gee',
  mds: 'menu:analyze:mds',
  lifetab: 'menu:analyze:life-tables',
  ratio: 'menu:analyze:ratio',
  mr: 'menu:analyze:multiple-response',
  missing: 'menu:analyze:missing-values',
  power: 'menu:analyze:power',
  glmm: 'menu:analyze:glmm',
  mi: 'menu:analyze:mi',
  'chart-scatter': 'menu:graphs:scatter',
  'chart-bar': 'menu:graphs:bar',
  'chart-line': 'menu:graphs:line',
  'chart-histogram': 'menu:graphs:histogram',
  'chart-boxplot': 'menu:graphs:boxplot',
  'chart-pp': 'menu:graphs:pp',
  'chart-qq': 'menu:graphs:qq'
}
