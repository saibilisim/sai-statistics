// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { defaultMultinomialSettings, type MultinomialSettings } from '@shared/multinomial-types'

interface SyntaxVariable {
  name: string
  colId?: string
}
export function buildMultinomialSyntax(
  dep: SyntaxVariable[],
  covariates: SyntaxVariable[],
  factors: SyntaxVariable[] = [],
  settings: MultinomialSettings = defaultMultinomialSettings,
  createVars: Record<string, string> = {},
  variables: SyntaxVariable[] = []
): string | null {
  const d = dep[0]
  if (!d) return null
  const { model: m, options: o, criteria: c, statistics: s, reference: r } = settings
  const custom = r.customValue.trim()
  const base =
    r.category === 'custom'
      ? /^-?\d+(\.\d+)?$/.test(custom)
        ? custom
        : `'${custom.replace(/'/g, "''")}'`
      : r.category.toUpperCase()
  const all = [...variables, ...dep, ...factors, ...covariates]
  const name = (id: string) => all.find(v => v.colId === id)?.name ?? id
  const term = (ids: string[]) => ids.map(name).join('*')
  const list = (vars: SyntaxVariable[]) => vars.map(v => v.name).join(' ')
  const methods = {
    forward: 'FORWARD',
    backward: 'BACKWARD',
    forwardStepwise: 'FSTEP',
    backwardStepwise: 'BSTEP'
  }
  const rules = { all: 'SINGLE', factors: 'SFACTOR', containment: 'CONTAINMENT', none: 'NONE' }
  const lines = [
    `NOMREG ${d.name} (BASE=${base} ORDER=${r.order.toUpperCase()})${factors.length ? ` BY ${list(factors)}` : ''}${covariates.length ? ` WITH ${list(covariates)}` : ''}`
  ]
  lines.push(`/INTERCEPT=${m.intercept ? 'INCLUDE' : 'EXCLUDE'}`)
  if (m.mode === 'factorial') lines.push('/FULLFACTORIAL')
  else if (m.mode === 'custom')
    lines.push(
      `/MODEL=${m.forced.map(term).join(' ')}${m.stepped.length ? ` ${methods[m.method]}=${m.stepped.map(term).join(' ')}` : ''}`
    )
  else lines.push('/MODEL')
  lines.push(
    `/CRITERIA=CIN(${String(s.ciLevel)}) MXITER(${String(c.maxIterations)}) MXSTEP(${String(c.maxStepHalving)}) LCONVERGE(${String(c.logLikelihood)}) PCONVERGE(${String(c.parameter)}) SINGULAR(${String(c.singularity)}) DELTA(${String(c.delta)}) CHKSEP(${String(c.checkSeparation ? c.separationStart : c.maxIterations + 1)})`
  )
  lines.push(
    `/STEPWISE=PIN(${String(o.entryProbability)}) POUT(${String(o.removalProbability)}) ENTRYMETHOD(${o.entryTest.toUpperCase()}) REMOVALMETHOD(${o.removalTest.toUpperCase()}) MINEFFECT(${String(o.minEffects)})${o.maxEffects === null ? '' : ` MAXEFFECT(${String(o.maxEffects)})`} RULE(${rules[o.hierarchy]})`
  )
  lines.push(
    `/SCALE=${o.scale === 'none' ? '1' : o.scale === 'fixed' ? String(o.scaleValue) : o.scale.toUpperCase()}`
  )
  const flags = {
    caseSummary: 'CPS',
    pseudoR2: 'SUMMARY',
    stepSummary: 'STEP',
    modelFit: 'MFI',
    informationCriteria: 'IC',
    cellProbabilities: 'CELLPROB',
    classification: 'CLASSTABLE',
    goodnessOfFit: 'FIT',
    monotonicity: 'ASSOCIATION',
    estimates: 'PARAMETER',
    likelihoodRatio: 'LRT',
    correlations: 'CORB',
    covariances: 'COVB'
  } as const
  const print = Object.entries(flags)
    .filter(([key]) => s[key as keyof typeof flags])
    .map(([, value]) => value as string)
  if (c.printHistory) print.push(`HISTORY(${String(c.historyEvery)})`)
  lines.push(`/PRINT=${print.length ? print.join(' ') : 'NONE'}`)
  if (s.subpopulationMode === 'custom')
    lines.push(`/SUBPOP=${s.subpopulations.map(name).join(' ')}`)
  const saves = {
    predictedGroup: 'PREDCAT',
    probability: 'PCPROB',
    actualProbability: 'ACPROB',
    estimatedProbabilities: 'ESTPROB'
  }
  const save = Object.entries(createVars)
    .filter(([key, value]) => key in saves && /^[A-Za-z][A-Za-z0-9_.]*$/.test(value))
    .map(([key, value]) => `${saves[key as keyof typeof saves]}(${value})`)
  if (save.length) lines.push(`/SAVE=${save.join(' ')}`)
  if (settings.exportModel.path)
    lines.push(
      `/OUTFILE=${settings.exportModel.covariance ? 'MODEL' : 'PARAMETER'}('${settings.exportModel.path.replace(/'/g, "''")}')`
    )
  return lines.join('\n  ') + '.'
}
