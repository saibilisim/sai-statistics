// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Feed the SPSS parity job's OWN syntax through our SPSS-syntax dispatcher.
 *
 * tests/spss-parity/job.sps is the file real SPSS executed to produce
 * spss-values.json. Parsing that same text with our dispatcher and emitting the
 * `{analysisId, scriptFile, params}` it would have run closes the loop: with
 * compare.R's SYNTAX section replaying those params through the production R
 * scripts, one run checks the statistics AND the syntax front-end that reaches
 * them.
 *
 * The dispatch path used here is the real one (`dispatchAnalysisStatement` from
 * @shared/spss-syntax-analysis, the same function ai-bridge.ts and the terminal
 * call); only `runAnalysis` is swapped for a recorder, since there is no
 * Electron IPC in a unit test.
 *
 * Writes syntax-params.json as a side effect. That file is an input to
 * compare.R, so this test must run before it — see README.
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

/**
 * Variables shaped as the app holds them: opaque colIds, display names.
 *
 * The weight/split/filter matrix in job.sps builds an alias of `score` per cell
 * with COMPUTE, so those names exist in SPSS's working file but not in the CSV.
 * They are appended here for the same reason: after a COMPUTE the app's dataset
 * would hold them too, and without them the dispatcher correctly — but
 * unhelpfully — reports every one of those commands as "unknown variables".
 */
const COMPUTED_IN_JOB = ['s_w', 's_f', 's_wf', 's_s', 's_ws', 's_fs', 's_wfs', 'a_w']

function variablesFromCsvHeader(csv: string): Variable[] {
  const header = [...(csv.split(/\r?\n/)[0] ?? '').split(','), ...COMPUTED_IN_JOB]
  return header.map((name, i) => ({
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
  request: AnalysisRunRequest
}

async function dispatchJob(): Promise<{
  dispatched: Dispatched[]
  unhandled: string[]
  errors: { syntax: string; key: string }[]
}> {
  const sps = readFileSync(join(HERE, 'job.sps'), 'utf8')
  const csv = readFileSync(join(HERE, 'data.csv'), 'utf8')
  const variables = variablesFromCsvHeader(csv)

  const dispatched: Dispatched[] = []
  const unhandled: string[] = []
  const errors: { syntax: string; key: string }[] = []

  for (const raw of splitStatements(sps)) {
    let captured: AnalysisRunRequest | null = null
    const result = await dispatchAnalysisStatement(raw, {
      variables,
      runAnalysis: async req => {
        captured = req
      }
    })
    if (!result) {
      unhandled.push(raw.trim())
      continue
    }
    for (const entry of result.log) {
      if (entry.level === 'error') errors.push({ syntax: raw.trim(), key: entry.key })
    }
    if (captured) {
      dispatched.push({
        command: result.statement.command,
        syntax: raw.trim().replace(/\s+/g, ' '),
        request: captured
      })
    }
  }
  return { dispatched, unhandled, errors }
}

describe('SPSS syntax dispatch of the parity job', () => {
  it('routes every analysis command in job.sps without an error', async () => {
    const { dispatched, unhandled, errors } = await dispatchJob()

    // MIXED is the one command in job.sps we knowingly cannot route: SPSS's
    // `MIXED score BY grp3 /FIXED=grp3` with no /RANDOM is a fixed-effects-only
    // model, and mixed-models.R requires a subject variable, so there is no
    // parameter set to send it. Listed explicitly rather than filtered by
    // pattern, so a NEW failure can never hide behind it.
    const KNOWN_UNSUPPORTED = ['MIXED']
    const realErrors = errors.filter(
      e => !KNOWN_UNSUPPORTED.some(cmd => e.syntax.toUpperCase().startsWith(cmd))
    )
    expect(realErrors, `dispatch errors: ${JSON.stringify(realErrors)}`).toEqual([])

    // The non-analysis lines: SET/GET DATA/FORMATS are data-plumbing for SPSS
    // itself and have no analysis to route. Anything else being unhandled
    // would mean a procedure silently vanished.
    // Two kinds of line legitimately have no ANALYSIS handler:
    //   * SET / GET DATA / FORMATS — data plumbing for SPSS itself;
    //   * COMPUTE / WEIGHT / FILTER / SPLIT FILE / SORT CASES / EXECUTE —
    //     commands that MUTATE the dataset or the view. Those are dispatched by
    //     the Renderer half (src/lib/spss-syntax.ts), which writes to the
    //     Zustand store; `dispatchAnalysisStatement` only knows the shared
    //     analysis registry, so it returns null for them by design. Their own
    //     coverage lives in tests/unit/spss-syntax.test.ts.
    const STATE_COMMANDS =
      /^\s*(SET|GET DATA|FORMATS|COMPUTE|EXECUTE|WEIGHT|FILTER|SPLIT FILE|SORT CASES|\*)/i
    const unexpected = unhandled.filter(s => !STATE_COMMANDS.test(s) && s.trim() !== '')
    expect(unexpected, `unrouted commands: ${JSON.stringify(unexpected)}`).toEqual([])

    const commands = dispatched.map(d => d.command)
    for (const expected of [
      'FREQUENCIES',
      'DESCRIPTIVES',
      'T-TEST',
      'ONEWAY',
      'CORRELATIONS',
      'NONPAR CORR',
      'CROSSTABS',
      'REGRESSION'
    ]) {
      expect(commands, `${expected} did not dispatch`).toContain(expected)
    }
    // T-TEST appears several times (groups / pairs / testval, plus the
    // weighted and filtered runs). Counted from the file rather than hard-coded
    // so adding a run to job.sps does not need this number edited too.
    const sps = readFileSync(join(HERE, 'job.sps'), 'utf8')
    const tTestsInJob = (sps.match(/^\s*T-TEST\b/gim) ?? []).length
    expect(commands.filter(c => c === 'T-TEST')).toHaveLength(tTestsInJob)

    writeFileSync(join(HERE, 'syntax-params.json'), JSON.stringify(dispatched, null, 2))
  })

  it('carries /STATISTICS from FREQUENCIES into the analysis params', async () => {
    // Regression test for a real defect: the handler hard-coded every
    // statistic to false, so this exact line produced a bare frequency table
    // and no Statistics table at all — silently, with a success message.
    const { dispatched } = await dispatchJob()
    const freq = dispatched.find(d => d.command === 'FREQUENCIES')
    expect(freq).toBeDefined()
    const opts = freq!.request.params.options as {
      showTable: boolean
      statistics: Record<string, unknown>
    }
    expect(opts.showTable, '/FORMAT=NOTABLE must suppress the frequency table').toBe(false)
    for (const key of [
      'mean',
      'median',
      'mode',
      'sd',
      'variance',
      'range',
      'min',
      'max',
      'semean',
      'sum',
      'skewness',
      'kurtosis'
    ]) {
      expect(opts.statistics[key], `/STATISTICS=${key} lost`).toBe(true)
    }
    expect(opts.statistics.percentiles).toBe(true)
    expect(opts.statistics.customPercentiles).toEqual([25, 50, 75, 90])
  })

  it('carries /STATISTICS from DESCRIPTIVES into the analysis params', async () => {
    const { dispatched } = await dispatchJob()
    const desc = dispatched.find(d => d.command === 'DESCRIPTIVES')
    expect(desc).toBeDefined()
    const opts = desc!.request.params.options as Record<string, unknown>
    for (const key of [
      'mean',
      'sd',
      'variance',
      'range',
      'min',
      'max',
      'seMean',
      'kurtosis',
      'skewness',
      'sum'
    ]) {
      expect(opts[key], `/STATISTICS=${key} lost`).toBe(true)
    }
  })

  it('carries /CELLS from MEANS into the analysis params', async () => {
    // Regression test for a real defect: the handler dropped /CELLS, so
    // `MEANS … /CELLS MEAN COUNT STDDEV MEDIAN MIN MAX RANGE SUM VARIANCE KURT
    // SKEW` produced the same three columns as a bare MEANS, with a success
    // message and no indication that eight statistics had gone missing.
    const { dispatched } = await dispatchJob()
    const withCells = dispatched.filter(d => {
      if (d.command !== 'MEANS') return false
      const cells = (d.request.params.options as { cells?: Record<string, boolean> })?.cells
      return Boolean(cells?.median)
    })
    expect(withCells.length, 'the extended MEANS run did not carry its cells').toBeGreaterThan(0)
    const cells = (withCells[0]!.request.params.options as { cells: Record<string, boolean> }).cells
    for (const key of [
      'mean',
      'n',
      'sd',
      'median',
      'min',
      'max',
      'range',
      'sum',
      'variance',
      'kurtosis',
      'skewness'
    ]) {
      expect(cells[key], `/CELLS ${key} lost`).toBe(true)
    }
    // And a run that asked for three cells must not acquire the rest.
    const plain = dispatched.find(
      d =>
        d.command === 'MEANS' &&
        !(d.request.params.options as { cells?: Record<string, boolean> })?.cells?.median
    )
    expect(plain, 'the default MEANS run vanished').toBeDefined()
    const plainCells = (plain!.request.params.options as { cells: Record<string, boolean> }).cells
    expect(plainCells.mean).toBe(true)
    expect(plainCells.variance).toBe(false)
  })

  it('carries /MODEL=SPLIT from RELIABILITY into the analysis params', async () => {
    const { dispatched } = await dispatchJob()
    const rel = dispatched.filter(d => d.command === 'RELIABILITY')
    expect(rel.length, 'RELIABILITY did not dispatch').toBeGreaterThan(0)
    const models = rel.map(d => (d.request.params.options as { model?: string }).model)
    expect(models, '/MODEL=SPLIT lost').toContain('split')
    // The ALPHA run must stay alpha: a handler that read any /MODEL as SPLIT
    // would satisfy the assertion above on its own.
    expect(models, 'the /MODEL=ALPHA run became something else').toContain('alpha')
  })

  it('resolves variable names to colIds, not to themselves', async () => {
    // The params that reach R must be colIds with a varNames map beside them;
    // a handler that passed the typed name straight through would still look
    // correct in a fixture whose columns happen to be named the same way.
    const { dispatched } = await dispatchJob()
    for (const d of dispatched) {
      const vars = d.request.params.variables
      if (!Array.isArray(vars)) continue
      for (const v of vars) expect(String(v)).toMatch(/^col_\d+$/)
    }
  })
})
