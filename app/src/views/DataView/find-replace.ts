// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * find-replace.ts — pure search logic for DataView's Bul/Değiştir (G6).
 *
 * The previous grid's native find/replace preset is gone with the migration;
 * this replaces it with a client-side scan instead of a new DuckDB IPC round
 * trip. That's a deliberate simplification, not a corner cut: `rowsRef`
 * already holds every visible row in Renderer memory (T2 — the whole point
 * of not duplicating data between a DB layer and a grid layer), so a linear
 * scan over it is a few hundred milliseconds at 500K rows worst case, no
 * IPC needed. Matches against the *displayed* text (value-label aware),
 * which is what a user visually searching the grid expects to match.
 */
import type { CellValue, Variable } from '@shared/data-types'
import { formatCellDisplay } from '../../lib/aggrid-data'

export interface MatchPosition {
  row: number
  col: number
}

/** A rectangular search scope (visible coordinates, inclusive). */
export interface SearchScope {
  top: number
  bottom: number
  left: number
  right: number
}

/** Search refinements (B6), matching every major spreadsheet's Find options. */
export interface SearchOptions {
  /** Treat the term as a JS regular expression (Sheets-style). */
  regex?: boolean
  /** Match Aa exactly (default: case-insensitive). */
  caseSensitive?: boolean
  /** The whole cell must equal the term, not merely contain it. */
  wholeCell?: boolean
  /** Restrict the scan to a rectangle (LibreOffice's "Current selection only"). */
  scope?: SearchScope | null
  /** Match EMPTY cells, ignoring the search term entirely — the useful half of
   *  Excel's `F5 ▸ Special ▸ Blanks`, folded into Find so "Tümünü Bul" selects
   *  them all and Ctrl+Enter can fill them in one go (no separate dialog). */
  emptyCells?: boolean
  /** Scan order: row-major (default) or column-major — LibreOffice's
   *  "Direction: Rows / Columns". Changes which match comes "next". */
  direction?: 'rows' | 'columns'
}

/** Builds the predicate a cell's displayed text is tested against. Returns
 *  null for an invalid regex, so callers can show "no matches" instead of
 *  throwing while the user is still typing the pattern. */
function buildMatcher(term: string, opts: SearchOptions): ((text: string) => boolean) | null {
  if (opts.regex) {
    try {
      // `wholeCell` anchors the pattern; flags carry case sensitivity.
      const source = opts.wholeCell ? `^(?:${term})$` : term
      const re = new RegExp(source, opts.caseSensitive ? '' : 'i')
      return text => re.test(text)
    } catch {
      return null // invalid pattern mid-typing
    }
  }
  const needle = opts.caseSensitive ? term : term.toLowerCase()
  return text => {
    const hay = opts.caseSensitive ? text : text.toLowerCase()
    return opts.wholeCell ? hay === needle : hay.includes(needle)
  }
}

/**
 * Finds every (row, col) whose displayed text matches `term`. Default is a
 * case-insensitive substring (the behaviour every spreadsheet's Find starts
 * with); `options` enables regex / case-sensitive / whole-cell matching (B6).
 */
export function findMatches(
  term: string,
  rows: CellValue[][],
  variables: Variable[],
  showValueLabels: boolean,
  options: SearchOptions = {}
): MatchPosition[] {
  // Only the plain (non-regex) path trims: in a regex, leading/trailing
  // whitespace can be a deliberate part of the pattern.
  const needle = options.regex ? term : term.trim()
  const matches: MatchPosition[] = []
  // "Find empty cells" ignores the term (there is nothing to type) and matches
  // blank display text; everything else still applies (scope, direction).
  const isMatch = options.emptyCells
    ? (text: string) => text.trim() === ''
    : needle === ''
      ? null
      : buildMatcher(needle, options)
  if (!isMatch) return []

  // Scope: whole grid by default, else the given rectangle (clamped).
  const top = Math.max(0, options.scope?.top ?? 0)
  const bottom = Math.min(rows.length - 1, options.scope?.bottom ?? rows.length - 1)
  const left = Math.max(0, options.scope?.left ?? 0)
  const right = Math.min(variables.length - 1, options.scope?.right ?? variables.length - 1)

  const test = (r: number, c: number) => {
    const variable = variables[c]
    if (!variable) return
    const display = formatCellDisplay(rows[r]?.[c] ?? null, variable, showValueLabels)
    if (isMatch(display)) matches.push({ row: r, col: c })
  }

  // Direction decides the traversal order, which is what "find next" follows.
  if (options.direction === 'columns') {
    for (let c = left; c <= right; c++) for (let r = top; r <= bottom; r++) test(r, c)
  } else {
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) test(r, c)
  }
  return matches
}

/**
 * Computes a cell's replaced text. Plain mode replaces the matched substring
 * (or the whole cell, when `wholeCell`); regex mode runs `String.replace` so
 * capture-group refs like `$1` work, matching Sheets' regex replace.
 */
export function computeReplacement(
  display: string,
  term: string,
  replacement: string,
  options: SearchOptions = {}
): string {
  const needle = options.regex ? term : term.trim()
  if (needle === '') return display
  if (options.wholeCell) return replacement

  if (options.regex) {
    try {
      const re = new RegExp(needle, options.caseSensitive ? 'g' : 'gi')
      return display.replace(re, replacement)
    } catch {
      return display
    }
  }
  if (options.caseSensitive) return display.split(needle).join(replacement)
  // Case-insensitive plain replace, without regex-escaping surprises.
  const lower = display.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  let out = ''
  let i = 0
  while (i < display.length) {
    if (lower.startsWith(lowerNeedle, i)) {
      out += replacement
      i += needle.length
    } else {
      out += display[i] ?? ''
      i++
    }
  }
  return out
}

/** Index of the first match at-or-after (row, col) in the scan order, wrapping
 *  to the start if none — used to resume "next" from wherever the user's
 *  cursor currently is rather than always index 0. `direction` must match the
 *  one `findMatches` used, since that's the order `matches` is in. */
export function findStartIndex(
  matches: MatchPosition[],
  fromRow: number,
  fromCol: number,
  direction: 'rows' | 'columns' = 'rows'
): number {
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (!m) continue
    const after =
      direction === 'columns'
        ? m.col > fromCol || (m.col === fromCol && m.row >= fromRow)
        : m.row > fromRow || (m.row === fromRow && m.col >= fromCol)
    if (after) return i
  }
  return 0
}
