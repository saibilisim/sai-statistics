// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import {
  normalizeRange,
  rangeContains,
  anyRangeContains,
  subtractFromRanges,
  buildClipboardText,
  buildClipboardTextForSelection,
  parseClipboardText,
  transposeGrid,
  computeFillValue,
  cellsFromRanges,
  countCellsInRanges,
  type CellRange
} from '../../src/views/DataView/cell-selection'
import type { CellValue, Variable } from '../../shared/data-types'

function makeVar(overrides: Partial<Variable> = {}): Variable {
  return {
    colId: 'col_1',
    name: 'v',
    type: 'numeric',
    width: 8,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'both',
    ...overrides
  }
}

describe('normalizeRange', () => {
  it('handles a drag drawn in any direction', () => {
    const backward: CellRange = { anchorRow: 5, anchorCol: 3, focusRow: 1, focusCol: 0 }
    expect(normalizeRange(backward)).toEqual({ top: 1, bottom: 5, left: 0, right: 3 })
  })

  it('handles a single-cell range', () => {
    const single: CellRange = { anchorRow: 2, anchorCol: 2, focusRow: 2, focusCol: 2 }
    expect(normalizeRange(single)).toEqual({ top: 2, bottom: 2, left: 2, right: 2 })
  })
})

describe('rangeContains / anyRangeContains', () => {
  const range: CellRange = { anchorRow: 1, anchorCol: 1, focusRow: 3, focusCol: 3 }

  it('is true inside the box, false outside', () => {
    expect(rangeContains(range, 2, 2)).toBe(true)
    expect(rangeContains(range, 1, 1)).toBe(true)
    expect(rangeContains(range, 3, 3)).toBe(true)
    expect(rangeContains(range, 0, 2)).toBe(false)
    expect(rangeContains(range, 2, 4)).toBe(false)
  })

  it('anyRangeContains checks multiple disjoint ranges (Ctrl+drag)', () => {
    const ranges: CellRange[] = [
      { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 },
      { anchorRow: 5, anchorCol: 5, focusRow: 6, focusCol: 6 }
    ]
    expect(anyRangeContains(ranges, 0, 0)).toBe(true)
    expect(anyRangeContains(ranges, 6, 5)).toBe(true)
    expect(anyRangeContains(ranges, 3, 3)).toBe(false)
  })
})

describe('subtractFromRanges', () => {
  it('removes a range that exactly matches the target (single cell)', () => {
    const ranges: CellRange[] = [{ anchorRow: 2, anchorCol: 2, focusRow: 2, focusCol: 2 }]
    expect(subtractFromRanges(ranges, { top: 2, bottom: 2, left: 2, right: 2 })).toEqual([])
  })

  it('leaves a non-overlapping range untouched', () => {
    const ranges: CellRange[] = [{ anchorRow: 5, anchorCol: 5, focusRow: 6, focusCol: 6 }]
    expect(subtractFromRanges(ranges, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual(ranges)
  })

  it('splits a whole-row selection when one row is removed from a Shift-extended block', () => {
    // Rows 0..3, full width — removing row 2 must leave rows [0,1] and [3,3],
    // NOT silently no-op (the bug reported: toggle-off failed for anything
    // that wasn't its own standalone exact-match range).
    const ranges: CellRange[] = [{ anchorRow: 0, anchorCol: 0, focusRow: 3, focusCol: 9 }]
    const result = subtractFromRanges(ranges, { top: 2, bottom: 2, left: 0, right: 9 })
    expect(result).toHaveLength(2)
    expect(result.map(normalizeRange)).toEqual(
      expect.arrayContaining([
        { top: 0, bottom: 1, left: 0, right: 9 },
        { top: 3, bottom: 3, left: 0, right: 9 }
      ])
    )
    // The removed row is no longer covered by anything.
    expect(anyRangeContains(result, 2, 4)).toBe(false)
    // The rest of the original block is still intact.
    expect(anyRangeContains(result, 0, 4)).toBe(true)
    expect(anyRangeContains(result, 3, 4)).toBe(true)
  })

  it('splits a rectangle into up to 4 strips when a single interior cell is removed', () => {
    const ranges: CellRange[] = [{ anchorRow: 0, anchorCol: 0, focusRow: 4, focusCol: 4 }]
    const result = subtractFromRanges(ranges, { top: 2, bottom: 2, left: 2, right: 2 })
    expect(anyRangeContains(result, 2, 2)).toBe(false)
    // Every other cell in the original 5x5 block is still covered.
    for (let r = 0; r <= 4; r++) {
      for (let c = 0; c <= 4; c++) {
        if (r === 2 && c === 2) continue
        expect(anyRangeContains(result, r, c)).toBe(true)
      }
    }
  })

  it('removes a range covering multiple targets across several ranges', () => {
    const ranges: CellRange[] = [
      { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 },
      { anchorRow: 5, anchorCol: 5, focusRow: 6, focusCol: 6 }
    ]
    const result = subtractFromRanges(ranges, { top: 0, bottom: 0, left: 0, right: 0 })
    expect(anyRangeContains(result, 0, 0)).toBe(false)
    expect(anyRangeContains(result, 6, 5)).toBe(true)
  })
})

describe('buildClipboardText', () => {
  const variables = [makeVar({ colId: 'col_1', name: 'a' }), makeVar({ colId: 'col_2', name: 'b' })]
  const rows: CellValue[][] = [
    [1, 2],
    [3, 4],
    [5, 6]
  ]

  it('serialises a range to TSV, tab-separated / newline-rowed', () => {
    const range: CellRange = { anchorRow: 0, anchorCol: 0, focusRow: 2, focusCol: 1 }
    const tsv = buildClipboardText(range, rows, variables, false)
    // Data View's decimal separator defaults to comma (editor.decimalSeparator,
    // aggrid-data.ts's currentDataDecimalSeparator) — formatCellDisplay reads
    // that module default when no explicit separator is passed, same as here.
    expect(tsv).toBe('1,00\t2,00\n3,00\t4,00\n5,00\t6,00')
  })

  it('reads from the full rows array regardless of scroll/paint state (no off-screen gap)', () => {
    // Row 2 stands in for a row that was never scrolled into view under the
    // previous grid's architecture — buildClipboardText has no "painted" concept
    // at all, so this is definitionally correct, but assert it explicitly.
    const range: CellRange = { anchorRow: 2, anchorCol: 0, focusRow: 2, focusCol: 0 }
    expect(buildClipboardText(range, rows, variables, false)).toBe('5,00')
  })

  it('respects the value-labels toggle', () => {
    const labelled = [makeVar({ colId: 'col_1', valueLabels: { '1': 'Erkek' } })]
    const range: CellRange = { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 }
    expect(buildClipboardText(range, [[1]], labelled, true)).toBe('Erkek')
    expect(buildClipboardText(range, [[1]], labelled, false)).toBe('1,00')
  })
})

describe('buildClipboardTextForSelection', () => {
  const variables = [makeVar({ colId: 'col_1', name: 'a' }), makeVar({ colId: 'col_2', name: 'b' })]
  const rows: CellValue[][] = [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8]
  ]

  it('a single range behaves exactly like buildClipboardText', () => {
    const ranges: CellRange[] = [{ anchorRow: 0, anchorCol: 0, focusRow: 1, focusCol: 1 }]
    expect(buildClipboardTextForSelection(ranges, rows, variables, false)).toBe(
      buildClipboardText(ranges[0]!, rows, variables, false)
    )
  })

  it('merges several Ctrl-selected full-width row ranges, in row order', () => {
    // Regression: Ctrl+click row 0 then row 2 used to copy only row 2 (the
    // last-drawn range) — the real bug reported by the user.
    const ranges: CellRange[] = [
      { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 1 },
      { anchorRow: 2, anchorCol: 0, focusRow: 2, focusCol: 1 }
    ]
    expect(buildClipboardTextForSelection(ranges, rows, variables, false)).toBe(
      '1,00\t2,00\n5,00\t6,00'
    )
  })

  it('merges out-of-order and overlapping full-width row ranges by row order, deduped', () => {
    const ranges: CellRange[] = [
      { anchorRow: 3, anchorCol: 0, focusRow: 3, focusCol: 1 },
      { anchorRow: 0, anchorCol: 0, focusRow: 1, focusCol: 1 },
      { anchorRow: 1, anchorCol: 0, focusRow: 1, focusCol: 1 } // overlaps the previous range
    ]
    expect(buildClipboardTextForSelection(ranges, rows, variables, false)).toBe(
      '1,00\t2,00\n3,00\t4,00\n7,00\t8,00'
    )
  })

  it('merges several Ctrl-selected full-height column ranges, in column order', () => {
    const threeCol = [
      makeVar({ colId: 'col_1', name: 'a' }),
      makeVar({ colId: 'col_2', name: 'b' }),
      makeVar({ colId: 'col_3', name: 'c' })
    ]
    const threeColRows: CellValue[][] = [
      [1, 2, 3],
      [4, 5, 6]
    ]
    const ranges: CellRange[] = [
      { anchorRow: 0, anchorCol: 2, focusRow: 1, focusCol: 2 },
      { anchorRow: 0, anchorCol: 0, focusRow: 1, focusCol: 0 }
    ]
    expect(buildClipboardTextForSelection(ranges, threeColRows, threeCol, false)).toBe(
      '1,00\t3,00\n4,00\t6,00'
    )
  })

  it('falls back to the most-recent range for an irregular multi-rectangle selection', () => {
    const ranges: CellRange[] = [
      { anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 },
      { anchorRow: 2, anchorCol: 1, focusRow: 3, focusCol: 1 }
    ]
    expect(buildClipboardTextForSelection(ranges, rows, variables, false)).toBe(
      buildClipboardText(ranges[1]!, rows, variables, false)
    )
  })

  it('returns empty string for no selection', () => {
    expect(buildClipboardTextForSelection([], rows, variables, false)).toBe('')
  })
})

describe('parseClipboardText', () => {
  it('splits rows on newline and cells on tab', () => {
    expect(parseClipboardText('1\t2\n3\t4')).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('normalises CRLF and drops a trailing empty line', () => {
    expect(parseClipboardText('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('handles a single cell with no delimiters', () => {
    expect(parseClipboardText('42')).toEqual([['42']])
  })
})

describe('computeFillValue', () => {
  it('repeats a single source value (plain copy-down)', () => {
    expect(computeFillValue([5], 0)).toBe(5)
    expect(computeFillValue([5], 4)).toBe(5)
    expect(computeFillValue(['x'], 2)).toBe('x')
  })

  it('continues an arithmetic sequence for constant-step numeric sources', () => {
    expect(computeFillValue([1, 2, 3], 0)).toBe(4)
    expect(computeFillValue([1, 2, 3], 1)).toBe(5)
    expect(computeFillValue([10, 8, 6], 0)).toBe(4) // negative step
    expect(computeFillValue([0, 5], 2)).toBe(20) // step 5: 10, 15, 20 for indices 0,1,2
  })

  it('tiles (repeats the pattern) for non-constant-step or non-numeric sources', () => {
    expect(computeFillValue([1, 2, 5], 0)).toBe(1) // 1,2,5 has no constant step -> tile
    expect(computeFillValue([1, 2, 5], 1)).toBe(2)
    expect(computeFillValue([1, 2, 5], 2)).toBe(5)
    expect(computeFillValue([1, 2, 5], 3)).toBe(1) // wraps
    expect(computeFillValue(['a', 'b'], 0)).toBe('a')
    expect(computeFillValue(['a', 'b'], 1)).toBe('b')
    expect(computeFillValue(['a', 'b'], 2)).toBe('a')
  })

  it('handles an empty source defensively', () => {
    expect(computeFillValue([], 0)).toBe(null)
  })

  it('continues a geometric/growth sequence for constant-ratio numeric sources', () => {
    expect(computeFillValue([2, 4, 8], 0)).toBe(16)
    expect(computeFillValue([2, 4, 8], 1)).toBe(32)
    expect(computeFillValue([1, 3, 9], 0)).toBe(27) // ratio 3
    expect(computeFillValue([100, 50, 25], 0)).toBe(12.5) // ratio 0.5
  })

  it('does not misdetect a non-constant-ratio numeric source as geometric', () => {
    // 1,2,5 has neither a constant additive step nor a constant ratio -> tile.
    expect(computeFillValue([1, 2, 5], 0)).toBe(1)
  })

  it('recognizes and continues a Turkish weekday series (full names)', () => {
    expect(computeFillValue(['Pazartesi', 'Salı', 'Çarşamba'], 0)).toBe('Perşembe')
    expect(computeFillValue(['Pazartesi', 'Salı', 'Çarşamba'], 1)).toBe('Cuma')
  })

  it('recognizes and continues a Turkish weekday series (abbreviated), wrapping around', () => {
    expect(computeFillValue(['Cum', 'Cmt'], 0)).toBe('Paz')
    expect(computeFillValue(['Cum', 'Cmt'], 1)).toBe('Pzt') // wraps past Sunday
  })

  it('recognizes and continues an English month series', () => {
    expect(computeFillValue(['January', 'February'], 0)).toBe('March')
    expect(computeFillValue(['Nov', 'Dec'], 0)).toBe('Jan') // wraps past December
  })

  it('recognizes a single named value and continues from it', () => {
    expect(computeFillValue(['Pzt'], 0)).toBe('Sal')
    expect(computeFillValue(['Aralık'], 0)).toBe('Ocak') // wraps
  })

  it('is case-insensitive for named series', () => {
    expect(computeFillValue(['monday', 'TUESDAY'], 0)).toBe('Wednesday')
  })

  it('does not treat a plain non-series text source as a named series', () => {
    expect(computeFillValue(['apple', 'banana'], 0)).toBe('apple') // tiles, not named
  })
})

describe('transposeGrid', () => {
  it('swaps rows and columns', () => {
    expect(
      transposeGrid([
        ['a', 'b', 'c'],
        ['d', 'e', 'f']
      ])
    ).toEqual([
      ['a', 'd'],
      ['b', 'e'],
      ['c', 'f']
    ])
  })
  it('pads ragged rows with empty strings', () => {
    expect(transposeGrid([['a', 'b'], ['c']])).toEqual([
      ['a', 'c'],
      ['b', '']
    ])
  })
  it('handles a single row and single column', () => {
    expect(transposeGrid([['x', 'y']])).toEqual([['x'], ['y']])
    expect(transposeGrid([['x'], ['y']])).toEqual([['x', 'y']])
  })
})

describe('countCellsInRanges', () => {
  const r = (
    anchorRow: number,
    anchorCol: number,
    focusRow: number,
    focusCol: number
  ): CellRange => ({
    anchorRow,
    anchorCol,
    focusRow,
    focusCol
  })

  it('returns 0 for no selection and the area for a single (reversed) range', () => {
    expect(countCellsInRanges([])).toBe(0)
    expect(countCellsInRanges([r(4, 2, 0, 0)])).toBe(15)
  })

  it('counts overlapping and adjacent ranges once, matching cellsFromRanges', () => {
    const cases: CellRange[][] = [
      [r(0, 0, 2, 2), r(1, 1, 3, 3)],
      [r(0, 0, 0, 5), r(0, 6, 0, 9)],
      [r(0, 0, 9, 0), r(5, 0, 5, 4), r(2, 2, 7, 3), r(2, 2, 7, 3)],
      [r(0, 0, 0, 0), r(10, 10, 10, 10)]
    ]
    for (const ranges of cases) {
      expect(countCellsInRanges(ranges)).toBe(cellsFromRanges(ranges).length)
    }
  })

  it('handles whole-column selections on large row counts without enumerating', () => {
    expect(countCellsInRanges([r(0, 1, 499_999, 1), r(0, 3, 499_999, 3)])).toBe(1_000_000)
  })
})
