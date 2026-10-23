// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { CorrelateOptions } from '../correlate-types'
import { defaultCorrelateOptions } from '../correlate-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import {
  parseList,
  parseMissingStrategy,
  parseSubcommand,
  resolveVars,
  variableListPart,
  splitOnWith,
  splitTopLevel
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── Nonparametric command handlers ────────────────────────────────────────

/** NONPAR CORR VARIABLES=varlist [WITH varlist2] [/PRINT=SPEARMAN|KENDALL|BOTH] */
export async function runNonparCorr(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  const { left, right } = splitOnWith(listPart)
  const { resolved, unknown } = resolveVars([...left, ...right], ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]
  const printWords = parseSubcommand(st.body, 'PRINT') || []
  const spearman =
    printWords.length === 0 || printWords.includes('SPEARMAN') || printWords.includes('BOTH')
  const kendall = printWords.includes('KENDALL') || printWords.includes('BOTH')
  const options: CorrelateOptions = {
    ...defaultCorrelateOptions,
    missing: parseMissingStrategy(st.body) ? 'listwise' : 'pairwise',
    oneTailed: printWords.includes('ONETAIL'),
    flagSignificant: !printWords.includes('NOSIG')
  }

  await ctx.runAnalysis({
    analysisId: 'correlate',
    scriptFile: 'correlation.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      methods: { pearson: false, spearman, kendall },
      options
    }
  })
  return [dispatchedToOutput('NONPAR CORR', resolved)]
}

// Clauses the per-sub-test loop must NOT treat as a test. SAMPLE is genuinely
// ignored; METHOD, MISSING and STATISTICS are read once, before the loop, and
// forwarded to the sub-tests (parseNparPMethod / parseMissingStrategy /
// parseNparStatistics) — a sub-test whose R script doesn't honour them trips
// the bootstrap's "requested but not applied" honesty warning instead of
// dropping silently.
const NPAR_IGNORED_SUBCOMMANDS = new Set(['STATISTICS', 'SAMPLE', 'METHOD'])

/**
 * `/METHOD=EXACT [TIMER(n)]` | `/METHOD=MC [CIN(n)] [SAMPLES(n)]` — SPSS's
 * Exact Tests p-value method, which the dialogs expose as the shared
 * PMethodSection. It used to sit in NPAR_IGNORED_SUBCOMMANDS: a pasted
 * `/METHOD=EXACT` ran asymptotic-only and said nothing (same silent-drop
 * class as `/MISSING` before it). Returns undefined for the asymptotic
 * default, so no key is sent — matching what the dialogs' buildPMethodParams()
 * does.
 *
 * The Monte Carlo SEED has no NPAR TESTS keyword (SPSS carries it on a
 * separate `SET SEED` command), so a pasted MC run draws its own sample.
 */
export function parseNparPMethod(body: string): Record<string, unknown> | undefined {
  const words = parseSubcommand(body, 'METHOD')
  if (!words || words.length === 0) return undefined
  const head = words[0] as string
  if (head === 'EXACT') return { method: 'exact' }
  if (head !== 'MC' && head !== 'MONTECARLO') return undefined
  const samplesM = /SAMPLES\s*\(\s*(\d+)\s*\)/i.exec(body)
  return { method: 'montecarlo', samples: samplesM ? Number(samplesM[1]) : 10000 }
}

/**
 * `/STATISTICS=DESCRIPTIVES QUARTILES [ALL]` — the summary block the Options
 * button adds. SPSS applies it to every sub-test in the command; only M-W
 * implements it today, so it is attached to that clause alone rather than
 * handed to sub-tests that would drop it without a word.
 */
export function parseNparStatistics(
  body: string
): { descriptives: boolean; quartiles: boolean } | undefined {
  const words = parseSubcommand(body, 'STATISTICS')
  if (!words || words.length === 0) return undefined
  const all = words.includes('ALL')
  return {
    descriptives: all || words.includes('DESCRIPTIVES'),
    quartiles: all || words.includes('QUARTILES')
  }
}

/**
 * NPAR TESTS /SUBCOMMAND=... [/SUBCOMMAND2=...] — one "command" that fans out
 * to several independent nonparametric tests, one per `/`-clause. Only the 10
 * sub-tests with a SAI R script are dispatched (CHISQUARE, K-S, RUNS,
 * BINOMIAL, WILCOXON, M-W, K-W, MEDIAN, J-T, FRIEDMAN); the rest (MCNEMAR,
 * SIGN, COCHRAN, KENDALL, two-sample K-S, W-W, MOSES) have no SAI equivalent
 * yet and get a "not supported" note instead of being silently dropped.
 *
 * K-W/MEDIAN/J-T share one R script (npar-kruskal-wallis.R, "Test Type"
 * checkboxes in the dialog) but are pasted as SEPARATE subcommands by real
 * SPSS syntax, same as CORRELATIONS/NONPAR CORR for mixed coefficients — a
 * pasted command naming more than one of the three dispatches one run PER
 * subcommand (separate output blocks) rather than reconstructing the
 * dialog's single combined run.
 */
/**
 * The variable list of an NPAR TESTS sub-command, e.g. the `score` in
 * `/K-S(NORMAL)=score`.
 *
 * The parenthetical carries the sub-command's own parameter (the test
 * proportion, the distribution, the cut point) and has to come out — but the
 * `=` sits AFTER it, so stripping only the parentheses left "=score" as the
 * variable name and every one of these commands failed with "unknown
 * variables". Only `/CHISQUARE=grp3`, which has no parenthetical, worked.
 */
function nparVarList(rest: string): string[] {
  return parseList(
    rest
      .replace(/\([^)]*\)/g, ' ')
      .replace(/^\s*=\s*/, '')
      .trim()
  )
}

export async function runNparTests(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const out: SyntaxLogEntry[] = []
  const clauses = splitTopLevel(st.body, '/')
    .map(c => c.trim())
    .filter(Boolean)
  if (clauses.length === 0) return [{ level: 'error', key: 'terminal.log.npartestsSyntax' }]

  // /MISSING and /METHOD are global clauses: they apply to every sub-test in
  // the command (the defaults — ANALYSIS, asymptotic — add no key, same as the
  // dialogs' payload).
  const missing = parseMissingStrategy(st.body)
  const pMethod = parseNparPMethod(st.body)
  const globalOptions: Record<string, unknown> = {
    ...(missing ? { missing } : {}),
    ...(pMethod ? { pMethod } : {})
  }
  const optGlobal = Object.keys(globalOptions).length ? { options: globalOptions } : {}
  // /STATISTICS is global too, but M-W/K-W/MEDIAN/J-T are the only sub-tests
  // that render it.
  const nparStatistics = parseNparStatistics(st.body)

  // Shared by /K-W, /MEDIAN and /J-T — same "varlist BY factor(min,max)"
  // shape, same R script, differing only in which Test Type flag is set.
  const dispatchKwFamily = async (
    rest: string,
    testType: { kruskalWallis: boolean; median: boolean; jonckheereTerpstra: boolean },
    cmdLabel: string,
    errorKey: string
  ): Promise<SyntaxLogEntry> => {
    const byM = /\bBY\b\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/i.exec(rest)
    const testListStr = rest.slice(0, byM ? byM.index : rest.length)
    const { resolved: testVars, unknown: u1 } = resolveVars(parseList(testListStr), ctx.variables)
    if (!byM) return { level: 'error', key: errorKey }
    const grp = resolveVars([byM[1] as string], ctx.variables)
    const unknown = [...u1, ...grp.unknown]
    if (unknown.length) return unknownVarsError(unknown)
    if (testVars.length === 0) return { level: 'error', key: errorKey }
    const f = grp.resolved[0] as Variable
    await ctx.runAnalysis({
      analysisId: 'nparKW',
      scriptFile: 'npar-kruskal-wallis.R',
      params: {
        variables: testVars.map(v => v.colId),
        varNames: Object.fromEntries(testVars.map(v => [v.colId, v.name])),
        factor: f.colId,
        factorName: f.name,
        factorValueLabels: f.valueLabels,
        options: { ...globalOptions, ...nparStatistics, testType }
      }
    })
    return dispatchedToOutput(cmdLabel, [...testVars, f])
  }

  for (const clause of clauses) {
    const kwM = /^([A-Z-]+)/i.exec(clause)
    const kw = (kwM?.[1] ?? '').toUpperCase()
    const rest = clause.slice(kwM ? kwM[0].length : 0).replace(/^=\s*/, '')

    if (NPAR_IGNORED_SUBCOMMANDS.has(kw)) continue

    switch (kw) {
      case 'CHISQUARE': {
        const { resolved, unknown } = resolveVars(nparVarList(rest), ctx.variables)
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (resolved.length === 0) {
          out.push({ level: 'error', key: 'terminal.log.noVariables' })
          break
        }
        await ctx.runAnalysis({
          analysisId: 'nparChiSq',
          scriptFile: 'npar-chisquare.R',
          params: {
            variables: resolved.map(v => v.colId),
            varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
            ...optGlobal
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /CHISQUARE', resolved))
        break
      }
      case 'K-S': {
        const distM = /\(\s*(NORMAL|UNIFORM|POISSON|EXPONENTIAL)/i.exec(rest)
        const dist = distM ? (distM[1] as string).toLowerCase() : 'normal'
        const { resolved, unknown } = resolveVars(nparVarList(rest), ctx.variables)
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (resolved.length === 0) {
          out.push({ level: 'error', key: 'terminal.log.noVariables' })
          break
        }
        await ctx.runAnalysis({
          analysisId: 'nparKS',
          scriptFile: 'npar-ks.R',
          params: {
            variables: resolved.map(v => v.colId),
            varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
            dist,
            ...optGlobal
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /K-S', resolved))
        break
      }
      case 'RUNS': {
        const cutM = /\(\s*(MEAN|MEDIAN)/i.exec(rest)
        const { resolved, unknown } = resolveVars(nparVarList(rest), ctx.variables)
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (resolved.length === 0 || !cutM) {
          out.push({ level: 'error', key: 'terminal.log.noVariables' })
          break
        }
        await ctx.runAnalysis({
          analysisId: 'nparRuns',
          scriptFile: 'npar-runs.R',
          params: {
            variables: resolved.map(v => v.colId),
            varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
            cutPoint: (cutM[1] as string).toLowerCase(),
            ...optGlobal
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /RUNS', resolved))
        break
      }
      case 'BINOMIAL': {
        const pM = /\(\s*([\d.]+)\s*\)/.exec(rest)
        const { resolved, unknown } = resolveVars(nparVarList(rest), ctx.variables)
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (resolved.length === 0) {
          out.push({ level: 'error', key: 'terminal.log.noVariables' })
          break
        }
        await ctx.runAnalysis({
          analysisId: 'nparBinomial',
          scriptFile: 'npar-binomial.R',
          params: {
            variables: resolved.map(v => v.colId),
            varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
            testProp: pM ? Number(pM[1]) : 0.5,
            ...optGlobal
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /BINOMIAL', resolved))
        break
      }
      case 'WILCOXON': {
        const cleaned = rest.replace(/\(\s*PAIRED\s*\)/gi, '')
        let v1Names: string[]
        let v2Names: string[]
        if (/\bWITH\b/i.test(cleaned)) {
          const split = splitOnWith(cleaned)
          v1Names = split.left
          v2Names = split.right
        } else {
          const toks = parseList(cleaned)
          if (toks.length !== 2) {
            out.push({ level: 'error', key: 'terminal.log.npartestsWilcoxonSyntax' })
            break
          }
          v1Names = [toks[0] as string]
          v2Names = [toks[1] as string]
        }
        const v1 = resolveVars(v1Names, ctx.variables)
        const v2 = resolveVars(v2Names, ctx.variables)
        const unknown = [...v1.unknown, ...v2.unknown]
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (v1.resolved.length === 0 || v1.resolved.length !== v2.resolved.length) {
          out.push({ level: 'error', key: 'terminal.log.npartestsWilcoxonSyntax' })
          break
        }
        await ctx.runAnalysis({
          analysisId: 'nparWilcoxon',
          scriptFile: 'npar-wilcoxon.R',
          params: {
            var1: v1.resolved.map(v => v.colId),
            var2: v2.resolved.map(v => v.colId),
            varNames: Object.fromEntries(
              [...v1.resolved, ...v2.resolved].map(v => [v.colId, v.name])
            ),
            ...optGlobal
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /WILCOXON', [...v1.resolved, ...v2.resolved]))
        break
      }
      case 'M-W': {
        const byM = /\bBY\b\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/i.exec(rest)
        const testListStr = rest.slice(0, byM ? byM.index : rest.length)
        const { resolved: testVars, unknown: u1 } = resolveVars(
          parseList(testListStr),
          ctx.variables
        )
        if (!byM) {
          out.push({ level: 'error', key: 'terminal.log.npartestsMwSyntax' })
          break
        }
        const groupVals = parseList(byM[2] as string)
        const grp = resolveVars([byM[1] as string], ctx.variables)
        const unknown = [...u1, ...grp.unknown]
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (testVars.length === 0 || groupVals.length < 2) {
          out.push({ level: 'error', key: 'terminal.log.npartestsMwSyntax' })
          break
        }
        const g = grp.resolved[0] as Variable
        await ctx.runAnalysis({
          analysisId: 'nparMW',
          scriptFile: 'npar-mann-whitney.R',
          params: {
            variables: testVars.map(v => v.colId),
            varNames: Object.fromEntries(testVars.map(v => [v.colId, v.name])),
            groupVar: g.colId,
            groupName: g.name,
            groupValueLabels: g.valueLabels,
            group1: groupVals[0],
            group2: groupVals[1],
            // The effect size and boxplot are SAI additions with no NPAR TESTS
            // keyword; they are on by default in the dialog, so a pasted
            // command draws the same output as its OK.
            options: {
              effectSize: true,
              boxplot: true,
              ...globalOptions,
              ...(nparStatistics ?? {})
            }
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /M-W', [...testVars, g]))
        break
      }
      case 'K-W': {
        out.push(
          await dispatchKwFamily(
            rest,
            { kruskalWallis: true, median: false, jonckheereTerpstra: false },
            'NPAR TESTS /K-W',
            'terminal.log.npartestsKwSyntax'
          )
        )
        break
      }
      case 'MEDIAN': {
        // SPSS allows /MEDIAN(value)=... to test against a fixed median
        // instead of the sample's own — not offered here (always the sample
        // median), so only the leading "(value)" needs stripping.
        const cleaned = rest.replace(/^\([^)]*\)\s*=?\s*/, '')
        out.push(
          await dispatchKwFamily(
            cleaned,
            { kruskalWallis: false, median: true, jonckheereTerpstra: false },
            'NPAR TESTS /MEDIAN',
            'terminal.log.npartestsMedianSyntax'
          )
        )
        break
      }
      case 'J-T': {
        out.push(
          await dispatchKwFamily(
            rest,
            { kruskalWallis: false, median: false, jonckheereTerpstra: true },
            'NPAR TESTS /J-T',
            'terminal.log.npartestsJtSyntax'
          )
        )
        break
      }
      case 'FRIEDMAN': {
        const { resolved, unknown } = resolveVars(parseList(rest), ctx.variables)
        if (unknown.length) {
          out.push(unknownVarsError(unknown))
          break
        }
        if (resolved.length < 2) {
          out.push({ level: 'error', key: 'terminal.log.needTwoVars' })
          break
        }
        await ctx.runAnalysis({
          analysisId: 'nparFriedman',
          scriptFile: 'npar-friedman.R',
          params: {
            variables: resolved.map(v => v.colId),
            varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
            ...optGlobal
          }
        })
        out.push(dispatchedToOutput('NPAR TESTS /FRIEDMAN', resolved))
        break
      }
      default:
        out.push({
          level: 'info',
          key: 'terminal.log.npartestsSubNotSupported',
          params: { command: `/${kw}` }
        })
    }
  }
  return out
}
