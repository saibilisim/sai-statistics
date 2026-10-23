// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { dispatchMultinomial } from './handlers-multinomial'
import type { Variable } from '../data-types'
import type { LogisticOptions } from '../logistic-types'
import { defaultLogisticOptions } from '../logistic-types'
import type { ProbitModel, ProbitOptions, ProbitTransform } from '../probit-types'
import { PROBIT_TRANSFORMS, defaultProbitOptions } from '../probit-types'
import type {
  RegressionCriteria,
  RegressionMethod,
  RegressionOptions,
  RegressionPlotToken
} from '../regression-types'
import {
  REGRESSION_PLOT_TOKENS,
  defaultRegressionCriteria,
  defaultRegressionOptions
} from '../regression-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import {
  parseList,
  parseSubcommand,
  methodVarList,
  resolveVars,
  variableListPart,
  splitOnWith,
  splitTopLevel
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'
import { runOrdinal } from './handlers-plum'

/** The body of one `/KEYWORD ...` subcommand, or "" when it is absent. */
function subcommand(body: string, keyword: string): string {
  const re = new RegExp(`\\b${keyword}\\s*=?\\s*([^/]*)`, 'i')
  const m = re.exec(body)
  return m ? (m[1] as string).trim() : ''
}

const hasWord = (s: string, w: string): boolean => new RegExp(`\\b${w}\\b`, 'i').test(s)

// ─── Regression-family command handlers ────────────────────────────────────

/** REGRESSION /DEPENDENT=y /METHOD=ENTER x1 x2 → linear regression. */
export async function runRegression(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const depM = /DEPENDENT\s*=?\s*([A-Za-z_]\w*)/i.exec(st.body)
  const methodM = /METHOD\s*=\s*(ENTER|FORWARD|BACKWARD|STEPWISE)\s+([^/]*)/i.exec(st.body)
  if (!depM || !methodM) return [{ level: 'error', key: 'terminal.log.regressionSyntax' }]
  const dep = resolveVars([depM[1] as string], ctx.variables)
  const preds = resolveVars(parseList(methodM[2] as string), ctx.variables)
  const unknown = [...dep.unknown, ...preds.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || preds.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.regressionSyntax' }]
  const d = dep.resolved[0] as Variable

  const methodWord = (methodM[1] as string).toUpperCase()
  const method: RegressionMethod =
    methodWord === 'FORWARD'
      ? 'forward'
      : methodWord === 'BACKWARD'
        ? 'backward'
        : methodWord === 'STEPWISE'
          ? 'stepwise'
          : 'enter'

  const statsWords = parseSubcommand(st.body, 'STATISTICS') || []
  const residWords = parseSubcommand(st.body, 'RESIDUALS') || []
  const casewiseWords = parseSubcommand(st.body, 'CASEWISE')
  const missingWords = parseSubcommand(st.body, 'MISSING') || []
  const ciWord = statsWords.find(w => w.startsWith('CI('))
  const outliersWord = casewiseWords?.find(w => w.startsWith('OUTLIERS('))

  // /CRITERIA=PIN(.05) POUT(.10) or FIN(3.84) FOUT(2.71) — only meaningful
  // once Method isn't Enter; a pasted /CRITERIA on an Enter model is ignored,
  // same as real SPSS (there's nothing for it to steer).
  const criteriaBody = subcommand(st.body, 'CRITERIA').toUpperCase()
  const pinM = /PIN\(([\d.]+)\)/.exec(criteriaBody)
  const poutM = /POUT\(([\d.]+)\)/.exec(criteriaBody)
  const finM = /FIN\(([\d.]+)\)/.exec(criteriaBody)
  const foutM = /FOUT\(([\d.]+)\)/.exec(criteriaBody)
  const criteria: RegressionCriteria = {
    type: finM || foutM ? 'fvalue' : 'prob',
    entryProb: pinM ? Number(pinM[1]) : defaultRegressionCriteria.entryProb,
    removalProb: poutM ? Number(poutM[1]) : defaultRegressionCriteria.removalProb,
    entryF: finM ? Number(finM[1]) : defaultRegressionCriteria.entryF,
    removalF: foutM ? Number(foutM[1]) : defaultRegressionCriteria.removalF
  }
  const scatterM = /\/SCATTERPLOT\s*=?\s*\(([^)]*)\)/i.exec(st.body)
  const scatterTokens = scatterM ? (scatterM[1] as string).split(',').map(s => s.trim()) : []
  const toPlotToken = (raw: string | undefined): RegressionPlotToken | '' => {
    if (!raw) return ''
    const clean = raw.replace(/^\*/, '').toUpperCase()
    if ((REGRESSION_PLOT_TOKENS as string[]).includes(clean)) return clean as RegressionPlotToken
    return raw.toUpperCase() === d.name.toUpperCase() ? 'DEPENDNT' : ''
  }

  const options: RegressionOptions = {
    ...defaultRegressionOptions,
    method,
    criteria,
    collinearity: statsWords.includes('COLLIN') || statsWords.includes('TOL'),
    // Real SPSS carries Durbin-Watson on /RESIDUALS; keep reading the old
    // /STATISTICS=DURBIN spelling as well so already-pasted syntax still works.
    durbinWatson: statsWords.includes('DURBIN') || residWords.includes('DURBIN'),
    confidenceIntervals: Boolean(ciWord),
    ciLevel: ciWord ? Number(ciWord.slice(3, -1)) || 95 : 95,
    covarianceMatrix: statsWords.includes('BCOV'),
    rSquaredChange: statsWords.includes('CHANGE'),
    descriptives: statsWords.includes('DESCRIPTIVES'),
    partialCorrelations: statsWords.includes('ZPP'),
    casewiseDiagnostics: casewiseWords !== null,
    casewiseOutliersOnly: !casewiseWords?.includes('ALL'),
    casewiseSD: outliersWord ? Number(outliersWord.slice(9, -1)) || 3 : 3,
    includeConstant: !/\/ORIGIN\b/i.test(st.body),
    missingMethod: missingWords.includes('MEANSUB') ? 'mean' : 'listwise',
    plots: {
      scatterY: toPlotToken(scatterTokens[0]),
      scatterX: toPlotToken(scatterTokens[1]),
      histogram: residWords.some(w => w.startsWith('HISTOGRAM')),
      normalPP: residWords.some(w => w.startsWith('NORM')),
      partialPlots: /\/PARTIALPLOT\b/i.test(st.body)
    }
  }

  await ctx.runAnalysis({
    analysisId: 'regression',
    scriptFile: 'regression-linear.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      independents: preds.resolved.map(v => v.colId),
      varNames: Object.fromEntries([d, ...preds.resolved].map(v => [v.colId, v.name])),
      options
    }
  })
  return [dispatchedToOutput('REGRESSION', [d, ...preds.resolved])]
}

/** LOGISTIC REGRESSION VARIABLES=dependent WITH covariates */
export async function runLogistic(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  const { left, right } = splitOnWith(listPart)
  const dep = resolveVars(left.slice(0, 1), ctx.variables)
  // As in COXREG: SPSS's Logistic Regression dialog pastes the covariates on
  // /METHOD=ENTER and never writes WITH, and that form used to be rejected.
  const covs = resolveVars(right.length ? right : methodVarList(st.body), ctx.variables)
  const unknown = [...dep.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || covs.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.logisticSyntax' }]
  const d = dep.resolved[0] as Variable

  // /CLASSPLOT, /CASEWISE, /PRINT, /ORIGIN and /CRITERIA carry everything the
  // Options sub-dialog collects — the same surface the dialog pastes, so a
  // pasted command reproduces the run it came from (as COXREG's parser does).
  const printBody = subcommand(st.body, 'PRINT')
  const ciM = /\bCI\s*\(\s*([\d.]+)\s*\)/i.exec(printBody)
  const caseBody = subcommand(st.body, 'CASEWISE')
  const outlierM = /\bOUTLIER\s*\(\s*([\d.]+)\s*\)/i.exec(caseBody)
  const critBody = subcommand(st.body, 'CRITERIA')
  const num = (re: RegExp, fallback: number): number => {
    const m = re.exec(critBody)
    if (!m) return fallback
    const n = Number(m[1])
    return Number.isFinite(n) ? n : fallback
  }
  const options: LogisticOptions = {
    ...defaultLogisticOptions,
    classificationPlots: hasWord(st.body, 'CLASSPLOT'),
    hosmerLemeshow: hasWord(printBody, 'GOODFIT'),
    correlation: hasWord(printBody, 'CORR'),
    iterationHistory: hasWord(printBody, 'ITER'),
    ciExpB: ciM !== null,
    ciLevel: ciM ? Number(ciM[1]) : defaultLogisticOptions.ciLevel,
    casewiseListing: caseBody.length > 0,
    casewiseOutliersOnly: outlierM !== null || !hasWord(caseBody, 'ALL'),
    casewiseThreshold: outlierM ? Number(outlierM[1]) : defaultLogisticOptions.casewiseThreshold,
    includeConstant: !hasWord(st.body, 'ORIGIN'),
    classificationCutoff: num(
      /\bCUT\s*\(\s*([\d.]+)\s*\)/i,
      defaultLogisticOptions.classificationCutoff
    ),
    maxIterations: num(/\bITERATE\s*\(\s*([\d.]+)\s*\)/i, defaultLogisticOptions.maxIterations)
  }

  await ctx.runAnalysis({
    analysisId: 'logistic',
    scriptFile: 'regression-logistic.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      covariates: covs.resolved.map(v => v.colId),
      varNames: Object.fromEntries([d, ...covs.resolved].map(v => [v.colId, v.name])),
      options
    }
  })
  return [dispatchedToOutput('LOGISTIC REGRESSION', [d, ...covs.resolved])]
}

export async function runNomreg(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  return dispatchMultinomial(st, ctx)
}

export async function runPlum(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  return runOrdinal(st, ctx)
}

/**
 * PROBIT respFreq OF total WITH cov1 cov2 [BY factor(min,max)]
 *   /MODEL=PROBIT|LOGIT [/TRANSFORM=...] [/PRINT=FREQ CI PARALLEL]
 *   [/NATRES=NONE|CALCULATE|VALUE(n)] [/CRITERIA=ITERATE(n) SIG(n)]
 *
 * SPSS's real PROBIT is a GROUPED dose-response model (Response Frequency /
 * Total Observed / Factor / Covariate), not a per-case binary one — matches
 * what regression-probit.R and the dialog's Options sub-dialog collect.
 */
export async function runProbit(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const firstSeg = splitTopLevel(st.body, '/')[0] ?? st.body
  const ofM = /^\s*([A-Za-z_]\w*)\s+OF\s+([A-Za-z_]\w*)\s+WITH\s+([\s\S]*)$/i.exec(firstSeg)
  if (!ofM) return [{ level: 'error', key: 'terminal.log.probitSyntax' }]
  const respFreqTok = ofM[1] as string
  const totalTok = ofM[2] as string
  const tail = ofM[3] as string

  const byM = /^([\s\S]*?)\bBY\s+([A-Za-z_]\w*)\s*(?:\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\))?\s*$/i.exec(
    tail
  )
  const covList = byM ? (byM[1] as string) : tail
  const factorTok = byM ? (byM[2] as string) : null
  const rangeMin = byM?.[3] !== undefined ? Number(byM[3]) : null
  const rangeMax = byM?.[4] !== undefined ? Number(byM[4]) : null

  const respFreq = resolveVars([respFreqTok], ctx.variables)
  const total = resolveVars([totalTok], ctx.variables)
  const covs = resolveVars(parseList(covList), ctx.variables)
  const factor = factorTok ? resolveVars([factorTok], ctx.variables) : null
  const unknown = [
    ...respFreq.unknown,
    ...total.unknown,
    ...covs.unknown,
    ...(factor?.unknown ?? [])
  ]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (respFreq.resolved.length === 0 || total.resolved.length === 0 || covs.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.probitSyntax' }]
  const r = respFreq.resolved[0] as Variable
  const tot = total.resolved[0] as Variable
  const f = factor?.resolved[0]

  const modelBody = subcommand(st.body, 'MODEL').toUpperCase()
  const modelType: ProbitModel = modelBody.includes('LOGIT') ? 'logit' : 'probit'
  const transformBody = subcommand(st.body, 'TRANSFORM').toUpperCase().trim()
  const transform: ProbitTransform = (PROBIT_TRANSFORMS as readonly string[]).includes(
    transformBody.toLowerCase()
  )
    ? (transformBody.toLowerCase() as ProbitTransform)
    : 'none'
  const printBody = subcommand(st.body, 'PRINT')
  const natresBody = subcommand(st.body, 'NATRES').toUpperCase()
  const natresValueM = /VALUE\s*\(\s*([\d.]+)\s*\)/i.exec(natresBody)
  const critBody = subcommand(st.body, 'CRITERIA')
  const num = (re: RegExp, fallback: number): number => {
    const m = re.exec(critBody)
    if (!m) return fallback
    const n = Number(m[1])
    return Number.isFinite(n) ? n : fallback
  }

  const options: ProbitOptions = {
    ...defaultProbitOptions,
    frequencies: hasWord(printBody, 'FREQ'),
    fiducialCI: hasWord(printBody, 'CI'),
    parallelism: hasWord(printBody, 'PARALLEL'),
    naturalResponseMode: natresValueM
      ? 'value'
      : hasWord(natresBody, 'CALCULATE')
        ? 'calculate'
        : 'none',
    naturalResponseValue: natresValueM ? Number(natresValueM[1]) : null,
    maxIterations: num(/\bITERATE\s*\(\s*([\d.]+)\s*\)/i, defaultProbitOptions.maxIterations),
    heterogeneitySig: num(/\bSIG\s*\(\s*([\d.]+)\s*\)/i, defaultProbitOptions.heterogeneitySig)
  }

  await ctx.runAnalysis({
    analysisId: 'probit',
    scriptFile: 'regression-probit.R',
    params: {
      responseFreq: r.colId,
      totalObserved: tot.colId,
      factor: f ? f.colId : null,
      factorRange:
        f && rangeMin !== null && rangeMax !== null ? { min: rangeMin, max: rangeMax } : null,
      covariates: covs.resolved.map(v => v.colId),
      varNames: Object.fromEntries(covs.resolved.map(v => [v.colId, v.name])),
      transform,
      modelType,
      options
    }
  })
  return [dispatchedToOutput('PROBIT', [r, tot, ...covs.resolved, ...(f ? [f] : [])])]
}

/**
 * CURVEFIT /VARIABLES=dep1 dep2 WITH indep [/ID=labelvar] [/CONSTANT|/NOCONSTANT]
 *   [/MODEL=...] [/UPPERBOUND=n] [/PLOT FIT] [/PRINT ANOVA]
 *
 * WITH omitted → SPSS's implicit case-sequence Time independent, which is
 * exactly what independentMode: "time" is for.
 */
export async function runCurvefit(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  const { left, right } = splitOnWith(listPart)
  const dep = resolveVars(left, ctx.variables)
  const indep = right.length ? resolveVars(right.slice(0, 1), ctx.variables) : null
  const unknown = [...dep.unknown, ...(indep?.unknown ?? [])]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || (right.length > 0 && (indep?.resolved.length ?? 0) === 0))
    return [{ level: 'error', key: 'terminal.log.curvefitSyntax' }]
  const deps = dep.resolved
  const ind = indep?.resolved[0]
  const timeMode = !ind

  const idM = /\bID\s*=?\s*([A-Za-z_]\w*)/i.exec(st.body)
  const idVars = idM ? resolveVars([idM[1] as string], ctx.variables) : null
  if (idVars?.unknown.length) return [unknownVarsError(idVars.unknown)]
  const idVar = idVars?.resolved[0]

  const modelWords = parseSubcommand(st.body, 'MODEL') || []
  const models = {
    linear: modelWords.length === 0 || modelWords.includes('LINEAR'),
    logarithmic: modelWords.includes('LOGARITHMIC'),
    inverse: modelWords.includes('INVERSE'),
    quadratic: modelWords.includes('QUADRATIC'),
    cubic: modelWords.includes('CUBIC'),
    power: modelWords.includes('POWER'),
    compound: modelWords.includes('COMPOUND'),
    s: modelWords.includes('S'),
    growth: modelWords.includes('GROWTH'),
    exponential: modelWords.includes('EXPONENTIAL'),
    logistic: modelWords.includes('LOGISTIC')
  }
  const upperM = /\bUPPERBOUND\s*=\s*([\d.]+)/i.exec(st.body)
  const logisticUpperBound = upperM ? Number(upperM[1]) : null

  await ctx.runAnalysis({
    analysisId: 'curve',
    scriptFile: 'regression-curve.R',
    params: {
      dependents: deps.map(v => v.colId),
      dependentNames: Object.fromEntries(deps.map(v => [v.colId, v.name])),
      independentMode: timeMode ? 'time' : 'variable',
      independent: ind ? ind.colId : null,
      independentName: ind ? ind.name : null,
      caseLabels: idVar ? idVar.colId : null,
      includeConstant: !hasWord(st.body, 'NOCONSTANT'),
      plotModels: hasWord(st.body, 'PLOT'),
      displayAnova: hasWord(st.body, 'ANOVA'),
      models,
      logisticUpperBound
    }
  })
  return [dispatchedToOutput('CURVEFIT', [...deps, ...(ind ? [ind] : [])])]
}

/**
 * GENLIN dependent WITH predictors /MODEL predictors DISTRIBUTION=... LINK=...
 *   [/REPEATED SUBJECT=subject [WITHINSUBJECT=...] CORRTYPE=...]
 * Presence of /REPEATED turns this into GEE — SPSS has no separate "GEE"
 * command keyword; the GEE dialog generates GENLIN syntax with /REPEATED.
 */
export async function runGenlin(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const body = st.body
  const firstSeg = splitTopLevel(body, '/')[0] ?? body
  const { left, right } = splitOnWith(firstSeg)
  const dep = resolveVars(left.slice(0, 1), ctx.variables)
  const preds = resolveVars(right, ctx.variables)
  const unknown = [...dep.unknown, ...preds.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || preds.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.genlinSyntax' }]
  const d = dep.resolved[0] as Variable

  const distM = /DISTRIBUTION\s*=\s*(POISSON|BINOMIAL|GAMMA|NEGBIN|NORMAL)/i.exec(body)
  const hasRepeated = /\/REPEATED\b/i.test(body)

  if (hasRepeated) {
    const subjM = /SUBJECT\s*=\s*([A-Za-z_]\w*)/i.exec(body)
    const corrM = /CORRTYPE\s*=\s*([A-Za-z0-9_]+)/i.exec(body)
    const subj = subjM
      ? resolveVars([subjM[1] as string], ctx.variables)
      : { resolved: [] as Variable[], unknown: [] as string[] }
    if (subj.unknown.length) return [unknownVarsError(subj.unknown)]
    if (subj.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.genlinSyntax' }]
    const s = subj.resolved[0] as Variable
    const distUpper = distM ? (distM[1] as string).toUpperCase() : ''
    const family: 'poisson' | 'binomial' | 'gaussian' =
      distUpper === 'POISSON' ? 'poisson' : distUpper === 'BINOMIAL' ? 'binomial' : 'gaussian'
    const corstr = corrM ? (corrM[1] as string).toLowerCase() : 'exchangeable'

    await ctx.runAnalysis({
      analysisId: 'gee',
      scriptFile: 'gee.R',
      params: {
        dependent: d.colId,
        dependentName: d.name,
        predictors: preds.resolved.map(v => v.colId),
        varNames: Object.fromEntries(preds.resolved.map(v => [v.colId, v.name])),
        subject: s.colId,
        family,
        corstr
      }
    })
    return [dispatchedToOutput('GENLIN /REPEATED', [d, s, ...preds.resolved])]
  }

  const distribution: 'poisson' | 'negbin' | 'gamma' | 'normal' = distM
    ? ((distM[1] as string).toLowerCase() as 'poisson' | 'negbin' | 'gamma' | 'normal')
    : 'poisson'

  await ctx.runAnalysis({
    analysisId: 'genlin',
    scriptFile: 'genlin.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      predictors: preds.resolved.map(v => v.colId),
      varNames: Object.fromEntries(preds.resolved.map(v => [v.colId, v.name])),
      distribution
    }
  })
  return [dispatchedToOutput('GENLIN', [d, ...preds.resolved])]
}
