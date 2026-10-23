// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'

// ─── Public types ──────────────────────────────────────────────────────────

export type LogLevel = 'info' | 'success' | 'error'

/** A console line. `key` is an i18n key under `analysis:terminal.log.*`. */
export interface SyntaxLogEntry {
  level: LogLevel
  key: string
  params?: Record<string, string | number>
}

export interface Statement {
  /** Upper-cased leading keyword(s), e.g. "FREQUENCIES", "RENAME VARIABLES". */
  command: string
  /** Everything after the keyword, original case, sans trailing terminator. */
  body: string
  raw: string
}

// ─── Analysis dispatch context ─────────────────────────────────────────────

export interface AnalysisRunRequest {
  analysisId: string
  scriptFile: string
  params: Record<string, unknown>
}

export interface AnalysisDispatchCtx {
  variables: Variable[]
  /** Executes one analysis; caller-supplied (Renderer IPC vs. Main job queue). */
  runAnalysis: (req: AnalysisRunRequest) => Promise<void>
}

export type AnalysisHandler = (st: Statement, ctx: AnalysisDispatchCtx) => Promise<SyntaxLogEntry[]>
