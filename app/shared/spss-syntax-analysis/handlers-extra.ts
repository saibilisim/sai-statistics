// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import {
  parseList,
  parseSubcommand,
  parseVariablesList,
  resolveVars,
  splitOnBy,
  splitOnWith,
  splitTopLevel
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── The last commands the Analyze menu can paste ──────────────────────────
//
// Everything here was written for the UI-parity harness: each of these dialogs
// had no way to express itself as SPSS syntax, so a pasted command could not
// round-trip and the dialog sat outside the comparison. The forms accepted are
// the ones SPSS itself accepts — each was probed against a real install before
// being written down (the keyword traps are in the comments).

/** KNN dependent [BY factors] WITH covariates [/MODEL NEIGHBORS=FIXED(K=k)] */
export async function runKnn(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const listPart = (splitTopLevel(st.body, '/')[0] ?? st.body).replace(/\[[^\]]*\]/g, ' ')
  const { left, right } = splitOnWith(listPart)
  // `dep BY factors WITH covariates`: the dependent is the first token, and the
  // covariates are what the R script models on.
  const { left: depTok } = splitOnBy(left.join(' '))
  const dep = resolveVars(depTok.slice(0, 1), ctx.variables)
  const covs = resolveVars(right, ctx.variables)
  const unknown = [...dep.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || covs.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.knnSyntax' }]
  const d = dep.resolved[0] as Variable
  // SPSS spells the neighbour count NEIGHBORS=FIXED(K=n) on /MODEL; K on
  // /CRITERIA is rejected outright ("KNN is not a valid keyword").
  const kM = /\bK\s*=\s*(\d+)/i.exec(st.body)

  await ctx.runAnalysis({
    analysisId: 'knn',
    scriptFile: 'knn.R',
    params: {
      groupVar: d.colId,
      groupName: d.label || d.name,
      groupValueLabels: d.valueLabels,
      independents: covs.resolved.map(v => v.colId),
      varNames: Object.fromEntries(covs.resolved.map(v => [v.colId, v.label || v.name])),
      options: { k: kM ? Number(kM[1]) : 5 }
    }
  })
  return [dispatchedToOutput('KNN', [d, ...covs.resolved])]
}

/** ALSCAL VARIABLES=varlist [/CRITERIA=DIMENS(n)] — multidimensional scaling. */
export async function runAlscal(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]
  const dimM = /DIMENS\s*\(\s*(\d+)/i.exec(st.body)

  await ctx.runAnalysis({
    analysisId: 'mds',
    scriptFile: 'mds.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      dimensions: dimM ? Number(dimM[1]) : 2
    }
  })
  return [dispatchedToOutput('ALSCAL', resolved)]
}

/** MULTIPLE IMPUTATION varlist [/IMPUTE NIMPUTATIONS=m] */
export async function runMultipleImputation(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = splitTopLevel(st.body, '/')[0] ?? st.body
  const { resolved, unknown } = resolveVars(parseList(listPart), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]
  const mM = /NIMPUTATIONS\s*=\s*(\d+)/i.exec(st.body)

  await ctx.runAnalysis({
    analysisId: 'mi',
    scriptFile: 'mi.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      m: mM ? Number(mM[1]) : 5
    }
  })
  return [dispatchedToOutput('MULTIPLE IMPUTATION', resolved)]
}

/**
 * POWER MEANS ONESAMPLE|INDEPENDENT [CORRELATION|CHISQUARE|REGRESSION|ANOVA]
 *   /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=a (N=n | POWER=p) ES=d
 *
 * The only data-free procedure in the menu: nothing here touches a variable.
 */
export async function runPower(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const head = (splitTopLevel(st.body, '/')[0] ?? '').toUpperCase()
  const test = head.includes('INDEPENDENT')
    ? 'tTwo'
    : head.includes('ONESAMPLE')
      ? 'tOne'
      : head.includes('CORRELATION')
        ? 'correlation'
        : head.includes('CHISQUARE')
          ? 'chisquare'
          : head.includes('REGRESSION')
            ? 'regression'
            : 'anova'
  const num = (key: string): number | null => {
    const m = new RegExp(`\\b${key}\\s*=\\s*([\\d.]+)`, 'i').exec(st.body)
    return m ? Number(m[1]) : null
  }
  const es = num('ES')
  if (es === null) return [{ level: 'error', key: 'terminal.log.powerSyntax' }]

  await ctx.runAnalysis({
    analysisId: 'power',
    scriptFile: 'power.R',
    params: {
      test,
      effectSize: es,
      alpha: num('SIGNIFICANCE') ?? 0.05,
      power: num('POWER'),
      n: num('N'),
      groups: num('GROUPS'),
      df: num('DF'),
      predictors: num('PREDICTORS')
    }
  })
  return [dispatchedToOutput('POWER', [])]
}

/**
 * REPORT /FORMAT=[LIST] … /VARIABLES=varlist /BREAK=varlist /SUMMARY=…
 *
 * SPSS's two Report dialogs paste the same command in two layouts, and the
 * difference is /FORMAT=LIST: with it the cases are listed (Summaries in Rows),
 * without it the report is the column layout (Summaries in Columns). They are
 * two different R scripts here, so the keyword decides which one runs.
 */
/** REPORT /SUMMARY functions → the dialogs' statistic keys (summary-stats.ts). */
const REPORT_SUMMARY_KEYWORDS: Record<string, string> = {
  VALIDN: 'n',
  MEAN: 'mean',
  MEDIAN: 'median',
  GMEDIAN: 'groupedMedian',
  SEMEAN: 'seMean',
  SUM: 'sum',
  MIN: 'min',
  MAX: 'max',
  RANGE: 'range',
  FIRST: 'first',
  LAST: 'last',
  STDDEV: 'sd',
  VARIANCE: 'variance',
  KURTOSIS: 'kurtosis',
  SEKURT: 'seKurtosis',
  SKEWNESS: 'skewness',
  SESKEW: 'seSkewness',
  HARMONIC: 'harmonic',
  GEOMETRIC: 'geometric'
}

export async function runReport(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const vars = resolveVars(parseVariablesList(st.body), ctx.variables)
  const breakWords = parseSubcommand(st.body, 'BREAK') ?? []
  const breaks = resolveVars(breakWords, ctx.variables)
  const unknown = [...vars.unknown, ...breaks.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (vars.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]

  const fmt = parseSubcommand(st.body, 'FORMAT') ?? []
  // LIST: Summaries in Rows listing the cases; NOLIST: the same dialog without
  // them; neither: Summaries in Columns (see buildSyntax.reportRows).
  const rows = fmt.includes('LIST') || fmt.includes('NOLIST')
  const limitM = /\bLIMIT\s*=?\s*\(?\s*(\d+)/i.exec(st.body)
  const summary = parseSubcommand(st.body, 'SUMMARY')
  let stats: Record<string, boolean> | undefined
  if (summary) {
    stats = Object.fromEntries(Object.values(REPORT_SUMMARY_KEYWORDS).map(k => [k, false]))
    for (const w of summary) {
      const key = REPORT_SUMMARY_KEYWORDS[w.replace(/\(.*$/, '')]
      if (key) stats[key] = true
    }
  }
  const missing = /\/MISSING\s*=?\s*LIST\b/i.test(st.body) ? 'listwise' : 'analysis'
  const breakValueLabels = Object.fromEntries(breaks.resolved.map(v => [v.colId, v.valueLabels]))
  const common = {
    variables: vars.resolved.map(v => v.colId),
    varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
    breakVars: breaks.resolved.map(v => v.colId),
    breakVarNames: Object.fromEntries(breaks.resolved.map(v => [v.colId, v.name])),
    ...(breaks.resolved.length ? { breakValueLabels } : {}),
    grandTotal: !fmt.includes('NOTOTAL'),
    options: { missing, ...(stats ? { stats } : {}) }
  }

  await ctx.runAnalysis(
    rows
      ? {
          analysisId: 'reportSummaries',
          scriptFile: 'report-summaries.R',
          params: {
            ...common,
            displayCases: fmt.includes('LIST'),
            limitCases: limitM && fmt.includes('LIST') ? Number(limitM[1]) : null
          }
        }
      : {
          analysisId: 'reportColumns',
          scriptFile: 'report-summaries-columns.R',
          params: common
        }
  )
  return [dispatchedToOutput('REPORT', [...vars.resolved, ...breaks.resolved])]
}

/**
 * /PLOT ROC[(REFERENCE)] PR(INTERPOLATE(TP|FP)) | NONE and /PRINT SE
 * MODELQUALITY COORDINATES PRCOORDINATES → the Display sub-dialog. Absent, they
 * mean what SPSS draws by default: the curve with its reference line, no
 * printed extras. The evaluation-metrics table is a SAI addition the dialog
 * shows by default, so it stays on.
 */
function rocDisplay(body: string): Record<string, unknown> {
  const plot = parseSubcommand(body, 'PLOT')
  const print = parseSubcommand(body, 'PRINT') ?? []
  const has = (words: string[], re: RegExp) => words.some(w => re.test(w))
  return {
    plotCurve: plot ? has(plot, /^ROC\b/) : true,
    diagonal: plot ? has(plot, /^ROC\(\s*REFERENCE/) : true,
    prCurve: plot ? has(plot, /^PR(\(|$)/) : false,
    prInterp: /\bINTERPOLATE\s*\(\s*FP\s*\)/i.test(body) ? 'fp' : 'tp',
    seCi: has(print, /^SE$/),
    modelQuality: has(print, /^MODELQUALITY$/),
    coordinates: has(print, /^COORDINATES$/),
    prCoordinates: has(print, /^PRCOORDINATES$/),
    metrics: true,
    compareAuc: false
  }
}

/**
 * ROC ANALYSIS testvars BY state(value) [/CRITERIA … TESTPOS=LARGE|SMALL CI=n]
 *   [/PLOT …] [/PRINT …]
 *
 * SPSS 27+'s own procedure, and the one our extended ROC dialog matches. Its
 * `/PLOT` keywords differ from the older ROC command's (ROC / PR, not CURVE).
 */
export async function runRocAnalysis(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { left } = splitOnBy(splitTopLevel(st.body, '/')[0] ?? st.body)
  const test = resolveVars(left, ctx.variables)
  const stateM = /\bBY\b\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/i.exec(st.body)
  if (!stateM || test.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.rocSyntax' }]
  const stateVars = resolveVars([stateM[1] as string], ctx.variables)
  const unknown = [...test.unknown, ...stateVars.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (stateVars.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.rocSyntax' }]
  const state = stateVars.resolved[0] as Variable
  const critWords = parseSubcommand(st.body, 'CRITERIA') ?? []
  const direction: 'larger' | 'smaller' = critWords.some(w => w.includes('TESTPOS=SMALL'))
    ? 'smaller'
    : 'larger'
  const ciM = /\bCI\s*=\s*([\d.]+)/i.exec(st.body)

  await ctx.runAnalysis({
    analysisId: 'rocAnalysis',
    scriptFile: 'roc-analysis.R',
    params: {
      variables: test.resolved.map(v => v.colId),
      varNames: Object.fromEntries(test.resolved.map(v => [v.colId, v.name])),
      stateVar: state.colId,
      stateName: state.name,
      stateLabel: state.label,
      stateValueLabels: state.valueLabels,
      stateValue: (stateM[2] as string).trim(),
      options: {
        direction,
        ciLevel: ciM ? Number(ciM[1]) / 100 : 0.95,
        cutoff: critWords.some(w => w.includes('CUTOFF=EXCLUDE')) ? 'exclude' : 'include',
        distribution: critWords.some(w => w.includes('DISTRIBUTION=NEGEXPO')) ? 'negexpo' : 'free',
        userMissingValid: /\bUSERMISSING\s*=\s*INCLUDE\b/i.test(st.body),
        ...rocDisplay(st.body)
      }
    }
  })
  return [dispatchedToOutput('ROC ANALYSIS', [...test.resolved, state])]
}

/** SPSS GRAPH keyword → the chartType chart.R switches on. */
const GRAPH_KEYWORDS: [RegExp, string][] = [
  [/\/HISTOGRAM/i, 'histogram'],
  [/\/SCATTERPLOT/i, 'scatter'],
  [/\/BAR/i, 'bar'],
  [/\/LINE/i, 'line'],
  [/\/BOXPLOT/i, 'boxplot'],
  [/\/PPLOT/i, 'pp'],
  [/\/QQ/i, 'qq']
]

/**
 * GRAPH /HISTOGRAM=x | /SCATTERPLOT(BIVAR)=x WITH y [BY g] | /BAR=agg BY x …
 *
 * Only the shapes the Chart dialog produces. SPSS prints no pivot table for a
 * GRAPH command — the parity value here is that a pasted chart command draws
 * the same chart, and that the round trip does not lose the variables.
 */
export async function runGraph(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const hit = GRAPH_KEYWORDS.find(([re]) => re.test(st.body))
  if (!hit) return [{ level: 'error', key: 'terminal.log.graphSyntax' }]
  const chartType = hit[1]
  // Everything after the chart keyword's `=`, minus the aggregate wrapper SPSS
  // writes for bar/line charts (`COUNT()`, `MEAN(score)`).
  const clause = (splitTopLevel(st.body, '/').find(c => hit[0].test('/' + c)) ?? '').replace(
    /^[A-Z()]+\s*(\([^)]*\))?\s*=?/i,
    ''
  )
  // Bar/line summary functions: COUNT BY x · PCT BY x · MEAN(y) BY g · VALUE(y).
  // The function word is not a variable: a bar chart's bars are the BY
  // variable's categories; a line chart plots the function's variable, by
  // the BY variable's categories when there is one.
  const agg =
    chartType === 'bar' || chartType === 'line'
      ? /^\s*(COUNT|PCT|CUFREQ|CUPCT|MEAN|MEDIAN|SUM|VALUE)\b\s*(?:\(\s*([^)]*?)\s*\))?\s*(?:\bBY\s+(\S+))?\s*$/i.exec(
          clause
        )
      : null
  let xPart: string[]
  let yPart: string[] = []
  let groupPart: string[] = []
  if (agg) {
    const inner = agg[2]?.trim()
    const by = agg[3]
    if (chartType === 'line' && inner) {
      xPart = [inner]
      groupPart = by ? [by] : []
    } else xPart = by ? [by] : []
  } else {
    const { left, right } = splitOnWith(clause)
    const split = splitOnBy(right.length ? left.join(' ') : clause)
    xPart = split.left
    yPart = right.length ? splitOnBy(right.join(' ')).left : []
    groupPart = right.length ? splitOnBy(right.join(' ')).right : split.right
  }
  // The two Options choices GRAPH has keywords for (see buildSyntax.chart).
  const options =
    chartType === 'bar' && agg?.[1]?.toUpperCase() === 'PCT'
      ? { represent: 'percent' }
      : chartType === 'histogram' && /\/HISTOGRAM\s*\(\s*NORMAL\s*\)/i.test(st.body)
        ? { normalCurve: true }
        : undefined
  return dispatchChart(chartType, 'GRAPH', xPart, yPart, groupPart, ctx, options)
}

/**
 * PPLOT /VARIABLES=x /TYPE=P-P|Q-Q — the P-P / Q-Q chart dialogs' paste.
 * Only the normal distribution (SPSS's default /DIST=NORMAL) is drawn.
 */
export async function runPplot(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const vars = parseVariablesList(st.body)
  const chartType = /\/TYPE\s*=?\s*Q-?Q\b/i.test(st.body) ? 'qq' : 'pp'
  if (/\/DIST(RIBUTION)?\s*=?\s*(?!NORMAL\b)[A-Z]/i.test(st.body))
    return [{ level: 'error', key: 'terminal.log.graphSyntax' }]
  return dispatchChart(chartType, 'PPLOT', vars.slice(0, 1), [], [], ctx)
}

async function dispatchChart(
  chartType: string,
  command: string,
  xPart: string[],
  yPart: string[],
  groupPart: string[],
  ctx: AnalysisDispatchCtx,
  options?: Record<string, unknown>
): Promise<SyntaxLogEntry[]> {
  const x = resolveVars(xPart.slice(0, 1), ctx.variables)
  const y = resolveVars(yPart.slice(0, 1), ctx.variables)
  const g = resolveVars(groupPart.slice(0, 1), ctx.variables)
  const unknown = [...x.unknown, ...y.unknown, ...g.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (x.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.graphSyntax' }]
  const xv = x.resolved[0] as Variable
  const yv = y.resolved[0]
  const gv = g.resolved[0]

  await ctx.runAnalysis({
    analysisId: `chart-${chartType}`,
    scriptFile: 'chart.R',
    params: {
      chartType,
      xVar: xv.colId,
      xVarName: xv.label || xv.name,
      ...(Object.keys(xv.valueLabels).length > 0 ? { xValueLabels: xv.valueLabels } : {}),
      ...(yv
        ? {
            yVar: yv.colId,
            yVarName: yv.label || yv.name,
            ...(Object.keys(yv.valueLabels).length > 0 ? { yValueLabels: yv.valueLabels } : {})
          }
        : {}),
      ...(gv
        ? {
            groupVar: gv.colId,
            groupVarName: gv.label || gv.name,
            ...(Object.keys(gv.valueLabels).length > 0 ? { groupValueLabels: gv.valueLabels } : {})
          }
        : {}),
      ...(options ? { options } : {})
    }
  })
  return [dispatchedToOutput(command, [xv, ...(yv ? [yv] : []), ...(gv ? [gv] : [])])]
}
