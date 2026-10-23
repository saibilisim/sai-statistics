// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * spss-syntax-rowwise.test.ts — the SPSS syntax commands that work case by case
 * (COMPUTE / IF / COUNT / DO IF) plus RENAME, TO lists, SELECT IF parens and
 * command abbreviations, against a small in-memory dataset.
 *
 * Every case here was a real bug found by the 2026-10-18 syntax stress run:
 * `DO IF … ELSE … END IF` ran its COMPUTEs on every case, `IF (grp = 'A')`
 * matched nothing, COUNT read only its first value, `a TO d` meant just a and
 * d, `(a b = b a)` reported a no-op rename as done, `(x > 1) AND (y < 3)` was
 * a syntax error and FREQ / DESC were unknown commands.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runSpssSyntax } from '../../src/lib/spss-syntax'
import { useDatasetStore } from '../../src/store/dataset-store'
import type { CellValue, Variable } from '../../shared/data-types'

function v(colId: string, name: string, type: 'numeric' | 'string' = 'numeric'): Variable {
  return {
    colId,
    name,
    type,
    width: 8,
    decimals: 0,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'input'
  }
}

// Columns follow `vars` order, one row per case.
let vars: Variable[]
let rows: CellValue[][]
const analysisRun = vi.fn().mockResolvedValue({ jobId: 'j' })

function col(name: string): CellValue[] {
  const i = vars.findIndex(x => x.name === name)
  if (i < 0) throw new Error(`no variable ${name}`)
  return rows.map(r => r[i] ?? null)
}

beforeEach(() => {
  vars = [v('c1', 'grp', 'string'), v('c2', 'age'), v('c3', 's1'), v('c4', 's2'), v('c5', 's3')]
  rows = [
    ['A', 20, 0, 1, 2],
    ['B', 35, 1, 2, 3],
    ['C', 50, 2, 3, 4],
    ['A', null, 3, 4, 5]
  ]
  analysisRun.mockClear()
  let seq = 10
  ;(globalThis as unknown as { window: unknown }).window = {
    api: {
      analysis: { run: analysisRun },
      data: {
        getChunk: () => Promise.resolve({ rows: rows.map(r => [...r]), totalRows: rows.length }),
        updateCells: (req: {
          updates: { rowIndex: number; colId: string; value: CellValue }[]
        }) => {
          for (const u of req.updates) {
            const i = vars.findIndex(x => x.colId === u.colId)
            ;(rows[u.rowIndex] as CellValue[])[i] = u.value
          }
          return Promise.resolve()
        },
        setColumnFilters: () => Promise.resolve()
      },
      variable: {
        add: (req: { variable: Variable }) => {
          vars = [...vars, { ...req.variable, colId: `c${String(seq++)}` }]
          for (const r of rows) r.push(null)
          return Promise.resolve(vars)
        },
        update: (req: { colId: string; updates: Partial<Variable> }) => {
          const i = vars.findIndex(x => x.colId === req.colId)
          vars[i] = { ...(vars[i] as Variable), ...req.updates }
          if (req.updates.name && vars.filter(x => x.name === req.updates.name).length > 1) {
            return Promise.reject(new Error('duplicate name'))
          }
          return Promise.resolve()
        },
        deleteMany: (req: { colIds: string[] }) => {
          const keep = vars.map(x => !req.colIds.includes(x.colId))
          vars = vars.filter((_, i) => keep[i])
          rows = rows.map(r => r.filter((_, i) => keep[i]))
          return Promise.resolve()
        },
        getAll: () => Promise.resolve(vars)
      }
    }
  }
  useDatasetStore.setState({
    datasetId: 'ds-1',
    variables: vars,
    rowCount: rows.length,
    columnFilters: {}
  })
})

const errors = (log: { level: string }[]) => log.filter(e => e.level === 'error')

describe('DO IF', () => {
  it('runs each branch on its own cases only', async () => {
    const log = await runSpssSyntax(
      "DO IF (grp = 'A').\nCOMPUTE z = 1.\nELSE IF (age > 40).\nCOMPUTE z = 2.\nELSE.\nCOMPUTE z = 3.\nEND IF."
    )
    expect(errors(log)).toEqual([])
    expect(col('z')).toEqual([1, 3, 2, 1])
  })

  it('tests the conditions before any branch changes them', async () => {
    await runSpssSyntax('DO IF (s1 = 0).\nCOMPUTE s1 = 9.\nELSE.\nCOMPUTE s1 = -1.\nEND IF.')
    // The case that became 9 must not then fall into ELSE.
    expect(col('s1')).toEqual([9, -1, -1, -1])
  })

  it('a missing condition takes no branch, not even ELSE', async () => {
    await runSpssSyntax('DO IF (age > 30).\nCOMPUTE big = 1.\nELSE.\nCOMPUTE big = 0.\nEND IF.')
    expect(col('big')).toEqual([0, 1, 1, null])
  })

  it('nests', async () => {
    await runSpssSyntax(
      "DO IF (grp = 'A').\nDO IF (s1 = 0).\nCOMPUTE k = 1.\nELSE.\nCOMPUTE k = 2.\nEND IF.\nEND IF."
    )
    expect(col('k')).toEqual([1, null, null, 2])
  })

  it('refuses a block it cannot limit to the branch, running none of it', async () => {
    const log = await runSpssSyntax(
      "DO IF (grp = 'A').\nCOMPUTE z = 1.\nRECODE age (20=1).\nEND IF.\nCOMPUTE after = 1."
    )
    expect(log.some(e => e.key === 'terminal.log.doIfUnsupported')).toBe(true)
    expect(vars.some(x => x.name === 'z')).toBe(false)
    expect(col('age')).toEqual([20, 35, 50, null])
    expect(col('after')).toEqual([1, 1, 1, 1])
  })

  it('an unclosed DO IF runs nothing', async () => {
    const log = await runSpssSyntax("DO IF (grp = 'A').\nCOMPUTE z = 1.")
    expect(log.some(e => e.key === 'terminal.log.doIfUnclosed')).toBe(true)
    expect(vars.some(x => x.name === 'z')).toBe(false)
  })

  it('a stray ELSE / END IF is an error', async () => {
    const log = await runSpssSyntax('ELSE.\nEND IF.')
    expect(log.filter(e => e.key === 'terminal.log.strayBlockPart')).toHaveLength(2)
  })
})

describe('unsupported blocks are skipped whole', () => {
  it('LOOP does not run its body once', async () => {
    const log = await runSpssSyntax('LOOP #i = 1 TO 3.\nCOMPUTE x = 0.\nEND LOOP.\nCOMPUTE ok = 1.')
    expect(log.some(e => e.key === 'terminal.log.blockSkipped')).toBe(true)
    expect(vars.some(x => x.name === 'x')).toBe(false)
    expect(col('ok')).toEqual([1, 1, 1, 1])
  })
})

// DO REPEAT used to be skipped whole (2026-10-18); since 2026-10-21 it runs
// as SPSS's text macro.
describe('DO REPEAT', () => {
  it('runs the body once per position, stand-in replaced', async () => {
    const log = await runSpssSyntax('DO REPEAT x = s1 s2.\nCOMPUTE x = 0.\nEND REPEAT.')
    expect(errors(log)).toEqual([])
    expect(vars.some(x => x.name === 'x')).toBe(false)
    expect(col('s1')).toEqual([0, 0, 0, 0])
    expect(col('s2')).toEqual([0, 0, 0, 0])
    expect(col('s3')).toEqual([2, 3, 4, 5])
  })

  it('pairs several lists position by position, incl. TO ranges and new names', async () => {
    const log = await runSpssSyntax(
      'DO REPEAT src = s1 TO s3 / dst = d1 TO d3 / k = 1 TO 3.\nCOMPUTE dst = src * k.\nEND REPEAT PRINT.'
    )
    expect(errors(log)).toEqual([])
    expect(col('d1')).toEqual([0, 1, 2, 3])
    expect(col('d2')).toEqual([2, 4, 6, 8])
    expect(col('d3')).toEqual([6, 9, 12, 15])
  })

  it('substitutes quoted strings and leaves text inside quotes alone', async () => {
    await runSpssSyntax(
      "DO REPEAT g = 'A' 'B' / f = fa fb.\nCOMPUTE f = grp = g.\nEND REPEAT.\nCOMPUTE lit = grp = 'g'."
    )
    expect(col('fa')).toEqual([1, 0, 0, 1])
    expect(col('fb')).toEqual([0, 1, 0, 0])
    expect(col('lit')).toEqual([0, 0, 0, 0])
  })

  it('can hold a DO IF', async () => {
    const log = await runSpssSyntax(
      'DO REPEAT x = s1 s2.\nDO IF (age > 30).\nCOMPUTE x = -1.\nEND IF.\nEND REPEAT.'
    )
    expect(errors(log)).toEqual([])
    expect(col('s1')).toEqual([0, -1, -1, 3])
    expect(col('s2')).toEqual([1, -1, -1, 4])
  })

  it('refuses lists of different lengths, running nothing', async () => {
    const log = await runSpssSyntax(
      'DO REPEAT x = s1 s2 / y = 1 2 3.\nCOMPUTE x = y.\nEND REPEAT.\nCOMPUTE ok = 1.'
    )
    expect(log.some(e => e.key === 'terminal.log.doRepeatLength')).toBe(true)
    expect(col('s1')).toEqual([0, 1, 2, 3])
    expect(col('ok')).toEqual([1, 1, 1, 1])
  })

  it('an unclosed DO REPEAT runs nothing', async () => {
    const log = await runSpssSyntax('DO REPEAT x = s1 s2.\nCOMPUTE x = 0.')
    expect(log.some(e => e.key === 'terminal.log.doRepeatUnclosed')).toBe(true)
    expect(col('s1')).toEqual([0, 1, 2, 3])
  })
})

describe('dictionary commands', () => {
  const byName = (name: string): Variable | undefined => vars.find(x => x.name === name)

  it('VALUE LABELS replaces existing labels; ADD VALUE LABELS merges', async () => {
    await runSpssSyntax("VALUE LABELS age 1 'one' 2 'two'.")
    await runSpssSyntax("VALUE LABELS age 3 'three'.")
    expect(byName('age')?.valueLabels).toEqual({ '3': 'three' })
    await runSpssSyntax("ADD VALUE LABELS age 4 'four' 3 'THREE'.")
    expect(byName('age')?.valueLabels).toEqual({ '3': 'THREE', '4': 'four' })
  })

  it('FORMATS sets width/decimals and refuses a type mismatch', async () => {
    const log = await runSpssSyntax('FORMATS age s1 (F5.1) / grp (A8) / s2 (A4) / s3 (DATE11).')
    expect(byName('age')).toMatchObject({ width: 5, decimals: 1 })
    expect(byName('s1')).toMatchObject({ width: 5, decimals: 1 })
    expect(log.filter(e => e.key === 'terminal.log.formatSet')).toHaveLength(3)
    expect(log.some(e => e.key === 'terminal.log.formatTypeMismatch')).toBe(true)
    expect(log.some(e => e.key === 'terminal.log.formatUnsupported')).toBe(true)
  })

  it('STRING / NUMERIC declare new variables, x1 TO x3 included', async () => {
    const log = await runSpssSyntax(
      'STRING city (A20).\nNUMERIC n1 TO n3 (F4.0) / z.\nNUMERIC age.'
    )
    expect(byName('city')).toMatchObject({ type: 'string', width: 20 })
    expect(byName('n2')).toMatchObject({ type: 'numeric', width: 4, decimals: 0 })
    expect(byName('n3')).toBeDefined()
    expect(byName('z')).toMatchObject({ type: 'numeric', width: 8, decimals: 2 })
    expect(log.find(e => e.key === 'terminal.log.nameExists')?.params?.['name']).toBe('age')
  })

  it('VARIABLE LEVEL / WIDTH / ALIGNMENT / ROLE', async () => {
    const log = await runSpssSyntax(
      'VARIABLE LEVEL grp (NOMINAL) s1 TO s3 (ORDINAL).\nVARIABLE WIDTH age (12).\nVARIABLE ALIGNMENT grp (CENTER).\nVARIABLE ROLE /TARGET age /NONE grp.'
    )
    expect(errors(log)).toEqual([])
    expect(byName('grp')).toMatchObject({ measure: 'nominal', align: 'center', role: 'none' })
    expect(byName('s2')?.measure).toBe('ordinal')
    expect(byName('age')).toMatchObject({ columns: 12, role: 'target' })
  })

  it('rejects an unknown level keyword', async () => {
    const log = await runSpssSyntax('VARIABLE LEVEL age (CONTINUOUS).')
    expect(log.some(e => e.key === 'terminal.log.variableAttributeSyntax')).toBe(true)
    expect(byName('age')?.measure).toBe('scale')
  })

  it('DELETE VARIABLES removes them, but never all of them', async () => {
    const log = await runSpssSyntax('DELETE VARIABLES s1 TO s3.')
    expect(errors(log)).toEqual([])
    expect(vars.map(x => x.name)).toEqual(['grp', 'age'])
    const all = await runSpssSyntax('DELETE VARIABLES grp age.')
    expect(all.some(e => e.key === 'terminal.log.deleteAllVariables')).toBe(true)
    expect(vars).toHaveLength(2)
  })

  it('Chart Builder syntax is guidance, not an unknown-command error', async () => {
    const log = await runSpssSyntax(
      'GGRAPH\n  /GRAPHDATASET NAME="g" VARIABLES=age\n  /GRAPHSPEC SOURCE=INLINE.\nBEGIN GPL\n  SOURCE: s=userSource(id("g"))\n  ELEMENT: interval(position(age))\nEND GPL.\nTITLE \'Report\'.'
    )
    expect(errors(log)).toEqual([])
    expect(log.some(e => e.key === 'terminal.log.useGraphsMenu')).toBe(true)
  })
})

describe('IF / COMPUTE expressions', () => {
  it("compares strings written in single quotes (IF (grp = 'A'))", async () => {
    const log = await runSpssSyntax("IF (grp = 'A') bonus = 100.")
    expect(log.find(e => e.key === 'terminal.log.ifApplied')?.params?.['count']).toBe(2)
    expect(col('bonus')).toEqual([100, null, null, 100])
  })

  it('reads SPSS operators: EQ NE GT, ~=, &, |, ~', async () => {
    await runSpssSyntax(
      "COMPUTE a = age GT 30 & grp ~= 'C'.\nCOMPUTE b = grp EQ 'B' | s1 GE 3.\nCOMPUTE c = ~(s1 NE 0)."
    )
    expect(col('a')).toEqual([0, 1, 0, null])
    expect(col('b')).toEqual([0, 1, 0, 1])
    expect(col('c')).toEqual([1, 0, 0, 0])
  })

  it('expands TO inside functions: SUM(s1 TO s3)', async () => {
    await runSpssSyntax('COMPUTE t = SUM(s1 TO s3).')
    expect(col('t')).toEqual([3, 6, 9, 12])
  })

  it('has the common SPSS functions', async () => {
    const log = await runSpssSyntax(
      [
        'COMPUTE m = MISSING(age).',
        'COMPUTE nv = NVALID(age, s1, s2).',
        'COMPUTE r = RND(age / 3).',
        'COMPUTE r5 = RND(age, 20).',
        'COMPUTE tr = TRUNC(-2.7).',
        'COMPUTE sd = SD(s1, s2, s3).',
        "COMPUTE lab = CONCAT(grp, '-', UPCASE('x')).",
        'COMPUTE any1 = ANY(s1, 1, 3).',
        'COMPUTE rg = RANGE(age, 30, 40).'
      ].join('\n')
    )
    expect(errors(log)).toEqual([])
    expect(col('m')).toEqual([0, 0, 0, 1])
    expect(col('nv')).toEqual([3, 3, 3, 2])
    expect(col('r')).toEqual([7, 12, 17, null])
    expect(col('r5')).toEqual([20, 40, 60, null])
    expect(col('tr')).toEqual([-2, -2, -2, -2])
    expect(col('sd')).toEqual([1, 1, 1, 1])
    expect(col('lab')).toEqual(['A-X', 'B-X', 'C-X', 'A-X'])
    expect(col('any1')).toEqual([0, 1, 0, 1])
    expect(col('rg')).toEqual([0, 1, 0, null])
  })
})

describe('COUNT', () => {
  it('counts every value group, THRU ranges and MISSING', async () => {
    const log = await runSpssSyntax('COUNT n = s1 s2 (0 1) s3 (3 THRU 4) age (MISSING).')
    expect(errors(log)).toEqual([])
    // row0: s1=0 ✓ s2=1 ✓ s3=2 ✗ → 2; row1: s1=1 ✓ s3=3 ✓ → 2; row2: s3=4 ✓ → 1; row3: age missing → 1
    expect(col('n')).toEqual([2, 2, 1, 1])
  })

  it('counts string values', async () => {
    await runSpssSyntax("COUNT a = grp ('A').")
    expect(col('a')).toEqual([1, 0, 0, 1])
  })
})

describe('RENAME VARIABLES', () => {
  it('renames the list form positionally and swaps', async () => {
    const log = await runSpssSyntax('RENAME VARIABLES (s1 s2 = s2 s1).')
    expect(errors(log)).toEqual([])
    expect(vars.find(x => x.colId === 'c3')?.name).toBe('s2')
    expect(vars.find(x => x.colId === 'c4')?.name).toBe('s1')
  })

  it('refuses a name that would clash, renaming nothing', async () => {
    const log = await runSpssSyntax('RENAME VARIABLES (s1=x) (age=s2).')
    expect(log.some(e => e.key === 'terminal.log.nameExists')).toBe(true)
    expect(vars.map(x => x.name)).toEqual(['grp', 'age', 's1', 's2', 's3'])
  })
})

describe('variable lists', () => {
  it('a TO c means every variable from a to c', async () => {
    await runSpssSyntax('DESCRIPTIVES VARIABLES=s1 TO s3.')
    const call = analysisRun.mock.calls[0]?.[0] as { params: { variables: string[] } }
    expect(call.params.variables).toEqual(['c3', 'c4', 'c5'])
  })

  it('a reversed range is an error', async () => {
    const log = await runSpssSyntax('DESCRIPTIVES VARIABLES=s3 TO s1.')
    expect(log.some(e => e.level === 'error')).toBe(true)
    expect(analysisRun).not.toHaveBeenCalled()
  })
})

describe('SELECT IF', () => {
  it('takes parenthesised clauses: (age > 30) AND (s1 < 3)', async () => {
    const log = await runSpssSyntax('SELECT IF (age > 30) AND (s1 < 3).')
    expect(errors(log)).toEqual([])
    expect(useDatasetStore.getState().columnFilters).toEqual({
      c2: { operator: 'greater_than', value: '30' },
      c3: { operator: 'less_than', value: '3' }
    })
  })
})

describe('command abbreviations', () => {
  it('FREQ / DESC / CORR run their commands', async () => {
    const log = await runSpssSyntax('FREQ age.\nDESC age.\nCORR age s1.')
    expect(errors(log)).toEqual([])
    expect(analysisRun).toHaveBeenCalledTimes(3)
  })
})
