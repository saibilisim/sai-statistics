// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/** Shared by the dialog, NOMREG syntax, and regression-multinomial.R. */
/** NOMREG (BASE=… ORDER=…): which outcome category the logits are against. */
export interface MultinomialReference {
  category: 'first' | 'last' | 'custom'
  customValue: string
  order: 'ascending' | 'descending'
}
export interface MultinomialModel {
  mode: 'main' | 'factorial' | 'custom'
  intercept: boolean
  forced: string[][]
  stepped: string[][]
  method: 'forward' | 'backward' | 'forwardStepwise' | 'backwardStepwise'
}
export interface MultinomialOptions {
  scale: 'none' | 'deviance' | 'pearson' | 'fixed'
  scaleValue: number
  entryProbability: number
  removalProbability: number
  entryTest: 'lr' | 'score'
  removalTest: 'lr' | 'wald'
  minEffects: number
  maxEffects: number | null
  hierarchy: 'all' | 'factors' | 'containment' | 'none'
}
export interface MultinomialCriteria {
  maxIterations: number
  maxStepHalving: number
  logLikelihood: number
  parameter: number
  printHistory: boolean
  historyEvery: number
  checkSeparation: boolean
  separationStart: number
  delta: number
  singularity: number
}
export interface MultinomialStatistics {
  caseSummary: boolean
  pseudoR2: boolean
  stepSummary: boolean
  modelFit: boolean
  informationCriteria: boolean
  cellProbabilities: boolean
  classification: boolean
  goodnessOfFit: boolean
  monotonicity: boolean
  estimates: boolean
  likelihoodRatio: boolean
  correlations: boolean
  covariances: boolean
  ciLevel: number
  subpopulationMode: 'predictors' | 'custom'
  subpopulations: string[]
}
export interface MultinomialSettings {
  reference: MultinomialReference
  model: MultinomialModel
  options: MultinomialOptions
  criteria: MultinomialCriteria
  statistics: MultinomialStatistics
  exportModel: { path: string; covariance: boolean }
}
export const defaultMultinomialSettings: MultinomialSettings = {
  // SPSS's default: the last category in ascending order.
  reference: { category: 'last', customValue: '', order: 'ascending' },
  model: { mode: 'main', intercept: true, forced: [], stepped: [], method: 'forward' },
  options: {
    scale: 'none',
    scaleValue: 1,
    entryProbability: 0.05,
    removalProbability: 0.1,
    entryTest: 'lr',
    removalTest: 'lr',
    minEffects: 0,
    maxEffects: null,
    hierarchy: 'all'
  },
  criteria: {
    maxIterations: 100,
    maxStepHalving: 5,
    logLikelihood: 0,
    parameter: 1e-6,
    printHistory: false,
    historyEvery: 1,
    checkSeparation: true,
    separationStart: 20,
    delta: 0,
    singularity: 1e-8
  },
  statistics: {
    caseSummary: true,
    pseudoR2: true,
    stepSummary: true,
    modelFit: true,
    informationCriteria: false,
    cellProbabilities: false,
    classification: false,
    goodnessOfFit: false,
    monotonicity: false,
    estimates: true,
    likelihoodRatio: true,
    correlations: false,
    covariances: false,
    ciLevel: 95,
    subpopulationMode: 'predictors',
    subpopulations: []
  },
  exportModel: { path: '', covariance: true }
}
