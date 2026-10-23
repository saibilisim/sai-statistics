// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * spss-syntax-analysis — the "compiler" half of the SPSS syntax dispatcher
 * (Faz T3), shared between Renderer (Terminal tab, human-typed syntax) and
 * Main (AI `run_syntax` tool). Only the STATISTICAL-ANALYSIS subset of SPSS
 * commands lives here — FREQUENCIES, T-TEST, COXREG, NPAR TESTS, etc. — since
 * those are the only commands that can be fully expressed as a pure
 * `{ analysisId, scriptFile, params }` request with no side effects beyond
 * "run this analysis". Commands that mutate the live dataset/view (RENAME,
 * RECODE, VALUE LABELS, WEIGHT, SPLIT FILE, SELECT IF, FILTER, SORT CASES,
 * ...) stay Renderer-only in src/lib/spss-syntax.ts, because they read/write
 * the Renderer's Zustand store directly — Main has no equivalent state to
 * mutate (see that file's header for the full command-category breakdown).
 *
 * Every handler is dependency-injected via {@link AnalysisDispatchCtx}:
 * it takes the variable list and a `runAnalysis` callback instead of calling
 * `window.api.analysis.run`/`enqueueAiAnalysis` directly, so the exact same
 * SPSS-syntax parsing/param-building code runs unmodified in both contexts —
 * no duplicated regex/parsing logic between the human Terminal path and the
 * AI tool path (CLAUDE.md §11 DRY).
 *
 *   Renderer (src/lib/spss-syntax.ts):
 *     runAnalysis = (req) => window.api.analysis.run({ ...req, datasetId, columnFilters })
 *
 *   Main (electron/ipc/ai-bridge.ts, `run_syntax` tool):
 *     runAnalysis = (req) => enqueueAiAnalysis({ ...req, datasetId, sender, signal })
 *       (the exact same Main-side job pipeline `run_analysis` already uses)
 *
 * Module layout (this file only re-exports the public API):
 *   types.ts                  shared interfaces + dispatch context
 *   parsing.ts                pure syntax-parsing helpers
 *   log.ts                    shared log-entry helpers
 *   handlers-*.ts             per-command dispatch handlers (grouped by family)
 *   registry.ts               command-name list, handler table, statement dispatcher
 */

export type {
  LogLevel,
  SyntaxLogEntry,
  Statement,
  AnalysisRunRequest,
  AnalysisDispatchCtx
} from './types'

export {
  splitTopLevel,
  splitStatements,
  parseStatement,
  parseVariablesList,
  parseList,
  afterEquals,
  parseSubcommand,
  splitOnBy,
  splitOnWith,
  stripRanges,
  stripQuotes,
  resolveVars,
  variableListPart,
  methodVarList
} from './parsing'

export { unknownVarsError, dispatchedToOutput, parseCriteriaRscale } from './log'

export { ANALYSIS_COMMAND_NAMES, ANALYSIS_HANDLERS, dispatchAnalysisStatement } from './registry'
