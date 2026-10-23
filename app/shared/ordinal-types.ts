// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/** PLUM settings shared by the dialog and syntax dispatcher. */
export interface OrdinalSettings {
  location: { mode: 'main' | 'custom'; terms: string[][] }
  scale: { terms: string[][] }
  options: {
    maxIterations: number
    maxStepHalving: number
    logLikelihood: number
    parameter: number
    ciLevel: number
    delta: number
    singularity: number
    link: 'logit' | 'probit' | 'cloglog' | 'loglog' | 'cauchit'
  }
  output: {
    history: boolean
    historyEvery: number
    goodnessOfFit: boolean
    summary: boolean
    estimates: boolean
    correlations: boolean
    covariances: boolean
    cellInfo: boolean
    parallelLines: boolean
    includeConstant: boolean
  }
}
