// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { CorrelateOptions } from '../correlate-types'
import { defaultCorrelateOptions } from '../correlate-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import {
  afterEquals,
  parseList,
  parseMissingStrategy,
  parseSubcommand,
  parseVariablesList,
  resolveVars,
  variableListPart,
  splitOnBy,
  splitOnWith
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── Descriptive-statistics command handlers ───────────────────────────────

/**
 * SPSS statistic keywords → our option flags. Shared shape, but the two
 * commands spell a few keys differently (FREQUENCIES uses `semean`,
 * DESCRIPTIVES `seMean`), so each caller maps through its own table.
 *
 * SPSS's own aliases: DEFAULT = MEAN STDDEV MINIMUM MAXIMUM; ALL turns on
 * everything the command offers; NONE suppresses the lot. SESKEW/SEKURT have
 * no separate flag here — our tables always print a standard error beside the
 * moment it belongs to — so they are accepted and folded into SKEWNESS /
 * KURTOSIS rather than rejected.
 */
const FREQ_STAT_KEYWORDS: Record<string, string> = {
  MEAN: 'mean',
  MEDIAN: 'median',
  MODE: 'mode',
  SUM: 'sum',
  STDDEV: 'sd',
  VARIANCE: 'variance',
  RANGE: 'range',
  MINIMUM: 'min',
  MIN: 'min',
  MAXIMUM: 'max',
  MAX: 'max',
  SEMEAN: 'semean',
  CV: 'cv',
  SKEWNESS: 'skewness',
  SESKEW: 'skewness',
  KURTOSIS: 'kurtosis',
  SEKURT: 'kurtosis'
}

const DESC_STAT_KEYWORDS: Record<string, string> = {
  MEAN: 'mean',
  SUM: 'sum',
  STDDEV: 'sd',
  VARIANCE: 'variance',
  RANGE: 'range',
  MINIMUM: 'min',
  MIN: 'min',
  MAXIMUM: 'max',
  MAX: 'max',
  SEMEAN: 'seMean',
  SKEWNESS: 'skewness',
  SESKEW: 'skewness',
  KURTOSIS: 'kurtosis',
  SEKURT: 'kurtosis'
}

/**
 * Resolve a /STATISTICS keyword list against a keyword table.
 * Returns null when the subcommand is absent, so the caller can apply its own
 * default rather than treating "absent" as "none".
 */
function resolveStatKeywords(
  body: string,
  table: Record<string, string>,
  defaults: string[]
): Record<string, boolean> | null {
  const words = parseSubcommand(body, 'STATISTICS')
  if (!words) return null
  const flags: Record<string, boolean> = {}
  for (const key of Object.values(table)) flags[key] = false
  if (words.includes('NONE')) return flags
  if (words.includes('ALL')) {
    for (const key of Object.values(table)) flags[key] = true
    return flags
  }
  for (const w of words) {
    if (w === 'DEFAULT') {
      for (const key of defaults) flags[key] = true
      continue
    }
    const key = table[w]
    if (key) flags[key] = true
  }
  return flags
}

export async function runFrequencies(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]

  // Without this, real SPSS syntax lost every requested statistic silently:
  // the flags below used to be hard-coded false, so
  // `FREQUENCIES VARIABLES=age /STATISTICS=MEAN MEDIAN` produced a bare
  // frequency table and no Statistics table, with nothing in the log to say so.
  const statFlags =
    resolveStatKeywords(st.body, FREQ_STAT_KEYWORDS, ['mean', 'sd', 'min', 'max']) ??
    Object.fromEntries(Object.values(FREQ_STAT_KEYWORDS).map(k => [k, false]))

  // /PERCENTILES=25 50 75 90 → explicit list; /NTILES=k → k equal groups
  // (SPSS's own spelling for "cut points", and /NTILES=4 is the quartiles).
  const pctWords = parseSubcommand(st.body, 'PERCENTILES')
  const customPercentiles = (pctWords ?? [])
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 100)
  const ntiles = Number((parseSubcommand(st.body, 'NTILES') ?? [])[0])

  const formatWords = parseSubcommand(st.body, 'FORMAT') ?? []
  // Vocabulary taken from FrequenciesDialog/frequencies.R, not invented: the
  // script switches on exactly these four strings and silently falls back to
  // ascending for anything else.
  const order = formatWords.includes('DVALUE')
    ? 'descending'
    : formatWords.includes('AFREQ')
      ? 'ascFreq'
      : formatWords.includes('DFREQ')
        ? 'descFreq'
        : 'ascending'

  await ctx.runAnalysis({
    analysisId: 'frequencies',
    scriptFile: 'frequencies.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      valueLabels: Object.fromEntries(resolved.map(v => [v.colId, v.valueLabels])),
      options: {
        // /FORMAT=NOTABLE asks for the statistics WITHOUT the frequency table.
        showTable: !formatWords.includes('NOTABLE'),
        order,
        statistics: {
          ...statFlags,
          percentiles: customPercentiles.length > 0,
          customPercentiles,
          ...(Number.isFinite(ntiles) && ntiles > 1 ? { cutPoints: ntiles } : {})
        },
        charts: {
          // The script's vocabulary is the dialog's ('barChart'/'pieChart'),
          // not SPSS's keyword: emitting 'bar' made a pasted /BARCHART draw
          // nothing, silently.
          type: /\/HISTOGRAM\b/i.test(st.body)
            ? 'histogram'
            : /\/BARCHART\b/i.test(st.body)
              ? 'barChart'
              : /\/PIECHART\b/i.test(st.body)
                ? 'pieChart'
                : 'none',
          showNormalCurve: /\/HISTOGRAM[^/]*\bNORMAL\b/i.test(st.body)
        }
      }
    }
  })
  return [dispatchedToOutput('FREQUENCIES', resolved)]
}

export async function runDescriptives(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]

  // Same defect as FREQUENCIES had: /STATISTICS was ignored, so pasted SPSS
  // syntax always produced SPSS's DEFAULT four regardless of what it asked for.
  // Absent subcommand still means DEFAULT (mean/sd/min/max), as in SPSS.
  const stats = resolveStatKeywords(st.body, DESC_STAT_KEYWORDS, ['mean', 'sd', 'min', 'max']) ?? {
    mean: true,
    sd: true,
    min: true,
    max: true
  }

  const sortWords = parseSubcommand(st.body, 'SORT') ?? []
  // `/SORT=MEAN (D)` splits into ["MEAN", "(D)"] — compare without parens.
  const sortBare = sortWords.map(w => w.replace(/[()]/g, ''))

  await ctx.runAnalysis({
    analysisId: 'descriptives',
    scriptFile: 'descriptives.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      options: {
        mean: false,
        sum: false,
        sd: false,
        variance: false,
        range: false,
        min: false,
        max: false,
        seMean: false,
        kurtosis: false,
        skewness: false,
        ...stats,
        // DescriptivesDialog's own vocabulary; SPSS's /SORT=MEAN (A|D).
        displayOrder: sortBare.includes('MEAN')
          ? sortBare.includes('D')
            ? 'meanDesc'
            : 'meanAsc'
          : sortBare.includes('NAME')
            ? 'alpha'
            : 'variable'
      },
      // /SAVE writes z-scores into new variables — SPSS's own spelling.
      saveZScores: /\/SAVE\b/i.test(st.body)
    }
  })
  return [dispatchedToOutput('DESCRIPTIVES', resolved)]
}

/** CORRELATIONS VARIABLES=v1 v2 …  → bivariate correlation (Pearson default). */
export async function runCorrelations(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]

  const coefWords = parseSubcommand(st.body, 'COEFFICIENT') || []
  const hasCoef = coefWords.length > 0
  const pearson = !hasCoef || coefWords.includes('PEARSON')
  const spearman = coefWords.includes('SPEARMAN')
  const kendall = coefWords.includes('KENDALL')

  const printWords = parseSubcommand(st.body, 'PRINT') || []
  const statsWords = parseSubcommand(st.body, 'STATISTICS') || []
  const options: CorrelateOptions = {
    ...defaultCorrelateOptions,
    // /MISSING=LISTWISE (SPSS's own default here is PAIRWISE — no key).
    missing: parseMissingStrategy(st.body) ? 'listwise' : 'pairwise',
    oneTailed: printWords.includes('ONETAIL'),
    flagSignificant: !printWords.includes('NOSIG'),
    meansAndSD: statsWords.includes('DESCRIPTIVES'),
    crossProduct: statsWords.includes('XPROD')
  }

  await ctx.runAnalysis({
    analysisId: 'correlate',
    scriptFile: 'correlation.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      methods: { pearson, spearman, kendall },
      options
    }
  })
  return [dispatchedToOutput('CORRELATIONS', resolved)]
}

/** PARTIAL CORR VARIABLES=varlist BY control-varlist */
export async function runPartialCorr(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  const { left, right } = splitOnBy(listPart)
  const vars = resolveVars(left, ctx.variables)
  const ctrls = resolveVars(right, ctx.variables)
  const unknown = [...vars.unknown, ...ctrls.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (vars.resolved.length < 2 || ctrls.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.partialCorrSyntax' }]

  await ctx.runAnalysis({
    analysisId: 'partialCorr',
    scriptFile: 'correlation-partial.R',
    params: {
      variables: vars.resolved.map(v => v.colId),
      controls: ctrls.resolved.map(v => v.colId),
      varNames: Object.fromEntries(
        [...vars.resolved, ...ctrls.resolved].map(v => [v.colId, v.name])
      )
    }
  })
  return [dispatchedToOutput('PARTIAL CORR', [...vars.resolved, ...ctrls.resolved])]
}

/** MEANS TABLES=dep1 dep2 BY factor  → group means for one factor. */
export async function runMeans(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const listPart = /TABLES\s*=/i.test(st.body) ? afterEquals(st.body, 'TABLES') : st.body
  const { left, right } = splitOnBy(listPart)
  const deps = resolveVars(left, ctx.variables)
  const facs = resolveVars(right, ctx.variables)
  const unknown = [...deps.unknown, ...facs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (deps.resolved.length === 0 || facs.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.meansSyntax' }]
  const factor = facs.resolved[0] as Variable

  await ctx.runAnalysis({
    analysisId: 'means',
    scriptFile: 'means.R',
    params: {
      variables: deps.resolved.map(v => v.colId),
      varNames: Object.fromEntries(deps.resolved.map(v => [v.colId, v.label || v.name])),
      factor: factor.colId,
      factorName: factor.label || factor.name,
      factorValueLabels: factor.valueLabels,
      // /CELLS was parsed away with the rest of the tail and dropped, so
      // `MEANS … /CELLS MEAN COUNT STDDEV MEDIAN MIN MAX …` produced the same
      // three columns as a bare MEANS — quietly, with a success message. Same
      // keyword table SUMMARIZE and OLAP CUBES use; means.R takes the cells it
      // implements and ignores the rest.
      options: {
        cells: parseCellStats(st.body),
        ...(parseMissingStrategy(st.body) ? { missing: 'listwise' as const } : {})
      }
    }
  })
  return [dispatchedToOutput('MEANS', [...deps.resolved, factor])]
}

/** CROSSTABS /TABLES=row BY col [/STATISTICS=...] [/CELLS=...] → contingency table (chi-square default). */
export async function runCrosstabs(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { left, right } = splitOnBy(afterEquals(st.body, 'TABLES'))
  const rows = resolveVars(left, ctx.variables)
  const cols = resolveVars(right, ctx.variables)
  const unknown = [...rows.unknown, ...cols.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (rows.resolved.length === 0 || cols.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.crosstabsSyntax' }]

  // SPSS's own keywords are CHISQ / BTAU / CTAU — not the longer spellings
  // this used to require. `/STATISTICS=CHISQ PHI`, straight out of SPSS,
  // produced no chi-square table at all and said nothing about it.
  const statsWords = parseSubcommand(st.body, 'STATISTICS')
  const anyOf = (...words: string[]): boolean =>
    !!statsWords &&
    (statsWords.includes('ALL') || words.some(w => statsWords.includes(w))) &&
    !statsWords.includes('NONE')
  const stats = statsWords
    ? {
        chisquare: anyOf('CHISQ', 'CHISQUARE'),
        phiCramer: anyOf('PHI', 'CRAMER'),
        contingency: anyOf('CC', 'CONTINGENCY'),
        correlations: anyOf('CORR', 'CORRELATIONS'),
        gamma: anyOf('GAMMA'),
        somersd: anyOf('D', 'SOMERSD'),
        taub: anyOf('BTAU', 'BTAUB', 'TAUB'),
        tauc: anyOf('CTAU', 'CTAUC', 'TAUC'),
        eta: anyOf('ETA'),
        kappa: anyOf('KAPPA'),
        risk: anyOf('RISK'),
        mcnemar: anyOf('MCNEMAR')
      }
    : {
        chisquare: true,
        phiCramer: false,
        contingency: false,
        correlations: false,
        gamma: false,
        somersd: false,
        taub: false,
        tauc: false,
        eta: false,
        kappa: false,
        risk: false,
        mcnemar: false
      }

  const cellsWords = parseSubcommand(st.body, 'CELLS')
  const cells = cellsWords
    ? {
        observed: cellsWords.includes('COUNT') || cellsWords.includes('OBSERVED'),
        expected: cellsWords.includes('EXPECTED'),
        rowPct: cellsWords.includes('ROW'),
        colPct: cellsWords.includes('COLUMN') || cellsWords.includes('COL'),
        totalPct: cellsWords.includes('TOTAL'),
        unstdResid: cellsWords.includes('RESID') || cellsWords.includes('UNSTDRESID'),
        stdResid: cellsWords.includes('SRESID') || cellsWords.includes('STDRESID'),
        adjResid: cellsWords.includes('ASRESID') || cellsWords.includes('ADJRESID')
      }
    : {
        observed: true,
        expected: false,
        rowPct: false,
        colPct: false,
        totalPct: false,
        unstdResid: false,
        stdResid: false,
        adjResid: false
      }

  await ctx.runAnalysis({
    analysisId: 'crosstabs',
    scriptFile: 'crosstabs.R',
    params: {
      rows: rows.resolved.map(v => v.colId),
      rowNames: Object.fromEntries(rows.resolved.map(v => [v.colId, v.name])),
      cols: cols.resolved.map(v => v.colId),
      colNames: Object.fromEntries(cols.resolved.map(v => [v.colId, v.name])),
      options: { cells, stats }
    }
  })
  return [dispatchedToOutput('CROSSTABS', [...rows.resolved, ...cols.resolved])]
}

/** EXAMINE VARIABLES=dep [BY factor]  → Explore (descriptives + boxplot). */
export async function runExamine(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  const { left, right } = splitOnBy(listPart)
  const deps = resolveVars(left, ctx.variables)
  const facs = resolveVars(right, ctx.variables)
  const unknown = [...deps.unknown, ...facs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (deps.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]

  // Same defect FREQUENCIES and DESCRIPTIVES had: the subcommands were parsed
  // by nobody. `/PERCENTILES` produced no percentile table, `/PLOT NONE` still
  // drew a boxplot, and `/STATISTICS EXTREME` was dropped — all silently.
  const statWords = parseSubcommand(st.body, 'STATISTICS') ?? []
  const plotWords = parseSubcommand(st.body, 'PLOT') ?? []
  // /PERCENTILES takes an optional value list, so it can appear bare; a
  // keyword lookup that requires `=` misses `/PERCENTILES(5,10,25)`.
  const wantsPercentiles = /\/PERCENTILES\b/i.test(st.body)
  // /MESTIMATORS is its own subcommand in SPSS — nobody parsed it either.
  const wantsMestimators = /\/MESTIMATORS\b/i.test(st.body)
  const statsAll = statWords.includes('ALL')
  const plotsNone = plotWords.includes('NONE')
  const plotsAll = plotWords.includes('ALL')

  const hasStats = statWords.length > 0 || wantsPercentiles || wantsMestimators
  const hasPlots = plotWords.length > 0 && !plotsNone

  await ctx.runAnalysis({
    analysisId: 'explore',
    scriptFile: 'explore.R',
    params: {
      variables: deps.resolved.map(v => v.colId),
      varNames: Object.fromEntries(deps.resolved.map(v => [v.colId, v.label || v.name])),
      factors: facs.resolved.map(v => v.colId),
      factorNames: Object.fromEntries(facs.resolved.map(v => [v.colId, v.label || v.name])),
      ...(facs.resolved.some(v => Object.keys(v.valueLabels).length > 0)
        ? {
            factorValueLabels: Object.fromEntries(facs.resolved.map(v => [v.colId, v.valueLabels]))
          }
        : {}),
      options: {
        display: hasStats && !hasPlots ? 'statistics' : !hasStats && hasPlots ? 'plots' : 'both',
        stats: {
          descriptives: statsAll || statWords.includes('DESCRIPTIVES') || !hasStats,
          percentiles: statsAll || wantsPercentiles,
          outliers: statsAll || statWords.some(w => w.startsWith('EXTREME')),
          mEstimators: statsAll || wantsMestimators
        },
        plots: {
          boxplot: plotsNone ? false : plotsAll || plotWords.includes('BOXPLOT') || !hasPlots,
          histogram: plotsNone ? false : plotsAll || plotWords.includes('HISTOGRAM'),
          normality: plotsNone ? false : plotsAll || plotWords.includes('NPPLOT')
        },
        // /MISSING=LISTWISE (absent = SPSS's default, which for EXAMINE is
        // itself listwise — explore.R defaults the same way).
        ...(parseMissingStrategy(st.body) ? { missing: 'listwise' as const } : {})
      }
    }
  })
  return [dispatchedToOutput('EXAMINE', [...deps.resolved, ...facs.resolved])]
}

/** RATIO STATISTICS numerator WITH denominator [BY group] */
export async function runRatio(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const { left, right } = splitOnWith(st.body)
  const { left: denomList, right: groupList } = splitOnBy(right.join(' '))
  const num = resolveVars(left.slice(0, 1), ctx.variables)
  const den = resolveVars(denomList.slice(0, 1), ctx.variables)
  const grp = groupList.length
    ? resolveVars(groupList.slice(0, 1), ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  const unknown = [...num.unknown, ...den.unknown, ...grp.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (num.resolved.length === 0 || den.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.ratioSyntax' }]
  const n = num.resolved[0] as Variable
  const d = den.resolved[0] as Variable
  const g = grp.resolved[0]

  await ctx.runAnalysis({
    analysisId: 'ratio',
    scriptFile: 'ratio.R',
    params: { numerator: n.colId, denominator: d.colId, group: g ? g.colId : null }
  })
  return [dispatchedToOutput('RATIO STATISTICS', g ? [n, d, g] : [n, d])]
}

/** RELIABILITY VARIABLES=varlist [/STATISTICS=...CORRELATIONS...] */
export async function runReliability(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]
  const statsWords = parseSubcommand(st.body, 'STATISTICS') || []
  const interItemCorr = statsWords.includes('CORRELATIONS') || statsWords.includes('ALL')
  // /MODEL picks the reliability model, not a statistic: ALPHA (the default)
  // or SPLIT, which cuts the scale in two and reports the halves' agreement.
  // Anything else (GUTTMAN, PARALLEL, STRICTPARALLEL) is not implemented, so
  // it falls back to ALPHA rather than being silently read as SPLIT.
  const modelWords = parseSubcommand(st.body, 'MODEL') || []
  const model = modelWords.includes('SPLIT') ? 'split' : 'alpha'

  await ctx.runAnalysis({
    analysisId: 'reliability',
    scriptFile: 'reliability.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      options: { interItemCorr, model }
    }
  })
  return [dispatchedToOutput('RELIABILITY', resolved)]
}

/**
 * SPSS /CELLS keywords for SUMMARIZE and OLAP CUBES → the shared statistic
 * registry in _bootstrap.R (sai_summary_stat_defs). Both commands take the
 * same vocabulary, so both map through this table.
 */
const CELL_STAT_KEYWORDS: Record<string, string> = {
  COUNT: 'n',
  MEAN: 'mean',
  MEDIAN: 'median',
  GMEDIAN: 'groupedMedian',
  SEMEAN: 'seMean',
  SUM: 'sum',
  MIN: 'min',
  MINIMUM: 'min',
  MAX: 'max',
  MAXIMUM: 'max',
  RANGE: 'range',
  FIRST: 'first',
  LAST: 'last',
  STDDEV: 'sd',
  VARIANCE: 'variance',
  KURT: 'kurtosis',
  SEKURT: 'seKurtosis',
  SKEW: 'skewness',
  SESKEW: 'seSkewness',
  HARMONIC: 'harmonic',
  GEOMETRIC: 'geometric',
  // OLAP Cubes' percentage cells. Absent from this table, the dialog's
  // "% of Total N" / "% of Total Sum" checkboxes could not survive a Paste.
  NPCT: 'pctTotalN',
  SPCT: 'pctTotalSum'
}

/**
 * The per-grouping-variable percentage cells, NPCT(bulanti) / SPCT(bulanti).
 * SPSS names the variable inside the keyword; the dialog offers one checkbox
 * that covers every grouping variable, so which variable is named does not
 * change what runs — only that the cell was asked for.
 */
const CELL_PERCENT_IN_KEYWORDS: [RegExp, string][] = [
  [/^NPCT\s*\(/i, 'pctNIn'],
  [/^SPCT\s*\(/i, 'pctSumIn']
]

/** Resolve a /CELLS list; SPSS's DEFAULT is count/mean/std deviation. */
function parseCellStats(body: string): Record<string, boolean> {
  const words = parseSubcommand(body, 'CELLS')
  const flags: Record<string, boolean> = {}
  for (const key of Object.values(CELL_STAT_KEYWORDS)) flags[key] = false
  for (const [, key] of CELL_PERCENT_IN_KEYWORDS) flags[key] = false
  if (!words || words.includes('DEFAULT')) {
    flags.n = true
    flags.mean = true
    flags.sd = true
    return flags
  }
  if (words.includes('ALL')) {
    for (const key of Object.keys(flags)) flags[key] = true
    return flags
  }
  for (const w of words) {
    // NPCT(var) before NPCT: the parenthesised form is a different cell, and
    // an exact-match lookup would miss it and leave the flag off.
    const inKey = CELL_PERCENT_IN_KEYWORDS.find(([re]) => re.test(w))
    if (inKey) {
      flags[inKey[1]] = true
      continue
    }
    const key = CELL_STAT_KEYWORDS[w]
    if (key) flags[key] = true
  }
  return flags
}

/**
 * SUMMARIZE /TABLES=v1 v2 [BY break] [/FORMAT=...] [/CELLS=...]  → Case Summaries.
 * Both this and OLAP CUBES below were previously unrouted: the analyses and
 * their dialogs exist, but pasting SPSS's own syntax for them reported
 * "Unrecognized command".
 */
export async function runSummarize(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const tablesPart = /TABLES\s*=/i.test(st.body)
    ? afterEquals(st.body, 'TABLES')
    : variableListPart(st.body)
  const { left, right } = splitOnBy(tablesPart)
  const vars = resolveVars(left, ctx.variables)
  const breaks = resolveVars(right, ctx.variables)
  const unknown = [...vars.unknown, ...breaks.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (vars.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]

  const fmt = parseSubcommand(st.body, 'FORMAT') ?? []
  const limitM = /\bLIMIT\s*=?\s*\(?\s*(\d+)/i.exec(st.body)
  const group = breaks.resolved[0]

  await ctx.runAnalysis({
    analysisId: 'caseSummaries',
    scriptFile: 'case-summaries.R',
    params: {
      variables: vars.resolved.map(v => v.colId),
      varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
      ...(group ? { groupVar: group.colId, groupVarName: group.name } : {}),
      // /FORMAT=NOLIST asks for the summary without the per-case listing.
      displayCases: !fmt.includes('NOLIST'),
      subtotals: !fmt.includes('NOTOTAL'),
      limitCases: limitM ? Number(limitM[1]) : null,
      options: {
        stats: parseCellStats(st.body),
        ...(parseMissingStrategy(st.body) ? { missing: 'listwise' as const } : {})
      }
    }
  })
  return [dispatchedToOutput('SUMMARIZE', vars.resolved)]
}

/** OLAP CUBES v1 [v2] BY grp1 [grp2 ...] [/CELLS=...] → OLAP Cubes. */
export async function runOlapCubes(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { left, right } = splitOnBy(variableListPart(st.body))
  const vars = resolveVars(left, ctx.variables)
  const groups = resolveVars(right, ctx.variables)
  const unknown = [...vars.unknown, ...groups.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (vars.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]
  // SPSS itself rejects a string summary variable here; so does olap-cubes.R.
  const firstString = vars.resolved.find(v => v.type === 'string')
  if (firstString) {
    return [
      { level: 'error', key: 'terminal.log.olapStringVar', params: { name: firstString.name } }
    ]
  }

  await ctx.runAnalysis({
    analysisId: 'olapCubes',
    scriptFile: 'olap-cubes.R',
    params: {
      variables: vars.resolved.map(v => v.colId),
      varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
      groupVars: groups.resolved.map(v => v.colId),
      groupVarNames: Object.fromEntries(groups.resolved.map(v => [v.colId, v.name])),
      options: {
        stats: parseCellStats(st.body),
        ...(parseMissingStrategy(st.body) ? { missing: 'listwise' as const } : {})
      }
    }
  })
  return [dispatchedToOutput('OLAP CUBES', [...vars.resolved, ...groups.resolved])]
}

/** PROXIMITIES v1 v2 … [/VIEW=VARIABLE] [/MEASURE=EUCLID|SEUCLID|BLOCK|…] */
export async function runProximities(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseList(variableListPart(st.body)), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]

  const measureWords = parseSubcommand(st.body, 'MEASURE') ?? []
  const measure = measureWords.includes('SEUCLID')
    ? 'sqeuclidean'
    : measureWords.includes('BLOCK')
      ? 'manhattan'
      : measureWords.includes('CHEBYCHEV')
        ? 'chebyshev'
        : measureWords.includes('COSINE')
          ? 'cosine'
          : measureWords.includes('CORRELATION')
            ? 'pearson'
            : 'euclidean'

  await ctx.runAnalysis({
    analysisId: 'distances',
    scriptFile: 'distances.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      measure
    }
  })
  return [dispatchedToOutput('PROXIMITIES', resolved)]
}

/** MULT RESPONSE /GROUPS=name (v1 v2 v3 (countedValue)) /FREQUENCIES=name */
export async function runMultResponse(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  // /GROUPS=setname (var var var (value)) — the inner parenthesis holds the
  // counted value, the outer one the variables.
  const m = /GROUPS\s*=?\s*\w+\s*\(([^)]*)\(\s*([^)]*)\)/i.exec(st.body)
  if (!m) return [{ level: 'error', key: 'terminal.log.multResponseSyntax' }]
  const { resolved, unknown } = resolveVars(parseList(m[1] as string), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.noVariables' }]

  await ctx.runAnalysis({
    // Same id the Multiple Response dialog sends (see glmRep above).
    analysisId: 'mr',
    scriptFile: 'multiple-response.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      countedValue: Number(parseList(m[2] as string)[0] ?? 1)
    }
  })
  return [dispatchedToOutput('MULT RESPONSE', resolved)]
}

/** TREE dependent [n] BY v1 [s] v2 [s] [/GROWTHLIMIT MAXDEPTH=… MINPARENT=…] */
export async function runTree(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  // SPSS annotates each variable with its measurement level in brackets
  // ("disease [n]"); those are not part of the name.
  const listPart = variableListPart(st.body).replace(/\[[^\]]*\]/g, ' ')
  const { left, right } = splitOnBy(listPart)
  const dep = resolveVars(left.slice(0, 1), ctx.variables)
  const preds = resolveVars(right, ctx.variables)
  const unknown = [...dep.unknown, ...preds.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || preds.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.treeSyntax' }]
  const d = dep.resolved[0] as Variable

  const depthM = /MAXDEPTH\s*=?\s*(\d+)/i.exec(st.body)
  // SPSS's keyword is MINPARENTSIZE; MINPARENT alone is what this used to
  // look for, so the minimum-cases limit of a pasted TREE was always dropped.
  const parentM = /MINPARENT(?:SIZE)?\s*=?\s*(\d+)/i.exec(st.body)

  await ctx.runAnalysis({
    analysisId: 'tree',
    scriptFile: 'tree.R',
    params: {
      groupVar: d.colId,
      groupName: d.label || d.name,
      groupValueLabels: d.valueLabels,
      independents: preds.resolved.map(v => v.colId),
      // varNames stays v.name (not label) — tree.R uses these as literal
      // data.frame column names / rpart formula terms; see TreeDialog.tsx.
      varNames: Object.fromEntries(preds.resolved.map(v => [v.colId, v.name])),
      options: {
        ...(depthM ? { maxDepth: Number(depthM[1]) } : {}),
        ...(parentM ? { minCases: Number(parentM[1]) } : {})
      }
    }
  })
  return [dispatchedToOutput('TREE', [d, ...preds.resolved])]
}

/** MVA VARIABLES=v1 v2 ... (Missing Value Analysis) */
export async function runMva(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]

  await ctx.runAnalysis({
    analysisId: 'missing',
    scriptFile: 'missing-values.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name]))
    }
  })
  return [dispatchedToOutput('MVA', resolved)]
}
