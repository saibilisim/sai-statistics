// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import {
  isFormula,
  evaluateFormula,
  adjustReferences,
  remapReferences,
  extractReferences,
  type RefResolver
} from '../../src/lib/formula'
import type { CellValue } from '../../shared/data-types'

// A small grid resolver: grid[row][col]. Out-of-range → null.
function makeResolver(grid: CellValue[][]): RefResolver {
  return (col, row) => grid[row]?.[col] ?? null
}

const grid: CellValue[][] = [
  [10, 20, 2], // row 0 → A1,B1,C1
  [30, 40, 4], // row 1 → A2,B2,C2
  [50, 60, 8], // row 2 → A3,B3,C3
  ['x', null, 0] // row 3 → A4(text),B4(blank),C4
]
const R = makeResolver(grid)
const val = (src: string) => evaluateFormula(src, R)

describe('isFormula', () => {
  it('detects a leading =', () => {
    expect(isFormula('=A1')).toBe(true)
    expect(isFormula('  =A1')).toBe(true)
    expect(isFormula('42')).toBe(false)
    expect(isFormula('')).toBe(false)
  })
})

describe('evaluateFormula — arithmetic & precedence', () => {
  it('basic arithmetic', () => {
    expect(val('=1+2*3')).toEqual({ ok: true, value: 7 })
    expect(val('=(1+2)*3')).toEqual({ ok: true, value: 9 })
    expect(val('=2^3^2')).toEqual({ ok: true, value: 512 }) // right-assoc
    expect(val('=-3+5')).toEqual({ ok: true, value: 2 })
    expect(val('=10/4')).toEqual({ ok: true, value: 2.5 })
  })
  it('division by zero → #DIV/0!', () => {
    expect(val('=1/0')).toEqual({ ok: false, error: '#DIV/0!' })
  })
})

describe('evaluateFormula — references', () => {
  it('single cell refs (blank→0)', () => {
    expect(val('=A1+B1')).toEqual({ ok: true, value: 30 })
    expect(val('=A2*C2')).toEqual({ ok: true, value: 120 })
    expect(val('=B4+5')).toEqual({ ok: true, value: 5 }) // blank → 0
  })
  it('text in arithmetic → #VALUE!', () => {
    expect(val('=A4+1')).toEqual({ ok: false, error: '#VALUE!' })
  })
  it('$-locked refs still resolve to the same cell', () => {
    expect(val('=$A$1+$B$1')).toEqual({ ok: true, value: 30 })
  })
})

describe('evaluateFormula — functions & ranges', () => {
  it('aggregates over a range (skips blanks/text)', () => {
    expect(val('=SUM(A1:A3)')).toEqual({ ok: true, value: 90 })
    expect(val('=SUM(A1:A4)')).toEqual({ ok: true, value: 90 }) // A4 text skipped
    expect(val('=MEAN(A1:A3)')).toEqual({ ok: true, value: 30 })
    expect(val('=MIN(A1:C1)')).toEqual({ ok: true, value: 2 })
    expect(val('=MAX(A1:C1)')).toEqual({ ok: true, value: 20 })
    expect(val('=COUNT(A1:B4)')).toEqual({ ok: true, value: 6 }) // 8 cells, A4 text + B4 blank skipped
  })
  it('mixed scalar + range args', () => {
    expect(val('=SUM(A1,B1,100)')).toEqual({ ok: true, value: 130 })
  })
  it('scalar functions', () => {
    expect(val('=ABS(-7)')).toEqual({ ok: true, value: 7 })
    expect(val('=SQRT(9)')).toEqual({ ok: true, value: 3 })
    expect(val('=ROUND(3.14159,2)')).toEqual({ ok: true, value: 3.14 })
    expect(val('=LOG10(1000)')).toEqual({ ok: true, value: 3 })
    expect(val('=MOD(10,3)')).toEqual({ ok: true, value: 1 })
  })
  it('SQRT of a negative → #NUM!', () => {
    expect(val('=SQRT(-1)')).toEqual({ ok: false, error: '#NUM!' })
  })
  it('unknown function → #NAME?', () => {
    expect(val('=FOOBAR(1)')).toEqual({ ok: false, error: '#NAME?' })
  })
})

describe('evaluateFormula — logical & IF', () => {
  it('comparisons return booleans and drive IF', () => {
    expect(val('=IF(A1>B1,1,0)')).toEqual({ ok: true, value: 0 })
    expect(val('=IF(A2>A1,"up","down")')).toEqual({ ok: true, value: 'up' })
    expect(val('=IF(A1=10,100,200)')).toEqual({ ok: true, value: 100 })
  })
})

describe('evaluateFormula — safety', () => {
  it('never executes arbitrary code / rejects junk', () => {
    expect(val('=alert(1)')).toEqual({ ok: false, error: '#NAME?' })
    expect(val('=1+')).toEqual({ ok: false, error: '#NUM!' })
    expect(val('=')).toEqual({ ok: false, error: '#NUM!' })
  })
})

describe('adjustReferences (fill)', () => {
  it('shifts relative refs down/right, leaves $ locked', () => {
    expect(adjustReferences('=A7+B7', 1, 0)).toBe('=A8+B8')
    expect(adjustReferences('=A7+B7', 0, 1)).toBe('=B7+C7')
    expect(adjustReferences('=$A$7+B7', 1, 0)).toBe('=$A$7+B8')
    expect(adjustReferences('=A$7+$B7', 2, 3)).toBe('=D$7+$B9')
  })
  it('does not touch function names', () => {
    expect(adjustReferences('=SUM(A1:A3)', 1, 0)).toBe('=SUM(A2:A4)')
    expect(adjustReferences('=LOG10(A1)', 1, 0)).toBe('=LOG10(A2)')
  })
  it('off-edge refs become #REF!', () => {
    expect(adjustReferences('=A1', -1, 0)).toBe('=#REF!')
  })
})

describe('remapReferences', () => {
  it('remaps rows via a function, leaving $-locked rows fixed', () => {
    const out = remapReferences('=A2+$A$3', (col, row, _cl, rl) => ({
      col,
      row: rl ? row : row + 10
    }))
    expect(out).toBe('=A12+$A$3')
  })
  it('remaps columns too', () => {
    const out = remapReferences('=A2', (col, row) => ({ col: col + 2, row }))
    expect(out).toBe('=C2')
  })
  it('emits #REF! for negative results', () => {
    expect(remapReferences('=A1', (c, r) => ({ col: c, row: r - 5 }))).toBe('=#REF!')
  })
  it('leaves string literals and function names alone', () => {
    const out = remapReferences('=SUM(A1:A2)&"A1"', (c, r) => ({ col: c, row: r + 1 }))
    expect(out).toBe('=SUM(A2:A3)&"A1"')
  })
})

describe('extractReferences', () => {
  it('lists single refs', () => {
    expect(extractReferences('=A1+B2')).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 1 }
    ])
  })
  it('expands ranges', () => {
    expect(extractReferences('=SUM(A1:A3)')).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: 2 }
    ])
  })
  it('returns [] for junk', () => {
    expect(extractReferences('=@@@')).toEqual([])
  })
})

describe('evaluateFormula — variable names (Compute Variable)', () => {
  const vars: Record<string, CellValue> = {
    yas: 30,
    boy: 1.8,
    kilo: 81,
    q1: 5,
    ad: 'Ali',
    yb_yatisi: 1,
    sonuc: 3,
    flag: 0
  }
  const byName = (n: string) => (n in vars ? vars[n] : undefined)
  const ev = (src: string) => evaluateFormula(src, R, byName)

  it('resolves variable names containing underscores (real bug regression)', () => {
    // The identifier tokenizer only accepted [A-Za-z0-9] after the first
    // char, so "yb_yatisi" tokenized as "yb" followed by a bare "_" it could
    // not classify at all — the whole expression aborted with #NAME? even
    // though "yb_yatisi" was a perfectly valid known variable.
    expect(ev('=yb_yatisi + 1')).toEqual({ ok: true, value: 2 })
  })

  it('resolves bare variable names', () => {
    expect(ev('=yas + 10')).toEqual({ ok: true, value: 40 })
    expect(ev('kilo / (boy * boy)')).toEqual({ ok: true, value: 81 / (1.8 * 1.8) })
  })

  it('resolves names that look like cell refs (q1)', () => {
    expect(ev('=q1 * 2')).toEqual({ ok: true, value: 10 })
  })

  it('is case-insensitive only where the resolver says so (exact here)', () => {
    expect(ev('=YAS')).toEqual({ ok: false, error: '#NAME?' })
  })

  it('unknown names give #NAME? instead of silently becoming 0', () => {
    expect(ev('=bilinmeyen + 1')).toEqual({ ok: false, error: '#NAME?' })
  })

  it('functions still work alongside names', () => {
    expect(ev('=ROUND(kilo / (boy * boy), 1)')).toEqual({ ok: true, value: 25 })
    expect(ev('=IF(yas > 18, 1, 0)')).toEqual({ ok: true, value: 1 })
  })

  it('without a name resolver, bare names are still function calls (unchanged)', () => {
    expect(evaluateFormula('=yas + 1', R)).toEqual({ ok: false, error: '#NUM!' })
  })

  it('evaluates OR of two comparisons on different variables (SPSS IF-condition syntax)', () => {
    expect(ev('sonuc = 3 OR yb_yatisi = 9')).toEqual({ ok: true, value: true })
    expect(ev('sonuc = 9 OR yb_yatisi = 9')).toEqual({ ok: true, value: false })
  })

  it('evaluates AND of two comparisons', () => {
    expect(ev('sonuc = 3 AND yb_yatisi = 1')).toEqual({ ok: true, value: true })
    expect(ev('sonuc = 3 AND yb_yatisi = 9')).toEqual({ ok: true, value: false })
  })

  it('NOT negates a comparison', () => {
    expect(ev('NOT (sonuc = 3)')).toEqual({ ok: true, value: false })
    expect(ev('NOT (sonuc = 9)')).toEqual({ ok: true, value: true })
  })

  it('AND binds tighter than OR (real SPSS/Excel precedence)', () => {
    // Naive left-to-right (no precedence) would read this as
    // (sonuc=3 OR flag=1) AND yb_yatisi=0 = TRUE AND FALSE = FALSE.
    // Correct precedence groups it as sonuc=3 OR (flag=1 AND yb_yatisi=0)
    // = TRUE OR FALSE = TRUE.
    expect(ev('sonuc = 3 OR flag = 1 AND yb_yatisi = 0')).toEqual({ ok: true, value: true })
  })

  it('OR/AND feed into functions that flatten booleans to numbers (the MAX-as-OR workaround)', () => {
    expect(ev('MAX(sonuc = 3, yb_yatisi = 9)')).toEqual({ ok: true, value: 1 })
    expect(ev('MAX(sonuc = 9, yb_yatisi = 9)')).toEqual({ ok: true, value: 0 })
  })
})

describe('evaluateFormula — system-missing in Compute (name) mode', () => {
  // `eksik` is a variable whose value is missing in this case.
  const vars: Record<string, CellValue> = { x: 4, y: 6, eksik: null, s: 'a' }
  const byName = (n: string) => (n in vars ? vars[n] : undefined)
  const ev = (src: string) => evaluateFormula(src, R, byName)
  const SYSMIS = { ok: true, value: null }

  it('arithmetic with a missing operand is missing, not 0 (real bug: x*2 wrote 0)', () => {
    expect(ev('eksik * 2')).toEqual(SYSMIS)
    expect(ev('x + eksik')).toEqual(SYSMIS)
    expect(ev('-eksik')).toEqual(SYSMIS)
    expect(ev('SQRT(eksik)')).toEqual(SYSMIS)
  })

  it('aggregate functions skip missing arguments; all-missing is missing', () => {
    expect(ev('SUM(x, eksik, y)')).toEqual({ ok: true, value: 10 })
    expect(ev('MEAN(x, eksik, y)')).toEqual({ ok: true, value: 5 })
    expect(ev('MIN(eksik, y)')).toEqual({ ok: true, value: 6 })
    expect(ev('SUM(eksik)')).toEqual(SYSMIS)
    expect(ev('MEAN(eksik)')).toEqual(SYSMIS)
    expect(ev('MAX(eksik)')).toEqual(SYSMIS)
  })

  it('comparisons with a missing operand are missing', () => {
    expect(ev('eksik > 1')).toEqual(SYSMIS)
  })

  it('AND/OR follow SPSS three-valued logic', () => {
    expect(ev('eksik > 1 AND x = 0')).toEqual({ ok: true, value: false })
    expect(ev('eksik > 1 AND x = 4')).toEqual(SYSMIS)
    expect(ev('eksik > 1 OR x = 4')).toEqual({ ok: true, value: true })
    expect(ev('eksik > 1 OR x = 0')).toEqual(SYSMIS)
    expect(ev('NOT (eksik > 1)')).toEqual(SYSMIS)
  })

  it('a missing IF condition takes the else branch', () => {
    expect(ev('IF(eksik > 1, 1, 2)')).toEqual({ ok: true, value: 2 })
  })

  it('A1 cell formulas keep Excel semantics (blank → 0)', () => {
    expect(val('=B4 * 2')).toEqual({ ok: true, value: 0 })
  })
})
