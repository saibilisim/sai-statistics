// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import { afterEquals, parseList, parseVariablesList, resolveVars, splitOnWith } from './parsing'
import { dispatchedToOutput, parseCriteriaRscale, unknownVarsError } from './log'

// ─── Bayesian command handlers ─────────────────────────────────────────────

/**
 * BAYES TTEST — same three forms as T-TEST, plus the shared Bayes
 * `/CRITERIA RSCALE=(WIDE|MEDIUM|ULTRAWIDE|n)` subcommand for the Bayes
 * factor prior width.
 */
export async function runBayesTtest(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const body = st.body
  const rscale = parseCriteriaRscale(body)

  switch (true) {
    case /GROUPS\s*=/i.test(body): {
      const gm = /GROUPS\s*=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/i.exec(body)
      if (!gm) return [{ level: 'error', key: 'terminal.log.bayesTtestSyntax' }]
      const groupVals = parseList(gm[2] as string)
      if (groupVals.length < 2) return [{ level: 'error', key: 'terminal.log.bayesTtestSyntax' }]
      const grp = resolveVars([gm[1] as string], ctx.variables)
      const vars = resolveVars(parseVariablesList(afterEquals(body, 'VARIABLES')), ctx.variables)
      const unknown = [...grp.unknown, ...vars.unknown]
      if (unknown.length) return [unknownVarsError(unknown)]
      if (grp.resolved.length === 0 || vars.resolved.length === 0)
        return [{ level: 'error', key: 'terminal.log.bayesTtestSyntax' }]
      const g = grp.resolved[0] as Variable
      await ctx.runAnalysis({
        analysisId: 'bayesTTestInd',
        scriptFile: 'bayes-ttest-independent.R',
        params: {
          variables: vars.resolved.map(v => v.colId),
          varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
          groupVar: g.colId,
          groupName: g.name,
          groupValueLabels: g.valueLabels,
          group1: groupVals[0],
          group2: groupVals[1],
          rscale
        }
      })
      return [dispatchedToOutput('BAYES TTEST', [g, ...vars.resolved])]
    }

    case /PAIRS\s*=/i.test(body): {
      // Same list form as T-TEST: `PAIRS=a b WITH c d (PAIRED)` pairs a-c, b-d.
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
        return [{ level: 'error', key: 'terminal.log.bayesTtestSyntax' }]
      await ctx.runAnalysis({
        analysisId: 'bayesTTestPaired',
        scriptFile: 'bayes-ttest-paired.R',
        params: {
          var1: v1.resolved.map(v => v.colId),
          var2: v2.resolved.map(v => v.colId),
          varNames: Object.fromEntries(
            [...v1.resolved, ...v2.resolved].map(v => [v.colId, v.name])
          ),
          rscale
        }
      })
      return [dispatchedToOutput('BAYES TTEST', [...v1.resolved, ...v2.resolved])]
    }

    case /TESTVAL\s*=/i.test(body): {
      const tm = /TESTVAL\s*=\s*(-?[\d.]+)/i.exec(body)
      const vars = resolveVars(parseVariablesList(afterEquals(body, 'VARIABLES')), ctx.variables)
      if (vars.unknown.length) return [unknownVarsError(vars.unknown)]
      if (!tm || vars.resolved.length === 0)
        return [{ level: 'error', key: 'terminal.log.bayesTtestSyntax' }]
      await ctx.runAnalysis({
        analysisId: 'bayesTTest1',
        scriptFile: 'bayes-ttest-onesample.R',
        params: {
          variables: vars.resolved.map(v => v.colId),
          varNames: Object.fromEntries(vars.resolved.map(v => [v.colId, v.name])),
          testValue: Number(tm[1]) || 0,
          rscale
        }
      })
      return [dispatchedToOutput('BAYES TTEST', vars.resolved)]
    }

    default:
      return [{ level: 'error', key: 'terminal.log.bayesTtestSyntax' }]
  }
}

/** BAYES ANOVA DEPENDENT=y1 [y2 …] /DESIGN=factor [/CRITERIA RSCALE=...] */
export async function runBayesAnova(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  // The dialog takes several dependents (one Bayes factor each), so does this.
  const depM = /DEPENDENT\s*=?\s*([^/]+)/i.exec(st.body)
  const designM = /\/DESIGN\s*=\s*([A-Za-z_]\w*)/i.exec(st.body)
  if (!depM || !designM) return [{ level: 'error', key: 'terminal.log.bayesAnovaSyntax' }]
  const dep = resolveVars(parseList(depM[1] as string), ctx.variables)
  const fac = resolveVars([designM[1] as string], ctx.variables)
  const unknown = [...dep.unknown, ...fac.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || fac.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.bayesAnovaSyntax' }]
  const f = fac.resolved[0] as Variable
  const rscale = parseCriteriaRscale(st.body)

  await ctx.runAnalysis({
    analysisId: 'bayesAnova',
    scriptFile: 'bayes-anova.R',
    params: {
      variables: dep.resolved.map(v => v.colId),
      varNames: Object.fromEntries(dep.resolved.map(v => [v.colId, v.name])),
      factor: f.colId,
      factorName: f.name,
      rscale
    }
  })
  return [dispatchedToOutput('BAYES ANOVA', [...dep.resolved, f])]
}

/** BAYES CORRELATION VARIABLES=v1 v2 v3 [/CRITERIA RSCALE=...] */
export async function runBayesCorrelation(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseVariablesList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length < 2) return [{ level: 'error', key: 'terminal.log.needTwoVars' }]
  const rscale = parseCriteriaRscale(st.body)

  await ctx.runAnalysis({
    analysisId: 'bayesCorrelate',
    scriptFile: 'bayes-correlation.R',
    params: {
      variables: resolved.map(v => v.colId),
      varNames: Object.fromEntries(resolved.map(v => [v.colId, v.name])),
      rscale
    }
  })
  return [dispatchedToOutput('BAYES CORRELATION', resolved)]
}

/** BAYES REGRESSION DEPENDENT=y /METHOD=ENTER x1 x2 [/CRITERIA RSCALE=...] */
export async function runBayesRegression(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const depM = /DEPENDENT\s*=?\s*([A-Za-z_]\w*)/i.exec(st.body)
  const methodM = /METHOD\s*=\s*ENTER\s+([^/]*)/i.exec(st.body)
  if (!depM || !methodM) return [{ level: 'error', key: 'terminal.log.bayesRegressionSyntax' }]
  const dep = resolveVars([depM[1] as string], ctx.variables)
  const preds = resolveVars(parseList(methodM[1] as string), ctx.variables)
  const unknown = [...dep.unknown, ...preds.unknown]
  if (unknown.length) return [unknownVarsError(unknown)]
  if (dep.resolved.length === 0 || preds.resolved.length === 0)
    return [{ level: 'error', key: 'terminal.log.bayesRegressionSyntax' }]
  const d = dep.resolved[0] as Variable
  const rscale = parseCriteriaRscale(st.body)

  await ctx.runAnalysis({
    analysisId: 'bayesRegression',
    scriptFile: 'bayes-regression.R',
    params: {
      dependent: d.colId,
      dependentName: d.name,
      independents: preds.resolved.map(v => v.colId),
      varNames: Object.fromEntries([d, ...preds.resolved].map(v => [v.colId, v.name])),
      rscale
    }
  })
  return [dispatchedToOutput('BAYES REGRESSION', [d, ...preds.resolved])]
}
