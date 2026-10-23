// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { AnalysisDispatchCtx, Statement, SyntaxLogEntry } from './types'
import { resolveVars, splitOnWith, splitTopLevel } from './parsing'
import { dispatchedToOutput, unknownVarsError } from './log'

// ─── Proportions command handler ───────────────────────────────────────────

/**
 * PROPORTIONS (SPSS 27+ Compare Proportions):
 *
 * analysisId matches the DIALOG's, which splits by design — a syntax run and an
 * OK run of the same analysis must land in the output store under one identity.
 *   /ONESAMPLE var TESTVAL=p0 [...] [/SUCCESS VALUE=LEVEL(v)] [/CRITERIA CILEVEL=n]
 *   /INDEPENDENTSAMPLES var BY groupvar [...] [/SUCCESS VALUE=LEVEL(v)] [/CRITERIA CILEVEL=n]
 *   /PAIREDSAMPLES var1 WITH var2 (PAIRED) [...] [/CRITERIA CILEVEL=n]
 */
export async function runProportions(
  st: Statement,
  ctx: AnalysisDispatchCtx
): Promise<SyntaxLogEntry[]> {
  const body = st.body
  const successM = /\/SUCCESS\s+VALUE\s*=\s*LEVEL\(\s*([^)]*)\)/i.exec(body)
  const successValue = successM ? (successM[1] as string).trim().split(/[\s,]+/)[0] : '1'
  const ciM = /CILEVEL\s*=\s*([\d.]+)/i.exec(body)
  const ciLevel = ciM ? Number(ciM[1]) : 95

  if (/\/ONESAMPLE\b/i.test(body)) {
    const seg = /\/ONESAMPLE\s+([A-Za-z_]\w*)/i.exec(body)
    const testM = /TESTVAL\s*=\s*([\d.]+)/i.exec(body)
    if (!seg) return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
    const v = resolveVars([seg[1] as string], ctx.variables)
    if (v.unknown.length) return [unknownVarsError(v.unknown)]
    if (v.resolved.length === 0) return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
    const variable = v.resolved[0] as Variable
    await ctx.runAnalysis({
      analysisId: 'proportionsOne',
      scriptFile: 'proportions.R',
      params: {
        design: 'one',
        variable: variable.colId,
        varName: variable.name,
        testValue: testM ? Number(testM[1]) : 0.5,
        successValue,
        ciLevel
      }
    })
    return [dispatchedToOutput('PROPORTIONS /ONESAMPLE', [variable])]
  }

  if (/\/INDEPENDENTSAMPLES\b/i.test(body)) {
    const seg = /\/INDEPENDENTSAMPLES\s+([A-Za-z_]\w*)\s+BY\s+([A-Za-z_]\w*)/i.exec(body)
    if (!seg) return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
    const v = resolveVars([seg[1] as string], ctx.variables)
    const g = resolveVars([seg[2] as string], ctx.variables)
    const unknown = [...v.unknown, ...g.unknown]
    if (unknown.length) return [unknownVarsError(unknown)]
    if (v.resolved.length === 0 || g.resolved.length === 0)
      return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
    const variable = v.resolved[0] as Variable
    const group = g.resolved[0] as Variable
    await ctx.runAnalysis({
      analysisId: 'proportionsIndep',
      scriptFile: 'proportions.R',
      params: {
        design: 'independent',
        variable: variable.colId,
        varName: variable.name,
        groupVar: group.colId,
        groupVarName: group.name,
        successValue,
        ciLevel
      }
    })
    return [dispatchedToOutput('PROPORTIONS /INDEPENDENTSAMPLES', [variable, group])]
  }

  if (/\/PAIREDSAMPLES\b/i.test(body)) {
    const seg = /\/PAIREDSAMPLES\s+([^]*)/i.exec(body)
    if (!seg) return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
    const raw = seg[1] ?? ''
    const tail = splitTopLevel(raw, '/')[0] ?? raw
    const { left, right } = splitOnWith(tail)
    const v1 = resolveVars(left.slice(0, 1), ctx.variables)
    const v2 = resolveVars(right.slice(0, 1), ctx.variables)
    const unknown = [...v1.unknown, ...v2.unknown]
    if (unknown.length) return [unknownVarsError(unknown)]
    if (v1.resolved.length === 0 || v2.resolved.length === 0)
      return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
    const variable1 = v1.resolved[0] as Variable
    const variable2 = v2.resolved[0] as Variable
    await ctx.runAnalysis({
      analysisId: 'proportionsPaired',
      scriptFile: 'proportions.R',
      params: {
        design: 'paired',
        variable1: variable1.colId,
        varName1: variable1.name,
        variable2: variable2.colId,
        varName2: variable2.name,
        successValue,
        ciLevel
      }
    })
    return [dispatchedToOutput('PROPORTIONS /PAIREDSAMPLES', [variable1, variable2])]
  }

  return [{ level: 'error', key: 'terminal.log.proportionsSyntax' }]
}
