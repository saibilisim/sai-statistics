// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { defaultOrdinalSettings, validOrdinalSettings } from '@shared/ordinal-schema'
import { type OrdinalSettings } from '@shared/ordinal-types'

type Var = { name: string; colId?: string }
export function ordinalSyntax(
  dep: Var[],
  covariates: Var[],
  factors: Var[] = [],
  settings?: OrdinalSettings,
  saved: Record<string, string> = {}
): string | null {
  const d = dep[0]
  if (!d) return null
  const s = settings ?? defaultOrdinalSettings
  const predictors = [...factors, ...covariates]
  if (
    !validOrdinalSettings(
      s,
      predictors.map(v => v.colId ?? v.name)
    )
  )
    return null
  const terms = (items: string[][]) =>
    items
      .map(term => term.map(id => predictors.find(v => (v.colId ?? v.name) === id)?.name).join('*'))
      .join(' ')
  const o = s.options
  const print = [
    s.output.goodnessOfFit && 'FIT',
    s.output.estimates && 'PARAMETER',
    s.output.summary && 'SUMMARY',
    s.output.correlations && 'CORB',
    s.output.covariances && 'COVB',
    s.output.cellInfo && 'CELLINFO',
    s.output.parallelLines && 'TPARALLEL',
    s.output.history && `HISTORY(${String(s.output.historyEvery)})`,
    !s.output.includeConstant && 'KERNEL'
  ].filter(Boolean)
  const lines = [
    `PLUM ${d.name}${factors.length ? ` BY ${factors.map(v => v.name).join(' ')}` : ''}${covariates.length ? ` WITH ${covariates.map(v => v.name).join(' ')}` : ''}`,
    `  /LINK=${o.link === 'loglog' ? 'NLOGLOG' : o.link.toUpperCase()}`
  ]
  if (settings) {
    lines.push(
      `  /CRITERIA=CIN(${String(o.ciLevel)}) DELTA(${String(o.delta)}) MXITER(${String(o.maxIterations)}) MXSTEP(${String(o.maxStepHalving)}) LCONVERGE(${String(o.logLikelihood)}) PCONVERGE(${String(o.parameter)}) SINGULAR(${String(o.singularity)})`
    )
    if (s.location.mode === 'custom') lines.push(`  /LOCATION=${terms(s.location.terms)}`)
    if (s.scale.terms.length) lines.push(`  /SCALE=${terms(s.scale.terms)}`)
  }
  lines.push(`  /PRINT=${print.join(' ')}`)
  const saveKeys: Record<string, string> = {
    estimatedProbabilities: 'ESTPROB',
    predictedGroup: 'PREDCAT',
    probability: 'PCPROB',
    actualProbability: 'ACPROB'
  }
  const saves = Object.entries(saved)
    .filter(([key]) => key in saveKeys)
    .map(([key, name]) => `${saveKeys[key] ?? ''}(${name})`)
  if (saves.length) lines.push(`  /SAVE=${saves.join(' ')}`)
  return `${lines.join('\n')}.`
}
