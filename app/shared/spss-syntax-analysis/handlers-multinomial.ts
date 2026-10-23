// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import { parseList, resolveVars, splitTopLevel } from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'
import { defaultMultinomialSettings } from '../multinomial-types'

export async function dispatchMultinomial(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const segments = splitTopLevel(st.body, '/')
  const rawHead = segments.shift() ?? ''
  const keywords = /\(([^)]*)\)/.exec(rawHead)?.[1] ?? ''
  const head = rawHead.replace(/\([^)]*\)/g, '').trim()
  const depName = /^([A-Za-z_]\w*)/.exec(head)?.[1]
  const factorNames = /\bBY\s+([\s\S]*?)(?=\bWITH\b|$)/i.exec(head)?.[1] ?? ''
  const covNames = /\bWITH\s+([\s\S]*)/i.exec(head)?.[1] ?? ''
  const dep = resolveVars(depName ? [depName] : [], ctx.variables)
  const factors = resolveVars(parseList(factorNames), ctx.variables)
  const covs = resolveVars(parseList(covNames), ctx.variables)
  const unknown = [...dep.unknown, ...factors.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  const d = dep.resolved[0]
  if (!d) return [{ level: 'error', key: 'terminal.log.nomregSyntax' }]
  const settings = structuredClone(defaultMultinomialSettings)
  // dep (BASE=FIRST|LAST|value ORDER=ASCENDING|DESCENDING); SPSS's defaults are LAST/ASCENDING.
  const baseRaw = /\bBASE\s*=\s*('(?:[^']|'')*'|"[^"]*"|[^\s)]+)/i.exec(keywords)?.[1]
  if (baseRaw) {
    const upper = baseRaw.toUpperCase()
    if (upper === 'FIRST' || upper === 'LAST')
      settings.reference.category = upper.toLowerCase() as 'first' | 'last'
    else {
      settings.reference.category = 'custom'
      settings.reference.customValue = /^['"]/.test(baseRaw)
        ? baseRaw.slice(1, -1).replace(/''/g, "'")
        : baseRaw
    }
  }
  if (/\bORDER\s*=\s*DESCENDING\b/i.test(keywords)) settings.reference.order = 'descending'
  const sub = new Map(
    segments.map(seg => {
      const match = /^\s*(\w+)\s*=?\s*([\s\S]*)$/.exec(seg)
      return [match?.[1]?.toUpperCase() ?? '', match?.[2]?.trim() ?? '']
    })
  )
  const allowed = [
    'MODEL',
    'INTERCEPT',
    'CRITERIA',
    'STEPWISE',
    'SCALE',
    'PRINT',
    'SUBPOP',
    'SAVE',
    'OUTFILE',
    'FULLFACTORIAL'
  ]
  if ([...sub.keys()].some(key => !allowed.includes(key)))
    return [{ level: 'error', key: 'terminal.log.nomregSyntax' }]
  const num = (body: string, key: string, fallback: number) => {
    const raw = new RegExp(`\\b${key}\\s*\\(([^)]+)\\)`, 'i').exec(body)?.[1]
    return raw === undefined ? fallback : Number(raw)
  }
  const word = (body: string, key: string) =>
    new RegExp(`\\b${key}\\s*\\(([^)]+)\\)`, 'i').exec(body)?.[1]?.trim().toUpperCase()
  if (sub.has('INTERCEPT'))
    settings.model.intercept = sub.get('INTERCEPT')?.toUpperCase() !== 'EXCLUDE'
  if (sub.has('FULLFACTORIAL')) settings.model.mode = 'factorial'
  const model = sub.get('MODEL') ?? ''
  if (model) {
    settings.model.mode = 'custom'
    const method = /\b(FORWARD|BACKWARD|FSTEP|BSTEP)\s*=/i.exec(model)
    const parseTerms = (text: string): string[][] =>
      text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(term => {
          const resolved = resolveVars(term.split('*'), ctx.variables)
          unknown.push(...resolved.unknown)
          return resolved.resolved.map(v => v.colId)
        })
    settings.model.forced = parseTerms(method ? model.slice(0, method.index) : model)
    if (method) {
      settings.model.stepped = parseTerms(model.slice(method.index + method[0].length))
      settings.model.method = (
        {
          FORWARD: 'forward',
          BACKWARD: 'backward',
          FSTEP: 'forwardStepwise',
          BSTEP: 'backwardStepwise'
        } as const
      )[method[1]?.toUpperCase() as 'FORWARD']
    }
  } else if (
    sub.has('MODEL') &&
    (sub.get('MODEL') ?? '') === '' &&
    sub.has('INTERCEPT') &&
    sub.get('INTERCEPT') === 'EXCLUDE' &&
    !factors.resolved.length &&
    !covs.resolved.length
  ) {
    settings.model.mode = 'custom'
  }
  const criteria = sub.get('CRITERIA') ?? ''
  const c = settings.criteria
  c.maxIterations = num(criteria, 'MXITER', c.maxIterations)
  c.maxStepHalving = num(criteria, 'MXSTEP', c.maxStepHalving)
  c.logLikelihood = num(criteria, 'LCONVERGE', c.logLikelihood)
  c.parameter = num(criteria, 'PCONVERGE', c.parameter)
  c.singularity = num(criteria, 'SINGULAR', c.singularity)
  c.delta = num(criteria, 'DELTA', c.delta)
  c.separationStart = num(criteria, 'CHKSEP', c.separationStart)
  c.checkSeparation = c.separationStart <= c.maxIterations
  settings.statistics.ciLevel = num(criteria, 'CIN', 95)
  const step = sub.get('STEPWISE') ?? ''
  const o = settings.options
  o.entryProbability = num(step, 'PIN', o.entryProbability)
  o.removalProbability = num(step, 'POUT', o.removalProbability)
  o.minEffects = num(step, 'MINEFFECT', o.minEffects)
  if (/MAXEFFECT/i.test(step)) o.maxEffects = num(step, 'MAXEFFECT', 0)
  if (word(step, 'ENTRYMETHOD') === 'SCORE') o.entryTest = 'score'
  if (word(step, 'REMOVALMETHOD') === 'WALD') o.removalTest = 'wald'
  const hierarchyRules: Record<string, typeof o.hierarchy> = {
    SINGLE: 'all',
    SFACTOR: 'factors',
    CONTAINMENT: 'containment',
    NONE: 'none'
  }
  o.hierarchy = hierarchyRules[word(step, 'RULE') ?? 'SINGLE'] ?? 'all'
  const scale = sub.get('SCALE')?.toUpperCase()
  if (scale === 'DEVIANCE' || scale === 'PEARSON')
    o.scale = scale.toLowerCase() as 'deviance' | 'pearson'
  else if (scale) {
    o.scaleValue = Number(scale)
    o.scale = o.scaleValue === 1 ? 'none' : 'fixed'
  }
  if (sub.has('PRINT')) {
    const print = sub.get('PRINT') ?? ''
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
    for (const [key, flag] of Object.entries(flags))
      settings.statistics[key as keyof typeof flags] = new RegExp(`\\b${flag}\\b`, 'i').test(print)
    c.printHistory = /\bHISTORY\b/i.test(print)
    c.historyEvery = num(print, 'HISTORY', 1)
  }
  if (sub.has('SUBPOP')) {
    const vars = resolveVars(parseList(sub.get('SUBPOP') ?? ''), ctx.variables)
    unknown.push(...vars.unknown)
    settings.statistics.subpopulationMode = 'custom'
    settings.statistics.subpopulations = vars.resolved.map(v => v.colId)
  }
  const createVars: Record<string, string> = {}
  const save = sub.get('SAVE') ?? ''
  for (const [key, flag, fallback] of [
    ['predictedGroup', 'PREDCAT', 'pgr'],
    ['probability', 'PCPROB', 'pre'],
    ['actualProbability', 'ACPROB', 'acp'],
    ['estimatedProbabilities', 'ESTPROB', 'est']
  ] as const) {
    const match = new RegExp(`\\b${flag}(?:\\s*\\(([A-Za-z][\\w.]*)(?::\\d+)?\\))?`, 'i').exec(save)
    if (match) createVars[key] = match[1] ?? fallback
  }
  const outfile = /\b(MODEL|PARAMETER)\s*\(\s*'((?:[^']|'')*)'\s*\)/i.exec(sub.get('OUTFILE') ?? '')
  if (outfile)
    settings.exportModel = {
      path: (outfile[2] ?? '').replace(/''/g, "'"),
      covariance: outfile[1]?.toUpperCase() === 'MODEL'
    }
  if (unknown.length) return [unknownVarsError(unknown)]
  await ctx.runAnalysis({
    analysisId: 'multinom',
    scriptFile: 'regression-multinomial.R',
    params: {
      ...settings,
      dependent: d.colId,
      dependentName: d.label || d.name,
      dependentValueLabels: d.valueLabels,
      covariates: covs.resolved.map(v => v.colId),
      factors: factors.resolved.map(v => v.colId),
      varNames: Object.fromEntries(
        [...factors.resolved, ...covs.resolved].map(v => [v.colId, v.label || v.name])
      ),
      sourceNames: Object.fromEntries(
        [d, ...factors.resolved, ...covs.resolved].map(v => [v.colId, v.name])
      ),
      ...(Object.keys(createVars).length ? { createVars } : {})
    }
  })
  return [dispatchedToOutput('NOMREG', [d, ...factors.resolved, ...covs.resolved])]
}
