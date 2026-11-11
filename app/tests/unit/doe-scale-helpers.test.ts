// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Variable } from '@shared/data-types'
import {
  buildDesign,
  designSize,
  latinSquare,
  seededRandom,
  type DoeColumn,
  type DoeDesignSpec
} from '../../src/analyses/doe/doe-designs'
import { designSpecError, doeAnalysisParams } from '../../src/analyses/doe/doe-params'
import { parseRange, scoreVarNames } from '../../src/analyses/scale/scale-score-names'

const col = (cols: DoeColumn[], name: string) => {
  const c = cols.find(x => x.name === name)
  if (!c) throw new Error(`no column ${name}`)
  return c.values as number[]
}
const spec = (p: Partial<DoeDesignSpec>): DoeDesignSpec => ({
  type: 'crd',
  factors: [{ name: 'T', levels: ['a', 'b', 'c'] }],
  replicates: 3,
  seed: 42,
  responseName: 'Y',
  ...p
})

describe('DoE designs', () => {
  it('the same seed gives the same plan, a different seed another', () => {
    const a = buildDesign(spec({ type: 'rcbd', replicates: 4 }))
    const b = buildDesign(spec({ type: 'rcbd', replicates: 4 }))
    const c = buildDesign(spec({ type: 'rcbd', replicates: 4, seed: 43 }))
    expect(col(a, 'T')).toEqual(col(b, 'T'))
    expect(col(a, 'T')).not.toEqual(col(c, 'T'))
  })

  it('CRD: every treatment exactly r times; empty response column', () => {
    const d = buildDesign(spec({}))
    const t = col(d, 'T')
    for (const l of [1, 2, 3]) expect(t.filter(v => v === l)).toHaveLength(3)
    expect(col(d, 'Y').every(v => v === null)).toBe(true)
    expect(d.find(x => x.name === 'T')?.valueLabels).toEqual({ '1': 'a', '2': 'b', '3': 'c' })
  })

  it('RCBD: every treatment once in every block', () => {
    const d = buildDesign(spec({ type: 'rcbd', replicates: 5 }))
    const t = col(d, 'T')
    const b = col(d, 'Block')
    for (let blk = 1; blk <= 5; blk++) {
      expect(t.filter((_, i) => b[i] === blk).sort()).toEqual([1, 2, 3])
    }
  })

  it('Latin square: each symbol once per row and column', () => {
    for (const n of [3, 5, 8]) {
      const sq = latinSquare(n, seededRandom(n))
      for (let i = 0; i < n; i++) {
        expect(new Set(sq[i]).size).toBe(n)
        expect(new Set(sq.map(r => r[i])).size).toBe(n)
      }
    }
    const d = buildDesign(
      spec({ type: 'latin', factors: [{ name: 'T', levels: ['a', 'b', 'c', 'd'] }] })
    )
    expect(col(d, 'T')).toHaveLength(16)
  })

  it('factorial in blocks: every combination once per block', () => {
    const d = buildDesign(
      spec({
        type: 'factorial',
        blocked: true,
        replicates: 2,
        factors: [
          { name: 'A', levels: ['a1', 'a2'] },
          { name: 'B', levels: ['b1', 'b2', 'b3'] }
        ]
      })
    )
    const a = col(d, 'A')
    const b = col(d, 'B')
    const blk = col(d, 'Block')
    for (const k of [1, 2]) {
      const combos = a.map((x, i) => `${String(x)}${String(b[i])}`).filter((_, i) => blk[i] === k)
      expect(new Set(combos).size).toBe(6)
    }
  })

  it('split-plot: sub-plot levels complete within each main plot', () => {
    const d = buildDesign(
      spec({
        type: 'splitplot',
        replicates: 3,
        factors: [
          { name: 'A', levels: ['a1', 'a2'] },
          { name: 'B', levels: ['b1', 'b2', 'b3'] }
        ]
      })
    )
    const main = col(d, 'MainPlot')
    const a = col(d, 'A')
    const b = col(d, 'B')
    for (const m of new Set(main)) {
      const rows = main.map((x, i) => (x === m ? i : -1)).filter(i => i >= 0)
      expect(new Set(rows.map(i => a[i])).size).toBe(1)
      expect(rows.map(i => b[i]).sort()).toEqual([1, 2, 3])
    }
  })

  it('2^k: all 2^k sign combinations per replicate, standard order kept', () => {
    const d = buildDesign(
      spec({
        type: 'twok',
        replicates: 2,
        factors: ['A', 'B', 'C'].map(n => ({ name: n, levels: ['lo', 'hi'] }))
      })
    )
    expect(col(d, 'A')).toHaveLength(16)
    const rep1 = col(d, 'Replicate')
      .map((r, i) => (r === 1 ? i : -1))
      .filter(i => i >= 0)
    const combos = rep1.map(
      i => `${String(col(d, 'A')[i])}${String(col(d, 'B')[i])}${String(col(d, 'C')[i])}`
    )
    expect(new Set(combos).size).toBe(8)
    // Standard order 1 is all low; 2 has only the first factor high.
    const std = col(d, 'StdOrder')
    const i1 = std.indexOf(1)
    const i2 = std.indexOf(2)
    expect([col(d, 'A')[i1], col(d, 'B')[i1], col(d, 'C')[i1]]).toEqual([-1, -1, -1])
    expect([col(d, 'A')[i2], col(d, 'B')[i2]]).toEqual([1, -1])
    expect(
      designSize(
        spec({
          type: 'twok',
          replicates: 2,
          factors: [
            { name: 'A', levels: [] },
            { name: 'B', levels: [] },
            { name: 'C', levels: [] }
          ]
        })
      )
    ).toBe(16)
  })

  it('validation catches duplicate names, one-level factors and bad Latin sizes', () => {
    expect(designSpecError(spec({}))).toBeNull()
    expect(designSpecError(spec({ factors: [{ name: 'T', levels: ['a'] }] }))).toBe(
      'analysis:doe.errLevels'
    )
    expect(designSpecError(spec({ responseName: 'T' }))).toBe('analysis:doe.errResponseName')
    expect(
      designSpecError(spec({ type: 'latin', factors: [{ name: 'T', levels: ['a', 'b'] }] }))
    ).toBe('analysis:doe.errLatin')
    expect(designSpecError(spec({ replicates: 1 }))).toBe('analysis:doe.errReplicates')
  })
})

describe('Analyze Design params', () => {
  const v = (colId: string) => ({ colId }) as Variable
  it('needs every role of the design', () => {
    expect(doeAnalysisParams('rcbd', { response: [v('y')], treatment: [v('t')] })).toBeNull()
    expect(
      doeAnalysisParams('rcbd', { response: [v('y')], treatment: [v('t')], block: [v('b')] })
    ).toEqual({ response: 'y', design: 'rcbd', treatment: 't', block: 'b' })
    expect(
      doeAnalysisParams('factorial', { response: [v('y')], factors: [v('a'), v('b')] })
    ).toEqual({ response: 'y', design: 'factorial', factors: ['a', 'b'] })
    expect(doeAnalysisParams('factorial', { response: [v('y')], factors: [v('a')] })).toBeNull()
  })
})

describe('scale dialog helpers', () => {
  it('score variable names are valid and unique against the dataset', () => {
    const out = scoreVarNames(
      [
        { slot: 'score1', base: 'Öz yeterlik' },
        { slot: 'score2', base: 'q1' }
      ],
      ['q1']
    )
    expect(out.score1).toBeTruthy()
    expect(out.score2).not.toBe('q1')
    expect(new Set(Object.values(out)).size).toBe(2)
  })
  it('a blank range means "from the data"', () => {
    expect(parseRange('', '')).toEqual({})
    expect(parseRange('1', '5')).toEqual({ scaleMin: 1, scaleMax: 5 })
  })
})
