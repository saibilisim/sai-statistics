// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Factor Analysis dialog state and the `options` payload factor.R reads.
 * Numbers stay strings while typed (as in the other dialogs' number fields)
 * and are parsed once, in factorOptionParams().
 */

export type FactorRotation = 'none' | 'varimax' | 'quartimax' | 'equamax' | 'oblimin' | 'promax'
export type FactorExtraction = 'pc' | 'paf' | 'ml' | 'uls' | 'gls'

export interface FactorOptions {
  extraction: FactorExtraction
  /** Polychoric correlations for ordinal (Likert) items. */
  matrix: 'correlation' | 'polychoric'
  criterion: 'eigen' | 'fixed' | 'parallel'
  minEigen: string
  nFactors: string
  maxIter: string
  scree: boolean
  /** Parallel analysis table even when it does not decide the factor count. */
  parallel: boolean
  rotation: FactorRotation
  univariate: boolean
  correlation: boolean
  kmoBartlett: boolean
  antiImage: boolean
  sortBySize: boolean
  suppress: boolean
  suppressBelow: string
}

export const defaultFactorOptions: FactorOptions = {
  extraction: 'pc',
  matrix: 'correlation',
  criterion: 'eigen',
  minEigen: '1',
  nFactors: '2',
  maxIter: '100',
  scree: false,
  parallel: false,
  rotation: 'none',
  univariate: false,
  correlation: false,
  kmoBartlett: false,
  antiImage: false,
  sortBySize: false,
  suppress: false,
  suppressBelow: '0.30'
}

const num = (s: string, fallback: number): number => {
  const v = Number(s.replace(',', '.'))
  return Number.isFinite(v) ? v : fallback
}

/** The `options` object factor.R reads. */
export function factorOptionParams(o: FactorOptions) {
  return {
    extraction: o.extraction,
    matrix: o.matrix,
    criterion: o.criterion,
    minEigen: num(o.minEigen, 1),
    nFactors: Math.max(1, Math.round(num(o.nFactors, 1))),
    maxIter: Math.max(1, Math.round(num(o.maxIter, 100))),
    scree: o.scree,
    parallel: o.parallel,
    rotation: o.rotation,
    univariate: o.univariate,
    correlation: o.correlation,
    kmoBartlett: o.kmoBartlett,
    antiImage: o.antiImage,
    sortBySize: o.sortBySize,
    suppressBelow: o.suppress ? num(o.suppressBelow, 0.3) : null
  }
}

export type FactorOptionParams = ReturnType<typeof factorOptionParams>
