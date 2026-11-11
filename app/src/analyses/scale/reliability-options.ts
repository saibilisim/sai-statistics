// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reliability Analysis options: the dialog state, the `options` payload
 * reliability.R reads, and the SPSS RELIABILITY subcommands both directions
 * share (builder in src/lib/spss-syntax.ts, parser in
 * shared/spss-syntax-analysis/handlers-descriptives.ts).
 */

export type ReliabilityModel = 'alpha' | 'split' | 'guttman' | 'parallel' | 'strict' | 'omega'
export type ReliabilityAnova = 'none' | 'f' | 'friedman' | 'cochran'
export type IccModel = 'oneway' | 'random' | 'mixed'
export type IccType = 'consistency' | 'absolute'

export interface ReliabilityOptions {
  model: ReliabilityModel
  interItemCorr: boolean
  hotelling: boolean
  tukey: boolean
  anova: ReliabilityAnova
  icc: { enabled: boolean; model: IccModel; type: IccType; ci: number; testValue: number }
}

export const RELIABILITY_MODELS: ReliabilityModel[] = [
  'alpha',
  'split',
  'guttman',
  'parallel',
  'strict',
  'omega'
]

export const defaultReliabilityOptions: ReliabilityOptions = {
  model: 'alpha',
  interItemCorr: false,
  hotelling: false,
  tukey: false,
  anova: 'none',
  icc: { enabled: false, model: 'mixed', type: 'consistency', ci: 95, testValue: 0 }
}

/** The payload: the original two fields always, the rest only when used. */
export function reliabilityOptionParams(o: ReliabilityOptions): Record<string, unknown> {
  const p: Record<string, unknown> = { interItemCorr: o.interItemCorr, model: o.model }
  if (o.hotelling) p.hotelling = true
  if (o.tukey) p.tukey = true
  if (o.anova !== 'none') p.anova = o.anova
  if (o.icc.enabled) p.icc = { ...o.icc }
  return p
}

const MODEL_KEYWORD: Record<ReliabilityModel, string> = {
  alpha: 'ALPHA',
  split: 'SPLIT',
  guttman: 'GUTTMAN',
  parallel: 'PARALLEL',
  strict: 'STRICTPARALLEL',
  omega: 'OMEGA'
}

export function reliabilityModelKeyword(m: ReliabilityModel): string {
  return MODEL_KEYWORD[m]
}

/** /MODEL words → model; unknown words fall back to alpha. */
export function reliabilityModelFromWords(words: readonly string[]): ReliabilityModel {
  // STRICTPARALLEL before PARALLEL: the parser splits on spaces, so they never
  // collide, but keep the order explicit.
  const order: ReliabilityModel[] = ['strict', 'parallel', 'split', 'guttman', 'omega']
  return order.find(m => words.includes(MODEL_KEYWORD[m])) ?? 'alpha'
}
