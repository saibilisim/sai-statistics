// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Factor Analysis dialog state and the `options` payload factor.R reads.
 * Numbers stay strings while typed (as in the other dialogs' number fields)
 * and are parsed once, in factorOptionParams().
 */

export type FactorRotation = 'none' | 'varimax' | 'quartimax' | 'equamax' | 'oblimin' | 'promax'
export type FactorExtraction = 'pc' | 'paf' | 'ml' | 'uls' | 'gls' | 'alpha' | 'image'
export type FactorMatrix = 'correlation' | 'polychoric' | 'covariance'
export type FactorMissing = 'listwise' | 'pairwise' | 'mean'
export type FactorScoreMethod = 'regression' | 'bartlett' | 'anderson'

/** Extractions SPSS (and factor.R) run on a covariance matrix. */
export const COVARIANCE_EXTRACTIONS: readonly FactorExtraction[] = ['pc', 'paf', 'image']

export interface FactorOptions {
  extraction: FactorExtraction
  /** Polychoric correlations for ordinal (Likert) items; covariance for pc/paf/image. */
  matrix: FactorMatrix
  criterion: 'eigen' | 'fixed' | 'parallel'
  minEigen: string
  nFactors: string
  maxIter: string
  initialSolution: boolean
  unrotated: boolean
  scree: boolean
  /** Parallel analysis table even when it does not decide the factor count. */
  parallel: boolean
  rotation: FactorRotation
  delta: string
  kappa: string
  rotationMaxIter: string
  rotatedSolution: boolean
  loadingPlot: boolean
  univariate: boolean
  correlation: boolean
  sigLevels: boolean
  determinant: boolean
  inverse: boolean
  reproduced: boolean
  kmoBartlett: boolean
  antiImage: boolean
  scoreMethod: FactorScoreMethod
  scoreCoef: boolean
  missing: FactorMissing
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
  initialSolution: true,
  unrotated: true,
  scree: false,
  parallel: false,
  rotation: 'none',
  delta: '0',
  kappa: '4',
  rotationMaxIter: '1000',
  rotatedSolution: true,
  loadingPlot: false,
  univariate: false,
  correlation: false,
  sigLevels: false,
  determinant: false,
  inverse: false,
  reproduced: false,
  kmoBartlett: false,
  antiImage: false,
  scoreMethod: 'regression',
  scoreCoef: false,
  missing: 'listwise',
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
    // A covariance matrix only goes with the methods that can factor one.
    matrix:
      o.matrix === 'covariance' && !COVARIANCE_EXTRACTIONS.includes(o.extraction)
        ? 'correlation'
        : o.matrix,
    criterion: o.criterion,
    minEigen: num(o.minEigen, 1),
    nFactors: Math.max(1, Math.round(num(o.nFactors, 1))),
    maxIter: Math.max(1, Math.round(num(o.maxIter, 100))),
    initialSolution: o.initialSolution,
    unrotated: o.unrotated,
    scree: o.scree,
    parallel: o.parallel,
    rotation: o.rotation,
    delta: num(o.delta, 0),
    kappa: num(o.kappa, 4),
    rotationMaxIter: Math.max(1, Math.round(num(o.rotationMaxIter, 1000))),
    rotatedSolution: o.rotatedSolution,
    loadingPlot: o.loadingPlot,
    univariate: o.univariate,
    correlation: o.correlation,
    sigLevels: o.sigLevels,
    determinant: o.determinant,
    inverse: o.inverse,
    reproduced: o.reproduced,
    kmoBartlett: o.kmoBartlett,
    antiImage: o.antiImage,
    scoreMethod: o.scoreMethod,
    scoreCoef: o.scoreCoef,
    missing: o.missing,
    sortBySize: o.sortBySize,
    suppressBelow: o.suppress ? num(o.suppressBelow, 0.3) : null
  }
}

export type FactorOptionParams = ReturnType<typeof factorOptionParams>
