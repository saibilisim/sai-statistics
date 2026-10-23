// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Cauchy prior widths exist in two places that cannot import each other:
 * PRIOR_SCALE_VALUES in src/analyses/_bayes/bayes-prior.ts (so the dialog can
 * show the number beside each preset) and sai_bf_prior_note() in _bootstrap.R
 * (so the output footnote can state the number that was used).
 *
 * Two copies of the same table is how a dialog ends up promising r = 0.707
 * while the analysis computes with 0.354. This test reads the R source and
 * compares, so the drift fails here instead of on a user's screen.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PRIOR_SCALE_VALUES,
  bayesRscale,
  defaultBayesPrior,
  type PriorFamily
} from '../../src/analyses/_bayes/bayes-prior'

const BOOTSTRAP = join(__dirname, '../../r-scripts/_bootstrap.R')

/**
 * Pull the four rows out of the R helper's `named <- switch(family, …)` block
 * and evaluate their arithmetic. The expressions are simple by construction
 * (sqrt(2)/2, 1/3, …); anything else here should fail loudly rather than be
 * silently skipped, which is why an unparseable term throws.
 */
function rScaleTable(): Record<string, Record<string, number>> {
  const src = readFileSync(BOOTSTRAP, 'utf8')
  const block = /named <- switch\(family,([\s\S]*?)\n  \)/.exec(src)
  expect(block, 'sai_bf_prior_note içindeki switch bloğu bulunamadı').not.toBeNull()

  // Handles `1`, `1 / 3`, `sqrt(2) / 2` and `1 / sqrt(3)` — every shape the R
  // table uses. Anything else throws rather than being skipped: a term this
  // cannot read is a row that would silently stop being compared.
  const atom = (s: string): number => {
    const sq = /^sqrt\((\d+(?:\.\d+)?)\)$/.exec(s.trim())
    if (sq) return Math.sqrt(Number(sq[1]))
    const n = Number(s.trim())
    if (!Number.isFinite(n)) throw new Error(`beklenmeyen R terimi: ${s}`)
    return n
  }
  const evalTerm = (t: string): number => {
    const parts = t.trim().split('/')
    if (parts.length === 1) return atom(parts[0]!)
    if (parts.length === 2) return atom(parts[0]!) / atom(parts[1]!)
    throw new Error(`beklenmeyen R ifadesi: ${t}`)
  }

  // One family per line in the R source. Taking the text between the first
  // "c(" and the LAST ")" on the line avoids stopping inside "sqrt(2)", which
  // a single non-greedy group does — and did, silently truncating a term.
  const out: Record<string, Record<string, number>> = {}
  for (const line of block![1]!.split('\n')) {
    const head = /^\s*(\w+)\s*=\s*c\(/.exec(line)
    if (!head) continue
    const inner = line.slice(line.indexOf('c(') + 2, line.lastIndexOf(')'))
    const row: Record<string, number> = {}
    // Split on commas at paren depth 0, so "sqrt(2)" stays whole.
    let depth = 0
    let buf = ''
    const parts: string[] = []
    for (const ch of inner) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        parts.push(buf)
        buf = ''
      } else buf += ch
    }
    parts.push(buf)
    for (const part of parts) {
      const kv = /^\s*(\w+)\s*=\s*(.+)$/.exec(part)
      if (kv) row[kv[1]!] = evalTerm(kv[2]!)
    }
    out[head[1]!] = row
  }
  return out
}

describe('Bayes prior widths', () => {
  it('the dialog table and the R table agree', () => {
    const r = rScaleTable()
    const families = Object.keys(PRIOR_SCALE_VALUES) as PriorFamily[]
    expect(Object.keys(r).sort(), 'aynı aileler').toEqual([...families].sort())

    for (const f of families) {
      for (const preset of ['medium', 'wide', 'ultrawide'] as const) {
        expect(r[f]?.[preset], `${f}.${preset} R tarafında yok`).toBeDefined()
        expect(
          Math.abs(r[f]![preset]! - PRIOR_SCALE_VALUES[f][preset]),
          `${f}.${preset}: R ${r[f]![preset]} vs TS ${PRIOR_SCALE_VALUES[f][preset]}`
        ).toBeLessThan(1e-12)
      }
    }
  })

  it('the four families really do disagree, which is why the number is shown', () => {
    // If they all matched, printing the width would be decoration. "medium"
    // spans 0.354 to 0.707 across the four, so it is not.
    const mediums = (Object.keys(PRIOR_SCALE_VALUES) as PriorFamily[]).map(
      f => PRIOR_SCALE_VALUES[f].medium
    )
    expect(new Set(mediums.map(v => v.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('a custom width reaches R as a number', () => {
    expect(bayesRscale({ preset: 'custom', custom: '1' })).toBe(1)
    expect(bayesRscale({ preset: 'custom', custom: '0.35' })).toBeCloseTo(0.35, 12)
    // Turkish keyboards produce a decimal comma; it must not become NaN.
    expect(bayesRscale({ preset: 'custom', custom: '0,75' })).toBeCloseTo(0.75, 12)
  })

  it('an unusable custom width falls back instead of reaching R as NaN', () => {
    for (const bad of ['', '0', '-1', 'abc']) {
      expect(bayesRscale({ preset: 'custom', custom: bad }), `"${bad}"`).toBe('medium')
    }
  })

  it('a preset is sent by name, so R resolves it per family', () => {
    expect(bayesRscale({ preset: 'wide', custom: '99' })).toBe('wide')
    expect(bayesRscale(defaultBayesPrior)).toBe('medium')
  })

  it("SPSS's r = 1 is reachable for every family", () => {
    // The gap this control was changed to close: r = 1 is a preset for the t
    // test ("wide") but nothing reaches it for a regression coefficient, whose
    // presets stop at 0.707. Custom covers all four.
    expect(PRIOR_SCALE_VALUES.ttest.wide).toBe(1)
    expect(PRIOR_SCALE_VALUES.lmCont.ultrawide).toBeLessThan(1)
    expect(bayesRscale({ preset: 'custom', custom: '1' })).toBe(1)
  })
})
