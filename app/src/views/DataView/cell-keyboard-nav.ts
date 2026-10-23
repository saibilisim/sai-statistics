// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * cell-keyboard-nav.ts — pure keyboard-navigation geometry for DataView's
 * range selection, extracted from use-cell-selection.ts's onCellKeyDown:
 * Ctrl+. corner cycling, Tab/Enter movement WITHIN a multi-cell range, and
 * Shift+Arrow focus extension. Framework-free (no React / AG Grid), so it's
 * unit-testable like cell-selection.ts.
 */
import type { RangeRect } from './cell-selection-types'

/** Ctrl+. — the next corner of the range in cycle order (top-left →
 *  top-right → bottom-right → bottom-left, wrapping). `current` is the
 *  focused cell, or null when nothing/the row-number column is focused. */
export function nextRangeCorner(
  rect: RangeRect,
  current: { row: number; col: number } | null
): [number, number] {
  const { top, bottom, left, right } = rect
  const corners: [number, number][] = [
    [top, left],
    [top, right],
    [bottom, right],
    [bottom, left]
  ]
  const cur = current ? corners.findIndex(([r, c]) => r === current.row && c === current.col) : -1
  return corners[(cur + 1) % corners.length] ?? [top, left]
}

/** Tab/Enter movement WITHIN a multi-cell range (B1): the active cell walks
 *  the selection without collapsing it — Tab goes row-major (advance across,
 *  wrap to the next row), Enter column-major (advance down, wrap to the
 *  next column); Shift reverses. Returns the next absolute (row, col), or
 *  null for a single-cell range (the caller falls through to the grid's
 *  native nav there). A `current` outside the range restarts at its
 *  top-left. */
export function nextCellInRange(
  rect: RangeRect,
  current: { row: number; col: number } | null,
  key: 'Tab' | 'Enter',
  back: boolean
): { row: number; col: number } | null {
  const { top, bottom, left, right } = rect
  const w = right - left + 1
  const h = bottom - top + 1
  if (w * h <= 1) return null
  let rIdx = current ? current.row - top : 0
  let cIdx = current ? current.col - left : 0
  if (rIdx < 0 || rIdx >= h || cIdx < 0 || cIdx >= w) {
    rIdx = 0
    cIdx = 0
  }
  const size = w * h
  if (key === 'Tab') {
    // Row-major: advance across, wrap to the next row.
    const lin = (((rIdx * w + cIdx + (back ? -1 : 1)) % size) + size) % size
    rIdx = Math.floor(lin / w)
    cIdx = lin % w
  } else {
    // Enter: column-major — advance down, wrap to the next column.
    const lin = (((cIdx * h + rIdx + (back ? -1 : 1)) % size) + size) % size
    cIdx = Math.floor(lin / h)
    rIdx = lin % h
  }
  return { row: top + rIdx, col: left + cIdx }
}

/** Shift+Arrow — the active range's focus extended by one cell in the
 *  arrow's direction, clamped to the grid. Returns null for a non-arrow
 *  key (the caller leaves the range untouched). */
export function extendFocusByArrow(
  focusRow: number,
  focusCol: number,
  key: string,
  maxRow: number,
  maxCol: number
): { focusRow: number; focusCol: number } | null {
  if (key === 'ArrowDown') return { focusRow: Math.min(maxRow, focusRow + 1), focusCol }
  if (key === 'ArrowUp') return { focusRow: Math.max(0, focusRow - 1), focusCol }
  if (key === 'ArrowRight') return { focusRow, focusCol: Math.min(maxCol, focusCol + 1) }
  if (key === 'ArrowLeft') return { focusRow, focusCol: Math.max(0, focusCol - 1) }
  return null
}
