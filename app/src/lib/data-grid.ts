// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * data-grid.ts — Pure, framework-free helpers for the Data View grid.
 *
 * These functions contain the in-memory filter/sort pipeline, the structural
 * fingerprint used to decide between a full grid rebuild and a cheap in-place
 * update, and the small index/column utilities. They hold no grid or React
 * state, so they are unit-testable in isolation (see tests/unit/data-grid).
 */

import type { CellValue, Variable } from '@shared/data-types'
import { matchFilter, type ColumnFilter, type FilterOperator } from '@shared/data-filter'

// Re-export the filter primitives (now owned by shared/) so existing importers
// of these from data-grid keep working.
export { matchFilter }
export type { ColumnFilter, FilterOperator }

// ─────────────────────────────────────────────────────────────
//  Column letter / name helpers
// ─────────────────────────────────────────────────────────────

/** Spreadsheet column letter for a zero-based index (0 → A, 26 → AA). */
export function getColumnLetter(colIndex: number): string {
  let temp = colIndex
  let letter = ''
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter
    temp = Math.floor(temp / 26) - 1
  }
  return letter
}

/** Inverse of `getColumnLetter`: spreadsheet column letters → zero-based
 *  index (A→0, Z→25, AA→26). Returns -1 for anything that isn't a run of
 *  A–Z letters. Case-insensitive. Used by the Name Box (B1). */
export function columnLetterToIndex(letters: string): number {
  const s = letters.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(s)) return -1
  let idx = 0
  for (let i = 0; i < s.length; i++) {
    idx = idx * 26 + (s.charCodeAt(i) - 64) // 'A' → 1 (bijective base-26)
  }
  return idx - 1
}

/** A rectangle of visible-row × data-column indices, all zero-based inclusive,
 *  already clamped to the grid bounds. What `parseNameBoxAddress` resolves to. */
export interface ParsedAddress {
  top: number
  left: number
  bottom: number
  right: number
}

/**
 * Parses a spreadsheet address typed into the Name Box (B1) and clamps it to
 * the current grid bounds. Supported, matching Excel/Sheets:
 *   - single cell `C7` → that one cell
 *   - rectangular range `A1:D50` → normalized rectangle
 *   - whole column(s) `B:B` / `B:D` → those columns across every row
 *   - whole row(s) `3:3` / `3:5` → those rows across every column
 * Returns `null` for anything unparseable (empty, >1 colon, mixed open ends
 * like `A:5`, non-letter/non-digit tokens). Out-of-range but valid addresses
 * are clamped rather than rejected (`Z1` in a 3-column grid → last column).
 */
export function parseNameBoxAddress(
  input: string,
  maxRow: number,
  maxCol: number
): ParsedAddress | null {
  const raw = input.trim()
  if (raw === '' || maxRow < 0 || maxCol < 0) return null
  const parts = raw.split(':')
  if (parts.length > 2) return null

  // Parses one token into an optional row and/or column (either may be absent:
  // `C` → col only, `7` → row only, `C7` → both, `` → invalid).
  const parseToken = (token: string): { row: number | null; col: number | null } | null => {
    const m = /^([A-Za-z]*)(\d*)$/.exec(token.trim())
    if (!m) return null
    const letters = m[1] ?? ''
    const digits = m[2] ?? ''
    if (letters === '' && digits === '') return null
    let col: number | null = null
    if (letters !== '') {
      col = columnLetterToIndex(letters)
      if (col === -1) return null
    }
    let row: number | null = null
    if (digits !== '') {
      row = parseInt(digits, 10) - 1
      if (row < 0) return null
    }
    return { row, col }
  }

  const clampRow = (r: number): number => Math.max(0, Math.min(maxRow, r))
  const clampCol = (c: number): number => Math.max(0, Math.min(maxCol, c))

  if (parts.length === 1) {
    const cell = parseToken(parts[0] ?? '')
    if (!cell || cell.row === null || cell.col === null) return null // a bare token must be a full cell like C7
    const r = clampRow(cell.row)
    const c = clampCol(cell.col)
    return { top: r, left: c, bottom: r, right: c }
  }

  const a = parseToken(parts[0] ?? '')
  const b = parseToken(parts[1] ?? '')
  if (!a || !b) return null

  // Whole-column range: B:D (both column-only)
  if (a.row === null && b.row === null && a.col !== null && b.col !== null) {
    const left = clampCol(Math.min(a.col, b.col))
    const right = clampCol(Math.max(a.col, b.col))
    return { top: 0, left, bottom: maxRow, right }
  }
  // Whole-row range: 3:5 (both row-only)
  if (a.col === null && b.col === null && a.row !== null && b.row !== null) {
    const top = clampRow(Math.min(a.row, b.row))
    const bottom = clampRow(Math.max(a.row, b.row))
    return { top, left: 0, bottom, right: maxCol }
  }
  // Full rectangular range: A1:D50 (both full cells)
  if (a.row !== null && a.col !== null && b.row !== null && b.col !== null) {
    return {
      top: clampRow(Math.min(a.row, b.row)),
      left: clampCol(Math.min(a.col, b.col)),
      bottom: clampRow(Math.max(a.row, b.row)),
      right: clampCol(Math.max(a.col, b.col))
    }
  }
  return null // mixed open ends (A:5, C:D7, …) are not valid Excel addresses
}

/**
 * Excel's Ctrl+Arrow "jump to data-block edge" from (row, col) in one
 * direction (dRow/dCol is exactly one of ±1 on a single axis). Rules,
 * matching Excel/Calc/Sheets:
 *   - immediately blocked by the grid edge → stay put.
 *   - on a filled cell whose neighbour is also filled → jump to the last
 *     filled cell of that contiguous run (the block's far edge).
 *   - otherwise (on a blank, or a filled cell whose neighbour is blank) →
 *     skip forward to the next filled cell, or to the grid edge if none.
 * An empty cell counts as null / undefined / ''.
 */
export function findDataEdge(
  rows: CellValue[][],
  row: number,
  col: number,
  dRow: number,
  dCol: number,
  maxRow: number,
  maxCol: number
): { row: number; col: number } {
  const isEmpty = (r: number, c: number): boolean => {
    const v = rows[r]?.[c] ?? null
    return v === null || v === ''
  }
  const inBounds = (r: number, c: number): boolean => r >= 0 && r <= maxRow && c >= 0 && c <= maxCol

  let r = row
  let c = col
  if (!inBounds(r + dRow, c + dCol)) return { row: r, col: c }

  if (!isEmpty(r, c) && !isEmpty(r + dRow, c + dCol)) {
    // Inside a block, next cell filled → walk to the block's far edge.
    while (inBounds(r + dRow, c + dCol) && !isEmpty(r + dRow, c + dCol)) {
      r += dRow
      c += dCol
    }
    return { row: r, col: c }
  }

  // On a blank, or a filled cell followed by a blank → skip to the next
  // filled cell (or the grid edge if the rest is empty).
  r += dRow
  c += dCol
  while (inBounds(r + dRow, c + dCol) && isEmpty(r, c)) {
    r += dRow
    c += dCol
  }
  return { row: r, col: c }
}

/**
 * Generates a `VARn` name not already used by `existing`. The backend rejects
 * duplicate variable names, so each inserted column needs a fresh one.
 */
export function makeUniqueVarName(existing: Set<string>): string {
  const lowerExisting = new Set(Array.from(existing).map(x => x.toLowerCase()))
  let n = 1
  let name = `var${String(n)}`
  while (lowerExisting.has(name.toLowerCase())) {
    n++
    name = `var${String(n)}`
  }
  return name
}

// ─────────────────────────────────────────────────────────────
//  Structural fingerprint
// ─────────────────────────────────────────────────────────────

/**
 * A fingerprint of everything that changes the sheet's row/column *structure*
 * (column identity, type, decimals, width, alignment, format). When it is
 * unchanged across a refresh, the grid can take the cheap in-place `setValues`
 * path instead of disposing and rebuilding the whole grid instance.
 *
 * This must be computed identically everywhere it is used — extracting it here
 * removes the five hand-copied `.map(...).join('::')` sites it replaced.
 */
export function buildStructuralKey(
  variables: Pick<Variable, 'colId' | 'type' | 'decimals' | 'columns' | 'align' | 'numfmtPattern'>[]
): string {
  return variables
    .map(v => [v.colId, v.type, v.decimals, v.columns, v.align, v.numfmtPattern ?? ''].join('|'))
    .join('::')
}

// ─────────────────────────────────────────────────────────────
//  Visible → DB row mapping
// ─────────────────────────────────────────────────────────────

/**
 * Maps a visible (on-screen) row index back to its DuckDB `__row_idx`.
 * Filtering/sorting/manual reorder permute the visible order, so a cell edit at
 * visible row R must be persisted to `mapping[R]`. Falls back to identity when
 * no mapping exists (un-filtered, un-sorted view).
 */
export function toDbRow(visibleRow: number, mapping: readonly number[]): number {
  return mapping[visibleRow] ?? visibleRow
}

// ─────────────────────────────────────────────────────────────
//  In-memory column filter (matchFilter + types now live in @shared/data-filter)
// ─────────────────────────────────────────────────────────────

export interface FilteredResult {
  filteredRows: CellValue[][]
  /** visibleToOriginalIndex[i] = DB row index of visible row i */
  visibleToOriginalIndex: number[]
}

/**
 * Applies all active column filters over a base row-order permutation.
 * Walking `baseIndices` (rather than `rows` directly) preserves any manual
 * row reordering the user has applied.
 */
export function applyColumnFilters(
  rows: CellValue[][],
  baseIndices: number[],
  variables: Pick<Variable, 'colId'>[],
  columnFilters: Record<string, ColumnFilter>
): FilteredResult {
  const activeFilters = Object.entries(columnFilters)
  if (activeFilters.length === 0) {
    return {
      filteredRows: baseIndices.map(i => rows[i] ?? []),
      visibleToOriginalIndex: [...baseIndices]
    }
  }

  const filteredRows: CellValue[][] = []
  const visibleToOriginalIndex: number[] = []
  baseIndices.forEach(dbIdx => {
    const row = rows[dbIdx] ?? []
    const matchesAll = activeFilters.every(([colId, filter]) => {
      const colIdx = variables.findIndex(v => v.colId === colId)
      if (colIdx === -1) return true
      return matchFilter(row[colIdx] ?? null, filter.operator, filter.value)
    })
    if (matchesAll) {
      filteredRows.push(row)
      visibleToOriginalIndex.push(dbIdx)
    }
  })
  return { filteredRows, visibleToOriginalIndex }
}

// ─────────────────────────────────────────────────────────────
//  In-memory sort
// ─────────────────────────────────────────────────────────────

export interface ColumnSort {
  colId: string
  direction: 'asc' | 'desc'
}

export interface SortedResult {
  sortedRows: CellValue[][]
  sortedMapping: number[]
}

/**
 * Stable-ish in-memory sort of already-filtered rows by one column. Numeric
 * values compare numerically; everything else uses a locale-aware natural
 * compare. Nulls always sort to the end (direction-adjusted to stay last).
 */
export function applySortInMemory(
  filteredRows: CellValue[][],
  visibleToOriginalIndex: number[],
  variables: Pick<Variable, 'colId'>[],
  columnSort: ColumnSort | null | undefined
): SortedResult {
  if (!columnSort?.colId) {
    return { sortedRows: filteredRows, sortedMapping: visibleToOriginalIndex }
  }

  const sortColIdx = variables.findIndex(v => v.colId === columnSort.colId)
  if (sortColIdx === -1) {
    return { sortedRows: filteredRows, sortedMapping: visibleToOriginalIndex }
  }

  const zipped = filteredRows.map((row, idx) => ({
    row,
    originalIdx: visibleToOriginalIndex[idx] ?? idx
  }))

  const dirMultiplier = columnSort.direction === 'asc' ? 1 : -1
  // Blank = null/undefined or an empty/whitespace-only string. Blanks sort
  // LAST in both directions — the same NULLS LAST the DuckDB sort
  // (data:sort) uses — and never through Number(), which reads "" as 0.
  const isBlank = (v: CellValue | undefined): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
  zipped.sort((a, b) => {
    const valA = a.row[sortColIdx]
    const valB = b.row[sortColIdx]

    const blankA = isBlank(valA)
    const blankB = isBlank(valB)
    if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1

    const nA = Number(valA)
    const nB = Number(valB)
    if (!isNaN(nA) && !isNaN(nB)) {
      return (nA - nB) * dirMultiplier
    }

    return (
      String(valA).localeCompare(String(valB), undefined, {
        numeric: true,
        sensitivity: 'base'
      }) * dirMultiplier
    )
  })

  return {
    sortedRows: zipped.map(item => item.row),
    sortedMapping: zipped.map(item => item.originalIdx)
  }
}

// ─────────────────────────────────────────────────────────────
//  Row-drag reorder preview (DataView's hand-rolled row drag, P1.2 follow-
//  up — spreadsheet-ozellikleri-envanteri.md §4 2026-07-21)
// ─────────────────────────────────────────────────────────────

/**
 * Computes the row order for a drag-to-reorder in progress: `selectedRows`
 * (the rows being carried, DB/original indices, sorted ascending — frozen
 * at drag-start) move together as one contiguous block to sit just before
 * `overRow`'s position among the *unselected* rows, preserving their own
 * relative order. Also returns `insertAt`, the position (in the returned
 * order) where that block now sits — the caller uses this to know which
 * on-screen rows are "the dragged block" for dimming, since live-previewing
 * the reorder (rather than only showing a static drop-line) means their
 * on-screen row index changes on every hover, unlike the pre-drag indices
 * in `selectedRows`.
 *
 * Used BOTH for the live per-hover preview (DataView.tsx calls this on
 * every `onCellMouseOver` during a drag and feeds the result straight into
 * `rowData`, matching how AG Grid's own native `rowDragManaged` reflows the
 * grid live instead of only reordering on drop) and for the actual commit
 * on mouseup (same computation, called one last time with the final
 * `overRow`, then persisted via `data.reorderRows`).
 *
 * `overRow` landing inside the dragged block itself (hovering back over
 * where the selection started) reconstructs the original identity order —
 * dropping there is correctly a no-op.
 */
export function computeRowDragPreviewOrder(
  total: number,
  selectedRows: readonly number[],
  overRow: number
): { order: number[]; insertAt: number } {
  const selectedSet = new Set(selectedRows)
  const order = Array.from({ length: total }, (_, i) => i)
  const moved = selectedRows.filter(i => i >= 0 && i < total)
  const remaining = order.filter(i => !selectedSet.has(i))

  let insertAt = 0
  for (let i = 0; i < overRow; i++) {
    if (!selectedSet.has(i)) insertAt++
  }
  remaining.splice(insertAt, 0, ...moved)
  return { order: remaining, insertAt }
}
