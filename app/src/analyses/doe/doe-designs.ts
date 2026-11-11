// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design of Experiments › Create Design: randomized layouts for the classical
 * designs, built here and handed to Main as a new dataset
 * (window.api.data.createDataset).
 *
 * Randomization uses a seeded generator (mulberry32), so the same seed always
 * gives the same plan — the seed is printed with the design so a reviewer can
 * regenerate it. Factors are stored as numeric codes 1..k with the level names
 * as value labels (what Analyze Design and every other analysis expect); 2^k
 * factors are coded -1 / +1.
 *
 *   crd        completely randomized: t treatments x r replicates
 *   rcbd       randomized complete blocks: every treatment once per block
 *   latin      Latin square: t x t, rows, columns and symbols permuted
 *   factorial  2-3 factors, all combinations, in a CRD or in r blocks
 *   splitplot  main-plot factor A in r blocks (RCBD), sub-plot factor B
 *              randomized within each main plot
 *   twok       2^k full factorial (k = 2..6), r replicates, run order
 *              randomized, standard order kept as a column
 */

export type DoeDesignType = 'crd' | 'rcbd' | 'latin' | 'factorial' | 'splitplot' | 'twok'

export interface DoeFactorSpec {
  name: string
  levels: string[]
}

export interface DoeDesignSpec {
  type: DoeDesignType
  /** crd/rcbd/latin: one factor; factorial: 2-3; splitplot: [main, sub]; twok: k factors (levels ignored). */
  factors: DoeFactorSpec[]
  /** Replicates (crd, factorial in CRD, twok) or blocks (rcbd, factorial in blocks, splitplot). */
  replicates: number
  /** factorial only: lay the combinations out in blocks instead of a CRD. */
  blocked?: boolean
  seed: number
  responseName: string
}

export interface DoeColumn {
  name: string
  label: string
  type: 'numeric'
  measure: 'scale' | 'ordinal' | 'nominal'
  decimals: number
  valueLabels: Record<string, string>
  values: (number | null)[]
}

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

const factorColumn = (f: DoeFactorSpec, values: number[]): DoeColumn => ({
  name: f.name,
  label: '',
  type: 'numeric',
  measure: 'nominal',
  decimals: 0,
  valueLabels: Object.fromEntries(f.levels.map((l, i) => [String(i + 1), l])),
  values
})
const idColumn = (name: string, values: number[]): DoeColumn => ({
  name,
  label: '',
  type: 'numeric',
  measure: 'nominal',
  decimals: 0,
  valueLabels: {},
  values
})

/** All level combinations of the given level counts, first factor slowest. */
function combinations(counts: number[]): number[][] {
  let out: number[][] = [[]]
  for (const c of counts) out = out.flatMap(prefix => range(c).map(l => [...prefix, l]))
  return out
}

/** A random Latin square of order t: cyclic square, rows, columns and symbols permuted. */
export function latinSquare(t: number, rnd: () => number): number[][] {
  const rows = shuffle(range(t), rnd)
  const cols = shuffle(range(t), rnd)
  const sym = shuffle(range(t), rnd)
  return rows.map(r => cols.map(c => sym[(r + c) % t] as number))
}

export function buildDesign(spec: DoeDesignSpec): DoeColumn[] {
  const rnd = seededRandom(spec.seed)
  const r = Math.max(1, Math.floor(spec.replicates))
  const resp: (n: number) => DoeColumn = n => ({
    name: spec.responseName,
    label: '',
    type: 'numeric',
    measure: 'scale',
    decimals: 2,
    valueLabels: {},
    values: Array.from({ length: n }, () => null)
  })
  const f0 = spec.factors[0] ?? { name: 'Treatment', levels: ['T1', 'T2'] }

  switch (spec.type) {
    case 'crd': {
      const t = f0.levels.length
      const trt = shuffle(
        range(t).flatMap(l => Array.from({ length: r }, () => l)),
        rnd
      )
      return [idColumn('Plot', range(trt.length)), factorColumn(f0, trt), resp(trt.length)]
    }
    case 'rcbd': {
      const t = f0.levels.length
      const block: number[] = []
      const trt: number[] = []
      for (let b = 1; b <= r; b++) {
        for (const l of shuffle(range(t), rnd)) {
          block.push(b)
          trt.push(l)
        }
      }
      return [
        idColumn('Plot', range(trt.length)),
        idColumn('Block', block),
        factorColumn(f0, trt),
        resp(trt.length)
      ]
    }
    case 'latin': {
      const t = f0.levels.length
      const sq = latinSquare(t, rnd)
      const row: number[] = []
      const col: number[] = []
      const trt: number[] = []
      sq.forEach((line, i) => {
        line.forEach((s, j) => {
          row.push(i + 1)
          col.push(j + 1)
          trt.push(s)
        })
      })
      return [
        idColumn('Plot', range(trt.length)),
        idColumn('Row', row),
        idColumn('Column', col),
        factorColumn(f0, trt),
        resp(trt.length)
      ]
    }
    case 'factorial': {
      const fs = spec.factors
      const combos = combinations(fs.map(f => f.levels.length))
      const rowsOut: { block: number; combo: number[] }[] = []
      if (spec.blocked) {
        for (let b = 1; b <= r; b++)
          for (const c of shuffle(combos, rnd)) rowsOut.push({ block: b, combo: c })
      } else {
        const all = combos.flatMap(c => Array.from({ length: r }, () => c))
        for (const c of shuffle(all, rnd)) rowsOut.push({ block: 0, combo: c })
      }
      const cols: DoeColumn[] = [idColumn('Plot', range(rowsOut.length))]
      if (spec.blocked)
        cols.push(
          idColumn(
            'Block',
            rowsOut.map(x => x.block)
          )
        )
      fs.forEach((f, i) =>
        cols.push(
          factorColumn(
            f,
            rowsOut.map(x => x.combo[i] ?? 1)
          )
        )
      )
      cols.push(resp(rowsOut.length))
      return cols
    }
    case 'splitplot': {
      const fa = spec.factors[0] ?? f0
      const fb = spec.factors[1] ?? { name: 'B', levels: ['B1', 'B2'] }
      const block: number[] = []
      const main: number[] = []
      const a: number[] = []
      const b: number[] = []
      let mainId = 0
      for (let bl = 1; bl <= r; bl++) {
        for (const la of shuffle(range(fa.levels.length), rnd)) {
          mainId++
          for (const lb of shuffle(range(fb.levels.length), rnd)) {
            block.push(bl)
            main.push(mainId)
            a.push(la)
            b.push(lb)
          }
        }
      }
      return [
        idColumn('Plot', range(a.length)),
        idColumn('Block', block),
        idColumn('MainPlot', main),
        factorColumn(fa, a),
        factorColumn(fb, b),
        resp(a.length)
      ]
    }
    case 'twok': {
      const k = spec.factors.length
      // Standard (Yates) order: first factor alternates fastest.
      const std = range(2 ** k).map(i => range(k).map(j => (((i - 1) >> (j - 1)) & 1 ? 1 : -1)))
      const runs = range(r).flatMap(rep => std.map((levels, i) => ({ rep, std: i + 1, levels })))
      const order = shuffle(runs, rnd)
      const cols: DoeColumn[] = [
        idColumn('RunOrder', range(order.length)),
        idColumn(
          'StdOrder',
          order.map(x => x.std)
        ),
        idColumn(
          'Replicate',
          order.map(x => x.rep)
        )
      ]
      spec.factors.forEach((f, j) =>
        cols.push({
          name: f.name,
          label: '',
          type: 'numeric',
          measure: 'nominal',
          decimals: 0,
          valueLabels: { '-1': f.levels[0] ?? '-', '1': f.levels[1] ?? '+' },
          values: order.map(x => x.levels[j] ?? -1)
        })
      )
      cols.push(resp(order.length))
      return cols
    }
  }
}

/** Plots (rows) the design will have — for the dialog's preview line. */
export function designSize(spec: DoeDesignSpec): number {
  const r = Math.max(1, Math.floor(spec.replicates))
  const lv = spec.factors.map(f => f.levels.length)
  switch (spec.type) {
    case 'crd':
    case 'rcbd':
      return (lv[0] ?? 0) * r
    case 'latin':
      return (lv[0] ?? 0) ** 2
    case 'factorial':
    case 'splitplot':
      return lv.reduce((a, b) => a * b, 1) * r
    case 'twok':
      return 2 ** spec.factors.length * r
  }
}
