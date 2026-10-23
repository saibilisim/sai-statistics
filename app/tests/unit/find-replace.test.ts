// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import {
  findMatches,
  findStartIndex,
  computeReplacement,
  type MatchPosition
} from '../../src/views/DataView/find-replace'
import type { CellValue, Variable } from '../../shared/data-types'

function makeVar(overrides: Partial<Variable> = {}): Variable {
  return {
    colId: 'col_1',
    name: 'v',
    type: 'string',
    width: 8,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'left',
    measure: 'nominal',
    role: 'both',
    ...overrides
  }
}

describe('findMatches', () => {
  const variables = [
    makeVar({ colId: 'col_1', name: 'name', type: 'string' }),
    makeVar({ colId: 'col_2', name: 'age', type: 'numeric', decimals: 0 })
  ]
  const rows: CellValue[][] = [
    ['Ahmet', 25],
    ['Mehmet', 30],
    ['ahmet Yılmaz', 25]
  ]

  it('matches case-insensitively across all columns', () => {
    const matches = findMatches('ahmet', rows, variables, false)
    expect(matches).toEqual([
      { row: 0, col: 0 },
      { row: 2, col: 0 }
    ])
  })

  it('matches numeric columns via their formatted display text', () => {
    const matches = findMatches('25', rows, variables, false)
    expect(matches).toEqual([
      { row: 0, col: 1 },
      { row: 2, col: 1 }
    ])
  })

  it('returns empty for a blank search term', () => {
    expect(findMatches('', rows, variables, false)).toEqual([])
    expect(findMatches('   ', rows, variables, false)).toEqual([])
  })

  it('returns empty when nothing matches', () => {
    expect(findMatches('zzz', rows, variables, false)).toEqual([])
  })

  it('respects the value-labels toggle', () => {
    const labelled = [makeVar({ colId: 'col_1', valueLabels: { '1': 'Erkek' }, type: 'numeric' })]
    const data: CellValue[][] = [[1]]
    expect(findMatches('Erkek', data, labelled, true)).toEqual([{ row: 0, col: 0 }])
    expect(findMatches('Erkek', data, labelled, false)).toEqual([])
  })
})

describe('findStartIndex', () => {
  const matches = [
    { row: 0, col: 0 },
    { row: 2, col: 1 },
    { row: 5, col: 0 }
  ]

  it('finds the first match at-or-after the given position', () => {
    expect(findStartIndex(matches, 0, 0)).toBe(0)
    expect(findStartIndex(matches, 1, 0)).toBe(1)
    expect(findStartIndex(matches, 2, 1)).toBe(1)
    expect(findStartIndex(matches, 3, 0)).toBe(2)
  })

  it('wraps to 0 when past every match', () => {
    expect(findStartIndex(matches, 10, 0)).toBe(0)
  })

  it('handles an empty match list', () => {
    expect(findStartIndex([], 0, 0)).toBe(0)
  })
})

describe('findMatches — search options (B6)', () => {
  const variables = [makeVar({ colId: 'col_1', name: 'name', type: 'string' })]
  const rows: CellValue[][] = [['Ahmet'], ['ahmet'], ['Mehmet'], ['AHMET ALI']]

  it('is case-insensitive by default', () => {
    expect(findMatches('ahmet', rows, variables, false)).toHaveLength(3)
  })

  it('caseSensitive narrows to exact casing', () => {
    const m = findMatches('ahmet', rows, variables, false, { caseSensitive: true })
    expect(m).toEqual([{ row: 1, col: 0 }])
  })

  it('wholeCell requires the entire cell to equal the term', () => {
    const m = findMatches('ahmet', rows, variables, false, { wholeCell: true })
    expect(m).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 }
    ])
  })

  it('regex matches patterns', () => {
    const m = findMatches('^A.*T$', rows, variables, false, { regex: true })
    // case-insensitive by default: "Ahmet", "ahmet", "AHMET ALI" fails ($ anchor)
    expect(m).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 }
    ])
  })

  it('regex + wholeCell anchors the pattern', () => {
    const m = findMatches('ahmet', rows, variables, false, { regex: true, wholeCell: true })
    expect(m).toHaveLength(2)
  })

  it('an invalid regex yields no matches instead of throwing', () => {
    expect(findMatches('([', rows, variables, false, { regex: true })).toEqual([])
  })
})

describe('computeReplacement (B6)', () => {
  it('replaces every plain occurrence, case-insensitively by default', () => {
    expect(computeReplacement('aXbXc', 'x', 'Y')).toBe('aYbYc')
  })

  it('honours caseSensitive', () => {
    expect(computeReplacement('aXbxc', 'x', 'Y', { caseSensitive: true })).toBe('aXbYc')
  })

  it('wholeCell swaps the entire content', () => {
    expect(computeReplacement('Ahmet Ali', 'ahmet', 'Zeynep', { wholeCell: true })).toBe('Zeynep')
  })

  it('regex mode supports capture groups', () => {
    expect(computeReplacement('2024-07', '(\\d+)-(\\d+)', '$2/$1', { regex: true })).toBe('07/2024')
  })

  it('an invalid regex leaves the text unchanged', () => {
    expect(computeReplacement('abc', '([', 'X', { regex: true })).toBe('abc')
  })
})

describe('findMatches — scope & direction (full Find dialog)', () => {
  const variables = [
    makeVar({ colId: 'col_1', name: 'a', type: 'string' }),
    makeVar({ colId: 'col_2', name: 'b', type: 'string' })
  ]
  //   col0  col1
  // 0  x     y
  // 1  y     x
  // 2  x     x
  const rows: CellValue[][] = [
    ['x', 'y'],
    ['y', 'x'],
    ['x', 'x']
  ]

  it('scope restricts the scan to a rectangle', () => {
    const all = findMatches('x', rows, variables, false)
    expect(all).toHaveLength(4)
    const scoped = findMatches('x', rows, variables, false, {
      scope: { top: 0, bottom: 1, left: 0, right: 0 }
    })
    expect(scoped).toEqual([{ row: 0, col: 0 }])
  })

  it('row direction scans row-major (default)', () => {
    expect(findMatches('x', rows, variables, false, { direction: 'rows' })).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 0 },
      { row: 2, col: 1 }
    ])
  })

  it('column direction scans column-major', () => {
    expect(findMatches('x', rows, variables, false, { direction: 'columns' })).toEqual([
      { row: 0, col: 0 },
      { row: 2, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 1 }
    ])
  })
})

describe('findStartIndex — direction aware', () => {
  const rowOrder: MatchPosition[] = [
    { row: 0, col: 0 },
    { row: 1, col: 1 },
    { row: 2, col: 0 }
  ]
  it('resumes after the cursor in row order', () => {
    expect(findStartIndex(rowOrder, 1, 0)).toBe(1)
  })
  const colOrder: MatchPosition[] = [
    { row: 0, col: 0 },
    { row: 2, col: 0 },
    { row: 1, col: 1 }
  ]
  it('resumes after the cursor in column order', () => {
    expect(findStartIndex(colOrder, 0, 1, 'columns')).toBe(2)
  })
  it('wraps to the start when nothing follows', () => {
    expect(findStartIndex(rowOrder, 99, 99)).toBe(0)
  })
})

describe('findMatches — empty cells (Find ▸ Boş hücreleri bul)', () => {
  const variables = [
    makeVar({ colId: 'col_1', name: 'a', type: 'string' }),
    makeVar({ colId: 'col_2', name: 'b', type: 'string' })
  ]
  const rows: CellValue[][] = [
    ['x', null],
    ['', 'y'],
    ['z', '  ']
  ]

  it('finds blank / null / whitespace-only cells, ignoring the term', () => {
    expect(findMatches('', rows, variables, false, { emptyCells: true })).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 2, col: 1 }
    ])
  })

  it('ignores whatever term is typed', () => {
    const withTerm = findMatches('anything', rows, variables, false, { emptyCells: true })
    expect(withTerm).toHaveLength(3)
  })

  it('still honours scope', () => {
    expect(
      findMatches('', rows, variables, false, {
        emptyCells: true,
        scope: { top: 0, bottom: 0, left: 0, right: 1 }
      })
    ).toEqual([{ row: 0, col: 1 }])
  })

  it('an empty term without the option still finds nothing', () => {
    expect(findMatches('', rows, variables, false)).toEqual([])
  })
})
