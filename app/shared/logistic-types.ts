// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option shapes for Binary Logistic Regression (SPSS's Options dialog).
 *
 * Lives in shared/ for the same reason as survival-types.ts: the dialog that
 * collects these, the SPSS-syntax builder that pastes them, and the syntax
 * dispatcher that parses pasted syntax back into an `analysis:run` payload
 * all have to agree on the shape. regression-logistic.R reads the same field
 * names off `params.options`.
 *
 * Two SPSS Options fields are deliberately NOT modelled here:
 *   - "Conserve memory for complex analyses or large datasets" is a pure
 *     performance hint in SPSS with no effect on the reported numbers — there
 *     is nothing for a checkbox to wire up to.
 *   - "Probability for Stepwise" (Entry/Removal) and "Display: at each/last
 *     step" only mean something when the model is fit by forward/backward
 *     stepwise selection. This dialog has no method selector at all (SPSS's
 *     Enter is the only method implemented) — shipping disabled fields for a
 *     mode that can never be entered is worse than not having them.
 */
export interface LogisticOptions {
  /** Overlaid histogram of predicted probability by observed group. */
  classificationPlots: boolean
  /** Hosmer-Lemeshow goodness-of-fit test (plus its decile contingency table). */
  hosmerLemeshow: boolean
  /** List cases whose residual is unusual, or all cases. */
  casewiseListing: boolean
  /** true = only |ZResid| beyond casewiseThreshold std. dev.; false = all cases. */
  casewiseOutliersOnly: boolean
  casewiseThreshold: number
  /** Correlation matrix of the parameter estimates. */
  correlation: boolean
  /** -2 log likelihood at each IRLS iteration. */
  iterationHistory: boolean
  ciExpB: boolean
  /** Confidence level in percent, as SPSS's dialog shows it. */
  ciLevel: number
  /** Probability above which a case is classified into the higher category. */
  classificationCutoff: number
  maxIterations: number
  includeConstant: boolean
}

export const defaultLogisticOptions: LogisticOptions = {
  classificationPlots: false,
  hosmerLemeshow: false,
  casewiseListing: false,
  casewiseOutliersOnly: true,
  casewiseThreshold: 2,
  correlation: false,
  iterationHistory: false,
  ciExpB: false,
  ciLevel: 95,
  classificationCutoff: 0.5,
  maxIterations: 20,
  includeConstant: true
}
