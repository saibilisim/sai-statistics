// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type {
  CoxCategoricalSpec,
  CoxMethod,
  CoxOptions,
  KaplanMeierOptions,
  KmCompareMode
} from '../survival-types'
import {
  COX_CONTRASTS,
  defaultCoxOptions,
  defaultCoxPlotOptions,
  defaultKaplanMeierOptions
} from '../survival-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import {
  methodVarList,
  parseList,
  resolveVars,
  splitOnBy,
  splitOnWith,
  splitTopLevel
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── Survival-analysis command handlers ────────────────────────────────────

/** Extract a `/STATUS[=]var [EVENT](value...)` clause shared by COXREG/KM/SURVIVAL. */
function parseStatusClause(body: string): { name: string; value: string } | null {
  const m = /\bSTATUS\s*=?\s*([A-Za-z_]\w*)\s*(?:EVENT\s*)?\(([^)]*)\)/i.exec(body)
  if (!m) return null
  return { name: m[1] as string, value: (parseList(m[2] as string)[0] ?? '').trim() }
}

/** `/STRATA=var` — the stratification variable COXREG and KM share. */
function parseStrataClause(body: string): string | null {
  const m = /\bSTRATA\s*=?\s*([A-Za-z_]\w*)/i.exec(body)
  return m ? (m[1] as string) : null
}

/** The body of one `/KEYWORD ...` subcommand, or "" when it is absent. */
function subcommand(body: string, keyword: string): string {
  const re = new RegExp(`\\b${keyword}\\s*=?\\s*([^/]*)`, 'i')
  const m = re.exec(body)
  return m ? (m[1] as string).trim() : ''
}

const hasWord = (s: string, w: string): boolean => new RegExp(`\\b${w}\\b`, 'i').test(s)

/** COXREG [VARIABLES=]survival-var WITH covariates /STATUS=status-var(EVENT)(value) */
export async function runCoxreg(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const firstSeg = (splitTopLevel(st.body, '/')[0] ?? '').replace(/^\s*VARIABLES\s*=\s*/i, '')
  const { left, right } = splitOnWith(firstSeg)
  const time = resolveVars(left.slice(0, 1), ctx.variables)
  // Covariates come from `WITH varlist`, but SPSS's own Cox Regression dialog
  // pastes them on `/METHOD=ENTER varlist` and omits WITH entirely — that form
  // failed outright here. Accept both, preferring WITH when it is present.
  const covs = resolveVars(right.length ? right : methodVarList(st.body), ctx.variables)
  const status = parseStatusClause(st.body)
  const unknown = [...time.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (time.resolved.length === 0 || covs.resolved.length === 0 || !status)
    return [{ level: 'error', key: 'terminal.log.coxregSyntax' }]
  const statusVars = resolveVars([status.name], ctx.variables)
  if (statusVars.unknown.length) return [unknownVarsError(statusVars.unknown)]
  const t = time.resolved[0] as Variable
  const s = statusVars.resolved[0] as Variable

  // /STRATA, /CATEGORICAL + /CONTRAST, the stepwise keyword in /METHOD, and
  // the /PRINT + /CRITERIA options — the same surface the dialog pastes, so a
  // pasted command reproduces the run it came from instead of silently
  // falling back to an Enter model with no factors.
  const strataName = parseStrataClause(st.body)
  const strataVars = strataName
    ? resolveVars([strataName], ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  if (strataVars.unknown.length) return [unknownVarsError(strataVars.unknown)]

  const catNames = parseList(subcommand(st.body, 'CATEGORICAL'))
  const catVars = catNames.length
    ? resolveVars(catNames, ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  if (catVars.unknown.length) return [unknownVarsError(catVars.unknown)]

  const categorical: Record<string, CoxCategoricalSpec> = {}
  for (const v of catVars.resolved) {
    categorical[v.colId] = { contrast: 'indicator', reference: 'last' }
  }
  // /CONTRAST (var)=KEYWORD(FIRST|LAST) — one per categorical covariate.
  const contrastRe =
    /\bCONTRAST\s*\(\s*([A-Za-z_]\w*)\s*\)\s*=\s*([A-Za-z]+)(?:\s*\(\s*([A-Za-z]+)\s*\))?/gi
  for (const m of st.body.matchAll(contrastRe)) {
    const target = resolveVars([m[1] as string], ctx.variables).resolved[0]
    if (!target) continue
    const kw = (m[2] as string).toLowerCase()
    const contrast = COX_CONTRASTS.find(c => c === kw)
    if (!contrast) continue
    const ref = (m[3] ?? 'LAST').toUpperCase() === 'FIRST' ? 'first' : 'last'
    categorical[target.colId] = { contrast, reference: ref }
  }

  const methodBody = subcommand(st.body, 'METHOD')
  const method: CoxMethod = /\bFSTEP\s*\(\s*WALD/i.test(methodBody)
    ? 'forwardWald'
    : /\bFSTEP/i.test(methodBody)
      ? 'forwardLR'
      : /\bBSTEP\s*\(\s*WALD/i.test(methodBody)
        ? 'backwardWald'
        : /\bBSTEP/i.test(methodBody)
          ? 'backwardLR'
          : 'enter'

  const printBody = subcommand(st.body, 'PRINT')
  const ciM = /\bCI\s*\(\s*([\d.]+)\s*\)/i.exec(printBody)
  const critBody = subcommand(st.body, 'CRITERIA')
  const num = (re: RegExp, fallback: number): number => {
    const m = re.exec(critBody)
    if (!m) return fallback
    const n = Number(m[1])
    return Number.isFinite(n) ? n : fallback
  }
  const options: CoxOptions = {
    ...defaultCoxOptions,
    ciExpB: ciM !== null,
    ciLevel: ciM ? Number(ciM[1]) : defaultCoxOptions.ciLevel,
    correlation: hasWord(printBody, 'CORR'),
    baseline: hasWord(printBody, 'BASELINE'),
    entry: num(/\bPIN\s*\(\s*([\d.]+)\s*\)/i, defaultCoxOptions.entry),
    removal: num(/\bPOUT\s*\(\s*([\d.]+)\s*\)/i, defaultCoxOptions.removal),
    maxIterations: num(/\bITERATE\s*\(\s*([\d.]+)\s*\)/i, defaultCoxOptions.maxIterations)
  }

  const strata = strataVars.resolved[0]
  await ctx.runAnalysis({
    analysisId: 'survivalCox',
    scriptFile: 'survival-cox.R',
    params: {
      timeVar: t.colId,
      timeName: t.name,
      statusVar: s.colId,
      eventValue: status.value,
      covariates: covs.resolved.map(v => v.colId),
      varNames: Object.fromEntries(covs.resolved.map(v => [v.colId, v.name])),
      categorical,
      categoricalValueLabels: Object.fromEntries(
        catVars.resolved.map(v => [v.colId, v.valueLabels])
      ),
      strata: strata ? strata.colId : null,
      strataName: strata ? strata.name : null,
      method,
      options,
      plots: defaultCoxPlotOptions
    }
  })
  return [dispatchedToOutput('COXREG', [t, s, ...covs.resolved, ...(strata ? [strata] : [])])]
}

/** KM survival-var [BY factor] /STATUS=status-var(EVENT)(value) */
export async function runKm(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const firstSeg = splitTopLevel(st.body, '/')[0] ?? ''
  const { left, right } = splitOnBy(firstSeg)
  const time = resolveVars(left.slice(0, 1), ctx.variables)
  const factor = right.length
    ? resolveVars(right.slice(0, 1), ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  const status = parseStatusClause(st.body)
  const unknown = [...time.unknown, ...factor.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (time.resolved.length === 0 || !status)
    return [{ level: 'error', key: 'terminal.log.kmSyntax' }]
  const statusVars = resolveVars([status.name], ctx.variables)
  if (statusVars.unknown.length) return [unknownVarsError(statusVars.unknown)]
  const t = time.resolved[0] as Variable
  const s = statusVars.resolved[0] as Variable
  const f = factor.resolved[0]

  const strataName = parseStrataClause(st.body)
  const strataVars = strataName
    ? resolveVars([strataName], ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  if (strataVars.unknown.length) return [unknownVarsError(strataVars.unknown)]
  const strata = strataVars.resolved[0]

  // /PRINT, /PERCENTILES, /PLOT and /COMPARE carry everything the Options and
  // Compare Factor sub-dialogs collect. An ABSENT /PRINT keeps SPSS's default
  // (the means-and-medians block); an explicit one replaces it wholesale, so
  // "/PRINT NONE" really does suppress both tables.
  const printBody = subcommand(st.body, 'PRINT')
  const hasPrint = /\bPRINT\b/i.test(st.body)
  const plotBody = subcommand(st.body, 'PLOT')
  const compareBody = subcommand(st.body, 'COMPARE')
  const hasCompare = /\bCOMPARE\b/i.test(st.body)

  const pairwise = hasWord(compareBody, 'PAIRWISE')
  const separate = hasWord(compareBody, 'SEPARATE')
  const mode: KmCompareMode = pairwise
    ? separate
      ? 'pairwisePerStratum'
      : 'pairwise'
    : separate
      ? 'perStratum'
      : 'pooled'
  // With /COMPARE present but no test named, SPSS runs the log rank.
  const anyTest =
    hasWord(compareBody, 'LOGRANK') ||
    hasWord(compareBody, 'BRESLOW') ||
    hasWord(compareBody, 'TARONE')

  const options: KaplanMeierOptions = {
    compare: {
      logRank: hasCompare ? !anyTest || hasWord(compareBody, 'LOGRANK') : true,
      breslow: hasWord(compareBody, 'BRESLOW'),
      taroneWare: hasWord(compareBody, 'TARONE'),
      mode
    },
    stats: {
      survivalTable: hasPrint
        ? hasWord(printBody, 'TABLE')
        : defaultKaplanMeierOptions.stats.survivalTable,
      meanMedian: hasPrint
        ? hasWord(printBody, 'MEAN')
        : defaultKaplanMeierOptions.stats.meanMedian,
      quartiles: /\bPERCENTILES\b/i.test(st.body)
    },
    plots: {
      survival: hasWord(plotBody, 'SURVIVAL'),
      oneMinusSurvival: hasWord(plotBody, 'OMS'),
      hazard: hasWord(plotBody, 'HAZARD'),
      logSurvival: hasWord(plotBody, 'LOGSURV')
    }
  }

  await ctx.runAnalysis({
    analysisId: 'survivalKM',
    scriptFile: 'survival-km.R',
    params: {
      timeVar: t.colId,
      timeName: t.name,
      statusVar: s.colId,
      statusName: s.name,
      eventValue: status.value,
      factor: f ? f.colId : null,
      factorName: f ? f.name : null,
      factorValueLabels: f ? f.valueLabels : null,
      strata: strata ? strata.colId : null,
      strataName: strata ? strata.name : null,
      strataValueLabels: strata ? strata.valueLabels : null,
      options
    }
  })
  return [dispatchedToOutput('KM', [t, s, ...(f ? [f] : []), ...(strata ? [strata] : [])])]
}

/** SURVIVAL TABLE=time-var /STATUS=status-var(value) FOR ALL [/INTERVAL=THRU n BY step] */
export async function runSurvival(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const tableM = /\bTABLE\s*=\s*([A-Za-z_]\w*)/i.exec(st.body)
  const status = parseStatusClause(st.body)
  const intervalM = /\bINTERVAL\s*=\s*THRU\s+[\d.]+\s+BY\s+([\d.]+)/i.exec(st.body)
  const time = tableM
    ? resolveVars([tableM[1] as string], ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  const statusVars = status
    ? resolveVars([status.name], ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  const unknown = [...time.unknown, ...statusVars.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (time.resolved.length === 0 || !status || statusVars.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.survivalSyntax' }]
  const t = time.resolved[0] as Variable
  const s = statusVars.resolved[0] as Variable
  const interval = intervalM ? Number(intervalM[1]) : null

  await ctx.runAnalysis({
    analysisId: 'lifetab',
    scriptFile: 'life-tables.R',
    params: {
      time: t.colId,
      status: s.colId,
      interval,
      varNames: { [t.colId]: t.name, [s.colId]: s.name }
    }
  })
  return [dispatchedToOutput('SURVIVAL', [t, s])]
}
