// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from '@shared/analysis-types'
import type { Variable } from '@shared/data-types'
import {
  cfaOptionParams,
  defaultCfaOptions,
  efaToCfaAssignment
} from '../../src/analyses/dimension/cfa-options'

const v = (colId: string, name: string) => ({ colId, name }) as unknown as Variable
const vars = [v('c1', 'q1'), v('c2', 'q2'), v('c3', 'q3'), v('c4', 'q4'), v('c5', 'q5')]

const result = (tables: AnalysisResult['tables'], success = true): AnalysisResult =>
  ({ success, tables, plots: [], warnings: [], notes: [], caseVars: [] }) as AnalysisResult

const loadings = (titleKey: string, rows: (string | number | null)[][]) => ({
  titleKey,
  columns: ['output.col.variable', 'output.factor.factorHdr:1', 'output.factor.factorHdr:2'],
  rows,
  footnoteKey: null
})

describe('efaToCfaAssignment', () => {
  it('puts each item under its highest absolute loading, preferring the pattern matrix', () => {
    const blocks = [
      {
        analysisId: 'factor',
        result: result([
          loadings('output.factor.factorMatrixTitle', [
            ['q1', 0.1, 0.9],
            ['q2', 0.1, 0.9]
          ]),
          loadings('output.factor.patternMatrixTitle', [
            ['q1', 0.8, 0.1],
            ['q2', -0.7, 0.2],
            ['q3', 0.2, null],
            ['q4', 0.1, 0.6],
            ['q5', null, -0.5]
          ])
        ])
      }
    ]
    expect(efaToCfaAssignment(blocks, vars)).toEqual({
      factorCount: 2,
      assignment: [
        ['c1', 'c2', 'c3'],
        ['c4', 'c5']
      ]
    })
  })

  it('uses the newest successful Factor Analysis block and drops empty factors', () => {
    const blocks = [
      { analysisId: 'factor', result: result([], false) },
      { analysisId: 'roc', result: result([]) },
      {
        analysisId: 'factor',
        result: result([
          loadings('output.factor.rotatedMatrixTitle', [
            ['q1', 0.9, 0.1],
            ['q2', 0.8, 0.2],
            ['unknown', 0.1, 0.9]
          ])
        ])
      }
    ]
    expect(efaToCfaAssignment(blocks, vars)).toEqual({
      factorCount: 1,
      assignment: [['c1', 'c2']]
    })
  })

  it('returns null without a usable result', () => {
    expect(efaToCfaAssignment([], vars)).toBeNull()
    expect(efaToCfaAssignment([{ analysisId: 'factor', result: result([]) }], vars)).toBeNull()
  })
})

describe('cfaOptionParams', () => {
  it('keeps only error covariances between current items and parses the MI cut-off', () => {
    const p = cfaOptionParams(
      {
        ...defaultCfaOptions,
        errorCov: [
          ['c1', 'c2'],
          ['c1', 'gone']
        ],
        miMin: 'x'
      },
      ['c1', 'c2', 'c3']
    )
    expect(p.errorCov).toEqual([['c1', 'c2']])
    expect(p.miMin).toBe(3.84)
    expect(p.estimator).toBe('auto')
  })
})
