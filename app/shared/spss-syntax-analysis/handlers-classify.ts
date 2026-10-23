// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import {
  afterEquals,
  parseList,
  parseSubcommand,
  parseVariablesList,
  resolveVars,
  splitOnBy,
  splitTopLevel,
  stripQuotes
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── Classify / dimension-reduction command handlers ───────────────────────

/** DISCRIMINANT GROUPS=groupvar(min,max) /VARIABLES=predictors */
export async function runDiscriminant(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const gm = /\bGROUPS\s*=\s*([A-Za-z_]\w*)/i.exec(st.body)
  const varsWords = parseSubcommand(st.body, 'VARIABLES')
  const indepNames = varsWords ?? parseList(afterEquals(st.body, 'VARIABLES'))
  const grp = gm ? resolveVars([gm[1] as string], ctx.variables) : { resolved: [], unknown: [] }
  const indeps = resolveVars(indepNames, ctx.variables)
  const unknown = [...grp.unknown, ...indeps.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (grp.resolved.length === 0 || indeps.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.discriminantSyntax' }]
  const g = grp.resolved[0] as Variable

  await ctx.runAnalysis({
    analysisId: 'discriminant',
    scriptFile: 'discriminant.R',
    params: {
      groupVar: g.colId,
      groupName: g.name,
      independents: indeps.resolved.map(v => v.colId),
      varNames: Object.fromEntries(indeps.resolved.map(v => [v.colId, v.name]))
    }
  })
  return [dispatchedToOutput('DISCRIMINANT', [g, ...indeps.resolved])]
}

/** QUICK CLUSTER varlist [/CRITERIA=CLUSTER(n)] */
export async function runQuickCluster(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = splitTopLevel(st.body, '/')[0] ?? st.body
  const { resolved, unknown } = resolveVars(parseList(listPart), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]
  const clusterM = /CRITERIA\s*=\s*[^/]*?CLUSTER\s*\(\s*(\d+)\s*\)/i.exec(st.body)
  const clusters = clusterM ? Number(clusterM[1]) : 2

  await ctx.runAnalysis({
    analysisId: 'kmeans',
    scriptFile: 'kmeans.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      clusters
    }
  })
  return [dispatchedToOutput('QUICK CLUSTER', resolved)]
}

/** FACTOR VARIABLES=varlist [/ROTATION=VARIMAX|OBLIMIN|PROMAX|NOROTATE] [/PRINT=...KMO...] */
export async function runFactor(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]
  const rotWords = parseSubcommand(st.body, 'ROTATION') || []
  const rotation: 'none' | 'varimax' | 'oblimin' | 'promax' = rotWords.includes('VARIMAX')
    ? 'varimax'
    : rotWords.includes('OBLIMIN')
      ? 'oblimin'
      : rotWords.includes('PROMAX')
        ? 'promax'
        : 'none'
  const printWords = parseSubcommand(st.body, 'PRINT') || []
  const kmoBartlett = printWords.includes('KMO')

  await ctx.runAnalysis({
    analysisId: 'factor',
    scriptFile: 'factor.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      options: { rotation, kmoBartlett }
    }
  })
  return [dispatchedToOutput('FACTOR', resolved)]
}

/** CLUSTER varlist [/METHOD=WARD|BAVERAGE|SINGLE|COMPLETE] */
export async function runCluster(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = splitTopLevel(st.body, '/')[0] ?? st.body
  const { resolved, unknown } = resolveVars(parseList(listPart), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]
  const methodWords = parseSubcommand(st.body, 'METHOD') || []
  const method: 'ward.D2' | 'average' | 'single' | 'complete' = methodWords.includes('WARD')
    ? 'ward.D2'
    : methodWords.includes('SINGLE')
      ? 'single'
      : methodWords.includes('COMPLETE')
        ? 'complete'
        : 'average'

  await ctx.runAnalysis({
    analysisId: 'hier',
    scriptFile: 'hierarchical.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      method
    }
  })
  return [dispatchedToOutput('CLUSTER', resolved)]
}

/**
 * ROC varlist BY state-var(value) [/PLOT=CURVE[(REFERENCE)]|NONE]
 *   [/PRINT=SE COORDINATES] [/CRITERIA=CUTOFF(INCLUDE|EXCLUDE)
 *   TESTPOS(LARGE|SMALL) DISTRIBUTION(FREE|NEGEXPO) CI(n)] [/MISSING=EXCLUDE|INCLUDE]
 *
 * An absent /PLOT or /PRINT keeps this dispatcher's long-standing output
 * (curve with reference line, SE and CI) rather than SPSS's bare default, so
 * syntax written against earlier versions prints what it always printed.
 */
export async function runRoc(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const { left } = splitOnBy(st.body)
  const test = resolveVars(left, ctx.variables)
  const stateM = /\bBY\b\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/i.exec(st.body)
  if (test.unknown.length) return [unknownVarsError(test.unknown)]
  if (test.resolved.length === 0 || !stateM)
    return [{ level: 'error', key: 'terminal.log.rocSyntax' }]
  const stateVars = resolveVars([stateM[1] as string], ctx.variables)
  if (stateVars.unknown.length) return [unknownVarsError(stateVars.unknown)]
  const state = stateVars.resolved[0] as Variable
  const stateValue = stripQuotes((stateM[2] as string).trim())
  const critWords = parseSubcommand(st.body, 'CRITERIA') || []
  const direction: 'larger' | 'smaller' = critWords.some(w => w.includes('TESTPOS(SMALL'))
    ? 'smaller'
    : 'larger'
  const printWords = parseSubcommand(st.body, 'PRINT')
  const coordinates = (printWords ?? []).includes('COORDINATES')
  const plotWords = parseSubcommand(st.body, 'PLOT')
  const ciM = /\bCI\s*\(\s*([\d.]+)\s*\)/i.exec(st.body)
  const missingWords = parseSubcommand(st.body, 'MISSING') ?? []

  await ctx.runAnalysis({
    analysisId: 'roc',
    scriptFile: 'roc.R',
    params: {
      variables: test.resolved.map(v => v.colId),
      varNames: Object.fromEntries(test.resolved.map(v => [v.colId, v.name])),
      stateVar: state.colId,
      stateName: state.name,
      stateLabel: state.label,
      stateValueLabels: state.valueLabels,
      stateValue,
      options: {
        direction,
        coordinates,
        plotCurve: plotWords ? !plotWords.includes('NONE') : true,
        diagonal: plotWords ? plotWords.some(w => w.includes('REFERENCE')) : true,
        seCi: printWords ? printWords.includes('SE') : true,
        cutoff: critWords.some(w => w.includes('CUTOFF(EXCLUDE')) ? 'exclude' : 'include',
        distribution: critWords.some(w => w.includes('DISTRIBUTION(NEGEXPO')) ? 'negexpo' : 'free',
        ciLevel: ciM ? Number(ciM[1]) / 100 : 0.95,
        userMissingValid: missingWords.includes('INCLUDE')
      }
    }
  })
  return [dispatchedToOutput('ROC', [...test.resolved, state])]
}
