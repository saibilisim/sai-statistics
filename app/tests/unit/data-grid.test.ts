// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import {
  getColumnLetter,
  makeUniqueVarName,
  buildStructuralKey,
  toDbRow,
  matchFilter,
  applyColumnFilters,
  applySortInMemory,
  computeRowDragPreviewOrder,
  columnLetterToIndex,
  parseNameBoxAddress,
  findDataEdge
} from '../../src/lib/data-grid'
import { prepareCellEdit } from '../../src/lib/aggrid-data'
import type { CellValue, Variable } from '../../shared/data-types'

describe('getColumnLetter', () => {
  it('maps indices to spreadsheet letters', () => {
    expect(getColumnLetter(0)).toBe('A')
    expect(getColumnLetter(25)).toBe('Z')
    expect(getColumnLetter(26)).toBe('AA')
    expect(getColumnLetter(27)).toBe('AB')
  })
})

describe('makeUniqueVarName', () => {
  it('avoids collisions with existing names', () => {
    expect(makeUniqueVarName(new Set())).toBe('var1')
    expect(makeUniqueVarName(new Set(['var1']))).toBe('var2')
    expect(makeUniqueVarName(new Set(['var1', 'var2', 'var3']))).toBe('var4')
  })
})

describe('buildStructuralKey', () => {
  const base = {
    colId: 'col_1',
    type: 'numeric' as const,
    decimals: 2,
    columns: 8,
    align: 'right' as const,
    numfmtPattern: '0.00'
  }
  it('is stable for identical structure', () => {
    expect(buildStructuralKey([base])).toBe(buildStructuralKey([{ ...base }]))
  })
  it('changes when a structural field changes', () => {
    expect(buildStructuralKey([base])).not.toBe(buildStructuralKey([{ ...base, decimals: 3 }]))
  })
  it('tolerates missing optional fields', () => {
    const { numfmtPattern: _n, ...partial } = base
    expect(typeof buildStructuralKey([partial])).toBe('string')
  })
})

describe('toDbRow', () => {
  it('maps via the permutation when present', () => {
    expect(toDbRow(0, [3, 1, 2])).toBe(3)
    expect(toDbRow(2, [3, 1, 2])).toBe(2)
  })
  it('falls back to identity for out-of-range / empty mapping', () => {
    expect(toDbRow(5, [3, 1, 2])).toBe(5)
    expect(toDbRow(4, [])).toBe(4)
  })
})

describe('matchFilter', () => {
  it('handles empty / not-empty', () => {
    expect(matchFilter(null, 'is_empty', '')).toBe(true)
    expect(matchFilter('  ', 'is_empty', '')).toBe(true)
    expect(matchFilter('x', 'is_empty', '')).toBe(false)
    expect(matchFilter('x', 'is_not_empty', '')).toBe(true)
  })
  it('null never matches value operators', () => {
    expect(matchFilter(null, 'equals', '1')).toBe(false)
  })
  it('string operators are case-insensitive', () => {
    expect(matchFilter('Hello', 'contains', 'ell')).toBe(true)
    expect(matchFilter('Hello', 'starts_with', 'he')).toBe(true)
    expect(matchFilter('Hello', 'ends_with', 'LO')).toBe(true)
    expect(matchFilter('Hello', 'equals', 'hello')).toBe(true)
  })
  it('numeric comparisons compare numbers', () => {
    expect(matchFilter(10, 'greater_than', '5')).toBe(true)
    expect(matchFilter(10, 'less_than', '5')).toBe(false)
    expect(matchFilter(5, 'greater_than_or_equal', '5')).toBe(true)
    expect(matchFilter(5, 'less_than_or_equal', '5')).toBe(true)
  })
  it('in operator parses a JSON list', () => {
    expect(matchFilter('2', 'in', '["1","2","3"]')).toBe(true)
    expect(matchFilter('9', 'in', '["1","2","3"]')).toBe(false)
    expect(matchFilter('9', 'in', 'not-json')).toBe(false)
  })
})

describe('applyColumnFilters', () => {
  const rows: CellValue[][] = [
    [1, 'a'],
    [2, 'b'],
    [3, 'a']
  ]
  const vars = [{ colId: 'col_1' }, { colId: 'col_2' }]

  it('returns the base order untouched with no filters', () => {
    const r = applyColumnFilters(rows, [0, 1, 2], vars, {})
    expect(r.filteredRows).toEqual(rows)
    expect(r.visibleToOriginalIndex).toEqual([0, 1, 2])
  })
  it('filters and tracks original indices', () => {
    const r = applyColumnFilters(rows, [0, 1, 2], vars, {
      col_2: { operator: 'equals', value: 'a' }
    })
    expect(r.filteredRows).toEqual([
      [1, 'a'],
      [3, 'a']
    ])
    expect(r.visibleToOriginalIndex).toEqual([0, 2])
  })
  it('honors a non-identity base permutation', () => {
    const r = applyColumnFilters(rows, [2, 1, 0], vars, {})
    expect(r.visibleToOriginalIndex).toEqual([2, 1, 0])
  })
})

describe('applySortInMemory', () => {
  const vars = [{ colId: 'col_1' }]
  const rows: CellValue[][] = [[3], [1], [2]]
  const mapping = [0, 1, 2]

  it('no-ops without a sort', () => {
    const r = applySortInMemory(rows, mapping, vars, null)
    expect(r.sortedRows).toBe(rows)
  })
  it('sorts ascending and keeps the mapping aligned', () => {
    const r = applySortInMemory(rows, mapping, vars, { colId: 'col_1', direction: 'asc' })
    expect(r.sortedRows).toEqual([[1], [2], [3]])
    expect(r.sortedMapping).toEqual([1, 2, 0])
  })
  it('sorts descending', () => {
    const r = applySortInMemory(rows, mapping, vars, { colId: 'col_1', direction: 'desc' })
    expect(r.sortedRows).toEqual([[3], [2], [1]])
  })
  it('pushes nulls to the end', () => {
    const withNull: CellValue[][] = [[2], [null], [1]]
    const r = applySortInMemory(withNull, [0, 1, 2], vars, {
      colId: 'col_1',
      direction: 'asc'
    })
    expect(r.sortedRows[r.sortedRows.length - 1]).toEqual([null])
  })
  it('keeps blanks last when descending too (DuckDB NULLS LAST)', () => {
    const withBlanks: CellValue[][] = [[2], [null], [-1], [''], [1], [null]]
    const r = applySortInMemory(withBlanks, [0, 1, 2, 3, 4, 5], vars, {
      colId: 'col_1',
      direction: 'desc'
    })
    expect(r.sortedRows.slice(0, 3)).toEqual([[2], [1], [-1]])
    expect(r.sortedRows.slice(3).every(([v]) => v === null || v === '')).toBe(true)
  })
  it('does not read an empty string as 0', () => {
    const r = applySortInMemory([[1], [' '], [-1]], [0, 1, 2], vars, {
      colId: 'col_1',
      direction: 'asc'
    })
    expect(r.sortedRows).toEqual([[-1], [1], [' ']])
  })
})

describe('computeRowDragPreviewOrder', () => {
  it('moves a single row down, shifting the rows in between up', () => {
    // 5 rows [0,1,2,3,4], drag row 0 to hover over row 3 — lands just
    // before row 3 (insertAt counts unselected rows strictly before the
    // hovered index, so hovering row 3 inserts before it, not after).
    const { order, insertAt } = computeRowDragPreviewOrder(5, [0], 3)
    expect(order).toEqual([1, 2, 0, 3, 4])
    expect(insertAt).toBe(2)
  })

  it('moves a single row up, shifting the rows in between down', () => {
    const { order, insertAt } = computeRowDragPreviewOrder(5, [4], 1)
    expect(order).toEqual([0, 4, 1, 2, 3])
    expect(insertAt).toBe(1)
  })

  it('carries a multi-row (non-contiguous) selection together, preserving relative order', () => {
    // Drag rows 0 and 2 (Ctrl-selected) to hover over row 4.
    const { order, insertAt } = computeRowDragPreviewOrder(5, [0, 2], 4)
    expect(order).toEqual([1, 3, 0, 2, 4])
    expect(insertAt).toBe(2)
  })

  it('hovering back over the dragged block reconstructs the original identity order (no-op drop)', () => {
    const total = 6
    const identity = Array.from({ length: total }, (_, i) => i)
    for (const overRow of [1, 2]) {
      const { order } = computeRowDragPreviewOrder(total, [1, 2], overRow)
      expect(order).toEqual(identity)
    }
  })

  it('dropping in place (single row, own position) is a no-op', () => {
    const { order } = computeRowDragPreviewOrder(4, [2], 2)
    expect(order).toEqual([0, 1, 2, 3])
  })
})

describe('columnLetterToIndex', () => {
  it('inverts getColumnLetter', () => {
    expect(columnLetterToIndex('A')).toBe(0)
    expect(columnLetterToIndex('Z')).toBe(25)
    expect(columnLetterToIndex('AA')).toBe(26)
    expect(columnLetterToIndex('AB')).toBe(27)
  })
  it('is case-insensitive and trims', () => {
    expect(columnLetterToIndex(' aa ')).toBe(26)
  })
  it('rejects non-letters', () => {
    expect(columnLetterToIndex('A1')).toBe(-1)
    expect(columnLetterToIndex('')).toBe(-1)
    expect(columnLetterToIndex('3')).toBe(-1)
  })
})

describe('parseNameBoxAddress', () => {
  const maxRow = 99
  const maxCol = 9 // 10 columns A..J

  it('parses a single cell', () => {
    expect(parseNameBoxAddress('C7', maxRow, maxCol)).toEqual({
      top: 6,
      left: 2,
      bottom: 6,
      right: 2
    })
  })
  it('parses a rectangular range and normalizes direction', () => {
    expect(parseNameBoxAddress('A1:D50', maxRow, maxCol)).toEqual({
      top: 0,
      left: 0,
      bottom: 49,
      right: 3
    })
    expect(parseNameBoxAddress('D50:A1', maxRow, maxCol)).toEqual({
      top: 0,
      left: 0,
      bottom: 49,
      right: 3
    })
  })
  it('parses whole-column ranges', () => {
    expect(parseNameBoxAddress('B:B', maxRow, maxCol)).toEqual({
      top: 0,
      left: 1,
      bottom: maxRow,
      right: 1
    })
    expect(parseNameBoxAddress('B:D', maxRow, maxCol)).toEqual({
      top: 0,
      left: 1,
      bottom: maxRow,
      right: 3
    })
  })
  it('parses whole-row ranges', () => {
    expect(parseNameBoxAddress('3:5', maxRow, maxCol)).toEqual({
      top: 2,
      left: 0,
      bottom: 4,
      right: maxCol
    })
  })
  it('clamps out-of-range addresses to grid bounds', () => {
    expect(parseNameBoxAddress('Z500', maxRow, maxCol)).toEqual({
      top: maxRow,
      left: maxCol,
      bottom: maxRow,
      right: maxCol
    })
  })
  it('rejects garbage and mixed open ends', () => {
    expect(parseNameBoxAddress('', maxRow, maxCol)).toBeNull()
    expect(parseNameBoxAddress('C', maxRow, maxCol)).toBeNull() // bare column, no row
    expect(parseNameBoxAddress('7', maxRow, maxCol)).toBeNull() // bare row, no col
    expect(parseNameBoxAddress('A:5', maxRow, maxCol)).toBeNull() // mixed open ends
    expect(parseNameBoxAddress('A1:B2:C3', maxRow, maxCol)).toBeNull()
    expect(parseNameBoxAddress('!!', maxRow, maxCol)).toBeNull()
  })
})

describe('findDataEdge', () => {
  // Column 0 filled rows 0..3, gap at 4, filled 5..6, rest empty (maxRow 9).
  const rows: CellValue[][] = [
    ['a'],
    ['b'],
    ['c'],
    ['d'],
    [null],
    ['e'],
    ['f'],
    [null],
    [null],
    [null]
  ]
  const maxRow = 9
  const maxCol = 0

  it('walks to the far edge of a contiguous block (down)', () => {
    expect(findDataEdge(rows, 0, 0, 1, 0, maxRow, maxCol)).toEqual({ row: 3, col: 0 })
  })
  it('from a block edge over a gap, skips to the next filled cell', () => {
    expect(findDataEdge(rows, 3, 0, 1, 0, maxRow, maxCol)).toEqual({ row: 5, col: 0 })
  })
  it('from the last filled block, jumps to the grid edge when the rest is empty', () => {
    expect(findDataEdge(rows, 6, 0, 1, 0, maxRow, maxCol)).toEqual({ row: 9, col: 0 })
  })
  it('does nothing at the grid edge', () => {
    expect(findDataEdge(rows, 9, 0, 1, 0, maxRow, maxCol)).toEqual({ row: 9, col: 0 })
    expect(findDataEdge(rows, 0, 0, -1, 0, maxRow, maxCol)).toEqual({ row: 0, col: 0 })
  })
  it('walks up to the top of a block', () => {
    expect(findDataEdge(rows, 3, 0, -1, 0, maxRow, maxCol)).toEqual({ row: 0, col: 0 })
  })
})

describe('prepareCellEdit — numeric width (denetim raporu §4.5)', () => {
  const numVar: Variable = {
    colId: 'col_1',
    name: 'x',
    type: 'numeric',
    width: 8,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'both'
  }

  it('shortens a too-long number by dropping decimals, not by cutting the string', () => {
    const r = prepareCellEdit('3.14159265358979', numVar, false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.truncated).toBe(true)
    expect(r.value).toBe(3.141593) // 8 chars, magnitude intact
  })

  it('keeps the exact value when no rounding fits (magnitude must not change)', () => {
    // 1.23456789e+30 renders exponentially; slicing it to 8 chars used to
    // produce 1.234567 — off by 30 orders of magnitude.
    const r = prepareCellEdit('1.23456789e+30', numVar, false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe(1.23456789e30)
  })

  it('leaves a number that already fits alone', () => {
    const r = prepareCellEdit('12.5', numVar, false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe(12.5)
    expect(r.truncated).toBe(false)
  })

  it('still truncates strings by slicing', () => {
    const strVar: Variable = { ...numVar, type: 'string', width: 4 }
    const r = prepareCellEdit('abcdefgh', strVar, false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe('abcd')
    expect(r.truncated).toBe(true)
  })
})
