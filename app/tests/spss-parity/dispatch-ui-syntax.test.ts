// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * UI-driven dispatch + the Paste ≡ OK equivalence.
 *
 * tests/e2e/e2e-ui-syntax.cjs drives real dialogs through the real menu channel
 * and writes two artifacts:
 *   ui-job.sps          — the Paste-Syntax output of each scenario
 *   ui-dialog-runs.json — the payload the SAME selections sent via OK
 *
 * This test
 *   1. dispatches ui-job.sps through the real registry (the same
 *      dispatchAnalysisStatement the terminal and the AI bridge call) and
 *      writes ui-syntax-params.json — the input compare-ui.R replays through
 *      the production R scripts;
 *   2. asserts the two parameter sets describe the SAME analysis. A checkbox
 *      the syntax generator drops — or a handler that reads a different
 *      vocabulary than the generator emits — fails here, by scenario.
 *
 * Both artifacts are committed; regenerate them with
 * `node tests/e2e/e2e-ui-syntax.cjs` after `pnpm build` when scenarios change.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  splitStatements,
  dispatchAnalysisStatement,
  type AnalysisRunRequest
} from '../../shared/spss-syntax-analysis'
import type { Variable } from '../../shared/data-types'

const HERE = __dirname
const JOB = join(HERE, 'ui-job.sps')
// The SPSS 27+ procedures live in their own job (they run against SPSS 32);
// both are dispatched here, in the order the e2e captured them.
const JOB32 = join(HERE, 'ui-job32.sps')
const RUNS = join(HERE, 'ui-dialog-runs.json')

interface UiRun {
  id: string
  channel: string
  spss32?: boolean
  syntax: string
  okRequest: { analysisId: string; scriptFile: string; params: Record<string, unknown> }
}

function variablesFromCsvHeader(csv: string): Variable[] {
  return (csv.split(/\r?\n/)[0] ?? '').split(',').map((name, i) => ({
    colId: `col_${i + 1}`,
    name: name.trim(),
    type: name.trim() === 'region' ? 'string' : 'numeric',
    width: 8,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'input'
  })) as Variable[]
}

interface Dispatched {
  command: string
  syntax: string
  request: AnalysisRunRequest
}

async function dispatchUiJob() {
  const sps =
    readFileSync(JOB, 'utf8') + '\n' + (existsSync(JOB32) ? readFileSync(JOB32, 'utf8') : '')
  const variables = variablesFromCsvHeader(readFileSync(join(HERE, 'data.csv'), 'utf8'))
  const dispatched: Dispatched[] = []
  const unhandled: string[] = []
  const errors: { syntax: string; key: string }[] = []

  for (const raw of splitStatements(sps)) {
    let captured: AnalysisRunRequest | null = null
    const result = await dispatchAnalysisStatement(raw, {
      variables,
      runAnalysis: async req => {
        captured = req
      }
    })
    if (!result) {
      unhandled.push(raw.trim())
      continue
    }
    for (const entry of result.log) {
      if (entry.level === 'error') errors.push({ syntax: raw.trim(), key: entry.key })
    }
    if (captured) {
      dispatched.push({
        command: result.statement.command,
        syntax: raw.trim().replace(/\s+/g, ' '),
        request: captured
      })
    }
  }
  return { dispatched, unhandled, errors }
}

/* ── Canonical forms ─────────────────────────────────────────────────────
 * The two sides use different colIds (the app's own vs col_N by header), so
 * everything is compared by variable NAME. Each canonicalizer answers: "what
 * analysis do these params describe?" — anything that changes the R script's
 * behavior must show up in the canonical form. */

type Params = Record<string, unknown>

const nameOf = (p: Params, colId: unknown): string => {
  const maps = ['varNames', 'rowNames', 'colNames'] as const
  for (const m of maps) {
    const names = p[m] as Record<string, string> | undefined
    if (names?.[String(colId)]) return names[String(colId)]
  }
  return String(colId)
}
const namesOf = (p: Params, key: string): string[] =>
  ((p[key] as string[] | undefined) ?? []).map(c => nameOf(p, c))

const FREQ_STAT_KEYS = [
  'mean',
  'median',
  'mode',
  'sum',
  'sd',
  'variance',
  'range',
  'min',
  'max',
  'semean',
  'cv',
  'skewness',
  'kurtosis'
] as const

function canonFrequencies(p: Params) {
  const opts = (p.options ?? {}) as Record<string, never>
  const st = ((opts as Record<string, Params>).statistics ?? {}) as Params
  const charts = ((opts as Record<string, Params>).charts ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    showTable: opts.showTable ?? true,
    order: opts.order ?? 'ascending',
    stats: FREQ_STAT_KEYS.filter(k => st[k] === true),
    // The dialog spells quartiles as a flag, the handler as cutPoints: 4 —
    // both mean /NTILES=4.
    ntiles: st.quartiles === true ? 4 : ((st.cutPoints as number | null) ?? null),
    percentiles:
      st.percentiles === true
        ? (st.customPercentiles as number[])?.length
          ? st.customPercentiles
          : 'default-list'
        : false,
    chartType: charts.type ?? 'none',
    normalCurve: charts.showNormalCurve === true
  }
}

const XT_CELLS = [
  'observed',
  'expected',
  'rowPct',
  'colPct',
  'totalPct',
  'unstdResid',
  'stdResid',
  'adjResid'
] as const
const XT_STATS = [
  'chisquare',
  'phiCramer',
  'contingency',
  'correlations',
  'gamma',
  'somersd',
  'taub',
  'tauc',
  'eta',
  'kappa',
  'risk',
  'mcnemar'
] as const
// The dialog offers these but SPSS CROSSTABS syntax (and our handler) has no
// keyword for them — if one is ever selected, Paste cannot express the dialog.
const XT_UNSAYABLE = ['lambda', 'uncertainty'] as const

function canonCrosstabs(p: Params) {
  const opts = (p.options ?? {}) as Record<string, Params>
  const cells = (opts.cells ?? {}) as Params
  const stats = (opts.stats ?? {}) as Params
  return {
    rows: namesOf(p, 'rows'),
    cols: namesOf(p, 'cols'),
    cells: XT_CELLS.filter(k => cells[k] === true),
    stats: XT_STATS.filter(k => stats[k] === true),
    unsayableSelected: XT_UNSAYABLE.filter(k => stats[k] === true)
  }
}

function canonTtestInd(p: Params) {
  // The OK path always sends options.missing; the syntax path sends the key
  // only for /MISSING=LISTWISE because SPSS's default IS analysis-wise.
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    group: p.groupName ?? nameOf(p, p.groupVar),
    group1: String(p.group1),
    group2: String(p.group2),
    missing: (opts.missing as string) ?? 'analysis',
    bootstrap: (opts.bootstrap as unknown) ?? null
  }
}

function canonTtest1(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    testValue: Number(p.testValue),
    missing: (opts.missing as string) ?? 'analysis'
  }
}

function canonTtestPaired(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    var1: namesOf(p, 'var1'),
    var2: namesOf(p, 'var2'),
    missing: (opts.missing as string) ?? 'analysis'
  }
}

const CELL_KEYS = [
  'n',
  'mean',
  'median',
  'groupedMedian',
  'seMean',
  'sum',
  'min',
  'max',
  'range',
  'first',
  'last',
  'sd',
  'variance',
  'kurtosis',
  'seKurtosis',
  'skewness',
  'seSkewness'
] as const

function canonMeans(p: Params) {
  const opts = (p.options ?? {}) as Params
  const cells = (opts.cells ?? {}) as Params
  return {
    deps: namesOf(p, 'variables'),
    factor: p.factorName ?? nameOf(p, p.factor),
    // Both sides always carry a full cells map: the dialog sends its
    // selection, the handler's parseCellStats fills defaults when /CELLS is
    // absent.
    cells: CELL_KEYS.filter(k => cells[k] === true),
    missing: (opts.missing as string) ?? 'analysis'
  }
}

const DESC_STAT_KEYS = [
  'mean',
  'sum',
  'sd',
  'variance',
  'range',
  'min',
  'max',
  'seMean',
  'kurtosis',
  'skewness'
] as const

function canonDescriptives(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    stats: DESC_STAT_KEYS.filter(k => opts[k] === true),
    displayOrder: (opts.displayOrder as string) ?? 'variable',
    saveZScores: p.saveZScores === true
  }
}

function canonCorrelate(p: Params) {
  const opts = (p.options ?? {}) as Params
  const methods = (p.methods ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    methods: (['pearson', 'spearman', 'kendall'] as const).filter(k => methods[k] === true),
    missing: (opts.missing as string) ?? 'pairwise'
  }
}

function canonAnova(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    deps: namesOf(p, 'variables'),
    factor: p.factorName ?? nameOf(p, p.factor),
    homogeneity: opts.homogeneity === true,
    welch: opts.welch === true,
    brownForsythe: opts.brownForsythe === true,
    tukey: opts.tukey === true,
    bonferroni: opts.bonferroni === true,
    missing: (opts.missing as string) ?? 'analysis'
  }
}

function canonRegression(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    independents: namesOf(p, 'independents'),
    collinearity: opts.collinearity === true,
    durbinWatson: opts.durbinWatson === true
  }
}

function canonExplore(p: Params) {
  const opts = (p.options ?? {}) as Params
  const stats = (opts.stats ?? {}) as Params
  const plots = (opts.plots ?? {}) as Params
  return {
    deps: namesOf(p, 'variables'),
    factors: namesOf(p, 'factors'),
    display: (opts.display as string) ?? 'both',
    stats: {
      descriptives: stats.descriptives === true,
      percentiles: stats.percentiles === true,
      mEstimators: stats.mEstimators === true,
      outliers: stats.outliers === true
    },
    plots: {
      boxplot: plots.boxplot === true,
      histogram: plots.histogram === true,
      normality: plots.normality === true
    },
    // explore.R's default (and SPSS EXAMINE's) is listwise.
    missing: (opts.missing as string) ?? 'listwise'
  }
}

/* ── NPAR TESTS family ───────────────────────────────────────────────────
 * Two things the pasted command genuinely cannot carry, so they are left out
 * of every canonical form below (and documented in the harness README):
 *   - the Monte Carlo SEED (SPSS keeps it on a separate `SET SEED` command);
 *   - the K-sample dialogs' "pairwise comparisons" checkbox, which is a
 *     Nonparametric-Tests-dialog feature with no NPAR TESTS keyword.
 * Everything else — the p-value method, the missing strategy, the test
 * parameters — must survive the round trip. */
const pMethodOf = (p: Params): unknown => {
  const opts = (p.options ?? {}) as Params
  const pm = opts.pMethod as Params | undefined
  if (!pm) return 'asymptotic'
  // `samples` is meaningless for the exact branch (the R side ignores it) and
  // /METHOD=EXACT has no place to put it.
  return pm.method === 'exact' ? 'exact' : { method: pm.method, samples: pm.samples }
}
const missingOf = (p: Params, dflt = 'analysis'): string =>
  (((p.options ?? {}) as Params).missing as string) ?? dflt

function canonNparVars(p: Params) {
  return { vars: namesOf(p, 'variables'), pMethod: pMethodOf(p) }
}
function canonNparBinomial(p: Params) {
  return { vars: namesOf(p, 'variables'), testProp: Number(p.testProp), pMethod: pMethodOf(p) }
}
function canonNparKs(p: Params) {
  return { vars: namesOf(p, 'variables'), dist: p.dist, pMethod: pMethodOf(p) }
}
function canonNparRuns(p: Params) {
  return { vars: namesOf(p, 'variables'), cutPoint: p.cutPoint, pMethod: pMethodOf(p) }
}
function canonNparMW(p: Params) {
  return {
    vars: namesOf(p, 'variables'),
    group: p.groupName ?? nameOf(p, p.groupVar),
    group1: String(p.group1),
    group2: String(p.group2),
    missing: missingOf(p),
    pMethod: pMethodOf(p)
  }
}
function canonNparKW(p: Params) {
  return {
    vars: namesOf(p, 'variables'),
    factor: p.factorName ?? nameOf(p, p.factor),
    missing: missingOf(p),
    pMethod: pMethodOf(p)
  }
}
function canonNparWilcoxon(p: Params) {
  return {
    var1: namesOf(p, 'var1'),
    var2: namesOf(p, 'var2'),
    missing: missingOf(p),
    pMethod: pMethodOf(p)
  }
}

/* ── Scale / Reports / Correlate / Regression ─────────────────────────────
 * OLAP CUBES' missing strategy is deliberately absent: SPSS's command has no
 * /MISSING keyword at all (it rejects one), so Paste cannot carry the dialog's
 * option. Everything else round-trips. */
const SUMMARY_STAT_KEYS = [
  'n',
  'mean',
  'median',
  'groupedMedian',
  'seMean',
  'sum',
  'min',
  'max',
  'range',
  'first',
  'last',
  'sd',
  'variance',
  'kurtosis',
  'seKurtosis',
  'skewness',
  'seSkewness',
  'pctTotalN',
  'pctTotalSum'
] as const
const statsOf = (p: Params): string[] => {
  const st = ((p.options ?? {}) as Record<string, Params>).stats ?? {}
  return SUMMARY_STAT_KEYS.filter(k => st[k] === true)
}

function canonReliability(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    interItemCorr: opts.interItemCorr === true,
    model: (opts.model as string) ?? 'alpha'
  }
}
function canonPartialCorr(p: Params) {
  return { vars: namesOf(p, 'variables'), controls: namesOf(p, 'controls') }
}
function canonCaseSummaries(p: Params) {
  return {
    vars: namesOf(p, 'variables'),
    group: p.groupVarName ?? (p.groupVar ? nameOf(p, p.groupVar) : null),
    displayCases: p.displayCases !== false,
    subtotals: p.subtotals !== false,
    limitCases: (p.limitCases as number | null) ?? null,
    stats: statsOf(p),
    missing: missingOf(p)
  }
}
function canonOlapCubes(p: Params) {
  return {
    vars: namesOf(p, 'variables'),
    groups: ((p.groupVars as string[] | undefined) ?? []).map(c => {
      const names = p.groupVarNames as Record<string, string> | undefined
      return names?.[c] ?? c
    }),
    stats: statsOf(p)
  }
}
function canonRatio(p: Params) {
  return {
    numerator: nameOf(p, p.numerator),
    denominator: nameOf(p, p.denominator),
    group: p.group ? nameOf(p, p.group) : null
  }
}
function canonRoc(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    state: p.stateName ?? nameOf(p, p.stateVar),
    stateValue: String(p.stateValue),
    direction: (opts.direction as string) ?? 'larger',
    coordinates: opts.coordinates === true
  }
}
function canonCurve(p: Params) {
  const m = (p.models ?? {}) as Params
  // Curve Estimation (2026-09) moved to multiple dependents + Time mode +
  // the full SPSS model set (shared/logistic-types.ts sibling: see
  // regression-curve.R) — `dependents`/`dependentNames` replaced the old
  // singular `dependent`/`dependentName`.
  const depNames = (p.dependentNames ?? {}) as Record<string, string>
  const deps = ((p.dependents as string[] | undefined) ?? []).map(c => depNames[c] ?? c)
  return {
    deps,
    indep: p.independentMode === 'time' ? null : (p.independentName ?? nameOf(p, p.independent)),
    models: (
      [
        'linear',
        'logarithmic',
        'inverse',
        'quadratic',
        'cubic',
        'power',
        's',
        'growth',
        'exponential',
        'compound',
        'logistic'
      ] as const
    ).filter(k => m[k] === true)
  }
}
function canonLogistic(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    covariates: namesOf(p, 'covariates')
  }
}

/* ── GLM / Classify / Dimension / Survival ────────────────────────────────
 * DISCRIMINANT's /GROUPS value range and the K-W range above are the same
 * situation: SPSS's syntax demands one, the dialog has none, and neither side
 * uses it (both take the levels present), so it is not part of the form. */
function canonGlmUni(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    factors: ((p.factors as string[] | undefined) ?? []).map(c => {
      const names = p.factorNames as Record<string, string> | undefined
      return names?.[c] ?? c
    })
  }
}
function canonFactor(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    rotation: (opts.rotation as string) ?? 'none',
    kmoBartlett: opts.kmoBartlett === true
  }
}
function canonDiscriminant(p: Params) {
  return { group: p.groupName ?? nameOf(p, p.groupVar), independents: namesOf(p, 'independents') }
}
function canonKmeans(p: Params) {
  return { vars: namesOf(p, 'variables'), clusters: Number(p.clusters) }
}
function canonHier(p: Params) {
  return { vars: namesOf(p, 'variables'), method: p.method }
}
function canonDistances(p: Params) {
  return { vars: namesOf(p, 'variables'), measure: p.measure }
}
function canonKm(p: Params) {
  return {
    time: p.timeName ?? nameOf(p, p.timeVar),
    status: p.statusName ?? nameOf(p, p.statusVar),
    eventValue: String(p.eventValue),
    factor: p.factor ? (p.factorName ?? nameOf(p, p.factor)) : null
  }
}
function canonCox(p: Params) {
  return {
    time: p.timeName ?? nameOf(p, p.timeVar),
    status: nameOf(p, p.statusVar),
    eventValue: String(p.eventValue),
    covariates: namesOf(p, 'covariates')
  }
}

function canonGlmMulti(p: Params) {
  return {
    deps: ((p.dependents as string[] | undefined) ?? []).map(c => {
      const n = p.dependentNames as Record<string, string> | undefined
      return n?.[c] ?? c
    }),
    factors: ((p.factors as string[] | undefined) ?? []).map(c => {
      const n = p.factorNames as Record<string, string> | undefined
      return n?.[c] ?? c
    })
  }
}
function canonGlmRepeated(p: Params) {
  return { vars: namesOf(p, 'variables'), factorName: p.factorName }
}
function canonMultResponse(p: Params) {
  return { vars: namesOf(p, 'variables'), countedValue: Number(p.countedValue) }
}
function canonDepCov(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    covariates: namesOf(p, 'covariates')
  }
}
/**
 * Probit Analysis (2026-09) moved from a per-case 0/1 model to SPSS's real
 * grouped PROBIT shape — no scenario is captured for it yet (the old
 * per-case one was removed from ui-job.sps/ui-dialog-runs.json since it no
 * longer describes a runnable dialog state); this canonicalizer is here so
 * a freshly-captured scenario (`node tests/e2e/e2e-ui-syntax.cjs` after
 * `pnpm build`) works without another round of test-file changes.
 */
function canonProbit(p: Params) {
  return {
    respFreq: nameOf(p, p.responseFreq),
    total: nameOf(p, p.totalObserved),
    factor: p.factor ? nameOf(p, p.factor) : null,
    covariates: namesOf(p, 'covariates'),
    transform: p.transform ?? 'none',
    modelType: p.modelType ?? 'probit'
  }
}
function canonLifeTables(p: Params) {
  // The dialog offers no interval width by default; the syntax always carries
  // one, so an absent width canonicalises to SPSS's own 1.
  return {
    time: nameOf(p, p.time),
    status: nameOf(p, p.status),
    interval: (p.interval as number | null) ?? 1
  }
}
// 2026-10: the dialog sends covariates (+ factors); older runs sent the same
// list as predictors — mixed-models.R reads both, so the canon merges them.
function canonMixed(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    predictors: [...namesOf(p, 'predictors'), ...namesOf(p, 'covariates')],
    factors: namesOf(p, 'factors'),
    subject: nameOf(p, p.subject)
  }
}
function canonGenlin(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    predictors: namesOf(p, 'predictors'),
    distribution: p.distribution
  }
}
function canonMva(p: Params) {
  return { vars: namesOf(p, 'variables') }
}
function canonProportions(p: Params) {
  return {
    design: p.design,
    variable: p.varName ?? p.varName1,
    other: p.groupVarName ?? p.varName2 ?? null,
    testValue: p.testValue === undefined ? null : Number(p.testValue),
    successValue: String(p.successValue),
    ciLevel: Number(p.ciLevel)
  }
}
function canonGlmm(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    predictors: namesOf(p, 'predictors'),
    subject: nameOf(p, p.subject),
    family: p.family
  }
}

function canonKnn(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    group: p.groupName ?? nameOf(p, p.groupVar),
    independents: namesOf(p, 'independents'),
    k: Number(opts.k)
  }
}
function canonTree(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    group: p.groupName ?? nameOf(p, p.groupVar),
    independents: namesOf(p, 'independents'),
    maxDepth: Number(opts.maxDepth),
    minCases: Number(opts.minCases)
  }
}
function canonGee(p: Params) {
  return {
    dep: p.dependentName ?? nameOf(p, p.dependent),
    predictors: namesOf(p, 'predictors'),
    subject: nameOf(p, p.subject),
    family: p.family,
    corstr: p.corstr
  }
}
function canonMds(p: Params) {
  return { vars: namesOf(p, 'variables'), dimensions: Number(p.dimensions) }
}
function canonMi(p: Params) {
  return { vars: namesOf(p, 'variables'), m: Number(p.m) }
}
function canonReport(p: Params) {
  return {
    vars: namesOf(p, 'variables'),
    breaks: ((p.breakVars as string[] | undefined) ?? []).map(c => {
      const n = p.breakVarNames as Record<string, string> | undefined
      return n?.[c] ?? c
    }),
    grandTotal: p.grandTotal !== false
  }
}
function canonRocAnalysis(p: Params) {
  const opts = (p.options ?? {}) as Params
  return {
    vars: namesOf(p, 'variables'),
    state: p.stateName ?? nameOf(p, p.stateVar),
    stateValue: String(p.stateValue),
    direction: (opts.direction as string) ?? 'larger',
    ciLevel: Number(opts.ciLevel)
  }
}
function canonPower(p: Params) {
  // SPSS solves for whichever of N / POWER is absent, so only the one the
  // dialog is solving for travels — the other is what comes back.
  return {
    test: p.test,
    effectSize: Number(p.effectSize),
    alpha: Number(p.alpha),
    solvesFor: p.n && Number(p.n) > 0 ? 'power' : 'n'
  }
}
function canonChart(p: Params) {
  return {
    chartType: p.chartType,
    x: p.xVarName ?? nameOf(p, p.xVar),
    y: p.yVar ? (p.yVarName ?? nameOf(p, p.yVar)) : null,
    group: p.groupVar ? (p.groupVarName ?? nameOf(p, p.groupVar)) : null
  }
}

const CANON: Record<string, (p: Params) => unknown> = {
  frequencies: canonFrequencies,
  crosstabs: canonCrosstabs,
  ttestInd: canonTtestInd,
  ttest1: canonTtest1,
  ttestPaired: canonTtestPaired,
  means: canonMeans,
  descriptives: canonDescriptives,
  correlate: canonCorrelate,
  anova: canonAnova,
  regression: canonRegression,
  explore: canonExplore,
  nparChiSq: canonNparVars,
  nparFriedman: canonNparVars,
  nparBinomial: canonNparBinomial,
  nparKS: canonNparKs,
  nparRuns: canonNparRuns,
  nparMW: canonNparMW,
  nparKW: canonNparKW,
  nparWilcoxon: canonNparWilcoxon,
  reliability: canonReliability,
  partialCorr: canonPartialCorr,
  caseSummaries: canonCaseSummaries,
  olapCubes: canonOlapCubes,
  ratio: canonRatio,
  roc: canonRoc,
  curve: canonCurve,
  logistic: canonLogistic,
  glmUni: canonGlmUni,
  factor: canonFactor,
  discriminant: canonDiscriminant,
  kmeans: canonKmeans,
  hier: canonHier,
  distances: canonDistances,
  survivalKM: canonKm,
  survivalCox: canonCox,
  glmMulti: canonGlmMulti,
  glmRep: canonGlmRepeated,
  mr: canonMultResponse,
  multinom: canonDepCov,
  ordinal: canonDepCov,
  probit: canonProbit,
  lifetab: canonLifeTables,
  mixed: canonMixed,
  genlin: canonGenlin,
  missing: canonMva,
  proportionsOne: canonProportions,
  proportionsIndep: canonProportions,
  proportionsPaired: canonProportions,
  glmm: canonGlmm,
  knn: canonKnn,
  tree: canonTree,
  gee: canonGee,
  mds: canonMds,
  mi: canonMi,
  reportSummaries: canonReport,
  reportColumns: canonReport,
  rocAnalysis: canonRocAnalysis,
  power: canonPower,
  'chart-histogram': canonChart,
  'chart-scatter': canonChart,
  'chart-bar': canonChart,
  'chart-line': canonChart,
  'chart-boxplot': canonChart
}

/** Scenario order of the concatenated jobs: SPSS 26 first, then SPSS 32. */
function orderedRuns(): UiRun[] {
  const all = (JSON.parse(readFileSync(RUNS, 'utf8')) as UiRun[]).filter(r => r.syntax)
  return [...all.filter(r => !r.spss32), ...all.filter(r => r.spss32)]
}

describe('UI syntax dispatch (ui-job.sps + ui-job32.sps)', () => {
  it('artifacts exist (run node tests/e2e/e2e-ui-syntax.cjs first)', () => {
    expect(existsSync(JOB), 'ui-job.sps missing — run node tests/e2e/e2e-ui-syntax.cjs').toBe(true)
    expect(existsSync(RUNS), 'ui-dialog-runs.json missing').toBe(true)
  })

  it('routes every pasted command without an error and writes ui-syntax-params.json', async () => {
    const { dispatched, unhandled, errors } = await dispatchUiJob()
    expect(errors, `dispatch errors: ${JSON.stringify(errors)}`).toEqual([])
    // DATASET DECLARE joins the plumbing for the same reason COMPUTE did:
    // MULTIPLE IMPUTATION's paste needs somewhere to put the imputations.
    const PLUMBING = /^\s*(SET|GET DATA|FORMATS|COMPUTE|EXECUTE|DATASET|\*)/i
    const unexpected = unhandled.filter(s => !PLUMBING.test(s) && s.trim() !== '')
    expect(unexpected, `unrouted commands: ${JSON.stringify(unexpected)}`).toEqual([])

    const runs = orderedRuns()
    expect(
      dispatched.length,
      `dispatched ${dispatched.length} commands but the e2e captured ${runs.length} scenarios`
    ).toBe(runs.length)

    writeFileSync(
      join(HERE, 'ui-syntax-params.json'),
      JSON.stringify(
        dispatched.map((d, i) => ({ id: runs[i]?.id ?? `#${i}`, ...d })),
        null,
        2
      )
    )
  })

  it('Paste ≡ OK: syntax-derived params describe the same analysis as the dialog', async () => {
    const { dispatched } = await dispatchUiJob()
    const runs = orderedRuns()

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!
      const viaSyntax = dispatched[i]?.request
      expect(
        viaSyntax?.analysisId,
        `${run.id}: scenario order diverged (${viaSyntax?.analysisId} ≠ ${run.okRequest.analysisId})`
      ).toBe(run.okRequest.analysisId)

      const canon = CANON[run.okRequest.analysisId]
      if (!canon) throw new Error(`no canonicalizer for ${run.okRequest.analysisId}`)
      expect(
        canon(viaSyntax!.params as Params),
        `${run.id}: Paste and OK disagree — the syntax lost (or invented) dialog state`
      ).toEqual(canon(run.okRequest.params as Params))
    }
  })
})
