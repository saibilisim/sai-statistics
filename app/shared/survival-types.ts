// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Option shapes for the Survival procedures (Kaplan-Meier, Cox Regression).
 *
 * These live in shared/ rather than beside the dialogs because three places
 * have to agree on them: the dialog that collects them, the SPSS-syntax
 * builder that pastes them, and the syntax dispatcher that parses a pasted
 * command back into an `analysis:run` payload. A copy per consumer is exactly
 * how the KM "Compare Factor" mode and its syntax keyword would drift apart.
 *
 * The R scripts read the same field names off `params` (survival-km.R,
 * survival-cox.R); the values are plain JSON, validated on the R side by the
 * scripts' own `%in% names(df)` / `on_flag()` guards.
 */

// ── Kaplan-Meier ─────────────────────────────────────────────────────────────

/**
 * SPSS's "Compare Factor" radio group. `pooled` and `pairwise` reduce to the
 * plain overall / pairwise tests when no stratum variable is set; the two
 * `…PerStratum` modes need one and the script warns if it is missing.
 */
export const KM_COMPARE_MODES = ['pooled', 'perStratum', 'pairwise', 'pairwisePerStratum'] as const
export type KmCompareMode = (typeof KM_COMPARE_MODES)[number]

export interface KaplanMeierOptions {
  /** Which of the three weighted log-rank tests to report. */
  compare: {
    logRank: boolean
    /** Gehan-Breslow — weights each event time by the number still at risk. */
    breslow: boolean
    /** Tarone-Ware — weights by the square root of the number at risk. */
    taroneWare: boolean
    mode: KmCompareMode
  }
  stats: {
    /** One row per case: time, status, S(t), SE, cumulative events, N left. */
    survivalTable: boolean
    meanMedian: boolean
    quartiles: boolean
  }
  plots: {
    survival: boolean
    oneMinusSurvival: boolean
    hazard: boolean
    logSurvival: boolean
  }
}

export const defaultKaplanMeierOptions: KaplanMeierOptions = {
  compare: { logRank: true, breslow: false, taroneWare: false, mode: 'pooled' },
  stats: { survivalTable: false, meanMedian: true, quartiles: false },
  plots: { survival: true, oneMinusSurvival: false, hazard: false, logSurvival: false }
}

// ── Cox Regression ───────────────────────────────────────────────────────────

/** SPSS's seven contrast codings for a categorical covariate. */
export const COX_CONTRASTS = [
  'indicator',
  'simple',
  'deviation',
  'difference',
  'helmert',
  'repeated',
  'polynomial'
] as const
export type CoxContrast = (typeof COX_CONTRASTS)[number]

export const COX_METHODS = [
  'enter',
  'forwardLR',
  'forwardWald',
  'backwardLR',
  'backwardWald'
] as const
export type CoxMethod = (typeof COX_METHODS)[number]

export interface CoxCategoricalSpec {
  contrast: CoxContrast
  /** Which category the contrast is taken against (ignored by polynomial). */
  reference: 'first' | 'last'
}

export interface CoxPlotOptions {
  survival: boolean
  hazard: boolean
  logMinusLog: boolean
  oneMinusSurvival: boolean
  /** colId of a categorical covariate to draw one line per category for. */
  separateBy: string | null
  /** colId → the value a scale covariate is pinned to instead of its mean. */
  values: Record<string, number>
}

export interface CoxOptions {
  ciExpB: boolean
  /** Confidence level in percent, as SPSS's dialog shows it. */
  ciLevel: number
  correlation: boolean
  /** Print the baseline cumulative hazard / survival table. */
  baseline: boolean
  /**
   * Grambsch-Therneau test of the proportional-hazards assumption. Not an
   * SPSS option — SPSS asks you to read a log-minus-log plot instead — but it
   * is the formal test for the assumption the whole model rests on.
   */
  phTest: boolean
  display: 'each' | 'last'
  entry: number
  removal: number
  maxIterations: number
}

export const defaultCoxOptions: CoxOptions = {
  ciExpB: true,
  ciLevel: 95,
  correlation: false,
  baseline: false,
  phTest: false,
  display: 'last',
  entry: 0.05,
  removal: 0.1,
  maxIterations: 20
}

export const defaultCoxPlotOptions: CoxPlotOptions = {
  survival: false,
  hazard: false,
  logMinusLog: false,
  oneMinusSurvival: false,
  separateBy: null,
  values: {}
}
