// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSyntax, runSpssSyntax } from '../../src/lib/spss-syntax'
import { useDatasetStore } from '../../src/store/dataset-store'
import type { Variable } from '../../shared/data-types'

const v = (colId: string, name: string): Variable => ({
  colId,
  name,
  type: 'numeric',
  width: 8,
  decimals: 2,
  label: '',
  valueLabels: colId === 'col_3' ? { '1': 'A', '2': 'B' } : {},
  missing: null,
  columns: 8,
  align: 'right',
  measure: 'scale',
  role: 'input'
})
const y = v('col_1', 'score')
const x = v('col_2', 'age')
const g = v('col_3', 'grp')
const z = v('col_4', 'post')

// The Bayes dialogs' Paste Syntax: what each pasted command dispatches must be
// exactly the params the dialog's OK button sends (scenarios in
// e2e-paste-syntax.cjs check the same thing end to end, against R).
describe('BAYES paste syntax round-trips to the dialog params', () => {
  const analysisRun = vi.fn().mockResolvedValue({ jobId: 'job-1' })
  beforeEach(() => {
    analysisRun.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { analysis: { run: analysisRun } }
    } as unknown as Window
    useDatasetStore.setState({ datasetId: 'ds-1', variables: [y, x, g, z] })
  })
  const params = async (syntax: string | null) => {
    expect(syntax).toBeTruthy()
    const log = await runSpssSyntax(syntax!)
    expect(log.filter(e => e.level === 'error')).toEqual([])
    expect(analysisRun).toHaveBeenCalledTimes(1)
    return (analysisRun.mock.calls[0]?.[0] as { params: Record<string, unknown> }).params
  }

  it('independent samples, with a custom numeric width', async () => {
    const syntax = buildSyntax.bayesTtestInd([y, x], [g], '1', '2', 0.5)
    expect(syntax).toContain('/CRITERIA RSCALE=0.5')
    expect(await params(syntax)).toEqual({
      variables: ['col_1', 'col_2'],
      varNames: { col_1: 'score', col_2: 'age' },
      groupVar: 'col_3',
      groupName: 'grp',
      groupValueLabels: { '1': 'A', '2': 'B' },
      group1: '1',
      group2: '2',
      rscale: 0.5
    })
  })

  it('paired lists pair element-wise', async () => {
    expect(await params(buildSyntax.bayesTtestPaired([y, x], [z, g], 'wide'))).toEqual({
      var1: ['col_1', 'col_2'],
      var2: ['col_4', 'col_3'],
      varNames: { col_1: 'score', col_2: 'age', col_4: 'post', col_3: 'grp' },
      rscale: 'wide'
    })
  })

  it('one sample', async () => {
    expect(await params(buildSyntax.bayesTtest1([y], 50, 'ultrawide'))).toEqual({
      variables: ['col_1'],
      varNames: { col_1: 'score' },
      testValue: 50,
      rscale: 'ultrawide'
    })
  })

  it('ANOVA keeps every dependent', async () => {
    expect(await params(buildSyntax.bayesAnova([y, x], [g], 'medium'))).toEqual({
      variables: ['col_1', 'col_2'],
      varNames: { col_1: 'score', col_2: 'age' },
      factor: 'col_3',
      factorName: 'grp',
      rscale: 'medium'
    })
  })

  it('regression', async () => {
    expect(await params(buildSyntax.bayesRegression([y], [x, z], 'medium'))).toEqual({
      dependent: 'col_1',
      dependentName: 'score',
      independents: ['col_2', 'col_4'],
      varNames: { col_1: 'score', col_2: 'age', col_4: 'post' },
      rscale: 'medium'
    })
  })

  it('correlation', async () => {
    expect(await params(buildSyntax.bayesCorrelation([y, x, z], 1))).toEqual({
      variables: ['col_1', 'col_2', 'col_4'],
      varNames: { col_1: 'score', col_2: 'age', col_4: 'post' },
      rscale: 1
    })
  })
})

// The Chart dialogs' Paste Syntax (GRAPH / PPLOT) dispatches the chart the
// dialog's OK draws: `COUNT`/`MEAN`/`VALUE` are summary functions, not variables.
describe('chart paste syntax dispatches the dialog chart', () => {
  const analysisRun = vi.fn().mockResolvedValue({ jobId: 'job-1' })
  beforeEach(() => {
    analysisRun.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { analysis: { run: analysisRun } }
    } as unknown as Window
    useDatasetStore.setState({ datasetId: 'ds-1', variables: [y, x, g, z] })
  })
  const chart = async (syntax: string | null) => {
    expect(syntax).toBeTruthy()
    const log = await runSpssSyntax(syntax!)
    expect(log.filter(e => e.level === 'error')).toEqual([])
    const p = (analysisRun.mock.calls[0]?.[0] as { params: Record<string, unknown> }).params
    return [p.chartType, p.xVar, p.yVar, p.groupVar]
  }
  it.each([
    ['bar', [g], [], [], ['bar', 'col_3', undefined, undefined]],
    ['line', [y], [], [g], ['line', 'col_1', undefined, 'col_3']],
    ['line', [y], [], [], ['line', 'col_1', undefined, undefined]],
    ['scatter', [y], [x], [], ['scatter', 'col_1', 'col_2', undefined]],
    ['histogram', [y], [], [], ['histogram', 'col_1', undefined, undefined]],
    ['boxplot', [y], [], [g], ['boxplot', 'col_1', undefined, 'col_3']],
    ['pp', [y], [], [], ['pp', 'col_1', undefined, undefined]],
    ['qq', [y], [], [], ['qq', 'col_1', undefined, undefined]]
  ] as const)('%s', async (type, xs, ys, gs, expected) => {
    expect(await chart(buildSyntax.chart(type, [...xs], [...ys], [...gs]))).toEqual(expected)
  })
})

describe('chart options with a GRAPH keyword survive the paste', () => {
  const analysisRun = vi.fn().mockResolvedValue({ jobId: 'job-1' })
  beforeEach(() => {
    analysisRun.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { analysis: { run: analysisRun } }
    } as unknown as Window
    useDatasetStore.setState({ datasetId: 'ds-1', variables: [y, x, g, z] })
  })
  const options = async (syntax: string | null) => {
    await runSpssSyntax(syntax!)
    return (analysisRun.mock.calls[0]?.[0] as { params: { options?: unknown } }).params.options
  }
  it('bars as percentages: PCT BY x', async () => {
    const s = buildSyntax.chart('bar', [g], [], [], { represent: 'percent' })
    expect(s).toBe('GRAPH /BAR(SIMPLE)=PCT BY grp.')
    expect(await options(s)).toEqual({ represent: 'percent' })
  })
  it('histogram normal curve: HISTOGRAM(NORMAL)', async () => {
    const s = buildSyntax.chart('histogram', [y], [], [], { normalCurve: true })
    expect(s).toBe('GRAPH /HISTOGRAM(NORMAL)=score.')
    expect(await options(s)).toEqual({ normalCurve: true })
  })
  it('defaults send no options', async () => {
    expect(await options(buildSyntax.chart('bar', [g], [], [], { represent: 'count' }))).toBe(
      undefined
    )
  })
})
