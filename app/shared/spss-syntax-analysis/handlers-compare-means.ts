// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
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
  splitOnWith,
  splitTopLevel,
  stripRanges
} from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── Compare-means / general-linear-model command handlers ─────────────────

/**
 * T-TEST — three SPSS forms:
 *   GROUPS=g(v1 v2) /VARIABLES=x y   → independent-samples
 *   PAIRS=a WITH b   |  PAIRS=a b     → paired
 *   /TESTVAL=n /VARIABLES=x           → one-sample
 */
export async function runTTest(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const body = st.body
  // /MISSING=LISTWISE applies to all three forms; the default (ANALYSIS)
  // adds no key, same as the dialogs' payload.
  const missing = parseMissingStrategy(body)
  const optMissing = missing ? { options: { missing } } : {}

  switch (true) {
    // Independent samples
    case /GROUPS\s*=/i.test(body): {
      const gm = /GROUPS\s*=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/i.exec(body)
      if (!gm) return [{ level: 'error', key: 'terminal.log.ttestSyntax' }]
      const groupVals = parseList(gm[2] as string)
      if (groupVals.length < 2) return [{ level: 'error', key: 'terminal.log.ttestSyntax' }]
      const grp = resolveVars([gm[1] as string], ctx.variables)
      const vars = resolveVars(parseVariablesList(afterEquals(body, 'VARIABLES')), ctx.variables)
      const unknown = [...grp.unknown, ...vars.unknown]
      if (unknown.length) return [unknownVarsError(unknown)]
      if (grp.resolved.length === 0 || vars.resolved.length === 0)
        return [{ level: 'error', key: 'terminal.log.ttestSyntax' }]
      const g = grp.resolved[0] as Variable
      await ctx.runAnalysis({
        analysisId: 'ttestInd',
        scriptFile: 'ttest-independent.R',
        params: {
          variables: vars.resolved.map(v => v.colId),
          varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
          groupVar: g.colId,
          groupName: g.name,
          group1: groupVals[0],
          group2: groupVals[1],
          ...optMissing
        }
      })
      return [dispatchedToOutput('T-TEST', [g, ...vars.resolved])]
    }

    // Paired samples
    case /PAIRS\s*=/i.test(body): {
      // SPSS marks the list style with a trailing `(PAIRED)`; without
      // stripping it the keyword was resolved as a variable name and the whole
      // command failed with "unknown variables".
      const pv = afterEquals(body, 'PAIRS').replace(/\(\s*PAIRED\s*\)/gi, ' ')
      const { left, right } = /\bWITH\b/i.test(pv)
        ? splitOnWith(pv)
        : (() => {
            const l = parseList(pv)
            return { left: l.slice(0, 1), right: l.slice(1, 2) }
          })()
      const v1 = resolveVars(left, ctx.variables)
      const v2 = resolveVars(right, ctx.variables)
      const unknown = [...v1.unknown, ...v2.unknown]
      if (unknown.length) return [unknownVarsError(unknown)]
      if (v1.resolved.length === 0 || v2.resolved.length === 0)
        return [{ level: 'error', key: 'terminal.log.ttestSyntax' }]
      await ctx.runAnalysis({
        analysisId: 'ttestPaired',
        scriptFile: 'ttest-paired.R',
        params: {
          var1: v1.resolved.map(v => v.colId),
          var2: v2.resolved.map(v => v.colId),
          varNames: Object.fromEntries(
            [...v1.resolved, ...v2.resolved].map(v => [v.colId, v.name])
          ),
          ...optMissing
        }
      })
      return [dispatchedToOutput('T-TEST', [...v1.resolved, ...v2.resolved])]
    }

    // One sample
    case /TESTVAL\s*=/i.test(body): {
      const tm = /TESTVAL\s*=\s*(-?[\d.]+)/i.exec(body)
      const vars = resolveVars(parseVariablesList(afterEquals(body, 'VARIABLES')), ctx.variables)
      if (vars.unknown.length) return [unknownVarsError(vars.unknown)]
      if (!tm || vars.resolved.length === 0)
        return [{ level: 'error', key: 'terminal.log.ttestSyntax' }]
      await ctx.runAnalysis({
        analysisId: 'ttest1',
        scriptFile: 'ttest-onesample.R',
        params: {
          variables: vars.resolved.map(v => v.colId),
          varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
          testValue: Number(tm[1]) || 0,
          ...optMissing
        }
      })
      return [dispatchedToOutput('T-TEST', vars.resolved)]
    }

    default:
      return [{ level: 'error', key: 'terminal.log.ttestSyntax' }]
  }
}

/** ONEWAY dep1 dep2 BY factor [/STATISTICS=...] [/POSTHOC=...] → one-way ANOVA. */
export async function runOneway(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  const { left, right } = splitOnBy(listPart)
  const deps = resolveVars(left, ctx.variables)
  const facs = resolveVars(right, ctx.variables)
  const unknown = [...deps.unknown, ...facs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (deps.resolved.length === 0 || facs.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.onewaySyntax' }]
  const factor = facs.resolved[0] as Variable

  const statsWords = parseSubcommand(st.body, 'STATISTICS') || []
  const posthocWords = parseSubcommand(st.body, 'POSTHOC') || []
  // /MISSING=LISTWISE — the builder emits it (OneWayAnovaDialog Paste) but
  // nobody parsed it, so a pasted listwise ONEWAY ran analysis-wise.
  const missing = parseMissingStrategy(st.body)
  const options = {
    homogeneity: statsWords.includes('HOMOGENEITY'),
    welch: statsWords.includes('WELCH'),
    // anova-oneway.R computes Brown-Forsythe from options.brownForsythe — the
    // builder emits the keyword (OneWayAnovaDialog Paste), so parse it too.
    brownForsythe: statsWords.includes('BROWNFORSYTHE'),
    tukey: posthocWords.includes('TUKEY'),
    bonferroni: posthocWords.includes('BONFERRONI'),
    ...(missing ? { missing } : {})
  }

  await ctx.runAnalysis({
    analysisId: 'anova',
    scriptFile: 'anova-oneway.R',
    params: {
      variables: deps.resolved.map(v => v.colId),
      varNames: Object.fromEntries(deps.resolved.map(v => [v.colId, v.name])),
      factor: factor.colId,
      factorName: factor.name,
      options
    }
  })
  return [dispatchedToOutput('ONEWAY', [...deps.resolved, factor])]
}

/**
 * ANOVA/UNIANOVA/GLM — all three collapse onto glm-univariate.R (or
 * glm-multivariate.R for GLM with ≥2 dependents): `dependent(s) BY factor(s)
 * WITH covariate(s)`. UNIANOVA/GLM's `WITH` covariates, `/METHOD=SSTYPE(n)`
 * and `/INTERCEPT=EXCLUDE` are honored for the single-dependent path (the
 * same fields the Univariate dialog's Model panel exposes); WLS weight,
 * stepwise, contrasts, post hoc and EM Means are unsupported here — those
 * stay dialog-only for now.
 */
export async function runGlmFamily(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const listPart = variableListPart(st.body)
  // ANOVA's factor list carries a "(min,max)" range per factor (e.g.
  // "REGION(1,9)") that UNIANOVA/GLM don't use — strip it before tokenizing
  // so the embedded comma isn't mistaken for a list separator. UNIANOVA/GLM
  // may also carry `WITH covariate(s)` after the BY factor list; split that
  // off first so it doesn't leak into the factor list.
  const { left: byPart, right: covPart } = splitOnWith(stripRanges(listPart))
  const { left, right } = splitOnBy(byPart.join(' '))
  const deps = resolveVars(left, ctx.variables)
  const facs = resolveVars(right, ctx.variables)
  const covs = resolveVars(covPart, ctx.variables)
  const unknown = [...deps.unknown, ...facs.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]

  // Repeated measures: `GLM pre post [BY group] [WITH cov] /WSFACTOR=time 2`
  // names the levels of a within-subject factor; BY factors are the
  // between-subjects design (a mixed design), WITH the covariates.
  const wsM = /\/WSFACTOR\s*=?\s*([A-Za-z_]\w*)/i.exec(st.body)
  if (wsM && deps.resolved.length >= 2) {
    const rmPrint = parseSubcommand(st.body, 'PRINT') ?? []
    const rmAlpha = /ALPHA\s*\(\s*([\d.]+)\s*\)/i.exec(st.body)
    await ctx.runAnalysis({
      // Same id the Repeated Measures dialog sends — a syntax run and an OK
      // run must land in the output store under one identity.
      analysisId: 'glmRep',
      scriptFile: 'glm-repeated.R',
      params: {
        variables: deps.resolved.map(v => v.colId),
        varNames: Object.fromEntries(deps.resolved.map(v => [v.colId, v.name])),
        factorName: wsM[1],
        betweenFactors: facs.resolved.map(v => v.colId),
        betweenNames: Object.fromEntries(facs.resolved.map(v => [v.colId, v.name])),
        covariates: covs.resolved.map(v => v.colId),
        covariateNames: Object.fromEntries(covs.resolved.map(v => [v.colId, v.name])),
        options: {
          descriptives: rmPrint.includes('DESCRIPTIVE'),
          effectSize: rmPrint.includes('ETASQ'),
          power: rmPrint.includes('OPOWER'),
          homogeneity: rmPrint.includes('HOMOGENEITY'),
          ...(rmAlpha?.[1]
            ? { sigLevel: rmAlpha[1].startsWith('.') ? `0${rmAlpha[1]}` : rmAlpha[1] }
            : {})
        }
      }
    })
    return [dispatchedToOutput(st.command, [...deps.resolved, ...facs.resolved, ...covs.resolved])]
  }

  if (deps.resolved.length === 0 || facs.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.glmFamilySyntax' }]

  // /METHOD=SSTYPE(n), /INTERCEPT=EXCLUDE and the /PRINT keywords — the
  // fields the GLM dialogs' own Paste Syntax buttons emit (see
  // buildSyntax.glmUnivariate / glmMultivariate). Anything else /METHOD
  // carries (ENTER, a predictor list) doesn't apply to UNIANOVA/GLM, so only
  // SSTYPE is read.
  const ssTypeM = /SSTYPE\s*\(\s*([1-4])\s*\)/i.exec(st.body)
  const ssType = ssTypeM ? (['I', 'II', 'III', 'IV'][Number(ssTypeM[1]) - 1] as string) : undefined
  const includeIntercept = /\/INTERCEPT\s*=\s*EXCLUDE/i.test(st.body) ? false : undefined
  const printWords = parseSubcommand(st.body, 'PRINT') ?? []
  const printOpts = {
    ...(printWords.includes('DESCRIPTIVE') ? { descriptives: true } : {}),
    ...(printWords.includes('ETASQ') ? { effectSize: true } : {}),
    ...(printWords.includes('OPOWER') ? { power: true } : {}),
    ...(printWords.includes('PARAMETER') ? { paramEstimates: true } : {}),
    ...(printWords.includes('HOMOGENEITY') ? { homogeneity: true } : {})
  }
  const glmOptions =
    ssType || includeIntercept !== undefined || Object.keys(printOpts).length
      ? {
          options: {
            ...(ssType ? { ssType } : {}),
            ...(includeIntercept !== undefined ? { includeIntercept } : {}),
            ...printOpts
          }
        }
      : {}

  if (st.command === 'GLM' && deps.resolved.length >= 2) {
    await ctx.runAnalysis({
      analysisId: 'glmMulti',
      scriptFile: 'glm-multivariate.R',
      params: {
        dependents: deps.resolved.map(v => v.colId),
        dependentNames: Object.fromEntries(deps.resolved.map(v => [v.colId, v.name])),
        factors: facs.resolved.map(v => v.colId),
        factorNames: Object.fromEntries(facs.resolved.map(v => [v.colId, v.name])),
        covariates: covs.resolved.map(v => v.colId),
        covariateNames: Object.fromEntries(covs.resolved.map(v => [v.colId, v.name])),
        ...glmOptions
      }
    })
    return [dispatchedToOutput(st.command, [...deps.resolved, ...facs.resolved, ...covs.resolved])]
  }

  const d = deps.resolved[0] as Variable
  await ctx.runAnalysis({
    analysisId: 'glmUni',
    scriptFile: 'glm-univariate.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      factors: facs.resolved.map(v => v.colId),
      factorNames: Object.fromEntries(facs.resolved.map(v => [v.colId, v.name])),
      covariates: covs.resolved.map(v => v.colId),
      covariateNames: Object.fromEntries(covs.resolved.map(v => [v.colId, v.name])),
      ...glmOptions
    }
  })
  return [dispatchedToOutput(st.command, [d, ...facs.resolved, ...covs.resolved])]
}

/**
 * MIXED dependent [BY factors] [WITH covariates]
 *   [/FIXED=terms | [NOINT] SSTYPE(1|3)] [/METHOD=REML|ML]
 *   [/PRINT=DESCRIPTIVES SOLUTION TESTCOV] [/CRITERIA=CIN(n)]
 *   /RANDOM=[INTERCEPT] [covariates] | SUBJECT(subject-var) [COVTYPE(VC|DIAG|UN|ID)]
 *   [/EMMEANS=TABLES(OVERALL|factor) [COMPARE ADJ(LSD|BONFERRONI|SIDAK)]]...
 */
export async function runMixed(st: Statement, ctx: AnalysisDispatchCtx): Promise<SyntaxLogEntry[]> {
  const firstSeg = splitTopLevel(st.body, '/')[0] ?? st.body
  const { left: byPart, right } = splitOnWith(firstSeg)
  const { left, right: facPart } = splitOnBy(byPart.join(' '))
  const dep = resolveVars(left.slice(0, 1), ctx.variables)
  const facs = resolveVars(facPart, ctx.variables)
  const covs = resolveVars(right, ctx.variables)
  const subjM = /\bSUBJECT\s*\(\s*([A-Za-z_]\w*)\s*\)/i.exec(st.body)
  const unknown = [...dep.unknown, ...facs.unknown, ...covs.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || facs.resolved.length + covs.resolved.length === 0 || !subjM)
    return [{ level: 'error', key: 'terminal.log.mixedSyntax' }]
  const subjVars = resolveVars([subjM[1] as string], ctx.variables)
  if (subjVars.unknown.length) return [unknownVarsError(subjVars.unknown)]
  const d = dep.resolved[0] as Variable
  const s = subjVars.resolved[0] as Variable

  const fixedM = /\/FIXED\s*=?([^/]*)/i.exec(st.body)
  const fixedTxt = fixedM?.[1] ?? ''
  const randomM = /\/RANDOM\s*=?([^|/]*)\|/i.exec(st.body)
  const randomWords = (randomM?.[1] ?? 'INTERCEPT').trim().split(/\s+/).filter(Boolean)
  const slopeVars = covs.resolved.filter(v =>
    randomWords.some(w => w.toUpperCase() === v.name.toUpperCase())
  )
  const covTypeM = /COVTYPE\s*\(\s*(\w+)\s*\)/i.exec(st.body)
  const covTypeKey = (covTypeM?.[1] ?? 'VC').toUpperCase()
  const covType =
    covTypeKey === 'UN'
      ? 'unstructured'
      : covTypeKey === 'DIAG'
        ? 'diagonal'
        : covTypeKey === 'ID'
          ? 'identity'
          : 'vc'
  const printWords = parseSubcommand(st.body, 'PRINT') ?? []
  const cinM = /CIN\s*\(\s*([\d.]+)\s*\)/i.exec(st.body)
  const emTerms = [...st.body.matchAll(/TABLES\s*\(\s*([A-Za-z_]\w*)\s*\)/gi)]
    .map(m => (m[1] ?? '').toUpperCase())
    .map(n =>
      n === 'OVERALL' ? 'OVERALL' : facs.resolved.find(f => f.name.toUpperCase() === n)?.colId
    )
    .filter((x): x is string => Boolean(x))
  const adjM = /ADJ\s*\(\s*(\w+)\s*\)/i.exec(st.body)
  const adj = (adjM?.[1] ?? 'LSD').toUpperCase()

  const named = [...facs.resolved, ...covs.resolved]
  await ctx.runAnalysis({
    analysisId: 'mixed',
    scriptFile: 'mixed-models.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      factors: facs.resolved.map(v => v.colId),
      covariates: covs.resolved.map(v => v.colId),
      subject: s.colId,
      varNames: Object.fromEntries(named.map(v => [v.colId, v.name])),
      options: {
        fixed: {
          model: fixedTxt.includes('*') ? 'factorial' : 'main',
          intercept: !/\bNOINT\b/i.test(fixedTxt),
          ssType: /SSTYPE\s*\(\s*1\s*\)/i.test(fixedTxt) ? 'I' : 'III'
        },
        random: {
          intercept: randomWords.some(w => w.toUpperCase() === 'INTERCEPT'),
          slopes: slopeVars.map(v => v.colId),
          covType
        },
        estimation: { method: /\/METHOD\s*=\s*ML\b/i.test(st.body) ? 'ML' : 'REML' },
        statistics: {
          descriptives: printWords.includes('DESCRIPTIVES'),
          paramEstimates: printWords.length === 0 || printWords.includes('SOLUTION'),
          covCI: printWords.includes('TESTCOV'),
          ...(cinM?.[1] ? { ciLevel: Number(cinM[1]) / 100 } : {})
        },
        ...(emTerms.length
          ? {
              emMeans: {
                terms: emTerms,
                compareMainEffects: /\bCOMPARE\b/i.test(st.body),
                ciAdjust: adj === 'BONFERRONI' ? 'bonferroni' : adj === 'SIDAK' ? 'sidak' : 'none'
              }
            }
          : {})
      }
    }
  })
  return [dispatchedToOutput('MIXED', [d, s, ...named])]
}

/**
 * GENLINMIXED /FIELDS TARGET=dep /FIXED EFFECTS=predictors
 *             /RANDOM ... SUBJECTS=subj [/TARGET_OPTIONS DISTRIBUTION=BINOMIAL|POISSON]
 */
export async function runGenlinmixed(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const targetM = /\bTARGET\s*=\s*([A-Za-z_]\w*)/i.exec(st.body)
  const fixedM = /\bFIXED\b[^/]*?EFFECTS\s*=\s*([^/]*)/i.exec(st.body)
  const subjM = /\bRANDOM\b[^/]*?SUBJECTS?\s*=\s*([A-Za-z_]\w*)/i.exec(st.body)
  const dep = targetM
    ? resolveVars([targetM[1] as string], ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  // `/FIXED EFFECTS=score age USE_INTERCEPT=TRUE` — SPSS's own paste puts
  // option assignments in the same clause and they are not variables. Without
  // dropping them the whole command failed with "unknown variables", i.e.
  // GENLINMIXED syntax copied out of SPSS did not run here at all.
  const preds = fixedM
    ? resolveVars(
        parseList(fixedM[1] as string).filter(tok => !tok.includes('=')),
        ctx.variables
      )
    : { resolved: [] as Variable[], unknown: [] as string[] }
  const subj = subjM
    ? resolveVars([subjM[1] as string], ctx.variables)
    : { resolved: [] as Variable[], unknown: [] as string[] }
  const unknown = [...dep.unknown, ...preds.unknown, ...subj.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || preds.resolved.length === 0 || subj.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.genlinmixedSyntax' }]
  const distM = /\bDISTRIBUTION\s*=\s*(BINOMIAL|POISSON)/i.exec(st.body)
  const family: 'binomial' | 'poisson' =
    distM && (distM[1] as string).toUpperCase() === 'POISSON' ? 'poisson' : 'binomial'
  const d = dep.resolved[0] as Variable
  const s = subj.resolved[0] as Variable

  await ctx.runAnalysis({
    analysisId: 'glmm',
    scriptFile: 'glmm.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      predictors: preds.resolved.map(v => v.colId),
      subject: s.colId,
      family,
      varNames: Object.fromEntries(preds.resolved.map(v => [v.colId, v.name]))
    }
  })
  return [dispatchedToOutput('GENLINMIXED', [d, s, ...preds.resolved])]
}
