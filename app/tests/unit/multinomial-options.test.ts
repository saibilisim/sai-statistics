// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { defaultMultinomialSettings } from '../../shared/multinomial-types'
import { buildMultinomialSyntax } from '../../src/lib/multinomial-syntax'
import { validMultinomialSettings, validMultinomialTerms } from '../../src/lib/multinomial-settings'
import { dispatchMultinomial } from '../../shared/spss-syntax-analysis/handlers-multinomial'
import type { Variable } from '../../shared/data-types'

const variable = (name: string, colId: string): Variable => ({
  name,
  colId,
  label: '',
  type: 'numeric',
  measure: 'scale',
  role: 'input',
  width: 8,
  decimals: 2,
  columns: 8,
  align: 'right',
  missing: null,
  valueLabels: {}
})
const y = variable('outcome', 'col_1')
const x = variable('age', 'col_2')
const f = variable('group', 'col_3')
const vars = [y, x, f]

describe('multinomial subdialog settings and NOMREG', () => {
  it('round-trips the five windows through standard syntax', async () => {
    const settings = structuredClone(defaultMultinomialSettings)
    settings.model = {
      mode: 'custom',
      intercept: false,
      forced: [[f.colId]],
      stepped: [[x.colId], [f.colId, x.colId]],
      method: 'backwardStepwise'
    }
    settings.options = {
      scale: 'fixed',
      scaleValue: 2,
      entryProbability: 0.03,
      removalProbability: 0.08,
      entryTest: 'score',
      removalTest: 'wald',
      minEffects: 1,
      maxEffects: 3,
      hierarchy: 'containment'
    }
    settings.criteria = {
      maxIterations: 200,
      maxStepHalving: 8,
      logLikelihood: 0.00001,
      parameter: 0.000001,
      printHistory: true,
      historyEvery: 2,
      checkSeparation: true,
      separationStart: 10,
      delta: 0.2,
      singularity: 1e-9
    }
    settings.statistics = {
      ...settings.statistics,
      ciLevel: 90,
      classification: true,
      correlations: true,
      covariances: true,
      goodnessOfFit: true,
      cellProbabilities: true,
      monotonicity: true,
      informationCriteria: true,
      subpopulationMode: 'custom',
      subpopulations: [f.colId]
    }
    settings.exportModel = { path: "C:/Models/Mehmet's model.xml", covariance: false }
    const createVars = {
      estimatedProbabilities: 'est',
      predictedGroup: 'pred',
      probability: 'pre',
      actualProbability: 'act'
    }
    const syntax = buildMultinomialSyntax([y], [x], [f], settings, createVars, vars)
    expect(syntax).toContain('BY group WITH age')
    const runAnalysis = vi.fn().mockResolvedValue(undefined)
    const log = await dispatchMultinomial(
      { command: 'NOMREG', body: syntax!.slice(7, -1), raw: syntax! },
      { variables: vars, runAnalysis }
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(runAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          ...settings,
          createVars,
          factors: ['col_3'],
          covariates: ['col_2']
        })
      })
    )
  })

  it('defaults to the last category and round-trips custom references and order', async () => {
    expect(buildMultinomialSyntax([y], [x])).toContain('(BASE=LAST ORDER=ASCENDING)')
    const runAnalysis = vi.fn().mockResolvedValue(undefined)
    const cases = [
      [
        { category: 'first', customValue: '', order: 'descending' },
        '(BASE=FIRST ORDER=DESCENDING)'
      ],
      [{ category: 'custom', customValue: '2', order: 'ascending' }, '(BASE=2 ORDER=ASCENDING)'],
      [
        { category: 'custom', customValue: "it's", order: 'ascending' },
        "(BASE='it''s' ORDER=ASCENDING)"
      ]
    ] as const
    for (const [reference, expected] of cases) {
      const settings = {
        ...structuredClone(defaultMultinomialSettings),
        reference: { ...reference }
      }
      const syntax = buildMultinomialSyntax([y], [x], [], settings)!
      expect(syntax).toContain(expected)
      runAnalysis.mockClear()
      await dispatchMultinomial(
        { command: 'NOMREG', body: syntax.slice(7, -1), raw: syntax },
        { variables: vars, runAnalysis }
      )
      expect(runAnalysis.mock.calls[0]?.[0].params.reference).toEqual(reference)
    }
    const settings = structuredClone(defaultMultinomialSettings)
    settings.reference.category = 'custom'
    expect(validMultinomialSettings(settings)).toBe(false)
  })

  it('keeps full factorial and disabled print output in pasted syntax', async () => {
    const settings = structuredClone(defaultMultinomialSettings)
    settings.model.mode = 'factorial'
    const syntax = buildMultinomialSyntax([y], [x], [f], settings)!
    expect(syntax).toContain('/FULLFACTORIAL')
    const runAnalysis = vi.fn().mockResolvedValue(undefined)
    await dispatchMultinomial(
      { command: 'NOMREG', body: 'outcome BY group /PRINT=NONE', raw: '' },
      { variables: vars, runAnalysis }
    )
    expect(runAnalysis.mock.calls[0]?.[0].params.statistics).toMatchObject({
      estimates: false,
      caseSummary: false,
      modelFit: false,
      likelihoodRatio: false
    })
  })

  it('rejects unknown variables and unsupported subcommands before queuing', async () => {
    const runAnalysis = vi.fn()
    for (const body of ['outcome WITH absent', 'outcome WITH age /UNKNOWN=1']) {
      const log = await dispatchMultinomial(
        { command: 'NOMREG', body, raw: body },
        { variables: vars, runAnalysis }
      )
      expect(log.some(e => e.level === 'error')).toBe(true)
    }
    expect(runAnalysis).not.toHaveBeenCalled()
  })

  it('validates probability, convergence, confidence and subpopulation limits', () => {
    const settings = structuredClone(defaultMultinomialSettings)
    expect(validMultinomialSettings(settings)).toBe(true)
    settings.criteria.maxIterations = Number.NaN
    expect(validMultinomialSettings(settings)).toBe(false)
    settings.criteria.maxIterations = 100
    settings.options.entryProbability = 0.2
    expect(validMultinomialSettings(settings)).toBe(false)
    settings.options.entryProbability = 0.05
    settings.statistics.ciLevel = 100
    expect(validMultinomialSettings(settings)).toBe(false)
    settings.statistics.ciLevel = 95
    settings.statistics.subpopulationMode = 'custom'
    expect(validMultinomialSettings(settings)).toBe(false)
    settings.statistics.subpopulations = ['col_3']
    expect(validMultinomialSettings(settings)).toBe(true)
  })

  it('does not silently discard terms after an assigned variable is removed', () => {
    const model = {
      ...defaultMultinomialSettings.model,
      mode: 'custom' as const,
      forced: [['col_2', 'col_3']]
    }
    expect(validMultinomialTerms(model, ['col_2', 'col_3'])).toBe(true)
    expect(validMultinomialTerms(model, ['col_2'])).toBe(false)
  })
})
