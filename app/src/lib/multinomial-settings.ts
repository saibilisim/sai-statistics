// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { MultinomialModel, MultinomialSettings } from '@shared/multinomial-types'

export function validMultinomialSettings(s: MultinomialSettings): boolean {
  const { criteria: c, options: o, statistics: st, reference: r } = s
  const integer = (n: number, min: number) => Number.isInteger(n) && n >= min
  const finite = (n: number, min: number) => Number.isFinite(n) && n >= min
  return (
    integer(c.maxIterations, 1) &&
    integer(c.maxStepHalving, 1) &&
    finite(c.logLikelihood, 0) &&
    finite(c.parameter, 0) &&
    integer(c.historyEvery, 1) &&
    integer(c.separationStart, 0) &&
    finite(c.delta, 0) &&
    c.delta < 1 &&
    finite(c.singularity, Number.MIN_VALUE) &&
    c.singularity < 1 &&
    finite(o.scaleValue, Number.MIN_VALUE) &&
    finite(o.entryProbability, 0) &&
    o.entryProbability <= 1 &&
    finite(o.removalProbability, 0) &&
    o.removalProbability <= 1 &&
    o.entryProbability <= o.removalProbability &&
    integer(o.minEffects, 0) &&
    (o.maxEffects === null || (integer(o.maxEffects, 0) && o.maxEffects >= o.minEffects)) &&
    finite(st.ciLevel, 0) &&
    st.ciLevel < 100 &&
    (st.subpopulationMode !== 'custom' || st.subpopulations.length > 0) &&
    (r.category !== 'custom' || r.customValue.trim() !== '')
  )
}

/** Never silently drop a custom term when its variable has been removed. */
export function validMultinomialTerms(model: MultinomialModel, predictorIds: string[]): boolean {
  if (model.mode !== 'custom') return true
  const terms = [...model.forced, ...model.stepped]
  return (
    terms.length > 0 &&
    terms.every(term => term.length > 0 && term.every(id => predictorIds.includes(id)))
  )
}
