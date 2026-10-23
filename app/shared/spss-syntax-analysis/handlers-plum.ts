// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { defaultOrdinalSettings, validOrdinalSettings } from '../ordinal-schema'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import { parseList, resolveVars, splitTopLevel } from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

/** Strict PLUM subset: never silently discard a requested model or option. */
export async function runOrdinal(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const invalid = (): SyntaxLogEntry[] => [{ level: 'error', key: 'terminal.log.plumSyntax' }]
  const segments = splitTopLevel(st.body, '/')
  const header = /^\s*(\S+)(?:\s+BY\s+(.+?))?(?:\s+WITH\s+(.+?))?\s*$/i.exec(segments[0] ?? '')
  if (!header) return invalid()
  const dep = resolveVars([header[1] ?? ''], ctx.variables)
  const factors = resolveVars(parseList(header[2] ?? ''), ctx.variables)
  const covs = resolveVars(parseList(header[3] ?? ''), ctx.variables)
  const unknown = [...dep.unknown, ...factors.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  const d = dep.resolved[0]
  if (!d) return invalid()
  const predictors = [...factors.resolved, ...covs.resolved]
  if (new Set([d.colId, ...predictors.map(v => v.colId)]).size !== predictors.length + 1)
    return invalid()
  const s = structuredClone(defaultOrdinalSettings)
  const createVars: Record<string, string> = {}
  const seen = new Set<string>()
  for (const segment of segments.slice(1)) {
    const match = /^\s*(\w+)\s*=?\s*(.*?)\s*$/s.exec(segment)
    if (!match) return invalid()
    const key = (match[1] ?? '').toUpperCase(),
      body = match[2] ?? ''
    if (seen.has(key)) return invalid()
    seen.add(key)
    if (key === 'LINK') {
      const link = body.toLowerCase() === 'nloglog' ? 'loglog' : body.toLowerCase()
      if (!['logit', 'probit', 'cloglog', 'loglog', 'cauchit'].includes(link)) return invalid()
      s.options.link = link as typeof s.options.link
    } else if (key === 'LOCATION' || key === 'SCALE') {
      const terms: string[][] = []
      for (const term of body.trim() ? body.trim().split(/\s+/) : []) {
        const vars = resolveVars(term.split('*'), predictors)
        if (vars.unknown.length) return [unknownVarsError(vars.unknown)]
        terms.push(vars.resolved.map(v => v.colId))
      }
      if (key === 'LOCATION') s.location = { mode: 'custom', terms }
      else s.scale = { terms }
    } else if (key === 'CRITERIA') {
      const keys = {
        CIN: 'ciLevel',
        DELTA: 'delta',
        MXITER: 'maxIterations',
        MXSTEP: 'maxStepHalving',
        LCONVERGE: 'logLikelihood',
        PCONVERGE: 'parameter',
        SINGULAR: 'singularity'
      } as const
      const errors: string[] = []
      const rest = body.replace(/(\w+)\s*\(\s*([^()]+)\s*\)/g, (_, word: string, raw: string) => {
        const option = (keys as Partial<Record<string, (typeof keys)[keyof typeof keys]>>)[
          word.toUpperCase()
        ]
        if (!option || !Number.isFinite(Number(raw))) errors.push(word)
        else s.options[option] = Number(raw)
        return ''
      })
      if (errors.length || rest.trim()) return invalid()
    } else if (key === 'PRINT') {
      const keys = {
        FIT: 'goodnessOfFit',
        PARAMETER: 'estimates',
        SUMMARY: 'summary',
        CORB: 'correlations',
        COVB: 'covariances',
        CELLINFO: 'cellInfo',
        TPARALLEL: 'parallelLines'
      } as const
      for (const option of Object.values(keys)) s.output[option] = false
      let words = body.toUpperCase()
      const history = /\bHISTORY(?:\s*\(\s*(\d+)\s*\))?/.exec(words)
      if (history) {
        s.output.history = true
        s.output.historyEvery = Number(history[1] ?? 1)
        words = words.replace(history[0], '')
      }
      for (const word of words.trim() ? words.trim().split(/\s+/) : []) {
        if (word === 'KERNEL') s.output.includeConstant = false
        else if (word in keys) s.output[keys[word as keyof typeof keys]] = true
        else return invalid()
      }
    } else if (key === 'SAVE') {
      const keys = {
        ESTPROB: ['estimatedProbabilities', 'est'],
        PREDCAT: ['predictedGroup', 'pgr'],
        PCPROB: ['probability', 'pre'],
        ACPROB: ['actualProbability', 'acp']
      } as const
      const errors: string[] = []
      const rest = body.replace(
        /(\w+)(?:\s*\(\s*([A-Za-z][A-Za-z0-9_.]*)\s*\))?/g,
        (_, word: string, name?: string) => {
          const option = (keys as Partial<Record<string, (typeof keys)[keyof typeof keys]>>)[
            word.toUpperCase()
          ]
          if (!option) errors.push(word)
          else createVars[option[0]] = name ?? option[1]
          return ''
        }
      )
      if (errors.length || rest.trim()) return invalid()
    } else return invalid()
  }
  if (
    !validOrdinalSettings(
      s,
      predictors.map(v => v.colId)
    )
  )
    return invalid()
  await ctx.runAnalysis({
    analysisId: 'ordinal',
    scriptFile: 'regression-ordinal.R',
    params: {
      dependent: d.colId,
      dependentName: d.label || d.name,
      dependentValueLabels: d.valueLabels,
      covariates: covs.resolved.map(v => v.colId),
      factors: factors.resolved.map(v => v.colId),
      varNames: Object.fromEntries(predictors.map(v => [v.colId, v.label || v.name])),
      settings: s,
      createVars
    }
  })
  return [dispatchedToOutput('PLUM', [d, ...predictors])]
}
