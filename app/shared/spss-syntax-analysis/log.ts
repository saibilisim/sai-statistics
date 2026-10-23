// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { Variable } from '../data-types'
import type { SyntaxLogEntry } from './types'

// ─── Shared log helpers ────────────────────────────────────────────────────

export function unknownVarsError(names: string[]): SyntaxLogEntry {
  return { level: 'error', key: 'terminal.log.unknownVars', params: { names: names.join(', ') } }
}

export function dispatchedToOutput(cmd: string, vars: Variable[]): SyntaxLogEntry {
  return {
    level: 'success',
    key: 'terminal.log.dispatched',
    params: { command: cmd, vars: vars.map(v => v.name).join(', ') }
  }
}

/**
 * Bayes Bayes-factor prior width from `/CRITERIA RSCALE=(WIDE|MEDIUM|ULTRAWIDE|n)`
 * (IBM SPSS Statistics Command Syntax Reference — BAYES TTEST/ANOVA/CORRELATION/
 * REGRESSION all share this CRITERIA subcommand). Defaults to "medium".
 */
export function parseCriteriaRscale(body: string): string | number {
  const m = /\/CRITERIA\b[^/]*\bRSCALE\s*=?\s*(WIDE|MEDIUM|ULTRAWIDE|[\d.]+)/i.exec(body)
  if (!m) return 'medium'
  // A custom width goes to R as a number, as the dialog sends it — BayesFactor
  // reads a string as a preset name and rejects "0.5".
  const v = Number(m[1])
  return Number.isFinite(v) && v > 0 ? v : (m[1] as string).toLowerCase()
}
