// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { buildMultinomialSyntax } from './multinomial-syntax'
/**
 * spss-syntax.ts — Faz T1 SPSS Syntax dispatcher (Renderer half).
 *
 * Parses a subset of SPSS command syntax and routes each command to the
 * EXISTING typed IPC pipeline (analysis:run / variable:update / transform:*),
 * never to free-form R. Parameters stay zod + allow-list validated, so this
 * mode does NOT fall under the §9 "arbitrary code" security exception
 * (see terminal.md §4.1, §11.3).
 *
 * Variable references resolve by name (case-insensitive), the same way the R
 * scripts do. Analysis commands flow to the Output tab via job:complete;
 * data/variable commands mutate DuckDB through the controlled handlers and
 * refresh the renderer store.
 *
 * Two categories of command live in two different files:
 * - Statistical-ANALYSIS commands (FREQUENCIES, T-TEST, COXREG, NPAR TESTS,
 *   ...) are pure `{analysisId, scriptFile, params}` requests with no side
 *   effects beyond "run this analysis" — their parsing/handler code lives in
 *   `@shared/spss-syntax-analysis.ts` so the exact same code also powers the
 *   AI's `run_syntax` tool (`electron/ipc/ai-bridge.ts`) with zero
 *   duplication (CLAUDE.md §11 DRY). This file just supplies the
 *   Renderer-specific `runAnalysis` callback (→ `window.api.analysis.run`).
 * - Commands that MUTATE the live dataset/view (RENAME, RECODE, VALUE
 *   LABELS, WEIGHT, SPLIT FILE, SELECT IF, FILTER, SORT CASES, ...) stay
 *   here, since they read/write the Renderer's Zustand store directly — Main
 *   has no equivalent state to mutate, so these are NOT available to the AI.
 */

import type { CellValue, Variable } from '@shared/data-types'
import { clampVariableAttr } from '@shared/data-types'
import { ordinalSyntax } from './ordinal-syntax'
import type {
  CoxCategoricalSpec,
  CoxMethod,
  CoxOptions,
  KaplanMeierOptions
} from '@shared/survival-types'
import { defaultCoxOptions, defaultKaplanMeierOptions } from '@shared/survival-types'
import type { LogisticOptions } from '@shared/logistic-types'
import { defaultLogisticOptions } from '@shared/logistic-types'
import type { ProbitModel, ProbitOptions, ProbitTransform } from '@shared/probit-types'
import { defaultProbitOptions } from '@shared/probit-types'
import type { RegressionOptions } from '@shared/regression-types'
import { defaultRegressionOptions } from '@shared/regression-types'
import type { CorrelateOptions } from '@shared/correlate-types'
import { defaultCorrelateOptions } from '@shared/correlate-types'
import {
  type SyntaxLogEntry,
  type Statement,
  type AnalysisDispatchCtx,
  splitTopLevel,
  splitStatements,
  parseStatement,
  parseList,
  afterEquals,
  stripQuotes,
  resolveVars,
  unknownVarsError,
  ANALYSIS_COMMAND_NAMES,
  ANALYSIS_HANDLERS
} from '@shared/spss-syntax-analysis'
import { useDatasetStore } from '../store/dataset-store'
import { evaluateFormula, truthy } from './formula'
import { fetchAllRows } from './fetch-all-rows'

// ─── Public types (re-exported for existing consumers) ─────────────────────

export type { LogLevel, SyntaxLogEntry } from '@shared/spss-syntax-analysis'
export { parseSubcommand } from '@shared/spss-syntax-analysis'

// SPSS variable names follow the same rule as our Variable schema.
const VAR_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// ─── Command tables (mutation/guidance/noop/not-implemented — Renderer-only) ─

// Commands with a real LOCAL dispatch handler (see HANDLERS below). The
// statistical-analysis commands (FREQUENCIES, T-TEST, ... NPAR TESTS) are
// NOT listed here — they come from the shared ANALYSIS_COMMAND_NAMES/
// ANALYSIS_HANDLERS instead, see the dispatch loop in runSpssSyntax.
const LOCAL_HANDLER_NAMES = [
  'COMPUTE',
  'IF',
  'RENAME VARIABLES',
  'SPLIT FILE',
  'SORT CASES',
  'RECODE',
  'WEIGHT',
  'COUNT',
  'RANK',
  'AUTORECODE',
  'VARIABLE LABELS',
  'VALUE LABELS',
  'ADD VALUE LABELS',
  'MISSING VALUES',
  // Dictionary — Variable View attributes (variable:update / add / delete).
  'FORMATS',
  'PRINT FORMATS',
  'WRITE FORMATS',
  'STRING',
  'NUMERIC',
  'VARIABLE LEVEL',
  'VARIABLE WIDTH',
  'VARIABLE ALIGNMENT',
  'VARIABLE ROLE',
  'DELETE VARIABLES',
  // Case selection — maps onto the existing column-filter store (same
  // filters the Data View grid and analyses already share via ctx.columnFilters).
  'SELECT IF',
  'FILTER'
]

// Commands that map conceptually to an existing GUI capability — we point the
// user there instead of running them. SELECT CASE(S) needs an arbitrary
// logical expression's row selection to become a *persistent* filter, which
// only the column-filter store models (see SELECT IF for the subset that
// fits it) — a bare SELECT CASE has no such target, so it stays guidance-only.
const GUIDANCE_COMMANDS = new Map<string, string>([
  ['SELECT CASE', 'terminal.log.useFilter'],
  ['SELECT CASES', 'terminal.log.useFilter'],
  // Chart Builder pastes GGRAPH + a BEGIN GPL … END GPL block (GPL lines
  // carry no terminator, so the whole block arrives as one statement).
  ['GGRAPH', 'terminal.log.useGraphsMenu']
])

// Procedural SPSS commands with no effect in SAI — accepted as harmless no-ops
// so pasted syntax logs run cleanly instead of erroring.
const NOOP_COMMANDS = new Set([
  'EXECUTE',
  'TEMPORARY',
  'DATASET',
  'SET',
  'SHOW',
  'COMMENT',
  'PRESERVE',
  'RESTORE',
  'CACHE',
  // Output/document annotations.
  'TITLE',
  'SUBTITLE',
  'FILE LABEL',
  'DOCUMENT',
  'ECHO',
  // The GPL half of a GGRAPH chart; GGRAPH itself carries the guidance.
  'BEGIN GPL'
])

// Real SPSS commands SAI recognises but has not implemented yet. These get a
// friendly "not yet supported" note (NOT an error), so a user's normal SPSS
// syntax is understood rather than rejected. (Planned coverage: terminal.md §9.)
const NOT_IMPLEMENTED_COMMANDS = new Set([
  // data / file
  'GET',
  'GET FILE',
  'GET DATA',
  'SAVE',
  'SAVE OUTFILE',
  'IMPORT',
  'EXPORT',
  'MATCH FILES',
  'ADD FILES',
  'UPDATE',
  'APPLY DICTIONARY',
  'LIST',
  'DATA LIST',
  'BEGIN DATA',
  'INSERT',
  'INCLUDE',
  'OUTPUT',
  'DISPLAY',
  // transforms — N OF CASES / SAMPLE wait for TEMPORARY: with it a no-op
  // here, `TEMPORARY. SAMPLE .1.` would delete cases for good, where SPSS
  // drops them for the next procedure only.
  'N OF CASES',
  'SAMPLE',
  'AGGREGATE',
  'VECTOR',
  'VARSTOCASES',
  'CASESTOVARS',
  'FLIP',
  'CTABLES',
  // analyses — PROBIT and GENLIN stay unimplemented: PROBIT's aggregated
  // response-count/observation-count data shape has no SAI equivalent (a
  // genuine data-model mismatch, not a syntax gap — see the expansion
  // report), and GENLIN's syntax surface (incl. the /REPEATED→GEE routing
  // question) was deferred as a separate follow-up pass.
  'PROBIT',
  'GENLIN'
])

// Block structure. DO IF and DO REPEAT run (runDoIf / runDoRepeat); LOOP is
// not supported, and the whole block is skipped rather than its commands run
// once each.
const SKIPPED_BLOCKS = new Map([['LOOP', 'END LOOP']])
// Parts that are only valid inside their block — on their own they are errors.
const BLOCK_PARTS = new Set(['ELSE IF', 'ELSE', 'END IF', 'END LOOP', 'END REPEAT'])

// Every recognised command name, longest (most words) first, so multi-word
// commands match before their single-word prefixes (e.g. "DO IF" before a bare
// "IF", "GET FILE" before "GET").
const ALL_COMMAND_NAMES = [
  ...ANALYSIS_COMMAND_NAMES,
  ...LOCAL_HANDLER_NAMES,
  'DO IF',
  'DO REPEAT',
  ...SKIPPED_BLOCKS.keys(),
  ...BLOCK_PARTS,
  ...GUIDANCE_COMMANDS.keys(),
  ...NOOP_COMMANDS,
  ...NOT_IMPLEMENTED_COMMANDS
].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length)

// ─── Command handlers (mutation commands — Renderer store/IPC only) ────────

interface DispatchCtx {
  datasetId: string
  variables: Variable[]
  columnFilters: Record<string, { operator: string; value: string }>
  /** Inside a DO IF branch: the rows the branch applies to (COMPUTE / IF /
   *  COUNT write only these). Absent = every row. */
  rowMask?: boolean[]
}

// ─── Row-wise helpers (COMPUTE / IF / COUNT / DO IF) ───────────────────────

/** Every row, columns in ctx.variables order (as ComputeVariableDialog reads them). */
function fetchCtxRows(ctx: DispatchCtx): Promise<CellValue[][]> {
  return fetchAllRows(ctx.datasetId, useDatasetStore.getState().rowCount)
}

function rowNameResolver(ctx: DispatchCtx, row: CellValue[]) {
  return (name: string): CellValue | undefined => {
    const idx = ctx.variables.findIndex(v => v.name.toLowerCase() === name.toLowerCase())
    return idx === -1 ? undefined : (row[idx] ?? null)
  }
}

/** `SUM(score1 TO score4)` → `SUM(score1, score2, score3, score4)` — the
 *  formula engine has no TO. Quoted text is left alone. */
function expandExprTo(expr: string, variables: Variable[]): string {
  return expr
    .split(/('[^']*'|"[^"]*")/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /\b([A-Za-z_]\w*)\s+TO\s+([A-Za-z_]\w*)\b/gi,
            (whole, a: string, b: string) => {
              const { resolved, unknown } = resolveVars([a, 'TO', b], variables)
              return unknown.length || resolved.length === 0
                ? whole
                : resolved.map(v => v.name).join(', ')
            }
          )
    )
    .join('')
}

/** Appends a new variable to the dataset and refreshes ctx + store. */
async function createVariable(
  ctx: DispatchCtx,
  name: string,
  numeric: boolean,
  width: number,
  decimals: number
): Promise<Variable | undefined> {
  const updated = await window.api.variable.add({
    datasetId: ctx.datasetId,
    variable: {
      colId: '',
      name,
      type: numeric ? 'numeric' : 'string',
      width,
      decimals: numeric ? decimals : 0,
      label: '',
      missing: null,
      valueLabels: {},
      columns: 8,
      align: numeric ? 'right' : 'left',
      measure: numeric ? 'scale' : 'nominal',
      role: 'none'
    },
    index: ctx.variables.length
  })
  useDatasetStore.getState().setVariables(updated)
  ctx.variables = updated
  return updated.find(v => v.name.toLowerCase() === name.toLowerCase())
}

/** The existing variable `name`, or a new one appended to the dataset. */
async function ensureTarget(
  ctx: DispatchCtx,
  name: string,
  numeric: boolean,
  decimals = 2
): Promise<Variable | undefined> {
  const existing = ctx.variables.find(v => v.name.toLowerCase() === name.toLowerCase())
  if (existing) return existing
  return createVariable(ctx, name, numeric, numeric ? 8 : 20, decimals)
}

async function writeCells(
  ctx: DispatchCtx,
  target: Variable,
  updates: { rowIndex: number; value: CellValue }[]
): Promise<void> {
  if (updates.length === 0) return
  await window.api.data.updateCells({
    datasetId: ctx.datasetId,
    updates: updates.map(({ rowIndex, value }) => ({ rowIndex, colId: target.colId, value }))
  })
  useDatasetStore.getState().bumpDataVersion()
  useDatasetStore.getState().setModified(true)
}

const targetFailed = (): SyntaxLogEntry => ({
  level: 'error',
  key: 'terminal.log.runFailed',
  params: { detail: 'Target variable could not be created' }
})

/**
 * RENAME VARIABLES (old=new) (old2=new2) | (a b = x y) | old=new
 * All pairs are renamed at once, as in SPSS, so `(a b = b a)` swaps. The list
 * form used to match only its inner `b = b` and report a no-op as a success.
 * Any invalid pair cancels the whole command — nothing is half-renamed.
 */
async function runRename(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const groups = st.body.includes('(')
    ? Array.from(st.body.matchAll(/\(([^)]*)\)/g), g => g[1] as string)
    : [st.body]
  const pairs: { variable: Variable; old: string; next: string }[] = []
  for (const g of groups) {
    const eq = g.indexOf('=')
    if (eq < 0) return [{ level: 'error', key: 'terminal.log.renameSyntax' }]
    const { resolved, unknown } = resolveVars(parseList(g.slice(0, eq)), ctx.variables)
    if (unknown.length) return [unknownVarsError(unknown)]
    const nextNames = parseList(g.slice(eq + 1))
    if (resolved.length === 0 || resolved.length !== nextNames.length) {
      return [{ level: 'error', key: 'terminal.log.renameSyntax' }]
    }
    resolved.forEach((variable, i) =>
      pairs.push({ variable, old: variable.name, next: nextNames[i] as string })
    )
  }
  if (pairs.length === 0) return [{ level: 'error', key: 'terminal.log.renameSyntax' }]

  const bad = pairs.find(p => !VAR_NAME_RE.test(p.next))
  if (bad) return [{ level: 'error', key: 'terminal.log.invalidName', params: { name: bad.next } }]
  // Names after the rename: untouched variables keep theirs.
  const renamed = new Map(pairs.map(p => [p.variable.colId, p.next]))
  if (renamed.size !== pairs.length) return [{ level: 'error', key: 'terminal.log.renameSyntax' }]
  const seen = new Set<string>()
  for (const v of ctx.variables) {
    const name = renamed.get(v.colId) ?? v.name
    if (seen.has(name.toLowerCase())) {
      return [{ level: 'error', key: 'terminal.log.nameExists', params: { name } }]
    }
    seen.add(name.toLowerCase())
  }

  const apply = async (variable: Variable, name: string): Promise<void> => {
    await window.api.variable.update({
      datasetId: ctx.datasetId,
      colId: variable.colId,
      updates: { name }
    })
    // Reflect in the renderer store (Variable/Data View).
    const ds = useDatasetStore.getState()
    const idx = ds.variables.findIndex(v => v.colId === variable.colId)
    if (idx >= 0) ds.updateVariable(idx, { name })
  }
  // A new name that is another pair's old name (a swap) goes via a free
  // temporary name first, so no step ever holds a duplicate.
  const olds = new Set(pairs.map(p => p.old.toLowerCase()))
  const viaTemp = pairs.filter(
    p => olds.has(p.next.toLowerCase()) && p.next.toLowerCase() !== p.old.toLowerCase()
  )
  for (const [i, p] of viaTemp.entries()) {
    let temp = `sai_tmp_${String(i)}`
    while (seen.has(temp) || ctx.variables.some(v => v.name.toLowerCase() === temp)) temp += '_'
    await apply(p.variable, temp)
  }
  for (const p of pairs) await apply(p.variable, p.next)
  useDatasetStore.getState().setModified(true)
  return pairs.map(p => ({
    level: 'success' as const,
    key: 'terminal.log.renamed',
    params: { old: p.old, next: p.next }
  }))
}

/**
 * VARIABLE LABELS var1 'label1' var2 'label2' ...
 * Pure renderer/IPC work — no new R script needed (§5 point 3 of CLAUDE.md).
 */
async function runVariableLabels(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const out: SyntaxLogEntry[] = []
  const pairRe = /([A-Za-z_]\w*)\s+(?:'([^']*)'|"([^"]*)")/g
  let m: RegExpExecArray | null
  let found = false
  while ((m = pairRe.exec(st.body)) !== null) {
    found = true
    const name = m[1] as string
    const label = m[2] ?? m[3] ?? ''
    const { resolved, unknown } = resolveVars([name], ctx.variables)
    if (unknown.length) {
      out.push(unknownVarsError(unknown))
      continue
    }
    const v = resolved[0] as Variable
    await window.api.variable.update({
      datasetId: ctx.datasetId,
      colId: v.colId,
      updates: { label }
    })
    const ds = useDatasetStore.getState()
    const idx = ds.variables.findIndex(x => x.colId === v.colId)
    if (idx >= 0) ds.updateVariable(idx, { label })
    ds.setModified(true)
    out.push({ level: 'success', key: 'terminal.log.variableLabelSet', params: { name: v.name } })
  }
  if (!found) return [{ level: 'error', key: 'terminal.log.variableLabelsSyntax' }]
  return out
}

/**
 * VALUE LABELS var1 var2 ... val 'label' val2 'label2' ... [/var3 val 'label' ...]
 * Groups are split on top-level `/`; within a group, SPSS allows a LIST of
 * variables (sharing the same value/label pairs) before the first pair —
 * the leading run of bare identifiers is consumed as variable names, and
 * the first non-identifier token (a quoted/numeric value) starts the pair
 * list (destek talebi 2026-08-25: `VALUE LABELS v1 v2 v3 0 'Yok' 1 'Var'.`
 * was only labeling v1 because the old parser treated everything after the
 * first token as the pair list).
 *
 * As in SPSS, VALUE LABELS replaces a variable's existing labels and ADD VALUE
 * LABELS (`merge`) adds to / overwrites them; both used to merge.
 */
async function runValueLabels(
  st: Statement,
  ctx: DispatchCtx,
  merge = false
): Promise<SyntaxLogEntry[]> {
  const out: SyntaxLogEntry[] = []
  const groups = splitTopLevel(st.body, '/')
    .map(g => g.trim())
    .filter(Boolean)
  if (groups.length === 0) return [{ level: 'error', key: 'terminal.log.valueLabelsSyntax' }]

  for (const g of groups) {
    const nameRe = /^([A-Za-z_]\w*)\s*/
    const names: string[] = []
    let rest = g
    let nm: RegExpExecArray | null
    while ((nm = nameRe.exec(rest)) !== null) {
      names.push(nm[1] as string)
      rest = rest.slice(nm[0].length)
    }
    if (names.length === 0) {
      out.push({ level: 'error', key: 'terminal.log.valueLabelsSyntax' })
      continue
    }
    const { resolved, unknown } = resolveVars(names, ctx.variables)
    if (unknown.length) {
      out.push(unknownVarsError(unknown))
      continue
    }

    // Both the value and the label accept either quote style — SPSS treats
    // '...' and "..." as interchangeable string delimiters everywhere (this
    // command's own VARIABLE LABELS sibling already did; this one required
    // '...' for the label specifically, so VALUE LABELS v 1 "A" 2 "B". read
    // as zero pairs and rejected the whole command as a syntax error).
    const pairRe = /(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))\s+(?:'([^']*)'|"([^"]*)")/g
    const pairs: { value: string; label: string }[] = []
    let pm: RegExpExecArray | null
    while ((pm = pairRe.exec(rest)) !== null) {
      const value = (pm[1] ?? pm[2] ?? pm[3]) as string
      const label = (pm[4] ?? pm[5]) as string
      pairs.push({ value, label })
    }
    if (pairs.length === 0) {
      out.push({ level: 'error', key: 'terminal.log.valueLabelsSyntax' })
      continue
    }

    const ds = useDatasetStore.getState()
    for (const v of resolved) {
      const valueLabels: Record<string, string> = merge ? { ...v.valueLabels } : {}
      for (const { value, label } of pairs) valueLabels[value] = label
      await window.api.variable.update({
        datasetId: ctx.datasetId,
        colId: v.colId,
        updates: { valueLabels }
      })
      const idx = ds.variables.findIndex(x => x.colId === v.colId)
      if (idx >= 0) ds.updateVariable(idx, { valueLabels })
      ds.setModified(true)
      out.push({
        level: 'success',
        key: 'terminal.log.valueLabelsSet',
        params: { name: v.name, count: pairs.length }
      })
    }
  }
  return out
}

/** Parses a RECODE/MISSING VALUES range operand: "1 THRU 5", "LO THRU 5", "5 THRU HI". */
function parseRecodeRange(left: string): { low: number | null; high: number | null } | null {
  const m = /^(LO|LOWEST|-?\d+(?:\.\d+)?)\s+THRU\s+(HI|HIGHEST|-?\d+(?:\.\d+)?)$/i.exec(left.trim())
  if (!m) return null
  const lowTok = (m[1] as string).toUpperCase()
  const highTok = (m[2] as string).toUpperCase()
  const low = lowTok === 'LO' || lowTok === 'LOWEST' ? null : Number(lowTok)
  const high = highTok === 'HI' || highTok === 'HIGHEST' ? null : Number(highTok)
  return { low, high }
}

/**
 * MISSING VALUES var1 var2 (9, 99) [/var3 (1 THRU 5)] ...
 * Discrete lists (up to 3 values, SPSS's own limit) or a single THRU range.
 * Like VALUE LABELS, a group may list several variables sharing one spec —
 * the leading run of bare identifiers is consumed as variable names before
 * the `(...)` spec (destek talebi 2026-08-25, same bug class as VALUE LABELS).
 */
async function runMissingValues(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const out: SyntaxLogEntry[] = []
  const groups = splitTopLevel(st.body, '/')
    .map(g => g.trim())
    .filter(Boolean)
  if (groups.length === 0) return [{ level: 'error', key: 'terminal.log.missingValuesSyntax' }]

  for (const g of groups) {
    const nameRe = /^([A-Za-z_]\w*)\s*/
    const names: string[] = []
    let rest = g
    let nm: RegExpExecArray | null
    while ((nm = nameRe.exec(rest)) !== null) {
      names.push(nm[1] as string)
      rest = rest.slice(nm[0].length)
    }
    const parenM = /^\(([^)]*)\)/.exec(rest)
    if (names.length === 0 || !parenM) {
      out.push({ level: 'error', key: 'terminal.log.missingValuesSyntax' })
      continue
    }
    const inner = (parenM[1] as string).trim()
    const { resolved, unknown } = resolveVars(names, ctx.variables)
    if (unknown.length) {
      out.push(unknownVarsError(unknown))
      continue
    }

    const range = parseRecodeRange(inner.replace(/,/g, ' '))
    const missing = range
      ? {
          type: 'range' as const,
          rangeLow: range.low ?? undefined,
          rangeHigh: range.high ?? undefined
        }
      : { type: 'discrete' as const, discrete: parseList(inner).map(stripQuotes) }

    const ds = useDatasetStore.getState()
    for (const v of resolved) {
      await window.api.variable.update({
        datasetId: ctx.datasetId,
        colId: v.colId,
        updates: { missing }
      })
      const idx = ds.variables.findIndex(x => x.colId === v.colId)
      if (idx >= 0) ds.updateVariable(idx, { missing })
      ds.setModified(true)
      out.push({ level: 'success', key: 'terminal.log.missingValuesSet', params: { name: v.name } })
    }
  }
  return out
}

/** WEIGHT BY var | WEIGHT OFF  → set/clear the case-weight variable (store). */
function runWeight(st: Statement, ctx: DispatchCtx): SyntaxLogEntry[] {
  if (/\bOFF\b/i.test(st.body)) {
    useDatasetStore.getState().setWeight(null)
    return [{ level: 'success', key: 'terminal.log.weightOff' }]
  }
  const m = /\bBY\b\s+([A-Za-z_]\w*)/i.exec(st.body)
  if (!m) return [{ level: 'error', key: 'terminal.log.weightSyntax' }]
  const { resolved, unknown } = resolveVars([m[1] as string], ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  const v = resolved[0] as Variable
  useDatasetStore.getState().setWeight(v.colId)
  return [
    { level: 'success', key: 'terminal.log.weightOn', params: { name: v.name } },
    { level: 'info', key: 'terminal.log.weightScopeNote' }
  ]
}

/** SPLIT FILE [SEPARATE|LAYERED] BY var | SPLIT FILE OFF  → set/clear split (store). */
function runSplitFile(st: Statement, ctx: DispatchCtx): SyntaxLogEntry[] {
  if (/\bOFF\b/i.test(st.body)) {
    useDatasetStore.getState().setSplit(null)
    return [{ level: 'success', key: 'terminal.log.splitOff' }]
  }
  const m = /\bBY\b\s+([A-Za-z_]\w*)/i.exec(st.body)
  if (!m) return [{ level: 'error', key: 'terminal.log.splitSyntax' }]
  const { resolved, unknown } = resolveVars([m[1] as string], ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  const v = resolved[0] as Variable
  useDatasetStore.getState().setSplit(v.colId)
  return [
    { level: 'success', key: 'terminal.log.splitOn', params: { name: v.name } },
    { level: 'info', key: 'terminal.log.splitNotApplied' }
  ]
}

const COMPARISON_OP_MAP: Record<string, string> = {
  '=': 'equals',
  EQ: 'equals',
  '~=': 'not_equals',
  '<>': 'not_equals',
  NE: 'not_equals',
  '<=': 'less_than_or_equal',
  LE: 'less_than_or_equal',
  '>=': 'greater_than_or_equal',
  GE: 'greater_than_or_equal',
  '<': 'less_than',
  LT: 'less_than',
  '>': 'greater_than',
  GT: 'greater_than'
}

/**
 * SELECT IF (var op value) [AND var2 op2 value2 ...]  → case selection.
 * Maps onto the same per-column filter store the Data View grid and every
 * analysis already read (ctx.columnFilters), so cases are filtered exactly
 * the way a manual column-filter selection would. Only a conjunction
 * (AND) of simple `variable OP value` comparisons is supported — one
 * filter slot per column, so OR and multiple conditions on the same
 * variable can't be represented and are rejected rather than silently
 * running a different filter than the user asked for.
 */
function runSelectIf(st: Statement, ctx: DispatchCtx): SyntaxLogEntry[] {
  // `(a > 1)`, `(a > 1 AND b < 3)` and `(a > 1) AND (b < 3)` — a wrapping
  // pair of parens comes off only when it really encloses the whole thing
  // (stripping the first and last character of the third form left
  // `a > 1) AND (b < 3` and rejected it).
  const unwrap = (s: string): string => {
    let t = s.trim()
    for (;;) {
      const inner = splitLeadingParen(t)
      if (!inner || inner.rest !== '') return t
      t = inner.inner.trim()
    }
  }
  const body = unwrap(st.body)
  if (/\bOR\b/i.test(body)) return [{ level: 'error', key: 'terminal.log.selectIfSyntax' }]

  const clauses = body
    .split(/\bAND\b/i)
    .map(unwrap)
    .filter(Boolean)
  if (clauses.length === 0) return [{ level: 'error', key: 'terminal.log.selectIfSyntax' }]

  const clauseRe = /^([A-Za-z_]\w*)\s*(=|~=|<>|<=|>=|<|>|EQ|NE|LE|GE|LT|GT)\s*(.+)$/i
  const parsed: { name: string; op: string; value: string }[] = []
  for (const clause of clauses) {
    const m = clauseRe.exec(clause)
    if (!m) return [{ level: 'error', key: 'terminal.log.selectIfSyntax' }]
    const op = COMPARISON_OP_MAP[(m[2] as string).toUpperCase()]
    if (!op) return [{ level: 'error', key: 'terminal.log.selectIfSyntax' }]
    parsed.push({ name: m[1] as string, op, value: stripQuotes((m[3] as string).trim()) })
  }

  const { resolved, unknown } = resolveVars(
    parsed.map(p => p.name),
    ctx.variables
  )
  if (unknown.length) return [unknownVarsError(unknown)]
  const colIds = resolved.map(v => v.colId)
  if (new Set(colIds).size !== colIds.length) {
    // Same variable referenced twice — our filter store holds one condition
    // per column, so an AND of two conditions on it can't be represented.
    return [{ level: 'error', key: 'terminal.log.selectIfSyntax' }]
  }

  const ds = useDatasetStore.getState()
  parsed.forEach((p, i) => {
    const v = resolved[i] as Variable
    ds.setColumnFilter(v.colId, { operator: p.op, value: p.value })
  })
  return [
    { level: 'success', key: 'terminal.log.selectIfApplied', params: { count: parsed.length } }
  ]
}

/**
 * FILTER BY var  → cases with a zero/missing value on `var` are excluded
 * (matches SPSS's own FILTER semantics), implemented as a `not_equals 0`
 * column filter. FILTER OFF clears every active column filter — SAI doesn't
 * track "which filter came from FILTER BY" separately from manually-applied
 * column filters, so OFF resets the whole filtered view.
 */
function runFilterCmd(st: Statement, ctx: DispatchCtx): SyntaxLogEntry[] {
  const ds = useDatasetStore.getState()
  if (/\bOFF\b/i.test(st.body)) {
    for (const colId of Object.keys(ds.columnFilters)) ds.setColumnFilter(colId, null)
    return [{ level: 'success', key: 'terminal.log.filterOff' }]
  }
  const m = /\bBY\b\s+([A-Za-z_]\w*)/i.exec(st.body)
  if (!m) return [{ level: 'error', key: 'terminal.log.filterSyntax' }]
  const { resolved, unknown } = resolveVars([m[1] as string], ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  const v = resolved[0] as Variable
  ds.setColumnFilter(v.colId, { operator: 'not_equals', value: '0' })
  return [{ level: 'success', key: 'terminal.log.filterOn', params: { name: v.name } }]
}

/**
 * SORT CASES BY var1 [(A|D)] var2 [(A|D)] ... → physical multi-key row sort
 * (DuckDB, via data:sort-multi — the same call SortCasesDialog uses) + grid
 * refresh. Previously only the first key was ever used and the rest were
 * silently dropped — same bug class as VALUE LABELS (destek talebi
 * 2026-08-25); data:sort-multi already existed for the GUI dialog, it just
 * wasn't wired up here.
 */
async function runSortCases(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const byM = /\bBY\b\s+([\s\S]*)$/i.exec(st.body)
  if (!byM) return [{ level: 'error', key: 'terminal.log.sortSyntax' }]

  const keyRe = /([A-Za-z_]\w*)\s*(?:\(\s*(A|ASC|UP|D|DESC|DOWN)\s*\))?\s*/gi
  const keys: { name: string; direction: 'asc' | 'desc' }[] = []
  let km: RegExpExecArray | null
  while ((km = keyRe.exec(byM[1] as string)) !== null) {
    const dirTok = (km[2] ?? '').toUpperCase()
    keys.push({
      name: km[1] as string,
      direction: dirTok === 'D' || dirTok === 'DESC' || dirTok === 'DOWN' ? 'desc' : 'asc'
    })
  }
  if (keys.length === 0) return [{ level: 'error', key: 'terminal.log.sortSyntax' }]

  const { resolved, unknown } = resolveVars(
    keys.map(k => k.name),
    ctx.variables
  )
  if (unknown.length) return [unknownVarsError(unknown)]
  const sortKeys = resolved.map((v, i) => ({
    variable: v,
    direction: (keys[i] as (typeof keys)[number]).direction
  }))

  await window.api.data.sortMulti({
    datasetId: ctx.datasetId,
    keys: sortKeys.map(k => ({ colId: k.variable.colId, direction: k.direction }))
  })
  const ds = useDatasetStore.getState()
  ds.setColumnSort('', null)
  ds.bumpDataVersion()
  ds.setModified(true)
  return sortKeys.map(k => ({
    level: 'success' as const,
    key: 'terminal.log.sorted',
    params: { name: k.variable.name, dir: k.direction }
  }))
}

/** Push a transform:* result (new/updated variables + row count) into the store. */
function applyTransformResult(result: { variables: Variable[]; rowCount: number }): void {
  const ds = useDatasetStore.getState()
  ds.setVariables(result.variables)
  ds.setRowCount(result.rowCount)
  ds.bumpDataVersion()
  ds.setModified(true)
}

/**
 * RECODE var1 var2 ... (old=new)(old2=new2)(lo THRU hi=new3)[(ELSE=x|COPY)]
 * [INTO newvar1 newvar2 ...]
 * Exact-value and THRU/LO/HI range mappings both map to transform:recode.
 * The same mapping rules apply to every listed source variable (matches
 * SPSS semantics) — previously a second variable was rejected outright
 * instead of applying the shared rules to it too (destek talebi 2026-08-25,
 * same bug class as VALUE LABELS). When INTO is given its name count must
 * match the source-variable count (positional pairing, same as
 * AUTORECODE); when omitted, each source variable is recoded in place.
 */
async function runRecode(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const body = st.body
  const firstParen = body.indexOf('(')
  if (firstParen < 0) return [{ level: 'error', key: 'terminal.log.recodeSyntax' }]

  const varList = parseList(body.slice(0, firstParen))
  if (varList.length === 0) return [{ level: 'error', key: 'terminal.log.recodeSyntax' }]
  const { resolved, unknown } = resolveVars(varList, ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]

  const groups = Array.from(body.matchAll(/\(([^)]*)\)/g), m => m[1] ?? '')
  // A null new value is SYSMIS (`(9=SYSMIS)`).
  const mappings: { oldValue: string; newValue: string | null }[] = []
  const rangeMappings: { low: number | null; high: number | null; newValue: string | null }[] = []
  // `(SYSMIS=9)` / `(MISSING=9)`: what a missing source becomes. Matched as
  // the literal text "SYSMIS" before, so missing cases stayed missing.
  let sysmisValue: string | null | undefined
  let elseValue: string | null = null
  // SYSMIS is a third ELSE state, distinct from both "keep" (elseValue null)
  // and "set to this literal" — an unmatched row becomes missing, not the
  // empty string (which used to get cast straight into a numeric column and
  // fail the whole UPDATE — see RecodeRequestSchema's elseSysmis).
  let elseSysmis = false
  for (const g of groups) {
    const eq = g.indexOf('=')
    if (eq < 0) continue
    const left = g.slice(0, eq).trim()
    const rawRight = g.slice(eq + 1).trim()
    const right = rawRight.toUpperCase() === 'SYSMIS' ? null : rawRight
    if (/^(SYSMIS|MISSING)$/i.test(left)) {
      sysmisValue = right === null ? null : stripQuotes(right)
      continue
    }
    if (left.toUpperCase() === 'ELSE') {
      if (right === null) {
        elseSysmis = true
      } else {
        elseValue = right.toUpperCase() === 'COPY' ? null : stripQuotes(right)
      }
      continue
    }
    const range = parseRecodeRange(left)
    if (range) {
      rangeMappings.push({ ...range, newValue: right === null ? null : stripQuotes(right) })
      continue
    }
    // SPSS allows a comma-separated list of old values sharing one new value: "1,2,3=9".
    for (const oldValue of parseList(left)) {
      mappings.push({
        oldValue: stripQuotes(oldValue),
        newValue: right === null ? null : stripQuotes(right)
      })
    }
  }
  if (mappings.length === 0 && rangeMappings.length === 0 && sysmisValue === undefined) {
    return [{ level: 'error', key: 'terminal.log.recodeSyntax' }]
  }

  const intoM = /\bINTO\b\s+([\s\S]*)$/i.exec(body)
  const targetNames = intoM ? parseList(intoM[1] as string) : []
  if (targetNames.length > 0 && targetNames.length !== resolved.length) {
    return [{ level: 'error', key: 'terminal.log.recodeSyntax' }]
  }
  const allNewValues = [
    ...mappings.map(m => m.newValue),
    ...rangeMappings.map(r => r.newValue),
    sysmisValue
  ].filter((v): v is string => typeof v === 'string')
  const outputType = allNewValues.every(v => v !== '' && !Number.isNaN(Number(v)))
    ? 'numeric'
    : 'string'

  const out: SyntaxLogEntry[] = []
  for (let i = 0; i < resolved.length; i++) {
    const src = resolved[i] as Variable
    const targetName = targetNames[i]
    const result = await window.api.transform.recode({
      datasetId: ctx.datasetId,
      sourceColId: src.colId,
      targetColId: targetName ? null : src.colId,
      targetName,
      mappings,
      rangeMappings: rangeMappings.length > 0 ? rangeMappings : undefined,
      ...(sysmisValue !== undefined ? { sysmisValue } : {}),
      elseValue,
      elseSysmis,
      outputType
    })
    applyTransformResult(result)
    out.push({
      level: 'success',
      key: 'terminal.log.recoded',
      params: { name: targetName ?? src.name }
    })
  }
  return out
}

type CountCriterion = (v: CellValue) => boolean

/** One COUNT value list: `1 2`, `'A'`, `1 THRU 5`, `LO THRU 0`, `MISSING`, `SYSMIS`. */
function parseCountValues(spec: string): CountCriterion[] | null {
  const toks = spec.match(/'[^']*'|"[^"]*"|[^\s,]+/g) ?? []
  const out: CountCriterion[] = []
  const num = (v: CellValue): number | null => {
    if (v === null || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isNaN(n) ? null : n
  }
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i] as string
    const up = tok.toUpperCase()
    if (up === 'MISSING' || up === 'SYSMIS') {
      out.push(v => v === null || v === '')
      continue
    }
    if ((toks[i + 1] ?? '').toUpperCase() === 'THRU') {
      const range = parseRecodeRange(`${tok} THRU ${toks[i + 2] ?? ''}`)
      if (!range) return null
      out.push(v => {
        const n = num(v)
        return (
          n !== null &&
          (range.low === null || n >= range.low) &&
          (range.high === null || n <= range.high)
        )
      })
      i += 2
      continue
    }
    const want = stripQuotes(tok)
    const wantNum = /^['"]/.test(tok) ? null : num(want)
    out.push(v => {
      if (v === null) return false
      if (wantNum !== null) return num(v) === wantNum
      return String(v) === want
    })
  }
  return out.length > 0 ? out : null
}

/**
 * COUNT target = v1 v2 (values) [v3 (values) …] [/target2 = …].
 * Each listed variable adds one per case when its value matches its group's
 * values (THRU ranges, MISSING/SYSMIS included). This used to read only the
 * FIRST group and its first value, so `COUNT n = a (0) b (2 THRU 4)` counted
 * zeros in `a` and nothing else.
 */
async function runCount(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const specs: { target: string; pairs: { vars: Variable[]; crit: CountCriterion[] }[] }[] = []
  for (const part of splitTopLevel(st.body, '/')) {
    if (part.trim() === '') continue
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(part)
    if (!m) return [{ level: 'error', key: 'terminal.log.countSyntax' }]
    const pairs: { vars: Variable[]; crit: CountCriterion[] }[] = []
    for (const g of (m[2] as string).matchAll(/([^()]+)\(([^)]*)\)/g)) {
      const { resolved, unknown } = resolveVars(parseList(g[1] as string), ctx.variables)
      if (unknown.length) return [unknownVarsError(unknown)]
      const crit = parseCountValues(g[2] as string)
      if (resolved.length === 0 || !crit)
        return [{ level: 'error', key: 'terminal.log.countSyntax' }]
      pairs.push({ vars: resolved, crit })
    }
    if (pairs.length === 0) return [{ level: 'error', key: 'terminal.log.countSyntax' }]
    specs.push({ target: m[1] as string, pairs })
  }
  if (specs.length === 0) return [{ level: 'error', key: 'terminal.log.countSyntax' }]

  const rows = await fetchCtxRows(ctx)
  const out: SyntaxLogEntry[] = []
  for (const spec of specs) {
    const cols = spec.pairs.map(p => ({
      idx: p.vars.map(v => ctx.variables.findIndex(x => x.colId === v.colId)),
      crit: p.crit
    }))
    const updates: { rowIndex: number; value: CellValue }[] = []
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (ctx.rowMask && !ctx.rowMask[rowIndex]) continue
      const row = rows[rowIndex] as CellValue[]
      let n = 0
      for (const c of cols) {
        for (const i of c.idx) {
          const v = row[i] ?? null
          if (c.crit.some(f => f(v))) n++
        }
      }
      updates.push({ rowIndex, value: n })
    }
    const target = await ensureTarget(ctx, spec.target, true, 0)
    if (!target) return [...out, targetFailed()]
    await writeCells(ctx, target, updates)
    out.push({ level: 'success', key: 'terminal.log.counted', params: { name: spec.target } })
  }
  return out
}

/**
 * RANK VARIABLES=var1 var2 ... (A|D) → rank cases into "<var>_rank" for
 * EACH listed variable (previously only the first was ranked and the rest
 * silently dropped — same bug class as VALUE LABELS, destek talebi 2026-08-25).
 */
async function runRank(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const listPart = /VARIABLES\s*=/i.test(st.body) ? afterEquals(st.body, 'VARIABLES') : st.body
  const tokens = parseList(listPart).filter(t => !t.startsWith('('))
  const { resolved, unknown } = resolveVars(tokens, ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.rankSyntax' }]
  const order = /\(\s*(D|DESC)\s*\)/i.test(st.body) ? 'descending' : 'ascending'
  const out: SyntaxLogEntry[] = []
  for (const src of resolved) {
    const result = await window.api.transform.rankCases({
      datasetId: ctx.datasetId,
      sourceColId: src.colId,
      targetName: `${src.name}_rank`,
      order,
      method: 'rank'
    })
    applyTransformResult(result)
    out.push({ level: 'success', key: 'terminal.log.ranked', params: { name: `${src.name}_rank` } })
  }
  return out
}

/**
 * AUTORECODE VARIABLES=var1 var2 ... /INTO newvar1 newvar2 ... → sequential
 * integer codes, one source→target pair per position (previously only the
 * first source variable was recoded and the rest silently dropped — same
 * bug class as VALUE LABELS, destek talebi 2026-08-25).
 */
async function runAutorecode(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const listPart = /VARIABLES\s*=/i.test(st.body)
    ? afterEquals(st.body, 'VARIABLES')
    : (splitTopLevel(st.body, '/')[0] ?? '')
  const { resolved, unknown } = resolveVars(parseList(listPart), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]

  const intoGroup = splitTopLevel(st.body, '/').find(g => /^\s*INTO\b/i.test(g))
  const targetNames = intoGroup ? parseList(intoGroup.replace(/^\s*INTO\b/i, '')) : []
  if (resolved.length === 0 || targetNames.length === 0 || targetNames.length !== resolved.length) {
    return [{ level: 'error', key: 'terminal.log.autorecodeSyntax' }]
  }

  const out: SyntaxLogEntry[] = []
  for (let i = 0; i < resolved.length; i++) {
    const src = resolved[i] as Variable
    const targetName = targetNames[i] as string
    const result = await window.api.transform.autoRecode({
      datasetId: ctx.datasetId,
      sourceColId: src.colId,
      targetName,
      order: 'ascending'
    })
    applyTransformResult(result)
    out.push({ level: 'success', key: 'terminal.log.autorecoded', params: { name: targetName } })
  }
  return out
}

/**
 * COMPUTE target = expression.  → real execution, modeled on
 * ComputeVariableDialog.run(): the expression is evaluated per row with
 * evaluateFormula (never reaches DuckDB or R as code), the target variable is
 * created via variable:add when new (its cells overwritten via updateCells
 * when it already exists), then the store is refreshed. Single assignment per
 * statement; the target is a plain variable name.
 */
/**
 * Splits a leading `(...)` group from the rest of a statement body, honouring
 * nested parens and quoted strings (so a `)` inside a label doesn't close the
 * group early). Returns null when the body doesn't start with `(` or the
 * parens never balance. Used by IF to separate its logical-expression
 * condition from the `target = expression` assignment that follows it.
 */
function splitLeadingParen(body: string): { inner: string; rest: string } | null {
  const s = body.trimStart()
  if (!s.startsWith('(')) return null
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return { inner: s.slice(1, i), rest: s.slice(i + 1).trim() }
    }
  }
  return null
}

/**
 * IF (logical expression) target = expression.
 * Unlike COMPUTE (which touches every row), IF only writes rows where the
 * condition evaluates true — a pre-existing target keeps its current value
 * on the other rows, matching real SPSS. A condition that fails to evaluate
 * (e.g. a missing operand) is treated as false, not an error — SPSS itself
 * treats a system-missing logical expression as "case not selected".
 */
async function runIf(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const split = splitLeadingParen(st.body)
  if (!split) return [{ level: 'error', key: 'terminal.log.ifSyntax' }]
  const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(split.rest)
  if (!m) return [{ level: 'error', key: 'terminal.log.ifSyntax' }]
  const condition = expandExprTo(split.inner.trim(), ctx.variables)
  const target = m[1] as string
  const expression = expandExprTo((m[2] as string).trim(), ctx.variables)
  if (condition === '' || expression === '') {
    return [{ level: 'error', key: 'terminal.log.ifSyntax' }]
  }

  const rows = await fetchCtxRows(ctx)
  const matchedUpdates: { rowIndex: number; value: CellValue }[] = []
  let firstError: string | null = null
  let matchedCount = 0
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (ctx.rowMask && !ctx.rowMask[rowIndex]) continue
    const byName = rowNameResolver(ctx, rows[rowIndex] as CellValue[])
    const condRes = evaluateFormula(condition, () => null, byName)
    if (!condRes.ok || !truthy(condRes.value)) continue
    matchedCount++
    const valRes = evaluateFormula(expression, () => null, byName)
    if (!valRes.ok) {
      firstError ??= valRes.error
      continue
    }
    matchedUpdates.push({
      rowIndex,
      value: typeof valRes.value === 'boolean' ? (valRes.value ? 1 : 0) : valRes.value
    })
  }

  const numeric = matchedUpdates.every(u => typeof u.value === 'number' || u.value === null)
  const targetVar = await ensureTarget(ctx, target, numeric)
  if (!targetVar) return [targetFailed()]
  await writeCells(ctx, targetVar, matchedUpdates)

  const out: SyntaxLogEntry[] = [
    {
      level: 'success',
      key: 'terminal.log.ifApplied',
      params: { name: target, count: matchedCount }
    }
  ]
  if (firstError) {
    out.push({ level: 'info', key: 'terminal.log.computeExprError', params: { error: firstError } })
  }
  return out
}

async function runCompute(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(st.body)
  if (!m) return [{ level: 'error', key: 'terminal.log.computeSyntax' }]
  const target = m[1] as string
  const expression = expandExprTo((m[2] as string).trim(), ctx.variables)
  if (expression === '') return [{ level: 'error', key: 'terminal.log.computeSyntax' }]

  // Compute applies to the whole dataset (post-filter view isn't right, like
  // SPSS) — every row in one chunk, same as ComputeVariableDialog. Inside a
  // DO IF branch only the branch's rows are written.
  const rows = await fetchCtxRows(ctx)

  // Evaluate first — if the expression is broken we abort before touching
  // the dataset.
  const updates: { rowIndex: number; value: CellValue }[] = []
  let firstError: string | null = null
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (ctx.rowMask && !ctx.rowMask[rowIndex]) continue
    const res = evaluateFormula(
      expression,
      () => null,
      rowNameResolver(ctx, rows[rowIndex] as CellValue[])
    )
    if (!res.ok) {
      firstError ??= res.error
      updates.push({ rowIndex, value: null })
    } else {
      updates.push({
        rowIndex,
        value: typeof res.value === 'boolean' ? (res.value ? 1 : 0) : res.value
      })
    }
  }
  if (firstError && updates.every(u => u.value === null)) {
    return [{ level: 'error', key: 'terminal.log.computeExprError', params: { error: firstError } }]
  }

  // Create the target column when it doesn't exist yet.
  const numeric = updates.every(u => u.value === null || typeof u.value === 'number')
  const targetVar = await ensureTarget(ctx, target, numeric)
  if (!targetVar) return [targetFailed()]
  await writeCells(ctx, targetVar, updates)
  const out: SyntaxLogEntry[] = [
    { level: 'success', key: 'terminal.log.computed', params: { name: target } }
  ]
  if (firstError) {
    // Bazı satırlar hesaplanamadı (örn. aritmetik ifadede metin) — o hücreler
    // boş yazıldı; başarı notuna ek olarak bilgi satırı düşülür.
    out.push({ level: 'info', key: 'terminal.log.computeExprError', params: { error: firstError } })
  }
  return out
}

// ─── Dictionary commands (FORMATS, STRING/NUMERIC, VARIABLE LEVEL …) ───────

/** Writes `updates` to one variable: Main (DuckDB metadata) + renderer store. */
async function updateVariable(
  ctx: DispatchCtx,
  v: Variable,
  updates: Partial<Variable>
): Promise<void> {
  await window.api.variable.update({ datasetId: ctx.datasetId, colId: v.colId, updates })
  const ds = useDatasetStore.getState()
  const idx = ds.variables.findIndex(x => x.colId === v.colId)
  if (idx >= 0) ds.updateVariable(idx, updates)
  ds.setModified(true)
}

/**
 * `a b (spec) c (spec2) d` → [{a b, spec}, {c, spec2}, {d, null}] — the
 * "variable list, then a parenthesised spec" shape FORMATS, STRING, NUMERIC
 * and VARIABLE LEVEL/WIDTH/ALIGNMENT share. `/` between groups is optional in
 * SPSS, so it is just a separator here. A trailing list without a spec is
 * returned with `spec: null` (NUMERIC's default format).
 */
function varSpecGroups(body: string): { names: string[]; spec: string | null }[] {
  const groups: { names: string[]; spec: string | null }[] = []
  const re = /([^()]*)\(([^)]*)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    groups.push({
      names: parseList((m[1] as string).replace(/\//g, ' ')),
      spec: (m[2] as string).trim()
    })
    last = re.lastIndex
  }
  const tail = parseList(body.slice(last).replace(/\//g, ' '))
  if (tail.length > 0) groups.push({ names: tail, spec: null })
  return groups
}

/**
 * Names for NEW variables, with SPSS's `x1 TO x5` → x1 x2 x3 x4 x5 (same
 * prefix, ascending number; zero padding kept, so `q08 TO q10` gives q08 q09
 * q10). Null when a TO range is malformed.
 */
function expandNewNames(tokens: string[]): string[] | null {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as string
    if (tok.toUpperCase() !== 'TO') {
      out.push(tok)
      continue
    }
    const a = /^(.*?)(\d+)$/.exec(out.pop() ?? '')
    const b = /^(.*?)(\d+)$/.exec(tokens[i + 1] ?? '')
    if (!a || !b || (a[1] as string).toLowerCase() !== (b[1] as string).toLowerCase()) return null
    const from = Number(a[2])
    const to = Number(b[2])
    if (to < from || to - from > MAX_GENERATED_NAMES) return null
    const pad = (a[2] as string).length === (b[2] as string).length ? (a[2] as string).length : 0
    for (let n = from; n <= to; n++) out.push(`${a[1] as string}${String(n).padStart(pad, '0')}`)
    i++
  }
  return out
}

/** Guard against `x1 TO x999999` style typos creating a million columns. */
const MAX_GENERATED_NAMES = 1000

/** An SPSS display format: `F8.2`, `A20`, `COMMA10.1`, `DATE11` … */
function parseFormat(spec: string): { kind: string; width: number; decimals: number } | null {
  const m = /^([A-Z]+)(\d+)(?:\.(\d+))?$/i.exec(spec.trim())
  if (!m) return null
  return { kind: (m[1] as string).toUpperCase(), width: Number(m[2]), decimals: Number(m[3] ?? 0) }
}

// Numeric display formats SAI's width/decimals model can hold. Date/time and
// currency-symbol formats (DATE, ADATE, TIME, DOLLAR …) have no equivalent yet.
const NUMERIC_FORMATS = new Set(['F', 'N', 'E', 'COMMA', 'DOT', 'PCT'])

/**
 * FORMATS / PRINT FORMATS / WRITE FORMATS var list (F8.2) [var list (A20)] …
 * Numeric formats set the variable's width and decimals; an A format on a
 * string variable is accepted unchanged (SPSS cannot resize a string here
 * either). A format that does not match the variable's type is refused for
 * that group, as in SPSS.
 */
async function runFormats(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const groups = varSpecGroups(st.body)
  if (groups.length === 0 || groups.some(g => g.spec === null || g.names.length === 0)) {
    return [{ level: 'error', key: 'terminal.log.formatsSyntax' }]
  }
  const out: SyntaxLogEntry[] = []
  for (const g of groups) {
    const spec = g.spec as string
    const fmt = parseFormat(spec)
    if (!fmt) {
      out.push({ level: 'error', key: 'terminal.log.formatsSyntax' })
      continue
    }
    const { resolved, unknown } = resolveVars(g.names, ctx.variables)
    if (unknown.length) {
      out.push(unknownVarsError(unknown))
      continue
    }
    const isString = fmt.kind === 'A' || fmt.kind === 'AHEX'
    if (!isString && !NUMERIC_FORMATS.has(fmt.kind)) {
      out.push({ level: 'info', key: 'terminal.log.formatUnsupported', params: { format: spec } })
      continue
    }
    for (const v of resolved) {
      if (isString !== (v.type === 'string')) {
        out.push({
          level: 'error',
          key: 'terminal.log.formatTypeMismatch',
          params: { name: v.name, format: spec }
        })
        continue
      }
      if (!isString) {
        await updateVariable(ctx, v, {
          width: clampVariableAttr('width', fmt.width),
          decimals: clampVariableAttr('decimals', fmt.decimals)
        })
      }
      out.push({
        level: 'success',
        key: 'terminal.log.formatSet',
        params: { name: v.name, format: spec.toUpperCase() }
      })
    }
  }
  return out
}

/**
 * STRING a b (A20) / c (A3).   NUMERIC x y (F8.2) z.
 * Declares new, empty variables (NUMERIC defaults to F8.2; STRING needs an A
 * format). `x1 TO x5` creates the whole run. Naming an existing variable is
 * an error for that variable, as in SPSS.
 */
async function runDeclare(
  st: Statement,
  ctx: DispatchCtx,
  numeric: boolean
): Promise<SyntaxLogEntry[]> {
  const groups = varSpecGroups(st.body)
  const syntaxError: SyntaxLogEntry = {
    level: 'error',
    key: 'terminal.log.declareSyntax',
    params: { command: st.command }
  }
  if (groups.length === 0) return [syntaxError]
  const out: SyntaxLogEntry[] = []
  for (const g of groups) {
    const fmt = g.spec === null ? (numeric ? parseFormat('F8.2') : null) : parseFormat(g.spec)
    const names = expandNewNames(g.names)
    const fmtOk =
      fmt !== null && (numeric ? NUMERIC_FORMATS.has(fmt.kind) : fmt.kind === 'A' && fmt.width > 0)
    if (!fmtOk || !names || names.length === 0) {
      out.push(syntaxError)
      continue
    }
    for (const name of names) {
      if (!VAR_NAME_RE.test(name)) {
        out.push({ level: 'error', key: 'terminal.log.invalidName', params: { name } })
        continue
      }
      if (ctx.variables.some(v => v.name.toLowerCase() === name.toLowerCase())) {
        out.push({ level: 'error', key: 'terminal.log.nameExists', params: { name } })
        continue
      }
      const created = await createVariable(
        ctx,
        name,
        numeric,
        clampVariableAttr('width', fmt.width),
        clampVariableAttr('decimals', fmt.decimals)
      )
      if (!created) {
        out.push(targetFailed())
        continue
      }
      useDatasetStore.getState().setModified(true)
      out.push({ level: 'success', key: 'terminal.log.variableCreated', params: { name } })
    }
  }
  return out
}

/** One VARIABLE LEVEL / WIDTH / ALIGNMENT command: keyword → attribute. */
type AttributeSpec = (spec: string) => Partial<Variable> | null

const LEVELS: Record<string, Variable['measure']> = {
  SCALE: 'scale',
  ORDINAL: 'ordinal',
  NOMINAL: 'nominal'
}
const ALIGNMENTS: Record<string, Variable['align']> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right'
}

const ATTRIBUTE_SPECS: Record<string, AttributeSpec> = {
  'VARIABLE LEVEL': spec => {
    const measure = LEVELS[spec.toUpperCase()]
    return measure ? { measure } : null
  },
  'VARIABLE WIDTH': spec =>
    /^\d+$/.test(spec) && Number(spec) > 0
      ? { columns: clampVariableAttr('columns', Number(spec)) }
      : null,
  'VARIABLE ALIGNMENT': spec => {
    const align = ALIGNMENTS[spec.toUpperCase()]
    return align ? { align } : null
  }
}

/** VARIABLE LEVEL a b (NOMINAL) c (SCALE) — likewise WIDTH (n) / ALIGNMENT (LEFT). */
async function runVariableAttribute(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const toUpdate = ATTRIBUTE_SPECS[st.command] as AttributeSpec
  const groups = varSpecGroups(st.body)
  const syntaxError: SyntaxLogEntry = {
    level: 'error',
    key: 'terminal.log.variableAttributeSyntax',
    params: { command: st.command }
  }
  if (groups.length === 0) return [syntaxError]
  const out: SyntaxLogEntry[] = []
  for (const g of groups) {
    const updates = g.spec === null ? null : toUpdate(g.spec)
    if (!updates || g.names.length === 0) {
      out.push(syntaxError)
      continue
    }
    const { resolved, unknown } = resolveVars(g.names, ctx.variables)
    if (unknown.length) {
      out.push(unknownVarsError(unknown))
      continue
    }
    for (const v of resolved) {
      await updateVariable(ctx, v, updates)
      out.push({
        level: 'success',
        key: 'terminal.log.variableAttributeSet',
        params: { name: v.name, value: (g.spec as string).toUpperCase() }
      })
    }
  }
  return out
}

const ROLES: Record<string, Variable['role']> = {
  INPUT: 'input',
  TARGET: 'target',
  BOTH: 'both',
  NONE: 'none',
  PARTITION: 'partition',
  SPLIT: 'split'
}

/** VARIABLE ROLE /INPUT a b /TARGET y /NONE id … */
async function runVariableRole(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const groups = splitTopLevel(st.body, '/')
    .map(g => g.trim())
    .filter(Boolean)
  const syntaxError: SyntaxLogEntry = {
    level: 'error',
    key: 'terminal.log.variableAttributeSyntax',
    params: { command: st.command }
  }
  if (groups.length === 0) return [syntaxError]
  const out: SyntaxLogEntry[] = []
  for (const g of groups) {
    const [keyword = '', ...names] = parseList(g)
    const role = ROLES[keyword.toUpperCase()]
    if (!role || names.length === 0) {
      out.push(syntaxError)
      continue
    }
    const { resolved, unknown } = resolveVars(names, ctx.variables)
    if (unknown.length) {
      out.push(unknownVarsError(unknown))
      continue
    }
    for (const v of resolved) {
      await updateVariable(ctx, v, { role })
      out.push({
        level: 'success',
        key: 'terminal.log.variableAttributeSet',
        params: { name: v.name, value: keyword.toUpperCase() }
      })
    }
  }
  return out
}

/** DELETE VARIABLES a b c TO f — one call, so it is one undo step. */
async function runDeleteVariables(st: Statement, ctx: DispatchCtx): Promise<SyntaxLogEntry[]> {
  const { resolved, unknown } = resolveVars(parseList(st.body), ctx.variables)
  if (unknown.length) return [unknownVarsError(unknown)]
  if (resolved.length === 0) return [{ level: 'error', key: 'terminal.log.deleteVariablesSyntax' }]
  // SPSS refuses to leave a dataset with no variables.
  if (resolved.length >= ctx.variables.length) {
    return [{ level: 'error', key: 'terminal.log.deleteAllVariables' }]
  }
  await window.api.variable.deleteMany({
    datasetId: ctx.datasetId,
    colIds: resolved.map(v => v.colId)
  })
  const refreshed = await window.api.variable.getAll({ datasetId: ctx.datasetId })
  const ds = useDatasetStore.getState()
  ds.setVariables(refreshed)
  ds.bumpDataVersion()
  ds.setModified(true)
  ctx.variables = refreshed
  return [
    {
      level: 'success',
      key: 'terminal.log.variablesDeleted',
      params: { count: resolved.length, names: resolved.map(v => v.name).join(' ') }
    }
  ]
}

type Handler = (st: Statement, ctx: DispatchCtx) => SyntaxLogEntry[] | Promise<SyntaxLogEntry[]>

const HANDLERS: Record<string, Handler> = {
  COMPUTE: runCompute,
  IF: runIf,
  RECODE: runRecode,
  COUNT: runCount,
  RANK: runRank,
  AUTORECODE: runAutorecode,
  'RENAME VARIABLES': runRename,
  WEIGHT: runWeight,
  'SPLIT FILE': runSplitFile,
  'SORT CASES': runSortCases,
  'VARIABLE LABELS': runVariableLabels,
  'VALUE LABELS': (st, ctx) => runValueLabels(st, ctx),
  'ADD VALUE LABELS': (st, ctx) => runValueLabels(st, ctx, true),
  'MISSING VALUES': runMissingValues,
  FORMATS: runFormats,
  'PRINT FORMATS': runFormats,
  'WRITE FORMATS': runFormats,
  STRING: (st, ctx) => runDeclare(st, ctx, false),
  NUMERIC: (st, ctx) => runDeclare(st, ctx, true),
  'VARIABLE LEVEL': runVariableAttribute,
  'VARIABLE WIDTH': runVariableAttribute,
  'VARIABLE ALIGNMENT': runVariableAttribute,
  'VARIABLE ROLE': runVariableRole,
  'DELETE VARIABLES': runDeleteVariables,
  'SELECT IF': runSelectIf,
  FILTER: runFilterCmd
}

// ─── Entry point ───────────────────────────────────────────────────────────

/**
 * Parse and execute SPSS syntax. Returns one or more console log entries per
 * statement (echo + outcome). Commands run sequentially so order is preserved.
 */
export async function runSpssSyntax(text: string): Promise<SyntaxLogEntry[]> {
  const ds = useDatasetStore.getState()
  if (!ds.datasetId) return [{ level: 'error', key: 'terminal.log.noDataset' }]

  const ctx: DispatchCtx = {
    datasetId: ds.datasetId,
    variables: ds.variables,
    columnFilters: ds.columnFilters
  }

  const statements = splitStatements(text)
  if (statements.length === 0) return [{ level: 'info', key: 'terminal.log.nothingToRun' }]

  const log: SyntaxLogEntry[] = []
  await runStatements(
    statements.map(raw => parseStatement(raw, ALL_COMMAND_NAMES)),
    ctx,
    log
  )
  return log
}

const echo = (st: Statement): SyntaxLogEntry => ({
  level: 'info',
  key: 'terminal.log.echo',
  params: { line: st.raw }
})

/** Where the block opened at `start` ends (its matching end command), or -1. */
function blockEnd(sts: Statement[], start: number, open: string, end: string): number {
  let depth = 0
  for (let i = start; i < sts.length; i++) {
    const c = (sts[i] as Statement).command
    if (c === open) depth++
    else if (c === end && --depth === 0) return i
  }
  return -1
}

async function runStatements(
  sts: Statement[],
  ctx: DispatchCtx,
  log: SyntaxLogEntry[]
): Promise<void> {
  for (let i = 0; i < sts.length; i++) {
    // Re-read the store before each statement: an earlier statement in this
    // same script (RENAME VARIABLES, RECODE ... INTO, AUTORECODE ... INTO)
    // may have changed variable names — ctx must not run on a stale snapshot.
    const fresh = useDatasetStore.getState()
    ctx.variables = fresh.variables
    ctx.columnFilters = fresh.columnFilters
    const st = sts[i] as Statement

    if (st.command === 'DO IF') {
      i = await runDoIf(sts, i, ctx, log)
      continue
    }
    if (st.command === 'DO REPEAT') {
      i = await runDoRepeat(sts, i, ctx, log)
      continue
    }
    const skipped = SKIPPED_BLOCKS.get(st.command)
    if (skipped) {
      // The commands inside used to run once, unconditionally, as if the
      // block weren't there — `DO REPEAT v = a b. COMPUTE v = 0.` made a
      // variable called v. Nothing in an unsupported block runs now.
      const end = blockEnd(sts, i, st.command, skipped)
      const last = end < 0 ? sts.length - 1 : end
      log.push(echo(st), {
        level: 'error',
        key: 'terminal.log.blockSkipped',
        params: { command: st.command, end: skipped, count: last - i - (end < 0 ? 0 : 1) }
      })
      i = last
      continue
    }
    if (BLOCK_PARTS.has(st.command)) {
      log.push(echo(st), {
        level: 'error',
        key: 'terminal.log.strayBlockPart',
        params: { command: st.command }
      })
      continue
    }
    log.push(echo(st))
    await runOne(st, ctx, log)
  }
}

async function runOne(st: Statement, ctx: DispatchCtx, log: SyntaxLogEntry[]): Promise<void> {
  const analysisHandler = ANALYSIS_HANDLERS[st.command]
  const localHandler = HANDLERS[st.command]
  const guidanceKey = GUIDANCE_COMMANDS.get(st.command)

  switch (true) {
    case !!analysisHandler:
      try {
        const analysisCtx: AnalysisDispatchCtx = {
          variables: ctx.variables,
          runAnalysis: async req => {
            const request = { ...req, datasetId: ctx.datasetId, columnFilters: ctx.columnFilters }
            // E2E hook, the syntax-side twin of useRunAnalysis's __SAI_RUNS__:
            // lets a test compare a pasted command's params with the dialog's.
            const w = window as unknown as { __SAI_SYNTAX_RUNS__?: unknown[] }
            w.__SAI_SYNTAX_RUNS__ ??= []
            w.__SAI_SYNTAX_RUNS__.push(JSON.parse(JSON.stringify(request)))
            await window.api.analysis.run(request)
          }
        }
        log.push(...(await analysisHandler(st, analysisCtx)))
      } catch (err) {
        log.push({
          level: 'error',
          key: 'terminal.log.runFailed',
          params: { detail: String(err) }
        })
      }
      break
    case !!localHandler:
      try {
        log.push(...(await localHandler(st, ctx)))
      } catch (err) {
        log.push({
          level: 'error',
          key: 'terminal.log.runFailed',
          params: { detail: String(err) }
        })
      }
      break
    case !!guidanceKey:
      log.push({ level: 'info', key: guidanceKey, params: { command: st.command } })
      break
    case NOOP_COMMANDS.has(st.command):
      log.push({ level: 'info', key: 'terminal.log.noop', params: { command: st.command } })
      break
    case NOT_IMPLEMENTED_COMMANDS.has(st.command):
      log.push({
        level: 'info',
        key: 'terminal.log.notImplemented',
        params: { command: st.command }
      })
      break
    default:
      log.push({
        level: 'error',
        key: 'terminal.log.unknownCommand',
        params: { command: st.command }
      })
  }
}

// Commands a DO IF branch may hold: they work row by row, so they can be
// limited to the branch's cases (RECODE, RANK … work on whole columns).
const DO_IF_BODY = new Set(['COMPUTE', 'IF', 'COUNT', 'DO IF', 'ELSE IF', 'ELSE', 'END IF'])

/**
 * DO IF (c1). … [ELSE IF (c2). …] [ELSE. …] END IF.
 * Each case takes the first branch whose condition is true; a missing
 * condition ends the search for that case (SPSS), so it takes no branch. The
 * conditions are all evaluated before any branch runs — for a given case
 * nothing in the structure has run before its conditions are tested, so this
 * is exactly SPSS's case-by-case result. Branches then run in order on their
 * own cases; a nested DO IF tests its conditions when it is reached.
 * Returns the index of the END IF.
 */
async function runDoIf(
  sts: Statement[],
  start: number,
  ctx: DispatchCtx,
  log: SyntaxLogEntry[]
): Promise<number> {
  const open = sts[start] as Statement
  const end = blockEnd(sts, start, 'DO IF', 'END IF')
  if (end < 0) {
    log.push(echo(open), { level: 'error', key: 'terminal.log.doIfUnclosed' })
    return sts.length - 1
  }
  const bad = sts.slice(start + 1, end).find(s => !DO_IF_BODY.has(s.command))
  if (bad) {
    log.push(echo(open), {
      level: 'error',
      key: 'terminal.log.doIfUnsupported',
      params: { command: bad.command }
    })
    return end
  }

  // Branches at this level (nested DO IFs stay inside their branch's body).
  // The condition may be parenthesised or not: DO IF (a = 1) / DO IF a = 1.
  const branches: { head: Statement; cond: string | null; body: Statement[] }[] = [
    { head: open, cond: open.body.trim(), body: [] }
  ]
  let depth = 0
  for (let i = start + 1; i < end; i++) {
    const s = sts[i] as Statement
    if (depth === 0 && (s.command === 'ELSE IF' || s.command === 'ELSE')) {
      branches.push({ head: s, cond: s.command === 'ELSE' ? null : s.body.trim(), body: [] })
      continue
    }
    if (s.command === 'DO IF') depth++
    else if (s.command === 'END IF') depth--
    ;(branches[branches.length - 1] as (typeof branches)[number]).body.push(s)
  }
  if (branches.some(b => b.cond === '')) {
    log.push(echo(open), { level: 'error', key: 'terminal.log.doIfSyntax' })
    return end
  }

  // Which branch each case takes (-1: none).
  const rows = await fetchCtxRows(ctx)
  const conds = branches.map(b => (b.cond === null ? null : expandExprTo(b.cond, ctx.variables)))
  const taken = rows.map((row, r) => {
    if (ctx.rowMask && !ctx.rowMask[r]) return -1
    const byName = rowNameResolver(ctx, row)
    for (let k = 0; k < conds.length; k++) {
      const c = conds[k]
      if (c === null || c === undefined) return k
      const res = evaluateFormula(c, () => null, byName)
      if (!res.ok || res.value === null) return -1
      if (truthy(res.value)) return k
    }
    return -1
  })

  const parentMask = ctx.rowMask
  try {
    for (const [k, b] of branches.entries()) {
      log.push(echo(b.head), {
        level: 'info',
        key: 'terminal.log.doIfBranch',
        params: { count: taken.filter(t => t === k).length }
      })
      ctx.rowMask = taken.map(t => t === k)
      await runStatements(b.body, ctx, log)
    }
  } finally {
    ctx.rowMask = parentMask
  }
  log.push(echo(sts[end] as Statement))
  return end
}

/** Cap on DO REPEAT positions — a `1 TO 1000000` typo must not run a million times. */
const MAX_REPEAT = 1000

/**
 * One DO REPEAT replacement list → its items. Variable names (`a TO d` over
 * existing variables, or `x1 TO x5` generating new names), integers (`1 TO 5`
 * counts up) and quoted strings, which keep their quotes so they substitute
 * as string literals. Null when a TO range is malformed or too long.
 */
function repeatItems(raw: string, variables: Variable[]): string[] | null {
  const tokens = raw.match(/'[^']*'|"[^"]*"|[^\s,]+/g) ?? []
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as string
    if (tok.toUpperCase() !== 'TO') {
      out.push(tok)
      continue
    }
    const from = out.pop() ?? ''
    const to = tokens[i + 1] ?? ''
    i++
    if (/^-?\d+$/.test(from) && /^-?\d+$/.test(to)) {
      const a = Number(from)
      const b = Number(to)
      if (b < a || b - a >= MAX_REPEAT) return null
      for (let n = a; n <= b; n++) out.push(String(n))
      continue
    }
    const existing = resolveVars([from, 'TO', to], variables)
    if (existing.unknown.length === 0 && existing.resolved.length > 0) {
      out.push(...existing.resolved.map(v => v.name))
      continue
    }
    const generated = expandNewNames([from, 'TO', to])
    if (!generated) return null
    out.push(...generated)
  }
  return out
}

/** `raw` with each stand-in name (whole word, outside quotes) replaced. */
function substituteStandIns(raw: string, items: Map<string, string>): string {
  return raw
    .split(/('[^']*'|"[^"]*")/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/[A-Za-z_]\w*/g, w => items.get(w.toLowerCase()) ?? w)
    )
    .join('')
}

/**
 * DO REPEAT a = x y z [/b = 1 2 3 …]. … END REPEAT [PRINT].
 * A text macro, as in SPSS: the body runs once per position, with every
 * stand-in replaced by that position's item, and the expanded commands go
 * through the normal dispatcher (so they may hold DO IF, nested DO REPEAT,
 * analyses …). Every list must have the same length. Returns the index of
 * the END REPEAT.
 */
async function runDoRepeat(
  sts: Statement[],
  start: number,
  ctx: DispatchCtx,
  log: SyntaxLogEntry[]
): Promise<number> {
  const open = sts[start] as Statement
  log.push(echo(open))
  const end = blockEnd(sts, start, 'DO REPEAT', 'END REPEAT')
  if (end < 0) {
    log.push({ level: 'error', key: 'terminal.log.doRepeatUnclosed' })
    return sts.length - 1
  }

  const lists: { name: string; items: string[] }[] = []
  for (const spec of splitTopLevel(open.body, '/')) {
    const m = /^\s*([A-Za-z_]\w*)\s*=([^]*)$/.exec(spec)
    const items = m ? repeatItems(m[2] as string, ctx.variables) : null
    if (!m || !items || items.length === 0) {
      log.push({ level: 'error', key: 'terminal.log.doRepeatSyntax' })
      return end
    }
    lists.push({ name: (m[1] as string).toLowerCase(), items })
  }
  const count = lists[0]?.items.length ?? 0
  if (lists.length === 0 || lists.some(l => l.items.length !== count)) {
    log.push({ level: 'error', key: 'terminal.log.doRepeatLength' })
    return end
  }
  if (count > MAX_REPEAT) {
    log.push({ level: 'error', key: 'terminal.log.doRepeatTooMany', params: { max: MAX_REPEAT } })
    return end
  }

  const body = sts.slice(start + 1, end)
  log.push({ level: 'info', key: 'terminal.log.doRepeatRunning', params: { count } })
  for (let k = 0; k < count; k++) {
    const items = new Map(lists.map(l => [l.name, l.items[k] as string]))
    const expanded = body.map(s =>
      parseStatement(substituteStandIns(s.raw, items), ALL_COMMAND_NAMES)
    )
    await runStatements(expanded, ctx, log)
  }
  log.push(echo(sts[end] as Statement))
  return end
}

/** Commands the dispatcher currently understands (for the in-app help panel). */
export const SUPPORTED_COMMANDS = [
  ...ANALYSIS_COMMAND_NAMES,
  ...Object.keys(HANDLERS),
  'DO IF',
  'DO REPEAT'
]

// ─── Syntax generators (inverse of the dispatcher) ───────────────────────────
// Used by the analysis dialogs' "Paste Syntax" button to emit a command line
// that this same dispatcher can re-run. Return null when the selection is
// insufficient (button stays a no-op).

type NamedVar = { name: string }
const names = (vars: NamedVar[]): string => vars.map(v => v.name).join(' ')

/** The BAYES commands' prior width; always written, so the pasted run is explicit. */
const bayesCriteria = (rscale: string | number): string =>
  `\n  /CRITERIA RSCALE=${typeof rscale === 'number' ? String(rscale) : rscale.toUpperCase()}`

/** What buildPMethodParams() produces — the p-value method the dialogs send
 *  (undefined for SPSS's asymptotic default). */
type PMethodSyntax = { method: 'montecarlo' | 'exact'; samples?: number }

/** `/METHOD` clause of NPAR TESTS, empty for SPSS's asymptotic default. */
const nparMethod = (p?: PMethodSyntax): string => {
  if (!p) return ''
  if (p.method === 'exact') return '\n  /METHOD=EXACT'
  return `\n  /METHOD=MC SAMPLES(${String(p.samples ?? 10000)})`
}

/** `/MISSING` clause: only LISTWISE needs saying (ANALYSIS is SPSS's default). */
const nparMissing = (m?: 'analysis' | 'listwise' | 'pairwise'): string =>
  m === 'listwise' ? '\n  /MISSING=LISTWISE' : ''

/** The dialog's statistic flags → SPSS's /CELLS vocabulary (SUMMARIZE, OLAP
 *  CUBES and MEANS share it — the same table the registry's parseCellStats
 *  reads back). Returns null when the selection IS SPSS's default. */
const CELL_KEYWORDS: [string, string][] = [
  ['n', 'COUNT'],
  ['mean', 'MEAN'],
  ['median', 'MEDIAN'],
  ['groupedMedian', 'GMEDIAN'],
  ['seMean', 'SEMEAN'],
  ['sum', 'SUM'],
  ['min', 'MIN'],
  ['max', 'MAX'],
  ['range', 'RANGE'],
  ['first', 'FIRST'],
  ['last', 'LAST'],
  ['sd', 'STDDEV'],
  ['variance', 'VARIANCE'],
  ['kurtosis', 'KURT'],
  ['seKurtosis', 'SEKURT'],
  ['skewness', 'SKEW'],
  ['seSkewness', 'SESKEW'],
  ['harmonic', 'HARMONIC'],
  ['geometric', 'GEOMETRIC'],
  ['pctTotalN', 'NPCT'],
  ['pctTotalSum', 'SPCT']
]
/** REPORT's /SUMMARY functions: the /CELLS words, but SPSS spells three of
 *  them differently here (VALIDN, KURTOSIS, SKEWNESS). Default: N, mean, SD. */
const reportSummary = (stats?: Partial<Record<string, boolean>>): string => {
  const rename: Record<string, string> = { COUNT: 'VALIDN', KURT: 'KURTOSIS', SKEW: 'SKEWNESS' }
  const words = CELL_KEYWORDS.filter(([k]) => (stats ? stats[k] : ['n', 'mean', 'sd'].includes(k)))
    .map(([, kw]) => rename[kw] ?? kw)
    .filter(kw => kw !== 'NPCT' && kw !== 'SPCT')
  return words.length ? words.join(' ') : 'MEAN'
}
const cellKeywords = (stats?: Partial<Record<string, boolean>>): string | null => {
  if (!stats) return null
  const words = CELL_KEYWORDS.filter(([k]) => stats[k]).map(([, kw]) => kw)
  return words.length ? words.join(' ') : null
}

interface CrosstabsOptionsParam {
  cells: {
    observed: boolean
    expected: boolean
    rowPct: boolean
    colPct: boolean
    totalPct: boolean
    unstdResid: boolean
    stdResid: boolean
    adjResid: boolean
  }
  stats: {
    chisquare: boolean
    phiCramer: boolean
    contingency: boolean
    correlations: boolean
    gamma: boolean
    somersd: boolean
    taub: boolean
    tauc: boolean
    eta: boolean
    kappa: boolean
    risk: boolean
    mcnemar: boolean
  }
}

type CurveModelKey =
  | 'linear'
  | 'logarithmic'
  | 'inverse'
  | 'quadratic'
  | 'cubic'
  | 'power'
  | 's'
  | 'growth'
  | 'exponential'
  | 'compound'
  | 'logistic'

/** The GLM Options panel as SPSS /PRINT keywords, shared by UNIANOVA and GLM.
 *  Descriptives stay on unless explicitly turned off — what these builders
 *  always wrote before the dialogs passed their options in. */
function glmPrint(opts?: {
  descriptives?: boolean
  effectSize?: boolean
  power?: boolean
  paramEstimates?: boolean
  homogeneity?: boolean
}): string {
  const words = [
    opts?.descriptives === false ? '' : 'DESCRIPTIVE',
    opts?.effectSize ? 'ETASQ' : '',
    opts?.power ? 'OPOWER' : '',
    opts?.paramEstimates ? 'PARAMETER' : '',
    opts?.homogeneity ? 'HOMOGENEITY' : ''
  ].filter(Boolean)
  return words.length ? `\n  /PRINT=${words.join(' ')}` : ''
}

export const buildSyntax = {
  frequencies: (
    vars: NamedVar[],
    options?: {
      showTable: boolean
      order: 'ascending' | 'descending' | 'ascFreq' | 'descFreq'
      statistics: {
        quartiles: boolean
        percentiles: boolean
        customPercentiles: number[]
        cutPoints: number | null
        mean: boolean
        median: boolean
        mode: boolean
        sum: boolean
        sd: boolean
        variance: boolean
        range: boolean
        min: boolean
        max: boolean
        semean: boolean
        cv: boolean
        skewness: boolean
        kurtosis: boolean
      }
      charts: { type: 'none' | 'barChart' | 'pieChart' | 'histogram'; showNormalCurve: boolean }
    }
  ): string | null => {
    if (!vars.length) return null
    let syntax = `FREQUENCIES VARIABLES=${names(vars)}`
    if (options) {
      // The same SPSS vocabulary the FREQUENCIES handler parses back
      // (FREQ_STAT_KEYWORDS) — Paste and OK must carry the same dialog state.
      const st = options.statistics
      const statsList: string[] = []
      if (st.mean) statsList.push('MEAN')
      if (st.median) statsList.push('MEDIAN')
      if (st.mode) statsList.push('MODE')
      if (st.sum) statsList.push('SUM')
      if (st.sd) statsList.push('STDDEV')
      if (st.variance) statsList.push('VARIANCE')
      if (st.range) statsList.push('RANGE')
      if (st.min) statsList.push('MINIMUM')
      if (st.max) statsList.push('MAXIMUM')
      if (st.semean) statsList.push('SEMEAN')
      if (st.cv) statsList.push('CV')
      if (st.skewness) statsList.push('SKEWNESS')
      if (st.kurtosis) statsList.push('KURTOSIS')
      if (statsList.length) {
        syntax += `\n  /STATISTICS=${statsList.join(' ')}`
      }
      // SPSS's spelling for "quartiles" is /NTILES=4; a cut-points entry
      // carries its own n. They are mutually exclusive in the dialog too.
      if (st.quartiles) {
        syntax += '\n  /NTILES=4'
      } else if (st.cutPoints != null) {
        syntax += `\n  /NTILES=${String(st.cutPoints)}`
      }
      if (st.percentiles) {
        // The dialog's empty list means its fixed default set.
        const p = st.customPercentiles.length ? st.customPercentiles : [5, 10, 25, 50, 75, 90, 95]
        syntax += `\n  /PERCENTILES=${p.join(' ')}`
      }
      const formatList: string[] = []
      if (!options.showTable) formatList.push('NOTABLE')
      if (options.order === 'descending') formatList.push('DVALUE')
      if (options.order === 'ascFreq') formatList.push('AFREQ')
      if (options.order === 'descFreq') formatList.push('DFREQ')
      if (formatList.length) {
        syntax += `\n  /FORMAT=${formatList.join(' ')}`
      }
      if (options.charts.type === 'histogram') {
        syntax += `\n  /HISTOGRAM${options.charts.showNormalCurve ? ' NORMAL' : ''}`
      } else if (options.charts.type === 'barChart') {
        syntax += '\n  /BARCHART'
      } else if (options.charts.type === 'pieChart') {
        syntax += '\n  /PIECHART'
      }
    }
    return syntax + '.'
  },
  descriptives: (
    vars: NamedVar[],
    options?: {
      mean?: boolean
      sum?: boolean
      sd?: boolean
      variance?: boolean
      range?: boolean
      min?: boolean
      max?: boolean
      seMean?: boolean
      kurtosis?: boolean
      skewness?: boolean
      displayOrder?: 'variable' | 'alpha' | 'meanAsc' | 'meanDesc'
    },
    saveZScores?: boolean
  ): string | null => {
    if (!vars.length) return null
    let syntax = `DESCRIPTIVES VARIABLES=${names(vars)}`
    if (options) {
      const STAT: [keyof typeof options, string][] = [
        ['mean', 'MEAN'],
        ['sum', 'SUM'],
        ['sd', 'STDDEV'],
        ['variance', 'VARIANCE'],
        ['range', 'RANGE'],
        ['min', 'MINIMUM'],
        ['max', 'MAXIMUM'],
        ['seMean', 'SEMEAN'],
        ['kurtosis', 'KURTOSIS'],
        ['skewness', 'SKEWNESS']
      ]
      const words = STAT.filter(([k]) => options[k]).map(([, w]) => w)
      // Absent /STATISTICS IS SPSS's default (mean/sd/min/max) — emit only
      // when the selection says something else.
      const isDefault =
        words.length === 4 && ['MEAN', 'STDDEV', 'MINIMUM', 'MAXIMUM'].every(w => words.includes(w))
      if (words.length && !isDefault) syntax += `\n  /STATISTICS=${words.join(' ')}`
      const sort = options.displayOrder
      if (sort === 'alpha') syntax += '\n  /SORT=NAME (A)'
      else if (sort === 'meanAsc') syntax += '\n  /SORT=MEAN (A)'
      else if (sort === 'meanDesc') syntax += '\n  /SORT=MEAN (D)'
    }
    if (saveZScores) syntax += '\n  /SAVE'
    return syntax + '.'
  },
  correlations: (
    vars: NamedVar[],
    methods?: { pearson: boolean; spearman: boolean; kendall: boolean },
    options: CorrelateOptions = defaultCorrelateOptions
  ): string | null => {
    if (vars.length < 2) return null
    // SPSS's Bivariate dialog pastes TWO commands: CORRELATIONS covers Pearson
    // only; Spearman/Kendall go out as NONPAR CORR. Our earlier /COEFFICIENT
    // keyword was an invention real SPSS rejects.
    const parts: string[] = []
    // TWOTAIL+SIG are SPSS's own defaults here — only the non-default keyword
    // needs saying, same convention as /MISSING=PAIRWISE below.
    const printKw = [
      options.oneTailed ? 'ONETAIL' : null,
      !options.flagSignificant ? 'NOSIG' : null
    ].filter((k): k is string => k !== null)
    const missingKw = options.missing === 'listwise' ? '\n  /MISSING=LISTWISE' : ''
    if (!methods || methods.pearson) {
      const statsKw = [
        options.meansAndSD ? 'DESCRIPTIVES' : null,
        options.crossProduct ? 'XPROD' : null
      ].filter((k): k is string => k !== null)
      let cmd = `CORRELATIONS /VARIABLES=${names(vars)}`
      if (printKw.length) cmd += `\n  /PRINT=${printKw.join(' ')}`
      cmd += missingKw
      if (statsKw.length) cmd += `\n  /STATISTICS=${statsKw.join(' ')}`
      parts.push(cmd + '.')
    }
    const nonpar: string[] = []
    if (methods?.spearman) nonpar.push('SPEARMAN')
    if (methods?.kendall) nonpar.push('KENDALL')
    if (nonpar.length) {
      let cmd = `NONPAR CORR VARIABLES=${names(vars)}\n  /PRINT=${[...nonpar, ...printKw].join(' ')}`
      cmd += missingKw
      parts.push(cmd + '.')
    }
    return parts.length ? parts.join('\n') : null
  },
  regression: (
    dep: NamedVar[],
    independents: NamedVar[],
    options: RegressionOptions = defaultRegressionOptions
  ): string | null => {
    const d = dep[0]
    if (!d || !independents.length) return null
    // Subcommand ORDER is not free here: real SPSS rejects the whole command
    // ("Invalid REGRESSION subcommand order ... Execution of this command
    // stops") unless /STATISTICS precedes /DEPENDENT (and /ORIGIN precedes it
    // too). And once /STATISTICS is written it REPLACES the defaults, so the
    // standard tables have to be named again — this is exactly what SPSS's
    // own dialog pastes.
    let syntax = 'REGRESSION'
    if (options.missingMethod === 'mean') syntax += '\n  /MISSING MEANSUB'
    const extraStats = [
      options.confidenceIntervals ? `CI(${String(options.ciLevel)})` : null,
      options.rSquaredChange ? 'CHANGE' : null,
      options.descriptives ? 'DESCRIPTIVES' : null,
      options.partialCorrelations ? 'ZPP' : null,
      options.covarianceMatrix ? 'BCOV' : null,
      options.collinearity ? 'COLLIN TOL' : null
    ].filter(Boolean)
    if (extraStats.length) syntax += `\n  /STATISTICS COEFF OUTS R ANOVA ${extraStats.join(' ')}`
    // Stepping Method Criteria only means anything once a method other than
    // Enter can actually drop/add a variable on its own.
    if (options.method !== 'enter') {
      syntax +=
        options.criteria.type === 'fvalue'
          ? `\n  /CRITERIA=FIN(${String(options.criteria.entryF)}) FOUT(${String(options.criteria.removalF)})`
          : `\n  /CRITERIA=PIN(${String(options.criteria.entryProb)}) POUT(${String(options.criteria.removalProb)})`
    }
    if (!options.includeConstant) syntax += '\n  /ORIGIN'
    syntax += `\n  /DEPENDENT=${d.name}\n  /METHOD=${options.method.toUpperCase()} ${names(independents)}`
    // Durbin-Watson/histogram/normal-probability are all /RESIDUALS keywords
    // in real SPSS — /STATISTICS=DURBIN is rejected ("Invalid keyword") — and
    // /RESIDUALS belongs after /METHOD.
    const residKw = [
      options.plots.histogram ? 'HISTOGRAM(ZRESID)' : null,
      options.plots.normalPP ? 'NORM(ZRESID)' : null,
      options.durbinWatson ? 'DURBIN' : null
    ].filter(Boolean)
    if (residKw.length) syntax += `\n  /RESIDUALS ${residKw.join(' ')}`
    if (options.casewiseDiagnostics) {
      syntax += options.casewiseOutliersOnly
        ? `\n  /CASEWISE OUTLIERS(${String(options.casewiseSD)})`
        : '\n  /CASEWISE ALL'
    }
    if (options.plots.scatterY && options.plots.scatterX) {
      const tok = (t: string) => (t === 'DEPENDNT' ? d.name : `*${t}`)
      syntax += `\n  /SCATTERPLOT=(${tok(options.plots.scatterY)},${tok(options.plots.scatterX)})`
    }
    if (options.plots.partialPlots) syntax += '\n  /PARTIALPLOT ALL'
    return syntax + '.'
  },
  means: (
    deps: NamedVar[],
    factor: NamedVar[],
    missing?: 'analysis' | 'listwise' | 'pairwise',
    cells?: Partial<Record<string, boolean>>
  ): string | null => {
    const f = factor[0]
    if (!deps.length || !f) return null
    let syntax = `MEANS TABLES=${names(deps)} BY ${f.name}`
    if (cells) {
      // Same vocabulary the registry's parseCellStats reads (CELL_STAT_KEYWORDS).
      const CELL: [string, string][] = [
        ['n', 'COUNT'],
        ['mean', 'MEAN'],
        ['median', 'MEDIAN'],
        ['groupedMedian', 'GMEDIAN'],
        ['seMean', 'SEMEAN'],
        ['sum', 'SUM'],
        ['min', 'MIN'],
        ['max', 'MAX'],
        ['range', 'RANGE'],
        ['first', 'FIRST'],
        ['last', 'LAST'],
        ['sd', 'STDDEV'],
        ['variance', 'VARIANCE'],
        ['kurtosis', 'KURT'],
        ['seKurtosis', 'SEKURT'],
        ['skewness', 'SKEW'],
        ['seSkewness', 'SESKEW']
      ]
      const words = CELL.filter(([k]) => cells[k]).map(([, w]) => w)
      // Absent /CELLS IS SPSS's default (count/mean/stddev) — emit otherwise.
      const isDefault =
        words.length === 3 && ['COUNT', 'MEAN', 'STDDEV'].every(w => words.includes(w))
      if (words.length && !isDefault) syntax += `\n  /CELLS=${words.join(' ')}`
    }
    // ANALYSIS is SPSS's default — only LISTWISE needs saying.
    if (missing === 'listwise') syntax += '\n  /MISSING=LISTWISE'
    return syntax + '.'
  },
  crosstabs: (
    rows: NamedVar[],
    cols: NamedVar[],
    options?: CrosstabsOptionsParam
  ): string | null => {
    if (!rows.length || !cols.length) return null
    let syntax = `CROSSTABS /TABLES=${names(rows)} BY ${names(cols)}`
    if (options) {
      // Keywords are SPSS's own (CHISQ/BTAU/CTAU, not CHISQUARE/BTAUB/CTAUC),
      // so pasting what this button produces into real SPSS works too.
      const statsList: string[] = []
      if (options.stats.chisquare) statsList.push('CHISQ')
      if (options.stats.phiCramer) statsList.push('PHI')
      if (options.stats.contingency) statsList.push('CC')
      if (options.stats.correlations) statsList.push('CORR')
      if (options.stats.gamma) statsList.push('GAMMA')
      if (options.stats.somersd) statsList.push('D')
      if (options.stats.taub) statsList.push('BTAU')
      if (options.stats.tauc) statsList.push('CTAU')
      if (options.stats.eta) statsList.push('ETA')
      if (options.stats.kappa) statsList.push('KAPPA')
      if (options.stats.risk) statsList.push('RISK')
      if (options.stats.mcnemar) statsList.push('MCNEMAR')

      if (statsList.length) {
        syntax += `\n  /STATISTICS=${statsList.join(' ')}`
      }

      const cellsList: string[] = []
      if (options.cells.observed) cellsList.push('COUNT')
      if (options.cells.expected) cellsList.push('EXPECTED')
      if (options.cells.rowPct) cellsList.push('ROW')
      if (options.cells.colPct) cellsList.push('COLUMN')
      if (options.cells.totalPct) cellsList.push('TOTAL')
      if (options.cells.unstdResid) cellsList.push('RESID')
      if (options.cells.stdResid) cellsList.push('SRESID')
      if (options.cells.adjResid) cellsList.push('ASRESID')

      if (cellsList.length) {
        syntax += `\n  /CELLS=${cellsList.join(' ')}`
      }
    }
    return syntax + '.'
  },
  examine: (
    deps: NamedVar[],
    factors: NamedVar[],
    labelBy?: NamedVar,
    missing?: 'analysis' | 'listwise' | 'pairwise',
    options?: {
      stats?: {
        descriptives?: boolean
        percentiles?: boolean
        mEstimators?: boolean
        outliers?: boolean
      }
      plots?: { boxplot?: boolean; histogram?: boolean; normality?: boolean }
    }
  ): string | null => {
    if (!deps.length) return null
    let syntax = `EXAMINE VARIABLES=${names(deps)}${factors.length ? ` BY ${names(factors)}` : ''}${labelBy ? ` /ID=${names([labelBy])}` : ''}`
    if (options?.stats) {
      // /STATISTICS carries DESCRIPTIVES/EXTREME; percentiles and M-estimators
      // are their own subcommands in SPSS.
      const words: string[] = []
      if (options.stats.descriptives) words.push('DESCRIPTIVES')
      if (options.stats.outliers) words.push('EXTREME')
      if (words.length) syntax += `\n  /STATISTICS ${words.join(' ')}`
      if (options.stats.percentiles) syntax += '\n  /PERCENTILES'
      if (options.stats.mEstimators) syntax += '\n  /MESTIMATORS'
    }
    if (options?.plots) {
      const words: string[] = []
      if (options.plots.boxplot) words.push('BOXPLOT')
      if (options.plots.histogram) words.push('HISTOGRAM')
      if (options.plots.normality) words.push('NPPLOT')
      // SPSS's default is BOXPLOT; emit only a non-default selection.
      const isDefault = words.length === 1 && words[0] === 'BOXPLOT'
      if (words.length && !isDefault) syntax += `\n  /PLOT ${words.join(' ')}`
      if (!words.length) syntax += '\n  /PLOT NONE'
    }
    if (missing === 'listwise') syntax += '\n  /MISSING=LISTWISE'
    return syntax + '.'
  },
  ttestInd: (
    vars: NamedVar[],
    group: NamedVar[],
    g1: string,
    g2: string,
    missing?: 'analysis' | 'listwise' | 'pairwise'
  ): string | null => {
    const g = group[0]
    return vars.length && g && g1 && g2
      ? `T-TEST GROUPS=${g.name}(${g1} ${g2}) /VARIABLES=${names(vars)}${missing === 'listwise' ? '\n  /MISSING=LISTWISE' : ''}.`
      : null
  },
  ttestPaired: (
    vars1: NamedVar[],
    vars2: NamedVar[],
    missing?: 'analysis' | 'listwise' | 'pairwise'
  ): string | null => {
    if (vars1.length === 0 || vars1.length !== vars2.length) return null
    // SPSS's own multi-pair form is paired LISTS: `PAIRS=a b WITH c d
    // (PAIRED)`. The earlier "a WITH c b WITH d" rendering was neither valid
    // SPSS nor parseable by our own handler.
    return `T-TEST PAIRS=${names(vars1)} WITH ${names(vars2)} (PAIRED)${missing === 'listwise' ? '\n  /MISSING=LISTWISE' : ''}.`
  },
  ttest1: (
    vars: NamedVar[],
    testValue: string | number,
    missing?: 'analysis' | 'listwise' | 'pairwise'
  ): string | null => {
    return vars.length
      ? `T-TEST /TESTVAL=${String(testValue)} /VARIABLES=${names(vars)}${missing === 'listwise' ? '\n  /MISSING=LISTWISE' : ''}.`
      : null
  },
  // ── Bayesian family: SAI's BAYES commands (handlers-bayes.ts), each with the
  // Priors… width as /CRITERIA RSCALE= (a preset name or a custom number).
  bayesTtestInd: (
    vars: NamedVar[],
    group: NamedVar[],
    g1: string,
    g2: string,
    rscale: string | number
  ): string | null => {
    const g = group[0]
    return vars.length && g && g1 && g2
      ? `BAYES TTEST GROUPS=${g.name}(${g1} ${g2}) /VARIABLES=${names(vars)}${bayesCriteria(rscale)}.`
      : null
  },
  bayesTtestPaired: (
    vars1: NamedVar[],
    vars2: NamedVar[],
    rscale: string | number
  ): string | null =>
    vars1.length && vars1.length === vars2.length
      ? `BAYES TTEST PAIRS=${names(vars1)} WITH ${names(vars2)} (PAIRED)${bayesCriteria(rscale)}.`
      : null,
  bayesTtest1: (
    vars: NamedVar[],
    testValue: string | number,
    rscale: string | number
  ): string | null =>
    vars.length
      ? `BAYES TTEST /TESTVAL=${String(testValue)} /VARIABLES=${names(vars)}${bayesCriteria(rscale)}.`
      : null,
  bayesAnova: (deps: NamedVar[], factor: NamedVar[], rscale: string | number): string | null => {
    const f = factor[0]
    return deps.length && f
      ? `BAYES ANOVA DEPENDENT=${names(deps)} /DESIGN=${f.name}${bayesCriteria(rscale)}.`
      : null
  },
  bayesRegression: (dep: NamedVar[], preds: NamedVar[], rscale: string | number): string | null => {
    const d = dep[0]
    return d && preds.length
      ? `BAYES REGRESSION DEPENDENT=${d.name} /METHOD=ENTER ${names(preds)}${bayesCriteria(rscale)}.`
      : null
  },
  bayesCorrelation: (vars: NamedVar[], rscale: string | number): string | null =>
    vars.length >= 2 ? `BAYES CORRELATION VARIABLES=${names(vars)}${bayesCriteria(rscale)}.` : null,
  oneway: (
    deps: NamedVar[],
    factor: NamedVar[],
    options?: {
      homogeneity: boolean
      welch: boolean
      brownForsythe?: boolean
      tukey: boolean
      bonferroni: boolean
      lsd?: boolean
      sidak?: boolean
      scheffe?: boolean
      gamesHowell?: boolean
      tamhaneT2?: boolean
      hochbergGT2?: boolean
      snk?: boolean
      duncan?: boolean
      regwQ?: boolean
      wallerDuncan?: boolean
      sigLevel?: string
      // 'pairwise' included for type compatibility with the shared
      // MissingValuesSection component (used by Correlate too); ONEWAY only
      // ever acts on 'listwise', so it's otherwise a no-op here.
      missing?: 'analysis' | 'listwise' | 'pairwise'
    }
  ): string | null => {
    const f = factor[0]
    if (!deps.length || !f) return null
    let syntax = `ONEWAY ${names(deps)} BY ${f.name}`
    if (options) {
      const statsList: string[] = []
      if (options.homogeneity) statsList.push('HOMOGENEITY')
      if (options.welch) statsList.push('WELCH')
      if (options.brownForsythe) statsList.push('BROWNFORSYTHE')
      if (statsList.length) {
        syntax += `\n  /STATISTICS=${statsList.join(' ')}`
      }

      const posthocList: string[] = []
      if (options.lsd) posthocList.push('LSD')
      if (options.bonferroni) posthocList.push('BONFERRONI')
      if (options.sidak) posthocList.push('SIDAK')
      if (options.scheffe) posthocList.push('SCHEFFE')
      if (options.tukey) posthocList.push('TUKEY')
      if (options.hochbergGT2) posthocList.push('GT2')
      if (options.snk) posthocList.push('SNK')
      if (options.duncan) posthocList.push('DUNCAN')
      if (options.regwQ) posthocList.push('QREGW')
      if (options.wallerDuncan) posthocList.push('WALLER(100)')
      if (options.gamesHowell) posthocList.push('GH')
      if (options.tamhaneT2) posthocList.push('T2')
      if (posthocList.length) {
        const alpha = options.sigLevel ?? '0.05'
        syntax += `\n  /POSTHOC=${posthocList.join(' ')} ALPHA(${alpha})`
      }

      if (options.missing === 'listwise') {
        syntax += '\n  /MISSING=LISTWISE'
      }
    }
    return syntax + '.'
  },

  // ── NPAR TESTS family ──────────────────────────────────────────────────
  // One SPSS command with one sub-command per test, so every Nonparametric
  // Tests dialog pastes `NPAR TESTS /<SUBCOMMAND>=…` plus the two clauses
  // that apply to the whole command: /METHOD (p-value method) and /MISSING.
  //
  // Not expressible in the pasted command: the Monte Carlo SEED (SPSS carries
  // it on a separate `SET SEED` command, so a Paste re-run draws a different
  // sample) and the "pairwise comparisons" checkbox of the K-sample dialogs
  // (a Nonparametric-Tests-dialog feature with no NPAR TESTS keyword). Both
  // are documented in tests/spss-parity/README.md.
  nparChiSquare: (vars: NamedVar[], pMethod?: PMethodSyntax): string | null =>
    vars.length ? `NPAR TESTS /CHISQUARE=${names(vars)}${nparMethod(pMethod)}.` : null,

  nparBinomial: (
    vars: NamedVar[],
    testProp: number | string,
    pMethod?: PMethodSyntax
  ): string | null =>
    vars.length
      ? `NPAR TESTS /BINOMIAL(${String(testProp)})=${names(vars)}${nparMethod(pMethod)}.`
      : null,

  nparKs: (
    vars: NamedVar[],
    dist: 'normal' | 'uniform' | 'poisson' | 'exponential',
    pMethod?: PMethodSyntax
  ): string | null =>
    vars.length
      ? `NPAR TESTS /K-S(${dist.toUpperCase()})=${names(vars)}${nparMethod(pMethod)}.`
      : null,

  nparRuns: (
    vars: NamedVar[],
    cutPoint: 'mean' | 'median' | 'mode',
    pMethod?: PMethodSyntax
  ): string | null =>
    vars.length
      ? `NPAR TESTS /RUNS(${cutPoint.toUpperCase()})=${names(vars)}${nparMethod(pMethod)}.`
      : null,

  nparMannWhitney: (
    vars: NamedVar[],
    group: NamedVar[],
    group1: string,
    group2: string,
    missing?: 'analysis' | 'listwise' | 'pairwise',
    pMethod?: PMethodSyntax,
    statistics?: { descriptives: boolean; quartiles: boolean }
  ): string | null => {
    const g = group[0]
    if (!vars.length || !g || !group1 || !group2) return null
    const stats = [
      ...(statistics?.descriptives ? ['DESCRIPTIVES'] : []),
      ...(statistics?.quartiles ? ['QUARTILES'] : [])
    ]
    const statsClause = stats.length ? ` /STATISTICS=${stats.join(' ')}` : ''
    return `NPAR TESTS /M-W=${names(vars)} BY ${g.name}(${group1} ${group2})${statsClause}${nparMethod(pMethod)}${nparMissing(missing)}.`
  },

  nparKruskalWallis: (
    vars: NamedVar[],
    factor: NamedVar[],
    missing?: 'analysis' | 'listwise' | 'pairwise',
    pMethod?: PMethodSyntax,
    range?: { min: string; max: string },
    testType?: { kruskalWallis: boolean; median: boolean; jonckheereTerpstra: boolean },
    statistics?: { descriptives: boolean; quartiles: boolean }
  ): string | null => {
    const f = factor[0]
    if (!vars.length || !f) return null
    // SPSS requires the factor's value range on each test-type subcommand;
    // our dialog has no range field (the R script uses every observed
    // level), so the widest range the data can hold is written and the
    // handler ignores it.
    const lo = range?.min ?? '1'
    const hi = range?.max ?? '99'
    const target = `${names(vars)} BY ${f.name}(${lo} ${hi})`
    const sub: string[] = []
    if (!testType || testType.kruskalWallis) sub.push(`/K-W=${target}`)
    if (testType?.median) sub.push(`/MEDIAN=${target}`)
    if (testType?.jonckheereTerpstra) sub.push(`/J-T=${target}`)
    if (sub.length === 0) return null
    const stats = [
      ...(statistics?.descriptives ? ['DESCRIPTIVES'] : []),
      ...(statistics?.quartiles ? ['QUARTILES'] : [])
    ]
    const statsClause = stats.length ? `\n  /STATISTICS=${stats.join(' ')}` : ''
    return `NPAR TESTS ${sub.join('\n  ')}${statsClause}${nparMethod(pMethod)}${nparMissing(missing)}.`
  },

  nparWilcoxon: (
    vars1: NamedVar[],
    vars2: NamedVar[],
    missing?: 'analysis' | 'listwise' | 'pairwise',
    pMethod?: PMethodSyntax
  ): string | null => {
    if (vars1.length === 0 || vars1.length !== vars2.length) return null
    return `NPAR TESTS /WILCOXON=${names(vars1)} WITH ${names(vars2)} (PAIRED)${nparMethod(pMethod)}${nparMissing(missing)}.`
  },

  nparFriedman: (vars: NamedVar[], pMethod?: PMethodSyntax): string | null =>
    vars.length >= 2 ? `NPAR TESTS /FRIEDMAN=${names(vars)}${nparMethod(pMethod)}.` : null,

  // ── Scale / Correlate / Reports ────────────────────────────────────────
  reliability: (
    vars: NamedVar[],
    options?: { interItemCorr: boolean; model: 'alpha' | 'split' }
  ): string | null => {
    if (vars.length < 2) return null
    let syntax = `RELIABILITY /VARIABLES=${names(vars)}`
    // SPSS writes /SCALE(label)=ALL for the Paste of this dialog; the label is
    // cosmetic and our handler ignores it, so it is left out.
    syntax += `\n  /MODEL=${options?.model === 'split' ? 'SPLIT' : 'ALPHA'}`
    // SCALE gives the item-total statistics the dialog always shows;
    // CORRELATIONS adds the inter-item matrix when the checkbox is on.
    syntax += `\n  /STATISTICS=DESCRIPTIVE SCALE${options?.interItemCorr ? ' CORRELATIONS' : ''}`
    return syntax + '.'
  },

  partialCorr: (vars: NamedVar[], controls: NamedVar[]): string | null =>
    vars.length >= 2 && controls.length
      ? `PARTIAL CORR /VARIABLES=${names(vars)} BY ${names(controls)}.`
      : null,

  caseSummaries: (
    vars: NamedVar[],
    group: NamedVar[],
    options?: {
      displayCases: boolean
      subtotals: boolean
      limitCases?: number | null
      missing?: 'analysis' | 'listwise' | 'pairwise'
      stats?: Partial<Record<string, boolean>>
    }
  ): string | null => {
    if (!vars.length) return null
    const g = group[0]
    let syntax = `SUMMARIZE /TABLES=${names(vars)}${g ? ` BY ${g.name}` : ''}`
    const fmt: string[] = [options?.displayCases === false ? 'NOLIST' : 'LIST']
    fmt.push(options?.subtotals === false ? 'NOTOTAL' : 'TOTAL')
    if (options?.limitCases) fmt.push(`LIMIT=${String(options.limitCases)}`)
    syntax += `\n  /FORMAT=${fmt.join(' ')}`
    const cells = cellKeywords(options?.stats)
    if (cells) syntax += `\n  /CELLS=${cells}`
    if (options?.missing === 'listwise') syntax += '\n  /MISSING=LISTWISE'
    return syntax + '.'
  },

  olapCubes: (
    vars: NamedVar[],
    groups: NamedVar[],
    options?: {
      missing?: 'analysis' | 'listwise' | 'pairwise'
      stats?: Partial<Record<string, boolean>>
    }
  ): string | null => {
    if (!vars.length) return null
    let syntax = `OLAP CUBES /VARIABLES=${names(vars)}${groups.length ? ` BY ${names(groups)}` : ''}`
    // The two per-grouping-variable percentage cells are written out once per
    // variable — SPSS names the variable inside the keyword, NPCT(bulanti).
    const perGroup = (['pctNIn', 'pctSumIn'] as const)
      .filter(k => options?.stats?.[k])
      .flatMap(k => groups.map(g => `${k === 'pctNIn' ? 'NPCT' : 'SPCT'}(${g.name})`))
    const cells = [cellKeywords(options?.stats), ...perGroup].filter(Boolean).join(' ')
    if (cells) syntax += `\n  /CELLS=${cells}`
    // SPSS's OLAP CUBES has no /MISSING (the command is rejected with it), so
    // the dialog's listwise option cannot be pasted — see the harness README.
    return syntax + '.'
  },

  ratio: (numerator: NamedVar[], denominator: NamedVar[], group: NamedVar[]): string | null => {
    const n = numerator[0]
    const d = denominator[0]
    if (!n || !d) return null
    const g = group[0]
    // Without /PRINT, SPSS prints ONLY the Case Processing Summary — the
    // statistics table the dialog exists for never appears. The keywords below
    // are exactly the columns ratio.R produces.
    return (
      `RATIO STATISTICS ${n.name} WITH ${d.name}${g ? ` BY ${g.name}` : ''}` +
      '\n  /PRINT=MEDIAN MEAN WGTMEAN MIN MAX RANGE COD PRD MDCOV MNCOV.'
    )
  },

  roc: (
    testVars: NamedVar[],
    state: NamedVar[],
    stateValue: string,
    options?: {
      direction?: 'larger' | 'smaller'
      coordinates?: boolean
      plotCurve?: boolean
      diagonal?: boolean
      seCi?: boolean
      cutoff?: 'include' | 'exclude'
      distribution?: 'free' | 'negexpo'
      ciLevel?: number
      userMissing?: 'exclude' | 'include'
    }
  ): string | null => {
    const s = state[0]
    if (!testVars.length || !s || !stateValue) return null
    const o = options ?? {}
    let syntax = `ROC ${names(testVars)} BY ${s.name}(${stateValue})`
    syntax += `\n  /PLOT=${
      o.plotCurve === false ? 'NONE' : o.diagonal === false ? 'CURVE' : 'CURVE(REFERENCE)'
    }`
    const print = [o.seCi === false ? '' : 'SE', o.coordinates ? 'COORDINATES' : '']
      .filter(Boolean)
      .join(' ')
    if (print) syntax += `\n  /PRINT=${print}`
    syntax += `\n  /CRITERIA=CUTOFF(${o.cutoff === 'exclude' ? 'EXCLUDE' : 'INCLUDE'}) TESTPOS(${
      o.direction === 'smaller' ? 'SMALL' : 'LARGE'
    }) DISTRIBUTION(${o.distribution === 'negexpo' ? 'NEGEXPO' : 'FREE'}) CI(${String(
      Math.round((o.ciLevel ?? 0.95) * 10000) / 100
    )})`
    syntax += `\n  /MISSING=${o.userMissing === 'include' ? 'INCLUDE' : 'EXCLUDE'}`
    return syntax + '.'
  },

  curveEstimation: (
    dep: NamedVar[],
    indep: NamedVar[],
    models?: Partial<Record<CurveModelKey, boolean>>,
    options?: {
      independentMode?: 'variable' | 'time'
      caseLabels?: NamedVar[]
      includeConstant?: boolean
      plotModels?: boolean
      displayAnova?: boolean
      logisticUpperBound?: number
    }
  ): string | null => {
    if (!dep.length) return null
    const i = indep[0]
    const timeMode = options?.independentMode === 'time'
    if (!timeMode && !i) return null
    const list: string[] = []
    const push = (kw: string, on?: boolean) => {
      if (on) list.push(kw)
    }
    push('LINEAR', models?.linear)
    push('LOGARITHMIC', models?.logarithmic)
    push('INVERSE', models?.inverse)
    push('QUADRATIC', models?.quadratic)
    push('CUBIC', models?.cubic)
    push('POWER', models?.power)
    push('COMPOUND', models?.compound)
    push('S', models?.s)
    push('GROWTH', models?.growth)
    push('EXPONENTIAL', models?.exponential)
    push('LOGISTIC', models?.logistic)
    const idVar = options?.caseLabels?.[0]
    return (
      `CURVEFIT /VARIABLES=${names(dep)}${timeMode ? '' : ` WITH ${i?.name ?? ''}`}` +
      (idVar ? `\n  /ID=${idVar.name}` : '') +
      `\n  ${options?.includeConstant === false ? '/NOCONSTANT' : '/CONSTANT'}` +
      `\n  /MODEL=${list.length ? list.join(' ') : 'LINEAR'}` +
      (models?.logistic && options?.logisticUpperBound !== undefined
        ? `\n  /UPPERBOUND=${String(options.logisticUpperBound)}`
        : '') +
      (options?.plotModels === false ? '' : '\n  /PLOT FIT') +
      (options?.displayAnova ? '\n  /PRINT ANOVA' : '') +
      '.'
    )
  },

  binaryLogistic: (
    dep: NamedVar[],
    covariates: NamedVar[],
    options: LogisticOptions = defaultLogisticOptions
  ): string | null => {
    const d = dep[0]
    if (!d || !covariates.length) return null
    const print = [
      options.hosmerLemeshow ? 'GOODFIT' : null,
      options.correlation ? 'CORR' : null,
      options.iterationHistory ? 'ITER' : null,
      options.ciExpB ? `CI(${String(options.ciLevel)})` : null
    ].filter(Boolean)
    const casewise = !options.casewiseListing
      ? ''
      : options.casewiseOutliersOnly
        ? `\n  /CASEWISE OUTLIER(${String(options.casewiseThreshold)})`
        : '\n  /CASEWISE ALL'
    const fmt = (n: number) => String(n).replace(/^0\./, '.')
    return (
      `LOGISTIC REGRESSION VARIABLES=${d.name}` +
      `\n  /METHOD=ENTER ${names(covariates)}` +
      (options.classificationPlots ? '\n  /CLASSPLOT' : '') +
      casewise +
      (print.length ? `\n  /PRINT=${print.join(' ')}` : '') +
      (options.includeConstant ? '' : '\n  /ORIGIN') +
      `\n  /CRITERIA=CUT(${fmt(options.classificationCutoff)}) ITERATE(${String(options.maxIterations)}).`
    )
  },

  // ── GLM / Classify / Dimension / Survival ──────────────────────────────
  glmUnivariate: (
    dep: NamedVar[],
    factors: NamedVar[],
    opts?: {
      covariates?: NamedVar[]
      wlsWeight?: NamedVar
      ssType?: 'I' | 'II' | 'III' | 'IV'
      includeIntercept?: boolean
      descriptives?: boolean
      effectSize?: boolean
      power?: boolean
      paramEstimates?: boolean
      homogeneity?: boolean
    }
  ): string | null => {
    const d = dep[0]
    if (!d || (!factors.length && !opts?.covariates?.length)) return null
    // UNIANOVA is what SPSS's Univariate dialog pastes; /DESIGN defaults to the
    // full factorial (factors crossed, covariates additive), which is what
    // glm-univariate.R fits. WLS Weight has no UNIANOVA subcommand of its own
    // in SPSS's own syntax — it's carried on the command line itself
    // (`UNIANOVA y BY … WITH … /WEIGHT=w` isn't a real SPSS keyword, so a WLS
    // weight is left as a Paste-Syntax limitation, documented here rather than
    // emitting an invented subcommand).
    const covs = opts?.covariates ?? []
    const ssType = opts?.ssType ?? 'III'
    const ssNum = { I: 1, II: 2, III: 3, IV: 4 }[ssType]
    const includeIntercept = opts?.includeIntercept ?? true
    const designTerms = [...(covs.length ? covs.map(c => c.name) : []), ...factors.map(f => f.name)]
    return (
      `UNIANOVA ${d.name}` +
      (factors.length ? ` BY ${names(factors)}` : '') +
      (covs.length ? ` WITH ${names(covs)}` : '') +
      `\n  /METHOD=SSTYPE(${String(ssNum)})` +
      `\n  /INTERCEPT=${includeIntercept ? 'INCLUDE' : 'EXCLUDE'}` +
      glmPrint(opts) +
      `\n  /DESIGN=${designTerms.join(' ')}.`
    )
  },

  factorAnalysis: (
    vars: NamedVar[],
    options?: { rotation: 'none' | 'varimax' | 'oblimin' | 'promax'; kmoBartlett: boolean }
  ): string | null => {
    if (vars.length < 2) return null
    const rot = (options?.rotation ?? 'none').toUpperCase()
    return (
      `FACTOR /VARIABLES=${names(vars)}\n  /MISSING LISTWISE\n  /ANALYSIS ${names(vars)}` +
      `\n  /PRINT INITIAL${options?.kmoBartlett ? ' KMO' : ''} EXTRACTION ROTATION` +
      '\n  /CRITERIA MINEIGEN(1) ITERATE(25)\n  /EXTRACTION PC' +
      `\n  /ROTATION ${rot === 'NONE' ? 'NOROTATE' : rot}\n  /METHOD=CORRELATION.`
    )
  },

  discriminant: (
    group: NamedVar[],
    independents: NamedVar[],
    range?: { min: string; max: string }
  ): string | null => {
    const g = group[0]
    if (!g || !independents.length) return null
    // GROUPS needs a value range; the dialog has no range field, so the widest
    // plausible one is written — SPSS uses only the levels present, as we do.
    const lo = range?.min ?? '1'
    const hi = range?.max ?? '99'
    return (
      `DISCRIMINANT /GROUPS=${g.name}(${lo} ${hi})\n  /VARIABLES=${names(independents)}` +
      '\n  /ANALYSIS ALL\n  /PRIORS EQUAL\n  /STATISTICS=TABLE\n  /CLASSIFY=NONMISSING POOLED.'
    )
  },

  kmeans: (vars: NamedVar[], clusters: number | string): string | null =>
    vars.length
      ? `QUICK CLUSTER ${names(vars)}\n  /MISSING=LISTWISE` +
        `\n  /CRITERIA=CLUSTER(${String(clusters)}) MXITER(10) CONVERGE(0)` +
        '\n  /METHOD=KMEANS(NOUPDATE)\n  /PRINT INITIAL ANOVA.'
      : null,

  hierarchical: (
    vars: NamedVar[],
    method: 'ward.D2' | 'average' | 'single' | 'complete'
  ): string | null => {
    if (!vars.length) return null
    const kw =
      method === 'ward.D2'
        ? 'WARD'
        : method === 'single'
          ? 'SINGLE'
          : method === 'complete'
            ? 'COMPLETE'
            : 'BAVERAGE'
    return `CLUSTER ${names(vars)}\n  /METHOD ${kw}\n  /MEASURE=SEUCLID\n  /PRINT SCHEDULE.`
  },

  distances: (
    vars: NamedVar[],
    measure: 'euclidean' | 'sqeuclidean' | 'manhattan' | 'chebyshev' | 'cosine' | 'pearson'
  ): string | null => {
    if (vars.length < 2) return null
    const kw = {
      euclidean: 'EUCLID',
      sqeuclidean: 'SEUCLID',
      manhattan: 'BLOCK',
      chebyshev: 'CHEBYCHEV',
      cosine: 'COSINE',
      pearson: 'CORRELATION'
    }[measure]
    // /VIEW=VARIABLE, matching distances.R (it transposes to variable rows).
    // No /MATRIX=OUT(*): that REPLACES the active file with the proximity
    // matrix, and every command pasted after it then fails on "undefined
    // variable" — which is exactly what the first parity run produced.
    return (
      `PROXIMITIES ${names(vars)}\n  /VIEW=VARIABLE` +
      `\n  /MEASURE=${kw}\n  /PRINT PROXIMITIES\n  /STANDARDIZE=NONE.`
    )
  },

  kaplanMeier: (
    time: NamedVar[],
    status: NamedVar[],
    eventValue: string,
    factor: NamedVar[],
    strata: NamedVar[] = [],
    options: KaplanMeierOptions = defaultKaplanMeierOptions
  ): string | null => {
    const t = time[0]
    const s = status[0]
    if (!t || !s || !eventValue) return null
    const f = factor[0]
    const st = strata[0]
    // /PRINT keywords, in SPSS's own order. TABLE is the per-case survival
    // table, MEAN the means-and-medians block; with everything unticked SPSS
    // writes NONE rather than dropping the subcommand.
    const print = [
      options.stats.survivalTable ? 'TABLE' : null,
      options.stats.meanMedian ? 'MEAN' : null
    ].filter(Boolean)
    const plot = [
      options.plots.survival ? 'SURVIVAL' : null,
      options.plots.oneMinusSurvival ? 'OMS' : null,
      options.plots.hazard ? 'HAZARD' : null,
      options.plots.logSurvival ? 'LOGSURV' : null
    ].filter(Boolean)
    const tests = [
      options.compare.logRank ? 'LOGRANK' : null,
      options.compare.breslow ? 'BRESLOW' : null,
      options.compare.taroneWare ? 'TARONE' : null
    ].filter(Boolean)
    const compareScope = options.compare.mode.startsWith('pairwise') ? 'PAIRWISE' : 'OVERALL'
    const compareStrata = options.compare.mode.endsWith('PerStratum') ? 'SEPARATE' : 'POOLED'
    return (
      `KM ${t.name}${f ? ` BY ${f.name}` : ''}\n  /STATUS=${s.name}(${eventValue})` +
      (st ? `\n  /STRATA=${st.name}` : '') +
      `\n  /PRINT ${print.length ? print.join(' ') : 'NONE'}` +
      (options.stats.quartiles ? '\n  /PERCENTILES=25 50 75' : '') +
      (plot.length ? `\n  /PLOT ${plot.join(' ')}` : '') +
      (f && tests.length
        ? `\n  /COMPARE ${compareScope} ${compareStrata} ${tests.join(' ')}`
        : '') +
      '.'
    )
  },

  coxRegression: (
    time: NamedVar[],
    status: NamedVar[],
    eventValue: string,
    covariates: NamedVar[],
    strata: NamedVar[] = [],
    method: CoxMethod = 'enter',
    // Keyed by variable NAME, not colId: everything else in this file works
    // from `NamedVar` (name only), and syntax is written in names anyway.
    categorical: Record<string, CoxCategoricalSpec> = {},
    options: CoxOptions = defaultCoxOptions
  ): string | null => {
    const t = time[0]
    const s = status[0]
    if (!t || !s || !eventValue || !covariates.length) return null
    const methodKeyword: Record<CoxMethod, string> = {
      enter: 'ENTER',
      forwardLR: 'FSTEP(LR)',
      forwardWald: 'FSTEP(WALD)',
      backwardLR: 'BSTEP(LR)',
      backwardWald: 'BSTEP(WALD)'
    }
    // /CATEGORICAL lists the factors; the coding of each is a separate
    // subcommand named after the contrast, with the reference category in
    // parentheses — the form SPSS's own dialog pastes.
    const catVars = covariates.filter(v => categorical[v.name])
    const catLines = catVars.map(v => {
      const spec = categorical[v.name] as CoxCategoricalSpec
      const kw = spec.contrast.toUpperCase()
      return spec.contrast === 'polynomial'
        ? `\n  /CONTRAST (${v.name})=POLYNOMIAL`
        : `\n  /CONTRAST (${v.name})=${kw}(${spec.reference.toUpperCase()})`
    })
    const catNames = catVars.map(v => v.name)
    const print = [
      options.ciExpB ? `CI(${String(options.ciLevel)})` : null,
      options.correlation ? 'CORR' : null,
      options.baseline ? 'BASELINE' : null
    ].filter(Boolean)
    const fmt = (n: number) => String(n).replace(/^0\./, '.')
    return (
      `COXREG ${t.name}\n  /STATUS=${s.name}(${eventValue})` +
      (strata[0] ? `\n  /STRATA=${strata[0].name}` : '') +
      (catNames.length ? `\n  /CATEGORICAL=${catNames.join(' ')}` : '') +
      catLines.join('') +
      `\n  /METHOD=${methodKeyword[method]} ${names(covariates)}` +
      (print.length ? `\n  /PRINT=${print.join(' ')}` : '') +
      `\n  /CRITERIA=PIN(${fmt(options.entry)}) POUT(${fmt(options.removal)})` +
      ` ITERATE(${String(options.maxIterations)}).`
    )
  },

  // ── The rest of the Analyze menu ───────────────────────────────────────
  glmMultivariate: (
    deps: NamedVar[],
    factors: NamedVar[],
    opts?: {
      covariates?: NamedVar[]
      ssType?: 'I' | 'II' | 'III' | 'IV'
      includeIntercept?: boolean
      descriptives?: boolean
      effectSize?: boolean
      power?: boolean
      paramEstimates?: boolean
      homogeneity?: boolean
      sigLevel?: string
    }
  ): string | null => {
    const covs = opts?.covariates ?? []
    if (deps.length < 2 || (!factors.length && !covs.length)) return null
    const ssNum = { I: 1, II: 2, III: 3, IV: 4 }[opts?.ssType ?? 'III']
    const alphaNum = Number(opts?.sigLevel ?? '0.05')
    const alpha = String(alphaNum > 0 && alphaNum < 1 ? alphaNum : 0.05).replace(/^0\./, '.')
    const design = [...covs.map(c => c.name), ...factors.map(f => f.name)]
    return (
      `GLM ${names(deps)}` +
      (factors.length ? ` BY ${names(factors)}` : '') +
      (covs.length ? ` WITH ${names(covs)}` : '') +
      `\n  /METHOD=SSTYPE(${String(ssNum)})` +
      `\n  /INTERCEPT=${opts?.includeIntercept === false ? 'EXCLUDE' : 'INCLUDE'}` +
      glmPrint(opts) +
      `\n  /CRITERIA=ALPHA(${alpha})` +
      `\n  /DESIGN=${design.join(' ')}.`
    )
  },

  glmRepeated: (
    vars: NamedVar[],
    factorName: string,
    opts?: {
      between?: NamedVar[]
      covariates?: NamedVar[]
      descriptives?: boolean
      effectSize?: boolean
      power?: boolean
      homogeneity?: boolean
      sigLevel?: string
    }
  ): string | null => {
    if (vars.length < 2 || !factorName) return null
    const between = opts?.between ?? []
    const covs = opts?.covariates ?? []
    const alphaNum = Number(opts?.sigLevel ?? '0.05')
    const alpha = String(alphaNum > 0 && alphaNum < 1 ? alphaNum : 0.05).replace(/^0\./, '.')
    const design = [...covs.map(c => c.name), ...between.map(b => b.name)]
    // SPSS's Repeated Measures dialog defines the within factor first, then
    // lists the measures in level order on the GLM command itself; between
    // factors follow BY, covariates WITH, exactly as on a GLM command.
    return (
      `GLM ${names(vars)}` +
      (between.length ? ` BY ${names(between)}` : '') +
      (covs.length ? ` WITH ${names(covs)}` : '') +
      `\n  /WSFACTOR=${factorName} ${String(vars.length)} Polynomial` +
      `\n  /METHOD=SSTYPE(3)` +
      glmPrint({ descriptives: opts?.descriptives ?? false, ...opts }) +
      `\n  /CRITERIA=ALPHA(${alpha})\n  /WSDESIGN=${factorName}` +
      (design.length ? `\n  /DESIGN=${design.join(' ')}` : '') +
      '.'
    )
  },

  multipleResponse: (vars: NamedVar[], countedValue: number | string): string | null =>
    vars.length
      ? `MULT RESPONSE /GROUPS=saiset(${names(vars)} (${String(countedValue)}))` +
        '\n  /FREQUENCIES=saiset.'
      : null,

  multinomial: buildMultinomialSyntax,

  ordinal: ordinalSyntax,

  probit: (
    responseFreq: NamedVar[],
    totalObserved: NamedVar[],
    factor: NamedVar[],
    covariates: NamedVar[],
    options?: {
      transform?: ProbitTransform
      modelType?: ProbitModel
      options?: ProbitOptions
      factorRange?: { min: number; max: number }
    }
  ): string | null => {
    const r = responseFreq[0]
    const total = totalObserved[0]
    if (!r || !total || !covariates.length) return null
    const f = factor[0]
    const opts = options?.options ?? defaultProbitOptions
    const range = options?.factorRange
    const print = [
      opts.frequencies ? 'FREQ' : null,
      opts.fiducialCI ? 'CI' : null,
      opts.parallelism && f ? 'PARALLEL' : null
    ].filter(Boolean)
    const natres =
      opts.naturalResponseMode === 'value'
        ? `VALUE(${String(opts.naturalResponseValue ?? 0)})`
        : opts.naturalResponseMode === 'calculate'
          ? 'CALCULATE'
          : 'NONE'
    return (
      `PROBIT ${r.name} OF ${total.name} WITH ${names(covariates)}` +
      (f ? ` BY ${f.name}${range ? `(${String(range.min)},${String(range.max)})` : ''}` : '') +
      `\n  /MODEL=${(options?.modelType ?? 'probit').toUpperCase()}` +
      `\n  /TRANSFORM=${(options?.transform ?? 'none').toUpperCase()}` +
      (print.length ? `\n  /PRINT=${print.join(' ')}` : '') +
      `\n  /NATRES=${natres}` +
      `\n  /CRITERIA=ITERATE(${String(opts.maxIterations)}) SIG(${String(opts.heterogeneitySig)}).`
    )
  },

  lifeTables: (time: NamedVar[], status: NamedVar[], interval: number | null): string | null => {
    const t = time[0]
    const s = status[0]
    if (!t || !s) return null
    // SPSS's own Life Tables dialog asks for BOTH bounds ("0 through __ by __")
    // and /INTERVAL is not optional; ours only asks for the width, so the paste
    // assumes 20 intervals. Cases past the last bound fall into it, which is
    // what SPSS does with them anyway.
    const by = interval && interval > 0 ? interval : 1
    return (
      `SURVIVAL TABLE=${t.name}\n  /INTERVAL=THRU ${String(by * 20)} BY ${String(by)}` +
      `\n  /STATUS=${s.name}(1)\n  /PRINT=TABLE.`
    )
  },

  /** `predictors` are the covariates (the dialog's first version had only
   *  those); everything else rides in `opts`. */
  mixedModel: (
    dep: NamedVar[],
    predictors: NamedVar[],
    subject: NamedVar[],
    opts?: {
      factors?: NamedVar[]
      fixedModel?: 'main' | 'factorial'
      intercept?: boolean
      ssType?: 'I' | 'III'
      randomIntercept?: boolean
      slopes?: NamedVar[]
      covType?: 'vc' | 'diagonal' | 'unstructured' | 'identity'
      method?: 'REML' | 'ML'
      descriptives?: boolean
      paramEstimates?: boolean
      covCI?: boolean
      ciLevel?: number
      emTerms?: string[]
      compareMainEffects?: boolean
      ciAdjust?: 'none' | 'bonferroni' | 'sidak'
    }
  ): string | null => {
    const d = dep[0]
    const s = subject[0]
    const facs = opts?.factors ?? []
    if (!d || (!predictors.length && !facs.length) || !s) return null
    // Every interaction of the factors, in SPSS's order, for "Factorial".
    const crossed: string[] = []
    if (opts?.fixedModel === 'factorial') {
      const n = facs.length
      for (let mask = 1; mask < 1 << n; mask++) {
        const parts = facs.filter((_, i) => mask & (1 << i)).map(f => f.name)
        if (parts.length > 1) crossed.push(parts.join('*'))
      }
    }
    const fixedTerms = [...predictors.map(p => p.name), ...facs.map(f => f.name), ...crossed]
    const fixedOpts = [
      opts?.intercept === false ? 'NOINT' : '',
      `SSTYPE(${opts?.ssType === 'I' ? '1' : '3'})`
    ]
      .filter(Boolean)
      .join(' ')
    const randomTerms = [
      opts?.randomIntercept === false ? '' : 'INTERCEPT',
      ...(opts?.slopes ?? []).map(v => v.name)
    ].filter(Boolean)
    const covType = { vc: 'VC', diagonal: 'DIAG', unstructured: 'UN', identity: 'ID' }[
      opts?.covType ?? 'vc'
    ]
    const print = [
      opts?.descriptives ? 'DESCRIPTIVES' : '',
      opts?.paramEstimates === false ? '' : 'SOLUTION',
      opts?.covCI ? 'TESTCOV' : ''
    ].filter(Boolean)
    const adj = { none: 'LSD', bonferroni: 'BONFERRONI', sidak: 'SIDAK' }[opts?.ciAdjust ?? 'none']
    const emmeans = (opts?.emTerms ?? []).map(term => {
      // 'OVERALL' or a factor name (the dialog maps its colIds to names).
      const name = term === 'OVERALL' ? 'OVERALL' : (facs.find(f => f.name === term)?.name ?? '')
      if (!name) return ''
      const cmp = name !== 'OVERALL' && opts?.compareMainEffects ? ` COMPARE ADJ(${adj})` : ''
      return `\n  /EMMEANS=TABLES(${name})${cmp}`
    })
    return (
      `MIXED ${d.name}` +
      (facs.length ? ` BY ${names(facs)}` : '') +
      (predictors.length ? ` WITH ${names(predictors)}` : '') +
      `\n  /CRITERIA=CIN(${String(Math.round((opts?.ciLevel ?? 0.95) * 10000) / 100)})` +
      `\n  /FIXED=${fixedTerms.join(' ')} | ${fixedOpts}` +
      `\n  /METHOD=${opts?.method === 'ML' ? 'ML' : 'REML'}` +
      (print.length ? `\n  /PRINT=${print.join(' ')}` : '') +
      `\n  /RANDOM=${randomTerms.join(' ')} | SUBJECT(${s.name}) COVTYPE(${covType})` +
      emmeans.join('') +
      '.'
    )
  },

  generalizedLinear: (
    dep: NamedVar[],
    predictors: NamedVar[],
    distribution: 'poisson' | 'negbin' | 'gamma' | 'normal'
  ): string | null => {
    const d = dep[0]
    if (!d || !predictors.length) return null
    const link = {
      poisson: 'DISTRIBUTION=POISSON LINK=LOG',
      negbin: 'DISTRIBUTION=NEGBIN(1) LINK=LOG',
      gamma: 'DISTRIBUTION=GAMMA LINK=LOG',
      normal: 'DISTRIBUTION=NORMAL LINK=IDENTITY'
    }[distribution]
    return (
      `GENLIN ${d.name} WITH ${names(predictors)}` +
      `\n  /MODEL ${names(predictors)} INTERCEPT=YES ${link}` +
      '\n  /CRITERIA METHOD=FISHER(1) CILEVEL=95\n  /PRINT SOLUTION.'
    )
  },

  missingValueAnalysis: (vars: NamedVar[]): string | null =>
    vars.length >= 2 ? `MVA VARIABLES=${names(vars)}\n  /MPATTERN.` : null,

  // ── SPSS 27+ (run against SPSS 32 here) ────────────────────────────────
  proportions: (
    design: 'one' | 'independent' | 'paired',
    a: NamedVar[],
    b: NamedVar[],
    options: { successValue: string; ciLevel: number | string; testValue?: number | string }
  ): string | null => {
    const v1 = a[0]
    if (!v1) return null
    const crit = `\n  /CRITERIA CILEVEL=${String(options.ciLevel)}`
    const success = `\n  /SUCCESS VALUE=LEVEL(${options.successValue})`
    if (design === 'one') {
      return (
        `PROPORTIONS\n  /ONESAMPLE ${v1.name} TESTVAL=${String(options.testValue ?? 0.5)}` +
        success +
        crit +
        '.'
      )
    }
    const v2 = b[0]
    if (!v2) return null
    if (design === 'independent') {
      return `PROPORTIONS\n  /INDEPENDENTSAMPLES ${v1.name} BY ${v2.name}` + success + crit + '.'
    }
    return (
      `PROPORTIONS\n  /PAIREDSAMPLES ${v1.name} WITH ${v2.name} (PAIRED)` + success + crit + '.'
    )
  },

  glmm: (
    dep: NamedVar[],
    predictors: NamedVar[],
    subject: NamedVar[],
    family: 'binomial' | 'poisson'
  ): string | null => {
    const d = dep[0]
    const s = subject[0]
    if (!d || !predictors.length || !s) return null
    return (
      `GENLINMIXED\n  /FIELDS TARGET=${d.name}` +
      `\n  /TARGET_OPTIONS DISTRIBUTION=${family.toUpperCase()} LINK=${
        family === 'binomial' ? 'LOGIT' : 'LOG'
      }` +
      `\n  /FIXED EFFECTS=${names(predictors)} USE_INTERCEPT=TRUE` +
      `\n  /RANDOM USE_INTERCEPT=TRUE SUBJECTS=${s.name} COVARIANCE_TYPE=VARIANCE_COMPONENTS` +
      // DESCENDING is SPSS's own default and the one that matches glmm.R: it
      // models the HIGHER category as the event. ASCENDING flips the sign of
      // every coefficient against ours.
      '\n  /BUILD_OPTIONS TARGET_CATEGORY_ORDER=DESCENDING.'
    )
  },

  // ── The last of the Analyze menu ───────────────────────────────────────
  knn: (group: NamedVar[], independents: NamedVar[], k: number | string): string | null => {
    const g = group[0]
    if (!g || !independents.length) return null
    // The neighbour count lives on /MODEL as NEIGHBORS=FIXED(K=n); SPSS rejects
    // K on /CRITERIA outright ("KNN is not a valid keyword").
    return `KNN ${g.name} WITH ${names(independents)}\n  /MODEL NEIGHBORS=FIXED(K=${String(k)}).`
  },

  tree: (
    group: NamedVar[],
    independents: NamedVar[],
    options?: { minCases: number; maxDepth: number }
  ): string | null => {
    const g = group[0]
    if (!g || !independents.length) return null
    const minParent = options?.minCases ?? 20
    // MINPARENTSIZE (not MINPARENT), and it may not be smaller than
    // MINCHILDSIZE — SPSS stops the command rather than adjusting either, so
    // the child limit is written too. The [n]/[s] tags are SPSS's measurement
    // levels; our handler strips them.
    return (
      `TREE ${g.name} [n] BY ${independents.map(v => `${v.name} [s]`).join(' ')}` +
      `\n  /GROWTHLIMIT MAXDEPTH=${String(options?.maxDepth ?? 5)}` +
      ` MINPARENTSIZE=${String(minParent)}` +
      ` MINCHILDSIZE=${String(Math.max(1, Math.floor(minParent / 2)))}` +
      // CRT, not SPSS's default CHAID: tree.R is rpart, i.e. CART. Asking SPSS
      // for the algorithm our script actually implements is the only way the
      // two trees can be compared at all.
      '\n  /METHOD TYPE=CRT.'
    )
  },

  gee: (
    dep: NamedVar[],
    predictors: NamedVar[],
    subject: NamedVar[],
    family: 'gaussian' | 'binomial' | 'poisson',
    corstr: string
  ): string | null => {
    const d = dep[0]
    const s = subject[0]
    if (!d || !predictors.length || !s) return null
    const dist = family === 'binomial' ? 'BINOMIAL' : family === 'poisson' ? 'POISSON' : 'NORMAL'
    const link = family === 'binomial' ? 'LOGIT' : family === 'poisson' ? 'LOG' : 'IDENTITY'
    // GEE has no command of its own in SPSS: it is GENLIN plus /REPEATED.
    return (
      `GENLIN ${d.name} WITH ${names(predictors)}` +
      `\n  /MODEL ${names(predictors)} INTERCEPT=YES DISTRIBUTION=${dist} LINK=${link}` +
      `\n  /REPEATED SUBJECT=${s.name} CORRTYPE=${corstr.toUpperCase()}` +
      '\n  /PRINT SOLUTION.'
    )
  },

  mds: (vars: NamedVar[], dimensions: number | string): string | null =>
    vars.length >= 2
      ? `ALSCAL VARIABLES=${names(vars)}\n  /SHAPE=SYMMETRIC\n  /LEVEL=INTERVAL` +
        `\n  /CRITERIA=DIMENS(${String(dimensions)}).`
      : null,

  multipleImputation: (vars: NamedVar[], m: number | string): string | null =>
    vars.length
      ? // SPSS refuses to impute without somewhere to put the result ("OUTFILE
        // must be specified"), so the paste declares an in-memory dataset for
        // it — the same two-command shape PROBIT needs.
        'DATASET DECLARE saiimp.\n' +
        `MULTIPLE IMPUTATION ${names(vars)}` +
        `\n  /IMPUTE METHOD=AUTO NIMPUTATIONS=${String(m)}` +
        '\n  /OUTFILE IMPUTATIONS=saiimp.'
      : null,

  power: (
    test: string,
    params: { effectSize: number; alpha: number; power: number | null; n: number | null }
  ): string | null => {
    const head = {
      tOne: 'MEANS ONESAMPLE',
      tTwo: 'MEANS INDEPENDENT',
      anova: 'MEANS ONEWAY',
      correlation: 'CORRELATION PEARSON',
      chisquare: 'CHISQUARE',
      regression: 'REGRESSION'
    }[test]
    if (!head) return null
    // SPSS solves for whichever of N / POWER is left out.
    // Two-group designs want a size per group: SPSS answers 'N must specify
    // two, and only two valid numeric values' to a single number.
    const twoGroups = test === 'tTwo' || test === 'anova'
    const nText = twoGroups ? `${String(params.n)} ${String(params.n)}` : String(params.n)
    const solveFor =
      params.n && params.n > 0 ? `N=${nText}` : `POWER=${String(params.power ?? 0.8)}`
    return (
      `POWER ${head}` +
      `\n  /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=${String(params.alpha)} ${solveFor}` +
      ` ES=${String(params.effectSize)}.`
    )
  },

  // LIST / NOLIST is what tells the two Report dialogs apart on the way back
  // in: Summaries in Rows always writes one (NOLIST is SPSS's default, so the
  // command means the same to SPSS), Summaries in Columns writes neither.
  reportRows: (
    vars: NamedVar[],
    breaks: NamedVar[],
    options?: {
      grandTotal: boolean
      limitCases: number | null
      displayCases?: boolean
      stats?: Partial<Record<string, boolean>>
      missing?: 'analysis' | 'listwise' | 'pairwise'
    }
  ): string | null =>
    vars.length
      ? `REPORT /FORMAT=AUTOMATIC ${options?.displayCases === false ? 'NOLIST' : 'LIST'}` +
        (options?.grandTotal === false ? ' NOTOTAL' : '') +
        (options?.displayCases !== false && options?.limitCases
          ? ` LIMIT=${String(options.limitCases)}`
          : '') +
        `\n  /VARIABLES=${names(vars)}` +
        (breaks.length ? `\n  /BREAK=${names(breaks)}` : '') +
        `\n  /SUMMARY=${reportSummary(options?.stats)}` +
        (options?.missing === 'listwise' ? '\n  /MISSING=LIST' : '') +
        '.'
      : null,

  reportColumns: (
    vars: NamedVar[],
    breaks: NamedVar[],
    options?: {
      grandTotal: boolean
      stats?: Partial<Record<string, boolean>>
      missing?: 'analysis' | 'listwise' | 'pairwise'
    }
  ): string | null =>
    vars.length
      ? `REPORT /FORMAT=AUTOMATIC${options?.grandTotal === false ? ' NOTOTAL' : ''}` +
        `\n  /VARIABLES=${names(vars)}` +
        (breaks.length ? `\n  /BREAK=${names(breaks)}` : '') +
        `\n  /SUMMARY=${reportSummary(options?.stats)}` +
        (options?.missing === 'listwise' ? '\n  /MISSING=LIST' : '') +
        '.'
      : null,

  rocAnalysis: (
    testVars: NamedVar[],
    state: NamedVar[],
    stateValue: string,
    options?: {
      direction?: 'larger' | 'smaller'
      ciLevel?: number
      cutoff?: 'include' | 'exclude'
      distribution?: 'free' | 'negexpo'
      userMissing?: 'exclude' | 'include'
    },
    display?: {
      plotCurve: boolean
      diagonal: boolean
      prCurve: boolean
      prInterp: 'tp' | 'fp'
      modelQuality: boolean
      seCi: boolean
      coordinates: boolean
      prCoordinates: boolean
    }
  ): string | null => {
    const s = state[0]
    if (!testVars.length || !s || !stateValue) return null
    const plot = display
      ? [
          display.plotCurve ? (display.diagonal ? 'ROC(REFERENCE)' : 'ROC') : '',
          display.prCurve ? `PR(INTERPOLATE(${display.prInterp === 'fp' ? 'FP' : 'TP'}))` : ''
        ].filter(Boolean)
      : []
    const print = display
      ? [
          display.seCi ? 'SE' : '',
          display.modelQuality ? 'MODELQUALITY' : '',
          display.coordinates ? 'COORDINATES' : '',
          display.prCoordinates ? 'PRCOORDINATES' : ''
        ].filter(Boolean)
      : []
    const displayClauses = display
      ? `\n  /PLOT ${plot.length ? plot.join(' ') : 'NONE'}` +
        (print.length ? `\n  /PRINT ${print.join(' ')}` : '')
      : ''
    // SPSS 27+'s own procedure. Its /PLOT keywords differ from the older ROC
    // command's (ROC / PR, not CURVE); /PRINT SE and COORDINATES are the forms
    // the SPSS 32 parity job ran. The Display sub-dialog is written in full so
    // a pasted command draws exactly what the dialog's OK does.
    return (
      `ROC ANALYSIS ${names(testVars)} BY ${s.name}(${stateValue})` +
      `\n  /CRITERIA CUTOFF=${options?.cutoff === 'exclude' ? 'EXCLUDE' : 'INCLUDE'}` +
      ` TESTPOS=${options?.direction === 'smaller' ? 'SMALL' : 'LARGE'}` +
      ` DISTRIBUTION=${options?.distribution === 'negexpo' ? 'NEGEXPO' : 'FREE'}` +
      ` CI=${String(Math.round((options?.ciLevel ?? 0.95) * 10000) / 100)}` +
      (options?.userMissing === 'include' ? '\n  /MISSING USERMISSING=INCLUDE' : '') +
      displayClauses +
      '.'
    )
  },

  // Of the Options sub-dialogs only two choices have a GRAPH keyword: bars as
  // percentages (PCT) and the histogram's normal curve (NORMAL). The rest
  // (sorting, labels, line style, bins, fit line, detrending) are drawing
  // choices GRAPH cannot say; a pasted command draws them at their defaults.
  chart: (
    chartType: string,
    x: NamedVar[],
    y: NamedVar[],
    group: NamedVar[],
    options?: { represent?: string; normalCurve?: boolean }
  ): string | null => {
    const xv = x[0]
    if (!xv) return null
    const yv = y[0]
    const gv = group[0]
    const by = gv ? ` BY ${gv.name}` : ''
    switch (chartType) {
      case 'histogram':
        return `GRAPH /HISTOGRAM${options?.normalCurve ? '(NORMAL)' : ''}=${xv.name}.`
      case 'scatter':
        return yv ? `GRAPH /SCATTERPLOT(BIVAR)=${xv.name} WITH ${yv.name}${by}.` : null
      case 'bar':
        return `GRAPH /BAR(SIMPLE)=${options?.represent === 'percent' ? 'PCT' : 'COUNT'} BY ${xv.name}.`
      // The line dialog plots x itself: means by the group's categories, or
      // the case values when there is no group.
      case 'line':
        return gv
          ? `GRAPH /LINE(SIMPLE)=MEAN(${xv.name}) BY ${gv.name}.`
          : `GRAPH /LINE(SIMPLE)=VALUE(${xv.name}).`
      case 'boxplot':
        return `GRAPH /BOXPLOT=${xv.name}${by}.`
      case 'pp':
        return `PPLOT /VARIABLES=${xv.name} /TYPE=P-P.`
      case 'qq':
        return `PPLOT /VARIABLES=${xv.name} /TYPE=Q-Q.`
      default:
        return null
    }
  }
}
