// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option shapes for Linear Regression (SPSS's Statistics / Options / Plots
 * dialogs).
 *
 * Lives in shared/ for the same reason as logistic-types.ts: the dialog that
 * collects these, the SPSS-syntax builder that pastes them, and the syntax
 * dispatcher that parses pasted syntax back into an `analysis:run` payload
 * all have to agree on the shape. regression-linear.R reads the same field
 * names off `params.options` (and `params.options.plots`).
 *
 * "Exclude cases pairwise" is not offered — see regression-linear.R's header
 * comment for why (no independent reference to validate it against).
 *
 * SPSS's "Remove" method (used to drop a BLOCK's variables relative to a
 * previous block in hierarchical/blocked entry) is not offered either: this
 * dialog fits a single block, so "remove this block" has no other block to
 * remove relative to — it would just be an obscure way to spell "fit nothing".
 */

/** SPSS's Method combo, minus Remove (see the file header comment for why). */
export type RegressionMethod = 'enter' | 'forward' | 'backward' | 'stepwise'

/**
 * Stepping Method Criteria (Options dialog) — only consulted when `method`
 * is not 'enter'. SPSS's own two defaults: probability of F (Entry .05 /
 * Removal .10) or F value (Entry 3.84 / Removal 2.71).
 */
export interface RegressionCriteria {
  type: 'prob' | 'fvalue'
  entryProb: number
  removalProb: number
  entryF: number
  removalF: number
}

export const defaultRegressionCriteria: RegressionCriteria = {
  type: 'prob',
  entryProb: 0.05,
  removalProb: 0.1,
  entryF: 3.84,
  removalF: 2.71
}

export type RegressionPlotToken =
  | 'DEPENDNT'
  | 'ZPRED'
  | 'ZRESID'
  | 'DRESID'
  | 'ADJPRED'
  | 'SRESID'
  | 'SDRESID'

export const REGRESSION_PLOT_TOKENS: RegressionPlotToken[] = [
  'DEPENDNT',
  'ZPRED',
  'ZRESID',
  'DRESID',
  'ADJPRED',
  'SRESID',
  'SDRESID'
]

export interface RegressionPlotOptions {
  scatterY: RegressionPlotToken | ''
  scatterX: RegressionPlotToken | ''
  /** Histogram of the standardized residuals. */
  histogram: boolean
  /** Normal P-P plot of the standardized residuals. */
  normalPP: boolean
  /** One added-variable (partial regression) plot per predictor. */
  partialPlots: boolean
}

export const defaultRegressionPlotOptions: RegressionPlotOptions = {
  scatterY: '',
  scatterX: '',
  histogram: false,
  normalPP: false,
  partialPlots: false
}

export interface RegressionOptions {
  method: RegressionMethod
  criteria: RegressionCriteria
  collinearity: boolean
  durbinWatson: boolean
  confidenceIntervals: boolean
  /** Confidence level in percent, as SPSS's dialog shows it. */
  ciLevel: number
  covarianceMatrix: boolean
  rSquaredChange: boolean
  descriptives: boolean
  partialCorrelations: boolean
  casewiseDiagnostics: boolean
  /** true = only |Std. Residual| beyond casewiseSD; false = all cases. */
  casewiseOutliersOnly: boolean
  casewiseSD: number
  includeConstant: boolean
  missingMethod: 'listwise' | 'mean'
  plots: RegressionPlotOptions
}

export const defaultRegressionOptions: RegressionOptions = {
  method: 'enter',
  criteria: defaultRegressionCriteria,
  collinearity: false,
  durbinWatson: false,
  confidenceIntervals: false,
  ciLevel: 95,
  covarianceMatrix: false,
  rSquaredChange: false,
  descriptives: false,
  partialCorrelations: false,
  casewiseDiagnostics: false,
  casewiseOutliersOnly: true,
  casewiseSD: 3,
  includeConstant: true,
  missingMethod: 'listwise',
  plots: defaultRegressionPlotOptions
}
