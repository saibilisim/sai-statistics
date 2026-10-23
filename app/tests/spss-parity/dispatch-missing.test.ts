// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Missing-values strategy dispatch: job-missing.sps runs every procedure that
 * exposes the Missing Values option twice — SPSS-default and /MISSING
 * LISTWISE. This test feeds that file through the real dispatcher and
 *
 *   1. asserts every LISTWISE statement arrives with options.missing ===
 *      'listwise' and every default statement without it (the silent-drop
 *      guard — a /MISSING the parser loses changes the numbers downstream);
 *   2. writes missing-syntax-params.json, the input compare-missing.R replays
 *      through the production R scripts against the real SPSS run.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  splitStatements,
  dispatchAnalysisStatement,
  type AnalysisRunRequest
} from '../../shared/spss-syntax-analysis'
import type { Variable } from '../../shared/data-types'

const HERE = __dirname

function variablesFromCsvHeader(csv: string): Variable[] {
  return (csv.split(/\r?\n/)[0] ?? '').split(',').map((name, i) => ({
    colId: `col_${i + 1}`,
    name: name.trim(),
    type: name.trim() === 'region' ? 'string' : 'numeric',
    width: 8,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'input'
  })) as Variable[]
}

interface Dispatched {
  command: string
  syntax: string
  listwise: boolean
  request: AnalysisRunRequest
}

async function dispatchMissingJob() {
  const sps = readFileSync(join(HERE, 'job-missing.sps'), 'utf8')
  const variables = variablesFromCsvHeader(readFileSync(join(HERE, 'data.csv'), 'utf8'))
  const dispatched: Dispatched[] = []
  const unhandled: string[] = []
  const errors: { syntax: string; key: string }[] = []

  for (const raw of splitStatements(sps)) {
    const captured: AnalysisRunRequest[] = []
    const result = await dispatchAnalysisStatement(raw, {
      variables,
      runAnalysis: async req => {
        captured.push(req)
      }
    })
    if (!result) {
      unhandled.push(raw.trim())
      continue
    }
    for (const entry of result.log) {
      if (entry.level === 'error') errors.push({ syntax: raw.trim(), key: entry.key })
    }
    const listwise = /\/MISSING\s*=?\s*LISTWISE/i.test(raw)
    for (const req of captured) {
      dispatched.push({
        command: result.statement.command,
        syntax: raw.trim().replace(/\s+/g, ' '),
        listwise,
        request: req
      })
    }
  }
  return { dispatched, unhandled, errors }
}

describe('missing-values dispatch (job-missing.sps)', () => {
  it('routes every analysis command without an error and writes missing-syntax-params.json', async () => {
    const { dispatched, unhandled, errors } = await dispatchMissingJob()
    expect(errors, `dispatch errors: ${JSON.stringify(errors)}`).toEqual([])
    const PLUMBING = /^\s*(SET|GET DATA|FORMATS|\*)/i
    const unexpected = unhandled.filter(s => !PLUMBING.test(s) && s.trim() !== '')
    expect(unexpected, `unrouted commands: ${JSON.stringify(unexpected)}`).toEqual([])
    expect(dispatched.length).toBeGreaterThan(0)
    writeFileSync(join(HERE, 'missing-syntax-params.json'), JSON.stringify(dispatched, null, 2))
  })

  it('/MISSING=LISTWISE reaches params as options.missing — never dropped', async () => {
    const { dispatched } = await dispatchMissingJob()
    for (const d of dispatched) {
      const missing = (d.request.params as { options?: { missing?: string } }).options?.missing
      // CORRELATIONS carries CorrelateOptions, whose `missing` field is
      // REQUIRED (a real dropdown default, "pairwise"), not a sparse
      // override like the other procedures here — the GUI dialog always
      // sends a concrete value too, so the syntax path matching that is
      // correct, not a dropped/invented key.
      if (d.request.analysisId === 'correlate') {
        expect(missing, `CORRELATIONS missing key: ${d.syntax}`).toBe(
          d.listwise ? 'listwise' : 'pairwise'
        )
      } else if (d.listwise) {
        expect(missing, `LISTWISE dropped: ${d.syntax}`).toBe('listwise')
      } else {
        expect(missing, `unexpected missing key: ${d.syntax}`).toBeUndefined()
      }
    }
    // The job pairs every procedure except OLAP CUBES (SPSS has no /MISSING
    // there — probe-missing.py), so the default runs outnumber LISTWISE by 1.
    const lw = dispatched.filter(d => d.listwise).length
    expect(lw).toBe((dispatched.length - 1) / 2)
  })
})
