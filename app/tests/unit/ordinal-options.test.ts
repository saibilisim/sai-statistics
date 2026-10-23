// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest'
import type { Variable } from '../../shared/data-types'
import { defaultOrdinalSettings, validOrdinalSettings } from '../../shared/ordinal-schema'
import { ordinalSyntax } from '../../src/lib/ordinal-syntax'
import { runOrdinal } from '../../shared/spss-syntax-analysis/handlers-plum'
import { splitStatements } from '../../shared/spss-syntax-analysis'
import { parseStatement } from '../../shared/spss-syntax-analysis/parsing'
const plumStatement = (syntax: string) => parseStatement(splitStatements(syntax)[0]!, ['PLUM'])

const variables = ['response', 'group', 'age'].map(
  (name, i): Variable => ({
    colId: `col_${i}`,
    name,
    type: 'numeric',
    width: 8,
    decimals: 0,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'input'
  })
)

describe('ordinal options and PLUM syntax', () => {
  it('round-trips every setting, factor, interaction and saved variable', async () => {
    const s = structuredClone(defaultOrdinalSettings)
    s.location = { mode: 'custom', terms: [['col_1'], ['col_2'], ['col_1', 'col_2']] }
    s.scale.terms = [['col_1']]
    s.options = {
      maxIterations: 50,
      maxStepHalving: 9,
      logLikelihood: 1e-8,
      parameter: 1e-5,
      ciLevel: 90,
      delta: 0.2,
      singularity: 1e-9,
      link: 'loglog'
    }
    s.output = {
      history: true,
      historyEvery: 3,
      goodnessOfFit: false,
      summary: false,
      estimates: true,
      correlations: true,
      covariances: true,
      cellInfo: true,
      parallelLines: true,
      includeConstant: false
    }
    const saved = {
      estimatedProbabilities: 'est',
      predictedGroup: 'grp',
      probability: 'prob',
      actualProbability: 'actual'
    }
    const syntax = ordinalSyntax([variables[0]!], [variables[2]!], [variables[1]!], s, saved)
    expect(syntax).toContain('/LINK=NLOGLOG')
    const runAnalysis = vi.fn(async () => {})
    const entries = await runOrdinal(plumStatement(syntax!), { variables, runAnalysis })
    expect(entries.some(e => e.level === 'error')).toBe(false)
    expect(runAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          settings: s,
          createVars: saved,
          factors: ['col_1'],
          covariates: ['col_2']
        })
      })
    )
  })

  it('permits thresholds-only models and validates removed terms', async () => {
    const s = structuredClone(defaultOrdinalSettings)
    s.location = { mode: 'custom', terms: [] }
    const syntax = ordinalSyntax([variables[0]!], [], [], s)
    expect(syntax).toContain('/LOCATION=')
    const runAnalysis = vi.fn(async () => {})
    await runOrdinal(plumStatement(syntax!), { variables, runAnalysis })
    expect(runAnalysis).toHaveBeenCalledOnce()
    s.scale.terms = [['missing']]
    expect(validOrdinalSettings(s, [])).toBe(false)
    expect(ordinalSyntax([variables[0]!], [], [], s)).toBeNull()
  })

  it.each([
    'PLUM response WITH age /CRITERIA=MXITER(-1).',
    'PLUM response WITH age /CRITERIA=CIN(100).',
    'PLUM response WITH age /SCALE=unknown.',
    'PLUM response WITH age /LINK=INVALID.',
    'PLUM response WITH age /PRINT=UNKNOWN.',
    'PLUM response WITH age /TEST=age.',
    'PLUM response WITH age /SAVE=ESTPROB(stem:2).'
  ])('rejects unsupported or invalid input without running: %s', async syntax => {
    const runAnalysis = vi.fn(async () => {})
    const entries = await runOrdinal(plumStatement(syntax), { variables, runAnalysis })
    expect(entries[0]?.level).toBe('error')
    expect(runAnalysis).not.toHaveBeenCalled()
  })
})
