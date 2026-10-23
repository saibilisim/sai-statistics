// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Cauchy prior widths behind BayesFactor's named settings, and the rule for
 * turning the dialog's choice into what `rscale` R receives.
 *
 * Data and logic live here rather than in BayesPriorSection.tsx so they can be
 * unit-tested without a JSX transform — the same split summary-stats.ts uses
 * beside its own component.
 *
 * Two things this has to get right, both learned from comparing our output
 * against SPSS 32:
 *
 * 1. A preset name is ambiguous. "medium" is r = 0.707 for a t test but 0.354
 *    for a regression coefficient — four different numbers behind one word,
 *    depending on which BayesFactor argument the value feeds. So callers pass
 *    their family and the dialog shows the number.
 * 2. The presets do not span every width worth asking for. SPSS's Rouder/JZS
 *    default is r = 1: reachable for a t test ("wide") but NOT for a regression
 *    coefficient, whose presets stop at 0.707. Reproducing a result from
 *    another package needed a number the dialog could not express, which is
 *    why "custom" exists.
 *
 * PRIOR_SCALE_VALUES mirrors `sai_bf_prior_note()` in r-scripts/_bootstrap.R.
 * R cannot import this table and TypeScript cannot import R's, so
 * tests/unit/bayes-prior.test.ts reads the R source and fails if they drift.
 */

export type PriorPreset = 'medium' | 'wide' | 'ultrawide' | 'custom'

/** Which BayesFactor argument the width feeds — it decides the numbers. */
export type PriorFamily = 'ttest' | 'correlation' | 'anovaFixed' | 'lmCont'

export interface BayesPrior {
  preset: PriorPreset
  /** Free text so the field can be cleared while typing; parsed on submit. */
  custom: string
}

export const defaultBayesPrior: BayesPrior = { preset: 'medium', custom: '1' }

export const PRIOR_SCALE_VALUES: Record<
  PriorFamily,
  Record<Exclude<PriorPreset, 'custom'>, number>
> = {
  ttest: { medium: Math.SQRT2 / 2, wide: 1, ultrawide: Math.SQRT2 },
  correlation: { medium: 1 / 3, wide: 1 / Math.sqrt(3), ultrawide: 1 },
  anovaFixed: { medium: 1 / 2, wide: Math.SQRT2 / 2, ultrawide: 1 },
  lmCont: { medium: Math.SQRT2 / 4, wide: 1 / 2, ultrawide: Math.SQRT2 / 2 }
}

/**
 * What to send as `rscale`: the preset's name, or the number for a custom
 * width. R accepts either — `sai_bf_prior_note()` labels a number "custom" and
 * BayesFactor takes it directly.
 *
 * A custom width that is not a positive finite number falls back to the default
 * preset rather than reaching R as NaN, where it would surface as an error the
 * user cannot connect to the box they typed in. A decimal comma is accepted:
 * the dialog is used on Turkish keyboards.
 */
export function bayesRscale(prior: BayesPrior): string | number {
  if (prior.preset !== 'custom') return prior.preset
  const v = Number(prior.custom.replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v : 'medium'
}

/** Whether the typed custom width is usable. Drives the inline error. */
export function isCustomWidthValid(prior: BayesPrior): boolean {
  return typeof bayesRscale({ ...prior, preset: 'custom' }) === 'number'
}
