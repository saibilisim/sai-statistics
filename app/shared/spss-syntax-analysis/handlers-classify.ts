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

/**
 * FACTOR VARIABLES=varlist [/MISSING LISTWISE|PAIRWISE|MEANSUB]
 *   [/PRINT=INITIAL EXTRACTION ROTATION UNIVARIATE CORRELATION SIG DET INV REPR
 *     AIC KMO FSCORE DEFAULT ALL]
 *   [/FORMAT SORT BLANK(x)] [/PLOT EIGEN ROTATION]
 *   [/CRITERIA FACTORS(n)|MINEIGEN(x) ITERATE(n)]
 *   [/EXTRACTION PC|PAF|ML|ULS|GLS|ALPHA|IMAGE]
 *   [/CRITERIA ITERATE(n) DELTA(d)]
 *   [/ROTATION VARIMAX|QUARTIMAX|EQUAMAX|OBLIMIN|PROMAX(k)|NOROTATE]
 *   [/SAVE REG|BART|AR(...)] [/METHOD=CORRELATION|COVARIANCE]
 */
export async function runFactor(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]
  const rotWords = parseSubcommand(st.body, 'ROTATION') || []
  const rotation =
    (['varimax', 'quartimax', 'equamax', 'oblimin', 'promax'] as const).find(r =>
      // PROMAX carries its kappa as PROMAX(4).
      rotWords.some(w => w === r.toUpperCase() || w.startsWith(`${r.toUpperCase()}(`))
    ) ?? 'none'
  const printWords = parseSubcommand(st.body, 'PRINT') || []
  const kmoBartlett = printWords.includes('KMO')
  const extWords = parseSubcommand(st.body, 'EXTRACTION') || []
  const extraction =
    (['paf', 'ml', 'uls', 'gls', 'alpha', 'image'] as const).find(m =>
      extWords.includes(m.toUpperCase())
    ) ?? 'pc'
  // CRITERIA / FORMAT keywords carry their value in parentheses: FACTORS(2).
  // SPSS reads /CRITERIA positionally: the one before /EXTRACTION sets the
  // extraction, a second one before /ROTATION the rotation (ITERATE, DELTA).
  const critText = (parseSubcommand(st.body, 'CRITERIA') || []).join(' ')
  const rotIdx = st.body.search(/\/ROTATION\b/i)
  const extIdx = st.body.search(/\/EXTRACTION\b/i)
  const rotCritText =
    rotIdx > extIdx && extIdx >= 0
      ? (parseSubcommand(st.body.slice(extIdx, rotIdx), 'CRITERIA') || []).join(' ')
      : ''
  const formatText = (parseSubcommand(st.body, 'FORMAT') || []).join(' ')
  const kwNum = (text: string, kw: string): number | null => {
    const m = new RegExp(`${kw}\\s*\\(\\s*(-?[0-9.]+)\\s*\\)`).exec(text)
    return m ? Number(m[1]) : null
  }
  const nFactors = kwNum(critText, 'FACTORS')
  const minEigen = kwNum(critText, 'MINEIGEN')
  const iterate = kwNum(critText, 'ITERATE')
  const blank = kwNum(formatText, 'BLANK')
  // Beyond rotation/kmoBartlett only what the statement actually says is
  // sent, so a plain FACTOR keeps its original payload.
  const options: Record<string, unknown> = { rotation, kmoBartlett }
  if (extraction !== 'pc') options.extraction = extraction
  if (nFactors !== null) {
    options.criterion = 'fixed'
    options.nFactors = nFactors
  } else if (minEigen !== null && minEigen !== 1) {
    options.minEigen = minEigen
  }
  if (iterate !== null && extraction !== 'pc') options.maxIter = iterate
  if (printWords.includes('UNIVARIATE')) options.univariate = true
  if (printWords.includes('CORRELATION')) options.correlation = true
  if (printWords.includes('AIC')) options.antiImage = true
  if (formatText.includes('SORT')) options.sortBySize = true
  if (blank !== null) options.suppressBelow = blank
  const plotWords = parseSubcommand(st.body, 'PLOT') || []
  if (plotWords.includes('EIGEN')) options.scree = true
  if (plotWords.includes('ROTATION')) options.loadingPlot = true

  // Descriptives and display. When /PRINT names any of INITIAL / EXTRACTION /
  // ROTATION it is managing the display, and a missing one turns that part
  // off (what the dialog pastes). A /PRINT of statistics only (`/PRINT=KMO`)
  // adds them to the usual output instead of hiding it — strict SPSS would
  // print the KMO table alone, which no one writing that line expects here.
  const all = printWords.includes('ALL')
  const has = (kw: string) => all || printWords.includes(kw)
  if (has('SIG')) options.sigLevels = true
  if (has('DET')) options.determinant = true
  if (has('INV')) options.inverse = true
  if (has('REPR')) options.reproduced = true
  if (has('FSCORE')) options.scoreCoef = true
  if (all)
    Object.assign(options, {
      univariate: true,
      correlation: true,
      antiImage: true,
      kmoBartlett: true
    })
  const managesDisplay = ['INITIAL', 'EXTRACTION', 'ROTATION'].some(kw => printWords.includes(kw))
  if (managesDisplay && !all && !printWords.includes('DEFAULT')) {
    if (!printWords.includes('INITIAL')) options.initialSolution = false
    if (!printWords.includes('EXTRACTION')) options.unrotated = false
    if (rotation !== 'none' && !printWords.includes('ROTATION')) options.rotatedSolution = false
  }

  const missingWords = parseSubcommand(st.body, 'MISSING') || []
  if (missingWords.includes('PAIRWISE')) options.missing = 'pairwise'
  else if (missingWords.includes('MEANSUB')) options.missing = 'mean'
  if ((parseSubcommand(st.body, 'METHOD') || []).includes('COVARIANCE')) {
    options.matrix = 'covariance'
  }

  // SPSS counts rotation iterations as sweeps of pairwise planar rotations;
  // factor.R's GPA rotations count gradient steps, which need more. SPSS's own
  // default (25) therefore does not carry over and leaves our default (1000)
  // in place; any other value is the user's explicit choice and is kept.
  const rotIterate = kwNum(rotCritText, 'ITERATE')
  if (rotIterate !== null && rotIterate !== 25 && rotIterate !== 1000 && rotation !== 'none') {
    options.rotationMaxIter = rotIterate
  }
  const delta = kwNum(rotCritText || critText, 'DELTA')
  if (delta !== null && delta !== 0 && rotation === 'oblimin') options.delta = delta
  const kappa = kwNum(rotWords.join(' '), 'PROMAX')
  if (kappa !== null && kappa !== 4 && rotation === 'promax') options.kappa = kappa
  const saveWords = (parseSubcommand(st.body, 'SAVE') || []).join(' ')
  if (/\bBART/.test(saveWords)) options.scoreMethod = 'bartlett'
  else if (/\bAR\b|\bAR\(/.test(saveWords)) options.scoreMethod = 'anderson'

  await ctx.runAnalysis({
    analysisId: 'factor',
    scriptFile: 'factor.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      options
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
        // Youden's optimal cut-off has no SPSS keyword; the dialogs show it by
        // default, so a pasted ROC command produces the same output as OK.
        youden: true,
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
