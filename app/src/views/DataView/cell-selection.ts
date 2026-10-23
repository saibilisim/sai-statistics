// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * cell-selection.ts — pure range-selection logic for DataView's AG Grid
 * Community instance (aggrid-gecis-roadmap.md G4 / T5).
 *
 * AG Grid Community has NO multi-cell range selection at all — that's
 * `CellSelectionModule`, Enterprise-only (confirmed against v35 docs before
 * this was written). Everything here — the range model, hit-testing, TSV
 * serialization — is our own, built against Community's public cell/row/
 * column APIs only. Kept framework-light (no React) so it's unit-testable
 * like data-grid.ts.
 */
import type { CellValue, Variable } from '@shared/data-types'
import { formatCellDisplay } from '../../lib/aggrid-data'

/** A single rectangular block of (visible) rows × (data, not row-number)
 *  column indices. Both ends inclusive; start may be > end (normalized by
 *  the getters below) since a drag can go in any direction. */
export interface CellRange {
  anchorRow: number
  anchorCol: number
  focusRow: number
  focusCol: number
}

export function normalizeRange(r: CellRange): {
  top: number
  bottom: number
  left: number
  right: number
} {
  return {
    top: Math.min(r.anchorRow, r.focusRow),
    bottom: Math.max(r.anchorRow, r.focusRow),
    left: Math.min(r.anchorCol, r.focusCol),
    right: Math.max(r.anchorCol, r.focusCol)
  }
}

export function rangeContains(r: CellRange, row: number, col: number): boolean {
  const { top, bottom, left, right } = normalizeRange(r)
  return row >= top && row <= bottom && col >= left && col <= right
}

/** True if (row, col) falls inside any of the given ranges (multi-range,
 *  Ctrl+drag support — T5). */
export function anyRangeContains(ranges: CellRange[], row: number, col: number): boolean {
  return ranges.some(r => rangeContains(r, row, col))
}

/**
 * Removes a target rectangle from every range in `ranges`, splitting any
 * range that only partially overlaps it into up to 4 remaining rectangles
 * (top/bottom/left/right strips around the removed area) instead of just
 * dropping exact-bounds matches. Used by Ctrl/Cmd+click's toggle-off
 * (Excel/Sheets convention: Ctrl+clicking an already-selected cell/row/
 * column removes just that one — regardless of whether it got selected as
 * its own single range, as part of a Shift-extended block, or any other
 * combination; the earlier exact-bounds-only version silently failed to
 * deselect anything that wasn't its own standalone range).
 */
export function subtractFromRanges(
  ranges: CellRange[],
  target: { top: number; bottom: number; left: number; right: number }
): CellRange[] {
  const result: CellRange[] = []
  for (const r of ranges) {
    const n = normalizeRange(r)
    const iTop = Math.max(n.top, target.top)
    const iBottom = Math.min(n.bottom, target.bottom)
    const iLeft = Math.max(n.left, target.left)
    const iRight = Math.min(n.right, target.right)
    if (iTop > iBottom || iLeft > iRight) {
      result.push(r) // no overlap — keep unchanged
      continue
    }
    if (n.top < iTop) {
      result.push({ anchorRow: n.top, anchorCol: n.left, focusRow: iTop - 1, focusCol: n.right })
    }
    if (n.bottom > iBottom) {
      result.push({
        anchorRow: iBottom + 1,
        anchorCol: n.left,
        focusRow: n.bottom,
        focusCol: n.right
      })
    }
    if (n.left < iLeft) {
      result.push({ anchorRow: iTop, anchorCol: n.left, focusRow: iBottom, focusCol: iLeft - 1 })
    }
    if (n.right > iRight) {
      result.push({ anchorRow: iTop, anchorCol: iRight + 1, focusRow: iBottom, focusCol: n.right })
    }
    // Fully contained (iTop===n.top && iBottom===n.bottom && iLeft===n.left && iRight===n.right):
    // no strips pushed — the range is entirely removed.
  }
  return result
}

/** All distinct (visRow, col) cells covered by a set of ranges (dedupes
 *  overlaps between discontiguous Ctrl-added ranges). */
export function cellsFromRanges(ranges: CellRange[]): { visRow: number; col: number }[] {
  const out: { visRow: number; col: number }[] = []
  const seen = new Set<string>()
  for (const r of ranges) {
    const { top, bottom, left, right } = normalizeRange(r)
    for (let row = top; row <= bottom; row++) {
      for (let c = left; c <= right; c++) {
        const key = `${String(row)}:${String(c)}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ visRow: row, col: c })
        }
      }
    }
  }
  return out
}

/** Number of distinct cells covered by a set of ranges — same result as
 *  `cellsFromRanges(ranges).length`, but without enumerating cells (a whole-
 *  column selection on a 500k-row dataset must not allocate 500k keys just
 *  to update a status-bar counter). Sweeps the row bands between range
 *  edges and merges the column intervals active in each band. */
export function countCellsInRanges(ranges: CellRange[]): number {
  const rects = ranges.map(normalizeRange)
  const [only] = rects
  if (rects.length === 1 && only) {
    return (only.bottom - only.top + 1) * (only.right - only.left + 1)
  }
  const edges = [...new Set(rects.flatMap(r => [r.top, r.bottom + 1]))].sort((a, b) => a - b)
  let total = 0
  for (let i = 0; i < edges.length - 1; i++) {
    const bandTop = edges[i] ?? 0
    const bandHeight = (edges[i + 1] ?? bandTop) - bandTop
    const cols = rects
      .filter(r => r.top <= bandTop && r.bottom >= bandTop)
      .map(r => [r.left, r.right] as const)
      .sort((a, b) => a[0] - b[0])
    let width = 0
    let curL = -1
    let curR = -2
    for (const [l, r] of cols) {
      if (l > curR + 1) {
        width += curR - curL + 1
        curL = l
        curR = r
      } else if (r > curR) {
        curR = r
      }
    }
    width += curR - curL + 1
    total += width * bandHeight
  }
  return total
}

/**
 * Builds Excel/Sheets-compatible TSV text for a range, reading values from
 * the row-array data directly (not from the DOM) so a copy is correct even
 * for parts of a huge grid that were never scrolled into view — the exact
 * gap flagged during the previous grid's architecture discussion (a native
 * clipboard command reading only *painted* cells silently dropped
 * off-screen rows; here there is no "painted" concept to be incomplete —
 * `rows` is the same rowsRef/allRowsRef array the grid itself reads from).
 */
export function buildClipboardText(
  range: CellRange,
  rows: CellValue[][],
  variables: Variable[],
  showValueLabels: boolean
): string {
  const { top, bottom, left, right } = normalizeRange(range)
  const lines: string[] = []
  for (let r = top; r <= bottom; r++) {
    const row = rows[r]
    const cells: string[] = []
    for (let c = left; c <= right; c++) {
      const variable = variables[c]
      if (!variable) {
        cells.push('')
        continue
      }
      const raw = row?.[c] ?? null
      cells.push(formatCellDisplay(raw, variable, showValueLabels))
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/**
 * Builds clipboard text for the WHOLE current selection, which may be more
 * than one disjoint range (Ctrl/Cmd+click adds a new range per click,
 * unlike Shift+click which extends a single range's focus — see startRange/
 * selectRow). Copying used to read only the last-drawn range, so a Shift-
 * multi-row selection (one big range) copied fine but a Ctrl-multi-row
 * selection (several one-row ranges) silently copied just the last row.
 *
 * Two shapes get first-class merged support, matching how users actually
 * build Ctrl-selections in this grid (row-header or column-header clicks):
 *   - every range spans the full column width → union of selected rows,
 *     each emitted as a full row, in row order (Excel-compatible paste-back).
 *   - every range spans the full row height → union of selected columns,
 *     emitted column-by-column, in column order.
 * Anything else (irregular multi-rectangle cell selections) has no single
 * "correct" merged rectangle — Excel itself refuses to copy non-uniform
 * multi-selections — so it falls back to the most-recently-drawn range,
 * the previous behaviour.
 */
export function buildClipboardTextForSelection(
  ranges: CellRange[],
  rows: CellValue[][],
  variables: Variable[],
  showValueLabels: boolean
): string {
  if (ranges.length === 0) return ''
  const last = ranges[ranges.length - 1]
  if (ranges.length === 1)
    return last ? buildClipboardText(last, rows, variables, showValueLabels) : ''

  const lastCol = variables.length - 1
  const allFullWidth = ranges.every(r => {
    const n = normalizeRange(r)
    return n.left === 0 && n.right === lastCol
  })
  if (allFullWidth) {
    const rowSet = new Set<number>()
    for (const r of ranges) {
      const n = normalizeRange(r)
      for (let row = n.top; row <= n.bottom; row++) rowSet.add(row)
    }
    const sortedRows = [...rowSet].sort((a, b) => a - b)
    return sortedRows
      .map(row =>
        buildClipboardText(
          { anchorRow: row, anchorCol: 0, focusRow: row, focusCol: lastCol },
          rows,
          variables,
          showValueLabels
        )
      )
      .join('\n')
  }

  const lastRow = rows.length - 1
  const allFullHeight = ranges.every(r => {
    const n = normalizeRange(r)
    return n.top === 0 && n.bottom === lastRow
  })
  if (allFullHeight) {
    const colSet = new Set<number>()
    for (const r of ranges) {
      const n = normalizeRange(r)
      for (let col = n.left; col <= n.right; col++) colSet.add(col)
    }
    const sortedCols = [...colSet].sort((a, b) => a - b)
    const lines: string[] = []
    for (let row = 0; row <= lastRow; row++) {
      const cells = sortedCols.map(col => {
        const variable = variables[col]
        if (!variable) return ''
        const raw = rows[row]?.[col] ?? null
        return formatCellDisplay(raw, variable, showValueLabels)
      })
      lines.push(cells.join('\t'))
    }
    return lines.join('\n')
  }

  return last ? buildClipboardText(last, rows, variables, showValueLabels) : ''
}

/** Transposes a clipboard grid (rows↔columns) — the Paste Special ▸ Transpose
 *  operation (B4). Ragged rows are padded with '' so the result is rectangular. */
export function transposeGrid(grid: string[][]): string[][] {
  const maxCols = grid.reduce((m, r) => Math.max(m, r.length), 0)
  const out: string[][] = []
  for (let c = 0; c < maxCols; c++) {
    const row: string[] = []
    for (let r = 0; r < grid.length; r++) row.push(grid[r]?.[c] ?? '')
    out.push(row)
  }
  return out
}

/** Parses TSV/Excel clipboard text into a 2D string array. Trailing empty
 *  line (many apps append one) is dropped. */
export function parseClipboardText(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.map(line => line.split('\t'))
}

// ─────────────────────────────────────────────────────────────
//  Named series (P1.6, spreadsheet-ozellikleri-envanteri.md §3) — TR+EN
//  weekday/month name recognition, matching LibreOffice Calc's built-in
//  "Day/Weekday/Month" fill-series categories
//  (help.libreoffice.org/latest/en-US/text/scalc/01/02140600.html).
//  Each list is checked full-name and abbreviated, case-insensitively.
// ─────────────────────────────────────────────────────────────
const NAME_SERIES_LISTS: readonly (readonly string[])[] = [
  ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'],
  ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'],
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  [
    'Ocak',
    'Şubat',
    'Mart',
    'Nisan',
    'Mayıs',
    'Haziran',
    'Temmuz',
    'Ağustos',
    'Eylül',
    'Ekim',
    'Kasım',
    'Aralık'
  ],
  ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
]

/** Wraps `n` into `[0, mod)`, handling negative results (`%` in JS keeps the
 *  sign of the dividend). */
function wrapIndex(n: number, mod: number): number {
  return ((n % mod) + mod) % mod
}

/**
 * Recognizes a weekday-name or month-name series (TR or EN, full or
 * abbreviated) and continues it cyclically — e.g. "Pzt, Sal, Çar" → "Per,
 * Cum, Cmt, …", wrapping back to the start after the last name. Returns
 * `undefined` (not `null`) when the source values don't match any known
 * list, so the caller can fall through to the numeric/tile logic below —
 * `null` is reserved for "matched, but the computed value is empty".
 */
function tryNameSeries(
  sourceColumnValues: CellValue[],
  filledRowIndex: number
): CellValue | undefined {
  const raw = sourceColumnValues.map(v => (v === null ? '' : String(v).trim()))
  if (raw.some(s => s.length === 0)) return undefined

  for (const list of NAME_SERIES_LISTS) {
    const indices = raw.map(s => list.findIndex(item => item.toLowerCase() === s.toLowerCase()))
    if (indices.some(i => i === -1)) continue

    const first = indices[0]
    if (first === undefined) continue
    if (indices.length === 1) {
      return list[wrapIndex(first + filledRowIndex + 1, list.length)]
    }

    const second = indices[1]
    if (second === undefined) continue
    const step = wrapIndex(second - first, list.length) || 1
    const isConstantStep = indices.every((idx, i) => {
      if (i === 0) return true
      const prev = indices[i - 1]
      return prev !== undefined && wrapIndex(idx - prev, list.length) === step
    })
    if (!isConstantStep) continue

    const last = indices[indices.length - 1]
    if (last === undefined) continue
    return list[wrapIndex(last + step * (filledRowIndex + 1), list.length)]
  }
  return undefined
}

/**
 * Computes the value for one column's Nth filled-down row (0-based, N=0 is
 * the row directly below the source range) from that column's source
 * values — the fill handle's "smart series" behaviour
 * (aggrid-gecis-roadmap.md T5 + P1.6 in spreadsheet-ozellikleri-
 * envanteri.md, matching LibreOffice Calc/Excel's own fill-series rules):
 *   - single source value → repeated for every filled row (plain copy-down,
 *     the common case: filling a constant down).
 *   - weekday or month name (TR/EN, full or abbreviated) → the calendar
 *     cycle continues, wrapping around (Cuma → Cumartesi → … → Pazartesi).
 *   - ≥2 numeric source values with a constant additive step → the
 *     arithmetic sequence continues (1,2,3 → 4,5,6).
 *   - ≥2 numeric source values with a constant multiplicative ratio (and no
 *     zero in the source) → the geometric/growth sequence continues
 *     (2,4,8 → 16,32 — Excel's "growth trend" fill).
 *   - anything else (mixed types, non-constant step, text) → the source
 *     block tiles/repeats, matching Excel's fallback for non-numeric drags.
 */
export function computeFillValue(
  sourceColumnValues: CellValue[],
  filledRowIndex: number
): CellValue {
  if (sourceColumnValues.length === 0) return null

  // Named series (weekday/month) are recognized even from a single source
  // value — Excel/Calc auto-continue "Monday" → "Tuesday" from one cell,
  // unlike a single plain number/text which just repeats verbatim.
  const named = tryNameSeries(sourceColumnValues, filledRowIndex)
  if (named !== undefined) return named

  if (sourceColumnValues.length === 1) return sourceColumnValues[0] ?? null

  const nums = sourceColumnValues.map(v => (typeof v === 'number' ? v : Number(v)))
  const allNumeric = nums.every(n => !Number.isNaN(n))
  const first = nums[0]
  const second = nums[1]
  const last = nums[nums.length - 1]
  if (allNumeric && first !== undefined && second !== undefined && last !== undefined) {
    const step = second - first
    const isConstantStep = nums.every((n, i) => {
      const prev = nums[i - 1]
      return i === 0 || prev === undefined || Math.abs(n - prev - step) < 1e-9
    })
    if (isConstantStep) {
      return last + step * (filledRowIndex + 1)
    }

    // Geometric/growth series: constant ratio between consecutive values
    // (needs every value non-zero — a zero anywhere makes "ratio" undefined
    // and also makes an additive step of 0 already handled above).
    if (nums.every(n => n !== 0)) {
      const ratio = second / first
      const isConstantRatio = nums.every((n, i) => {
        const prev = nums[i - 1]
        return i === 0 || prev === undefined || Math.abs(n / prev - ratio) < 1e-9
      })
      if (isConstantRatio && Math.abs(ratio - 1) > 1e-9) {
        return last * Math.pow(ratio, filledRowIndex + 1)
      }
    }
  }

  // Fallback: tile the source pattern.
  const value = sourceColumnValues[filledRowIndex % sourceColumnValues.length]
  return value ?? null
}
