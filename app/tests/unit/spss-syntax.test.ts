// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseSubcommand, buildSyntax, runSpssSyntax } from '../../src/lib/spss-syntax'
import { splitStatements } from '../../shared/spss-syntax-analysis'
import { useDatasetStore } from '../../src/store/dataset-store'
import type { Variable } from '../../shared/data-types'
import { defaultRegressionOptions } from '../../shared/regression-types'

function makeVariable(overrides: Partial<Variable>): Variable {
  return {
    colId: 'col_1',
    name: 'v1',
    type: 'numeric',
    width: 8,
    decimals: 2,
    label: '',
    valueLabels: {},
    missing: null,
    columns: 8,
    align: 'right',
    measure: 'scale',
    role: 'input',
    ...overrides
  }
}

describe('parseSubcommand', () => {
  it('returns null if the subcommand is not present', () => {
    const body = '/TABLES=v1 BY v2'
    expect(parseSubcommand(body, 'STATISTICS')).toBeNull()
    expect(parseSubcommand(body, 'CELLS')).toBeNull()
  })

  it('parses keywords separated by spaces', () => {
    const body = '/TABLES=v1 BY v2 /STATISTICS=CHISQUARE PHI'
    expect(parseSubcommand(body, 'STATISTICS')).toEqual(['CHISQUARE', 'PHI'])
  })

  it('parses keywords separated by commas', () => {
    const body = '/TABLES=v1 BY v2 /CELLS=COUNT,EXPECTED,ROW'
    expect(parseSubcommand(body, 'CELLS')).toEqual(['COUNT', 'EXPECTED', 'ROW'])
  })

  it('tolerates spaces around the equals sign', () => {
    const body = '/TABLES=v1 BY v2 /STATISTICS  =  CHISQUARE  PHI'
    expect(parseSubcommand(body, 'STATISTICS')).toEqual(['CHISQUARE', 'PHI'])
  })

  it('handles spaces without equals sign', () => {
    const body = '/TABLES=v1 BY v2 /STATISTICS CHISQUARE PHI'
    expect(parseSubcommand(body, 'STATISTICS')).toEqual(['CHISQUARE', 'PHI'])
  })

  it('converts keywords to uppercase', () => {
    const body = '/TABLES=v1 BY v2 /cells=count expected'
    expect(parseSubcommand(body, 'CELLS')).toEqual(['COUNT', 'EXPECTED'])
  })

  it('correctly stops matching at the next slash', () => {
    const body = '/TABLES=v1 BY v2 /STATISTICS=CHISQUARE PHI /CELLS=COUNT EXPECTED'
    expect(parseSubcommand(body, 'STATISTICS')).toEqual(['CHISQUARE', 'PHI'])
    expect(parseSubcommand(body, 'CELLS')).toEqual(['COUNT', 'EXPECTED'])
  })
})

describe('buildSyntax.crosstabs', () => {
  const rows = [{ name: 'gender' }]
  const cols = [{ name: 'passed' }]

  it('generates basic syntax when options are not provided', () => {
    const syntax = buildSyntax.crosstabs(rows, cols)
    expect(syntax).toBe('CROSSTABS /TABLES=gender BY passed.')
  })

  it('includes /STATISTICS and /CELLS when options are provided', () => {
    const options = {
      cells: {
        observed: true,
        expected: true,
        rowPct: false,
        colPct: false,
        totalPct: false,
        unstdResid: false,
        stdResid: false,
        adjResid: false
      },
      stats: {
        chisquare: true,
        phiCramer: true,
        contingency: false,
        correlations: false,
        gamma: false,
        somersd: false,
        taub: false,
        tauc: false,
        eta: false,
        kappa: false,
        risk: false,
        mcnemar: false
      }
    }
    const syntax = buildSyntax.crosstabs(rows, cols, options)
    expect(syntax).toBe(
      // CHISQ, not CHISQUARE: SPSS's own keyword, so the generated syntax is
      // valid in SPSS as well as here.
      'CROSSTABS /TABLES=gender BY passed\n' +
        '  /STATISTICS=CHISQ PHI\n' +
        '  /CELLS=COUNT EXPECTED.'
    )
  })
})

describe('buildSyntax.oneway', () => {
  const deps = [{ name: 'score1' }, { name: 'score2' }]
  const factor = [{ name: 'group' }]

  it('generates basic oneway syntax', () => {
    const syntax = buildSyntax.oneway(deps, factor)
    expect(syntax).toBe('ONEWAY score1 score2 BY group.')
  })

  it('generates oneway syntax with stats and posthoc options', () => {
    const options = {
      homogeneity: true,
      welch: true,
      tukey: true,
      bonferroni: false
    }
    const syntax = buildSyntax.oneway(deps, factor, options)
    expect(syntax).toBe(
      'ONEWAY score1 score2 BY group\n' +
        '  /STATISTICS=HOMOGENEITY WELCH\n' +
        '  /POSTHOC=TUKEY ALPHA(0.05).'
    )
  })

  it('generates oneway syntax with homogeneous-subset post hoc options', () => {
    const options = {
      homogeneity: false,
      welch: false,
      tukey: false,
      bonferroni: false,
      hochbergGT2: true,
      snk: true,
      duncan: true,
      regwQ: true,
      wallerDuncan: true
    }
    const syntax = buildSyntax.oneway(deps, factor, options)
    expect(syntax).toBe(
      'ONEWAY score1 score2 BY group\n' + '  /POSTHOC=GT2 SNK DUNCAN QREGW WALLER(100) ALPHA(0.05).'
    )
  })
})

describe('buildSyntax.ttest', () => {
  it('generates independent t-test syntax', () => {
    const vars = [{ name: 'salary' }, { name: 'age' }]
    const group = [{ name: 'gender' }]
    const syntax = buildSyntax.ttestInd(vars, group, '1', '2')
    expect(syntax).toBe('T-TEST GROUPS=gender(1 2) /VARIABLES=salary age.')
  })

  it('generates paired t-test syntax', () => {
    const vars1 = [{ name: 'pre' }, { name: 'mid' }]
    const vars2 = [{ name: 'post' }, { name: 'post2' }]
    const syntax = buildSyntax.ttestPaired(vars1, vars2)
    // SPSS's multi-pair form is paired LISTS, not repeated WITH clauses.
    expect(syntax).toBe('T-TEST PAIRS=pre mid WITH post post2 (PAIRED).')
  })

  it('generates one-sample t-test syntax', () => {
    const vars = [{ name: 'score' }]
    const syntax = buildSyntax.ttest1(vars, 50)
    expect(syntax).toBe('T-TEST /TESTVAL=50 /VARIABLES=score.')
  })
})

describe('buildSyntax.correlations', () => {
  it('generates correlations syntax with coefficient methods', () => {
    const vars = [{ name: 'age' }, { name: 'income' }]
    const methods = { pearson: true, spearman: true, kendall: false }
    const syntax = buildSyntax.correlations(vars, methods)
    // CORRELATIONS is Pearson-only in SPSS; rank coefficients are their own
    // command (NONPAR CORR), so a mixed selection pastes as two commands.
    expect(syntax).toBe(
      'CORRELATIONS /VARIABLES=age income.\n' +
        'NONPAR CORR VARIABLES=age income\n' +
        '  /PRINT=SPEARMAN.'
    )
  })

  it('generates /PRINT, /MISSING and /STATISTICS for the Options extensions', () => {
    const vars = [{ name: 'age' }, { name: 'income' }]
    const methods = { pearson: true, spearman: true, kendall: false }
    const syntax = buildSyntax.correlations(vars, methods, {
      missing: 'listwise',
      oneTailed: true,
      flagSignificant: false,
      meansAndSD: true,
      crossProduct: true
    })
    expect(syntax).toBe(
      'CORRELATIONS /VARIABLES=age income\n' +
        '  /PRINT=ONETAIL NOSIG\n' +
        '  /MISSING=LISTWISE\n' +
        '  /STATISTICS=DESCRIPTIVES XPROD.\n' +
        'NONPAR CORR VARIABLES=age income\n' +
        '  /PRINT=SPEARMAN ONETAIL NOSIG\n' +
        '  /MISSING=LISTWISE.'
    )
  })
})

describe('buildSyntax.regression', () => {
  it('generates linear regression syntax with statistics options', () => {
    const dep = [{ name: 'salary' }]
    const indeps = [{ name: 'age' }, { name: 'experience' }]
    const options = { ...defaultRegressionOptions, collinearity: true, durbinWatson: true }
    const syntax = buildSyntax.regression(dep, indeps, options)
    // /STATISTICS must precede /DEPENDENT (SPSS stops the command otherwise)
    // and, once written, has to re-name the default tables.
    expect(syntax).toBe(
      'REGRESSION\n' +
        '  /STATISTICS COEFF OUTS R ANOVA COLLIN TOL\n' +
        '  /DEPENDENT=salary\n' +
        '  /METHOD=ENTER age experience\n' +
        '  /RESIDUALS DURBIN.'
    )
  })

  it('generates syntax for the Statistics/Options/Plots extensions', () => {
    const dep = [{ name: 'salary' }]
    const indeps = [{ name: 'age' }, { name: 'experience' }]
    const options = {
      ...defaultRegressionOptions,
      confidenceIntervals: true,
      ciLevel: 90,
      rSquaredChange: true,
      descriptives: true,
      partialCorrelations: true,
      covarianceMatrix: true,
      includeConstant: false,
      missingMethod: 'mean' as const,
      casewiseDiagnostics: true,
      casewiseOutliersOnly: true,
      casewiseSD: 2,
      plots: {
        ...defaultRegressionOptions.plots,
        scatterY: 'ZRESID' as const,
        scatterX: 'DEPENDNT' as const,
        histogram: true,
        normalPP: true,
        partialPlots: true
      }
    }
    const syntax = buildSyntax.regression(dep, indeps, options)
    expect(syntax).toBe(
      'REGRESSION\n' +
        '  /MISSING MEANSUB\n' +
        '  /STATISTICS COEFF OUTS R ANOVA CI(90) CHANGE DESCRIPTIVES ZPP BCOV\n' +
        '  /ORIGIN\n' +
        '  /DEPENDENT=salary\n' +
        '  /METHOD=ENTER age experience\n' +
        '  /RESIDUALS HISTOGRAM(ZRESID) NORM(ZRESID)\n' +
        '  /CASEWISE OUTLIERS(2)\n' +
        '  /SCATTERPLOT=(*ZRESID,salary)\n' +
        '  /PARTIALPLOT ALL.'
    )
  })

  it('generates /METHOD and /CRITERIA for the stepwise methods', () => {
    const dep = [{ name: 'salary' }]
    const indeps = [{ name: 'age' }, { name: 'experience' }]

    const stepwiseProb = buildSyntax.regression(dep, indeps, {
      ...defaultRegressionOptions,
      method: 'stepwise'
    })
    expect(stepwiseProb).toBe(
      'REGRESSION\n' +
        '  /CRITERIA=PIN(0.05) POUT(0.1)\n' +
        '  /DEPENDENT=salary\n' +
        '  /METHOD=STEPWISE age experience.'
    )

    const forwardFvalue = buildSyntax.regression(dep, indeps, {
      ...defaultRegressionOptions,
      method: 'forward',
      criteria: { type: 'fvalue', entryProb: 0.05, removalProb: 0.1, entryF: 4, removalF: 2 }
    })
    expect(forwardFvalue).toBe(
      'REGRESSION\n' +
        '  /CRITERIA=FIN(4) FOUT(2)\n' +
        '  /DEPENDENT=salary\n' +
        '  /METHOD=FORWARD age experience.'
    )

    const backward = buildSyntax.regression(dep, indeps, {
      ...defaultRegressionOptions,
      method: 'backward'
    })
    expect(backward).toBe(
      'REGRESSION\n' +
        '  /CRITERIA=PIN(0.05) POUT(0.1)\n' +
        '  /DEPENDENT=salary\n' +
        '  /METHOD=BACKWARD age experience.'
    )
  })
})

describe('buildSyntax.nparKruskalWallis', () => {
  it('defaults to /K-W only, no Statistics clause', () => {
    const vars = [{ name: 'score' }]
    const factor = [{ name: 'grp' }]
    const syntax = buildSyntax.nparKruskalWallis(vars, factor)
    expect(syntax).toBe('NPAR TESTS /K-W=score BY grp(1 99).')
  })

  it('emits one subcommand per selected Test Type plus /STATISTICS', () => {
    const vars = [{ name: 'score' }]
    const factor = [{ name: 'grp' }]
    const syntax = buildSyntax.nparKruskalWallis(
      vars,
      factor,
      'listwise',
      undefined,
      undefined,
      { kruskalWallis: true, median: true, jonckheereTerpstra: true },
      { descriptives: true, quartiles: true }
    )
    expect(syntax).toBe(
      'NPAR TESTS /K-W=score BY grp(1 99)\n' +
        '  /MEDIAN=score BY grp(1 99)\n' +
        '  /J-T=score BY grp(1 99)\n' +
        '  /STATISTICS=DESCRIPTIVES QUARTILES\n' +
        '  /MISSING=LISTWISE.'
    )
  })

  it('returns null when every Test Type is unchecked', () => {
    const vars = [{ name: 'score' }]
    const factor = [{ name: 'grp' }]
    const syntax = buildSyntax.nparKruskalWallis(vars, factor, undefined, undefined, undefined, {
      kruskalWallis: false,
      median: false,
      jonckheereTerpstra: false
    })
    expect(syntax).toBeNull()
  })
})

describe('runSpssSyntax — ctx staleness (real bug regression)', () => {
  const analysisRun = vi.fn().mockResolvedValue({ jobId: 'job-1' })
  const variableUpdate = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    analysisRun.mockClear()
    variableUpdate.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: {
        analysis: { run: analysisRun },
        variable: { update: variableUpdate }
      }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [makeVariable({ colId: 'col_1', name: 'yas' })]
    })
  })

  it('sees a variable renamed by an earlier statement in the same script', async () => {
    const log = await runSpssSyntax('RENAME VARIABLES (yas=age).\nFREQUENCIES age.')

    expect(log.some(e => e.key === 'terminal.log.unknownVars')).toBe(false)
    expect(analysisRun).toHaveBeenCalledTimes(1)
    const call = analysisRun.mock.calls[0]?.[0] as { params: { variables: string[] } }
    expect(call.params.variables).toEqual(['col_1'])
  })
})

describe('runSpssSyntax — VARIABLE LABELS / VALUE LABELS / MISSING VALUES', () => {
  const variableUpdate = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    variableUpdate.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { variable: { update: variableUpdate } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [makeVariable({ colId: 'col_1', name: 'age' })]
    })
  })

  it('sets a variable label', async () => {
    const log = await runSpssSyntax("VARIABLE LABELS age 'Age in years'.")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(variableUpdate).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      colId: 'col_1',
      updates: { label: 'Age in years' }
    })
    expect(useDatasetStore.getState().variables[0]?.label).toBe('Age in years')
  })

  it('sets value labels', async () => {
    const log = await runSpssSyntax("VALUE LABELS age 1 'Under 18' 2 'Adult'.")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.valueLabels).toEqual({
      '1': 'Under 18',
      '2': 'Adult'
    })
  })

  it('accepts double-quoted labels, not just single-quoted (real bug regression)', async () => {
    // The value side of the pair regex already accepted '...'/"...", but the
    // label side was hardcoded to '...' only — VALUE LABELS etyoloji_4grup 1
    // "Viral" 2 "Otoimmün" ... matched zero pairs and the whole command
    // rejected as a syntax error, even though VARIABLE LABELS' own
    // double-quoted argument worked fine right above it in the same script.
    const log = await runSpssSyntax('VALUE LABELS age 1 "Under 18" 2 "Adult".')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.valueLabels).toEqual({
      '1': 'Under 18',
      '2': 'Adult'
    })
  })

  it('applies the same value labels to a list of variables sharing one group (no "/")', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'karin_agrisi_1v_0y' }),
        makeVariable({ colId: 'col_2', name: 'ikter_1v_0y' }),
        makeVariable({ colId: 'col_3', name: 'siroz_1v_0y' })
      ]
    })
    const log = await runSpssSyntax(
      "VALUE LABELS karin_agrisi_1v_0y ikter_1v_0y siroz_1v_0y 0 'Yok' 1 'Var'."
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    for (const v of useDatasetStore.getState().variables) {
      expect(v.valueLabels).toEqual({ '0': 'Yok', '1': 'Var' })
    }
    expect(variableUpdate).toHaveBeenCalledTimes(3)
  })

  it('sets discrete missing values', async () => {
    const log = await runSpssSyntax('MISSING VALUES age (9, 99).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.missing).toEqual({
      type: 'discrete',
      discrete: ['9', '99']
    })
  })

  it('sets a range for missing values', async () => {
    const log = await runSpssSyntax('MISSING VALUES age (90 THRU 99).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.missing).toEqual({
      type: 'range',
      rangeLow: 90,
      rangeHigh: 99
    })
  })

  it('applies the same missing-values spec to a list of variables sharing one group', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'v1' }),
        makeVariable({ colId: 'col_2', name: 'v2' })
      ]
    })
    const log = await runSpssSyntax('MISSING VALUES v1 v2 (9, 99).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    for (const v of useDatasetStore.getState().variables) {
      expect(v.missing).toEqual({ type: 'discrete', discrete: ['9', '99'] })
    }
    expect(variableUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('runSpssSyntax — RANK / AUTORECODE apply to every listed variable', () => {
  const rankCases = vi.fn()
  const autoRecode = vi.fn()

  beforeEach(() => {
    rankCases.mockClear()
    autoRecode.mockClear()
    rankCases.mockImplementation(({ targetName }: { targetName: string }) =>
      Promise.resolve({
        variables: [makeVariable({ colId: `col_${targetName}`, name: targetName })],
        rowCount: 0
      })
    )
    autoRecode.mockImplementation(({ targetName }: { targetName: string }) =>
      Promise.resolve({
        variables: [makeVariable({ colId: `col_${targetName}`, name: targetName })],
        rowCount: 0
      })
    )
    ;(globalThis as unknown as { window: Window }).window = {
      api: { transform: { rankCases, autoRecode } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'v1' }),
        makeVariable({ colId: 'col_2', name: 'v2' })
      ]
    })
  })

  it('ranks every variable in VARIABLES=, not just the first', async () => {
    const log = await runSpssSyntax('RANK VARIABLES=v1 v2 (A).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(rankCases).toHaveBeenCalledTimes(2)
    expect(rankCases).toHaveBeenCalledWith(expect.objectContaining({ targetName: 'v1_rank' }))
    expect(rankCases).toHaveBeenCalledWith(expect.objectContaining({ targetName: 'v2_rank' }))
  })

  it('autorecodes every variable paired positionally with /INTO names', async () => {
    const log = await runSpssSyntax('AUTORECODE VARIABLES=v1 v2 /INTO n1 n2.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(autoRecode).toHaveBeenCalledTimes(2)
    expect(autoRecode).toHaveBeenCalledWith(
      expect.objectContaining({ sourceColId: 'col_1', targetName: 'n1' })
    )
    expect(autoRecode).toHaveBeenCalledWith(
      expect.objectContaining({ sourceColId: 'col_2', targetName: 'n2' })
    )
  })

  it('rejects AUTORECODE when the /INTO count does not match the variable count', async () => {
    const log = await runSpssSyntax('AUTORECODE VARIABLES=v1 v2 /INTO n1.')
    expect(log.some(e => e.level === 'error')).toBe(true)
    expect(autoRecode).not.toHaveBeenCalled()
  })
})

describe('runSpssSyntax — RECODE with THRU ranges', () => {
  const recode = vi
    .fn()
    .mockResolvedValue({ variables: [makeVariable({ colId: 'col_1', name: 'age' })], rowCount: 0 })

  beforeEach(() => {
    recode.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { transform: { recode } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [makeVariable({ colId: 'col_1', name: 'age' })]
    })
  })

  it('parses a THRU range mapping instead of rejecting it', async () => {
    const log = await runSpssSyntax('RECODE age (18 THRU 65=1)(ELSE=0).')
    expect(log.some(e => e.key === 'terminal.log.recodeRange')).toBe(false)
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(recode).toHaveBeenCalledWith(
      expect.objectContaining({
        rangeMappings: [{ low: 18, high: 65, newValue: '1' }],
        elseValue: '0'
      })
    )
  })

  it('ELSE=SYSMIS sets elseSysmis, not an empty-string elseValue (real bug regression)', async () => {
    // DuckDB rejected CAST('' AS DOUBLE) the moment any row actually fell
    // through to ELSE on a numeric target — RECODE etyoloji_6li (1=1)(2=2)
    // (3=3)(5=4)(ELSE=SYSMIS) INTO etyoloji_4grup failed outright with
    // "Could not convert string '' to DOUBLE" (electron/ipc/db-handler/
    // transform-handlers.ts's ELSE clause used to bind that '' straight into
    // the CASE expression instead of emitting SQL NULL).
    const log = await runSpssSyntax('RECODE age (18 THRU 65=1)(ELSE=SYSMIS).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(recode).toHaveBeenCalledWith(
      expect.objectContaining({
        elseValue: null,
        elseSysmis: true
      })
    )
  })

  it('applies the same mapping rules to a list of source variables (in place, no INTO)', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'v1' }),
        makeVariable({ colId: 'col_2', name: 'v2' })
      ]
    })
    const log = await runSpssSyntax("RECODE v1 v2 (1='A')(2='B').")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(recode).toHaveBeenCalledTimes(2)
    expect(recode).toHaveBeenCalledWith(
      expect.objectContaining({ sourceColId: 'col_1', targetColId: 'col_1' })
    )
    expect(recode).toHaveBeenCalledWith(
      expect.objectContaining({ sourceColId: 'col_2', targetColId: 'col_2' })
    )
  })

  it('pairs multiple source variables with /INTO names positionally', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'v1' }),
        makeVariable({ colId: 'col_2', name: 'v2' })
      ]
    })
    const log = await runSpssSyntax("RECODE v1 v2 (1='A')(2='B') INTO n1 n2.")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(recode).toHaveBeenCalledWith(
      expect.objectContaining({ sourceColId: 'col_1', targetColId: null, targetName: 'n1' })
    )
    expect(recode).toHaveBeenCalledWith(
      expect.objectContaining({ sourceColId: 'col_2', targetColId: null, targetName: 'n2' })
    )
  })

  it('rejects RECODE when the INTO count does not match the variable count', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'v1' }),
        makeVariable({ colId: 'col_2', name: 'v2' })
      ]
    })
    const log = await runSpssSyntax("RECODE v1 v2 (1='A')(2='B') INTO n1.")
    expect(log.some(e => e.level === 'error')).toBe(true)
    expect(recode).not.toHaveBeenCalled()
  })
})

describe('runSpssSyntax — SORT CASES with multiple keys', () => {
  const sortMulti = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    sortMulti.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { data: { sortMulti } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'grp' }),
        makeVariable({ colId: 'col_2', name: 'age' })
      ]
    })
  })

  it('sorts by every listed key, not just the first, with per-key direction', async () => {
    const log = await runSpssSyntax('SORT CASES BY grp (A) age (D).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(sortMulti).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      keys: [
        { colId: 'col_1', direction: 'asc' },
        { colId: 'col_2', direction: 'desc' }
      ]
    })
  })

  it('defaults an unmarked key to ascending', async () => {
    const log = await runSpssSyntax('SORT CASES BY grp age (D).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(sortMulti).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      keys: [
        { colId: 'col_1', direction: 'asc' },
        { colId: 'col_2', direction: 'desc' }
      ]
    })
  })
})

describe('splitStatements — SPSS comments', () => {
  it('does not let an apostrophe in a comment swallow the rest of the file', () => {
    // Found by running tests/spss-parity/job.sps through the dispatcher: the
    // unpaired apostrophe in "SPSS's" opened a string that never closed, so
    // every command after it was absorbed into one chunk — and because that
    // chunk began with the comment's "*", it was dropped as a comment. Eight
    // procedures vanished with no error and no output.
    const text = [
      "* Enough decimals that this is not limited by SPSS's display format.",
      'FREQUENCIES VARIABLES=age.',
      'DESCRIPTIVES VARIABLES=score.'
    ].join('\n')
    expect(splitStatements(text)).toEqual([
      'FREQUENCIES VARIABLES=age',
      'DESCRIPTIVES VARIABLES=score'
    ])
  })

  it('treats a multi-line comment as one comment, not as stray statements', () => {
    // A comment is a COMMAND running to its terminating "." — a sentence
    // ending mid-comment used to split it, and every piece after the first no
    // longer started with "*", so it surfaced as "Unrecognized command".
    const text = [
      '* This runs in a Turkish locale, where the separator is a comma.',
      '* Without SET DECIMAL=DOT the import is rejected. DOT also makes',
      '* the output use dots, which the parser then reads unambiguously.',
      'FREQUENCIES VARIABLES=age.'
    ].join('\n')
    expect(splitStatements(text)).toEqual(['FREQUENCIES VARIABLES=age'])
  })

  it('keeps an apostrophe inside a real quoted label intact', () => {
    // The newline reset must not weaken quoting WITHIN a line.
    expect(splitStatements("VALUE LABELS status 1 'Bitti. Tamam'.")).toEqual([
      "VALUE LABELS status 1 'Bitti. Tamam'"
    ])
  })
})

describe('splitStatements — Markdown code-fence lines pasted from an AI reply', () => {
  it('strips ``` and ```spss fence lines instead of surfacing them as statements', () => {
    const text = [
      '```spss',
      'RECODE age (LO THRU 45=0) (46 THRU HI=1) INTO age_grp.',
      "VALUE LABELS age_grp 0 'low' 1 'high'.",
      '```'
    ].join('\n')
    expect(splitStatements(text)).toEqual([
      'RECODE age (LO THRU 45=0) (46 THRU HI=1) INTO age_grp',
      "VALUE LABELS age_grp 0 'low' 1 'high'"
    ])
  })
})

describe('runSpssSyntax — quote-aware statement/subcommand splitting (real bug regression)', () => {
  const variableUpdate = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    variableUpdate.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { variable: { update: variableUpdate } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'status' }),
        makeVariable({ colId: 'col_2', name: 'age' })
      ]
    })
  })

  it('does not split a statement on a "." inside a quoted label followed by whitespace', async () => {
    // Without quote-awareness, splitStatements breaks right after "Tamamlandı."
    // (a "." followed by a space looks exactly like a statement terminator),
    // truncating the command and losing the second value/label pair.
    const log = await runSpssSyntax("VALUE LABELS status 1 'Tamamlandı.' 2 'Sürüyor'.")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.valueLabels).toEqual({
      '1': 'Tamamlandı.',
      '2': 'Sürüyor'
    })
  })

  it('does not treat a "/" inside a quoted label as a subcommand boundary', async () => {
    // Without quote-awareness, the group-split on '/' in runValueLabels would
    // cut "Active/Inactive" into two bogus groups.
    const log = await runSpssSyntax("VALUE LABELS status 1 'Active/Inactive'.")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.valueLabels).toEqual({
      '1': 'Active/Inactive'
    })
  })

  it('still splits multiple statements on separate "."-terminators correctly', async () => {
    const log = await runSpssSyntax(
      "VARIABLE LABELS status 'Case status'.\nVARIABLE LABELS age 'Age in years'."
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(variableUpdate).toHaveBeenCalledTimes(2)
    expect(useDatasetStore.getState().variables[0]?.label).toBe('Case status')
    expect(useDatasetStore.getState().variables[1]?.label).toBe('Age in years')
  })

  it('still parses multiple VALUE LABELS groups separated by a real top-level "/"', async () => {
    const log = await runSpssSyntax("VALUE LABELS status 1 'A' 2 'B' /age 0 'Zero' 1 'One'.")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[0]?.valueLabels).toEqual({ '1': 'A', '2': 'B' })
    expect(useDatasetStore.getState().variables[1]?.valueLabels).toEqual({
      '0': 'Zero',
      '1': 'One'
    })
  })

  it('does not split a decimal number as a statement terminator', async () => {
    const log = await runSpssSyntax('MISSING VALUES age (9, 99).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().variables[1]?.missing).toEqual({
      type: 'discrete',
      discrete: ['9', '99']
    })
  })
})

describe('runSpssSyntax — Faz T3 statistical-command expansion', () => {
  const analysisRun = vi.fn().mockResolvedValue({ jobId: 'job-1' })

  beforeEach(() => {
    analysisRun.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { analysis: { run: analysisRun } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      variables: [
        makeVariable({ colId: 'col_1', name: 'appraise' }),
        makeVariable({ colId: 'col_2', name: 'price' }),
        makeVariable({ colId: 'col_3', name: 'group' }),
        makeVariable({ colId: 'col_4', name: 'survtime' }),
        makeVariable({ colId: 'col_5', name: 'status' }),
        makeVariable({ colId: 'col_6', name: 'z' }),
        makeVariable({ colId: 'col_7', name: 'outcome' }),
        makeVariable({ colId: 'col_8', name: 'seed' }),
        makeVariable({ colId: 'col_9', name: 'fert' }),
        makeVariable({ colId: 'col_10', name: 'yield' }),
        makeVariable({ colId: 'col_11', name: 'sexrace' })
      ]
    })
  })

  it('RATIO STATISTICS numerator WITH denominator', async () => {
    const log = await runSpssSyntax('RATIO STATISTICS appraise WITH price.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'ratio',
        scriptFile: 'ratio.R',
        params: expect.objectContaining({
          numerator: 'col_1',
          denominator: 'col_2',
          group: null
        })
      })
    )
  })

  it('COXREG survival WITH covariate /STATUS=status EVENT(1)', async () => {
    const log = await runSpssSyntax('COXREG survtime WITH z /STATUS survtime2 EVENT(1).')
    // survtime2 is unknown on purpose to exercise the error path first —
    // replace with the real status var for the success path below.
    expect(log.some(e => e.key === 'terminal.log.unknownVars')).toBe(true)

    analysisRun.mockClear()
    const log2 = await runSpssSyntax('COXREG survtime WITH z /STATUS status EVENT(1).')
    expect(log2.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'survivalCox',
        scriptFile: 'survival-cox.R',
        params: expect.objectContaining({
          timeVar: 'col_4',
          statusVar: 'col_5',
          eventValue: '1',
          covariates: ['col_6']
        })
      })
    )
  })

  it('KM time BY factor /STATUS=status EVENT(1)', async () => {
    const log = await runSpssSyntax('KM survtime BY sexrace /STATUS=status EVENT(1).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'survivalKM',
        params: expect.objectContaining({
          timeVar: 'col_4',
          statusVar: 'col_5',
          eventValue: '1',
          factor: 'col_11'
        })
      })
    )
  })

  it('LOGISTIC REGRESSION VARIABLES=dep WITH covariates', async () => {
    const log = await runSpssSyntax('LOGISTIC REGRESSION VARIABLES = outcome WITH z, price.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'logistic',
        params: expect.objectContaining({ dependent: 'col_7', covariates: ['col_6', 'col_2'] })
      })
    )
  })

  it('LOGISTIC REGRESSION with Options round-trip (CLASSPLOT/CASEWISE/PRINT/ORIGIN/CRITERIA)', async () => {
    const log = await runSpssSyntax(
      'LOGISTIC REGRESSION VARIABLES=outcome\n' +
        '  /METHOD=ENTER z price\n' +
        '  /CLASSPLOT\n' +
        '  /CASEWISE OUTLIER(2)\n' +
        '  /PRINT=GOODFIT CORR ITER CI(90)\n' +
        '  /ORIGIN\n' +
        '  /CRITERIA=CUT(.4) ITERATE(30).'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'logistic',
        params: expect.objectContaining({
          dependent: 'col_7',
          covariates: ['col_6', 'col_2'],
          options: expect.objectContaining({
            classificationPlots: true,
            hosmerLemeshow: true,
            correlation: true,
            iterationHistory: true,
            ciExpB: true,
            ciLevel: 90,
            casewiseListing: true,
            casewiseOutliersOnly: true,
            casewiseThreshold: 2,
            includeConstant: false,
            classificationCutoff: 0.4,
            maxIterations: 30
          })
        })
      })
    )
  })

  it('CORRELATIONS with /PRINT, /MISSING and /STATISTICS round-trip', async () => {
    const log = await runSpssSyntax(
      'CORRELATIONS /VARIABLES=appraise price\n' +
        '  /PRINT=ONETAIL NOSIG\n' +
        '  /MISSING=LISTWISE\n' +
        '  /STATISTICS=DESCRIPTIVES XPROD.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'correlate',
        params: expect.objectContaining({
          variables: ['col_1', 'col_2'],
          methods: { pearson: true, spearman: false, kendall: false },
          options: expect.objectContaining({
            missing: 'listwise',
            oneTailed: true,
            flagSignificant: false,
            meansAndSD: true,
            crossProduct: true
          })
        })
      })
    )
  })

  it('NONPAR CORR with /PRINT round-trip (SPEARMAN + ONETAIL)', async () => {
    const log = await runSpssSyntax(
      'NONPAR CORR VARIABLES=appraise price\n  /PRINT=SPEARMAN ONETAIL.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'correlate',
        params: expect.objectContaining({
          methods: { pearson: false, spearman: true, kendall: false },
          options: expect.objectContaining({
            oneTailed: true,
            flagSignificant: true,
            missing: 'pairwise'
          })
        })
      })
    )
  })

  it('NPAR TESTS /K-W /MEDIAN /J-T round-trip (combined Test Type + Statistics)', async () => {
    const log = await runSpssSyntax(
      'NPAR TESTS /K-W=fert BY group(1 3)\n' +
        '  /MEDIAN=fert BY group(1 3)\n' +
        '  /J-T=fert BY group(1 3)\n' +
        '  /STATISTICS=DESCRIPTIVES QUARTILES\n' +
        '  /MISSING=LISTWISE.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    // Three separate subcommands dispatch three separate runs (see the
    // handler's doc comment) — each with only ONE Test Type flag set.
    expect(analysisRun).toHaveBeenCalledTimes(3)
    const calls = analysisRun.mock.calls.map(c => c[0] as { params: { options: unknown } })
    const testTypes = calls.map(c => (c.params.options as { testType: unknown }).testType)
    expect(testTypes).toContainEqual({
      kruskalWallis: true,
      median: false,
      jonckheereTerpstra: false
    })
    expect(testTypes).toContainEqual({
      kruskalWallis: false,
      median: true,
      jonckheereTerpstra: false
    })
    expect(testTypes).toContainEqual({
      kruskalWallis: false,
      median: false,
      jonckheereTerpstra: true
    })
    for (const c of calls) {
      expect(c.params).toEqual(
        expect.objectContaining({
          variables: ['col_9'],
          factor: 'col_3',
          options: expect.objectContaining({
            missing: 'listwise',
            descriptives: true,
            quartiles: true
          })
        })
      )
    }
  })

  it('REGRESSION with Statistics/Options/Plots round-trip (CI/CASEWISE/ORIGIN/MISSING/SCATTERPLOT/PARTIALPLOT)', async () => {
    const log = await runSpssSyntax(
      'REGRESSION\n' +
        '  /MISSING MEANSUB\n' +
        '  /STATISTICS COEFF OUTS R ANOVA CI(90) CHANGE DESCRIPTIVES ZPP BCOV\n' +
        '  /ORIGIN\n' +
        '  /DEPENDENT=appraise\n' +
        '  /METHOD=ENTER price group\n' +
        '  /RESIDUALS HISTOGRAM(ZRESID) NORM(ZRESID)\n' +
        '  /CASEWISE OUTLIERS(2)\n' +
        '  /SCATTERPLOT=(*ZRESID,appraise)\n' +
        '  /PARTIALPLOT ALL.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'regression',
        params: expect.objectContaining({
          dependent: 'col_1',
          independents: ['col_2', 'col_3'],
          options: expect.objectContaining({
            confidenceIntervals: true,
            ciLevel: 90,
            rSquaredChange: true,
            descriptives: true,
            partialCorrelations: true,
            covarianceMatrix: true,
            includeConstant: false,
            missingMethod: 'mean',
            casewiseDiagnostics: true,
            casewiseOutliersOnly: true,
            casewiseSD: 2,
            plots: expect.objectContaining({
              scatterY: 'ZRESID',
              scatterX: 'DEPENDNT',
              histogram: true,
              normalPP: true,
              partialPlots: true
            })
          })
        })
      })
    )
  })

  it('REGRESSION /METHOD=STEPWISE with /CRITERIA=FIN/FOUT round-trip', async () => {
    const log = await runSpssSyntax(
      'REGRESSION\n' +
        '  /CRITERIA=FIN(4) FOUT(3.9)\n' +
        '  /DEPENDENT=appraise\n' +
        '  /METHOD=STEPWISE price group.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'regression',
        params: expect.objectContaining({
          dependent: 'col_1',
          independents: ['col_2', 'col_3'],
          options: expect.objectContaining({
            method: 'stepwise',
            criteria: {
              type: 'fvalue',
              entryF: 4,
              removalF: 3.9,
              entryProb: 0.05,
              removalProb: 0.1
            }
          })
        })
      })
    )
  })

  it('REGRESSION /METHOD=FORWARD with default (probability) /CRITERIA', async () => {
    const log = await runSpssSyntax(
      'REGRESSION\n  /DEPENDENT=appraise\n  /METHOD=FORWARD price group.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'regression',
        params: expect.objectContaining({
          options: expect.objectContaining({
            method: 'forward',
            criteria: {
              type: 'prob',
              entryProb: 0.05,
              removalProb: 0.1,
              entryF: 3.84,
              removalF: 2.71
            }
          })
        })
      })
    )
  })

  it('CURVEFIT with multiple dependents, Time mode and Options round-trip', async () => {
    const log = await runSpssSyntax(
      'CURVEFIT /VARIABLES=outcome z\n' +
        '  /CONSTANT\n' +
        '  /MODEL=LINEAR QUADRATIC LOGISTIC\n' +
        '  /UPPERBOUND=100\n' +
        '  /PLOT FIT\n' +
        '  /PRINT ANOVA.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'curve',
        params: expect.objectContaining({
          dependents: ['col_7', 'col_6'],
          independentMode: 'time',
          includeConstant: true,
          plotModels: true,
          displayAnova: true,
          logisticUpperBound: 100,
          models: expect.objectContaining({ linear: true, quadratic: true, logistic: true })
        })
      })
    )
  })

  it('CURVEFIT VARIABLES=dep WITH indep /ID=label /NOCONSTANT', async () => {
    const log = await runSpssSyntax(
      'CURVEFIT /VARIABLES=outcome WITH z\n  /ID=price\n  /NOCONSTANT\n  /MODEL=LINEAR.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'curve',
        params: expect.objectContaining({
          dependents: ['col_7'],
          independentMode: 'variable',
          independent: 'col_6',
          caseLabels: 'col_2',
          includeConstant: false,
          plotModels: false,
          displayAnova: false
        })
      })
    )
  })

  it('PROBIT respFreq OF total WITH covariate BY factor(min,max) with Options round-trip', async () => {
    const log = await runSpssSyntax(
      'PROBIT outcome OF appraise WITH z BY group(1,2)\n' +
        '  /MODEL=LOGIT\n' +
        '  /TRANSFORM=LOG10\n' +
        '  /PRINT=FREQ CI PARALLEL\n' +
        '  /NATRES=VALUE(0.05)\n' +
        '  /CRITERIA=ITERATE(30) SIG(0.1).'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'probit',
        params: expect.objectContaining({
          responseFreq: 'col_7',
          totalObserved: 'col_1',
          covariates: ['col_6'],
          factor: 'col_3',
          factorRange: { min: 1, max: 2 },
          transform: 'log10',
          modelType: 'logit',
          options: expect.objectContaining({
            frequencies: true,
            fiducialCI: true,
            parallelism: true,
            naturalResponseMode: 'value',
            naturalResponseValue: 0.05,
            maxIterations: 30,
            heterogeneitySig: 0.1
          })
        })
      })
    )
  })

  it('PROBIT respFreq OF total WITH covariate — no factor, defaults', async () => {
    const log = await runSpssSyntax('PROBIT outcome OF appraise WITH z.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'probit',
        params: expect.objectContaining({
          responseFreq: 'col_7',
          totalObserved: 'col_1',
          covariates: ['col_6'],
          factor: null,
          modelType: 'probit',
          transform: 'none'
        })
      })
    )
  })

  it('NOMREG dependent-only fits an intercept-only model', async () => {
    const log = await runSpssSyntax('NOMREG outcome.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(expect.objectContaining({ analysisId: 'multinom' }))
  })

  it('NOMREG dependent WITH covariates', async () => {
    const log = await runSpssSyntax('NOMREG outcome WITH z.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'multinom',
        scriptFile: 'regression-multinomial.R',
        params: expect.objectContaining({ dependent: 'col_7', covariates: ['col_6'] })
      })
    )
  })

  it('FACTOR VARIABLES=list /ROTATION=VARIMAX /PRINT=KMO', async () => {
    const log = await runSpssSyntax(
      'FACTOR VARIABLES=appraise price z /ROTATION=VARIMAX /PRINT=KMO.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'factor',
        params: expect.objectContaining({ options: { rotation: 'varimax', kmoBartlett: true } })
      })
    )
  })

  it('CLUSTER varlist /METHOD=WARD', async () => {
    const log = await runSpssSyntax('CLUSTER appraise price z /METHOD=WARD.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'hier',
        params: expect.objectContaining({ method: 'ward.D2' })
      })
    )
  })

  it('ROC testvars BY state(value) /CRITERIA=TESTPOS(SMALL)', async () => {
    const log = await runSpssSyntax('ROC price BY outcome (1) /CRITERIA=TESTPOS(SMALL).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'roc',
        params: expect.objectContaining({
          stateVar: 'col_7',
          stateValue: '1',
          options: expect.objectContaining({
            direction: 'smaller',
            coordinates: false,
            // Absent /PLOT and /PRINT keep the curve, reference line and SE.
            plotCurve: true,
            diagonal: true,
            seCi: true,
            cutoff: 'include',
            distribution: 'free',
            ciLevel: 0.95,
            userMissingValid: false
          })
        })
      })
    )
  })

  it('ROC Options/Display subcommands reach roc.R', async () => {
    const log = await runSpssSyntax(
      'ROC price BY outcome (1) /PLOT=CURVE /PRINT=COORDINATES' +
        ' /CRITERIA=CUTOFF(EXCLUDE) TESTPOS(LARGE) DISTRIBUTION(NEGEXPO) CI(90) /MISSING=INCLUDE.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'roc',
        params: expect.objectContaining({
          options: {
            direction: 'larger',
            coordinates: true,
            plotCurve: true,
            diagonal: false,
            seCi: false,
            cutoff: 'exclude',
            distribution: 'negexpo',
            ciLevel: 0.9,
            userMissingValid: true
          }
        })
      })
    )
  })

  it('UNIANOVA dependent BY factor(s) → glm-univariate.R', async () => {
    const log = await runSpssSyntax('UNIANOVA yield BY seed fert.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'glmUni',
        scriptFile: 'glm-univariate.R',
        params: expect.objectContaining({ dependent: 'col_10', factors: ['col_8', 'col_9'] })
      })
    )
  })

  it('UNIANOVA dependent BY factor WITH covariate /METHOD=SSTYPE(2) /INTERCEPT=EXCLUDE', async () => {
    const log = await runSpssSyntax(
      'UNIANOVA yield BY seed WITH price /METHOD=SSTYPE(2) /INTERCEPT=EXCLUDE.'
    )
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'glmUni',
        scriptFile: 'glm-univariate.R',
        params: expect.objectContaining({
          dependent: 'col_10',
          factors: ['col_8'],
          covariates: ['col_2'],
          options: { ssType: 'II', includeIntercept: false }
        })
      })
    )
  })

  it('GLM with 2 dependents routes to glm-multivariate.R', async () => {
    const log = await runSpssSyntax('GLM yield price BY seed.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'glmMulti',
        scriptFile: 'glm-multivariate.R',
        params: expect.objectContaining({ dependents: ['col_10', 'col_2'], factors: ['col_8'] })
      })
    )
  })

  it('ANOVA strips SPSS (min,max) factor ranges before resolving', async () => {
    const log = await runSpssSyntax('ANOVA VARIABLES=yield BY seed(1,3) fert(1,2).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'glmUni',
        params: expect.objectContaining({ factors: ['col_8', 'col_9'] })
      })
    )
  })

  it('MIXED dependent WITH covariates /RANDOM=... SUBJECT(subj)', async () => {
    const log = await runSpssSyntax('MIXED yield WITH price /RANDOM=INTERCEPT | SUBJECT(seed).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'mixed',
        params: expect.objectContaining({
          dependent: 'col_10',
          covariates: ['col_2'],
          subject: 'col_8'
        })
      })
    )
  })

  it('NPAR TESTS fans out one analysis:run call per recognized /subcommand', async () => {
    const log = await runSpssSyntax(
      'NPAR TESTS /CHISQUARE=price /M-W=appraise BY group(1,2) /MCNEMAR=price.'
    )
    expect(analysisRun).toHaveBeenCalledTimes(2)
    expect(analysisRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        analysisId: 'nparChiSq',
        params: expect.objectContaining({ variables: ['col_2'] })
      })
    )
    expect(analysisRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        analysisId: 'nparMW',
        params: expect.objectContaining({
          variables: ['col_1'],
          groupVar: 'col_3',
          group1: '1',
          group2: '2'
        })
      })
    )
    // MCNEMAR has no SAI equivalent — logged, not dispatched.
    expect(log.some(e => e.key === 'terminal.log.npartestsSubNotSupported')).toBe(true)
  })

  it('NPAR TESTS /STATISTICS reaches M-W as the descriptives/quartiles options', async () => {
    await runSpssSyntax(
      'NPAR TESTS /M-W=appraise BY group(1,2) /STATISTICS=QUARTILES /MISSING=LISTWISE.'
    )
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'nparMW',
        params: expect.objectContaining({
          // QUARTILES alone must not switch DESCRIPTIVES on, and the global
          // /MISSING has to survive alongside it.
          // (+ the dialog-default effect size and boxplot, SAI additions)
          options: {
            effectSize: true,
            boxplot: true,
            missing: 'listwise',
            descriptives: false,
            quartiles: true
          }
        })
      })
    )
  })

  it('NPAR TESTS /STATISTICS=ALL turns on both M-W summary blocks', async () => {
    await runSpssSyntax('NPAR TESTS /M-W=appraise BY group(1,2) /STATISTICS=ALL.')
    expect(analysisRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: 'nparMW',
        params: expect.objectContaining({
          options: { effectSize: true, boxplot: true, descriptives: true, quartiles: true }
        })
      })
    )
  })
})

describe('runSpssSyntax — SELECT IF / FILTER (column-filter store)', () => {
  const setColumnFilters = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    setColumnFilters.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { data: { setColumnFilters } }
    } as unknown as Window
    useDatasetStore.setState({
      datasetId: 'ds-1',
      columnFilters: {},
      variables: [
        makeVariable({ colId: 'col_1', name: 'age' }),
        makeVariable({ colId: 'col_2', name: 'gender' }),
        makeVariable({ colId: 'col_3', name: 'active' })
      ]
    })
  })

  it('SELECT IF (age > 18) sets a single column filter', async () => {
    const log = await runSpssSyntax('SELECT IF (age > 18).')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().columnFilters).toEqual({
      col_1: { operator: 'greater_than', value: '18' }
    })
  })

  it('SELECT IF with AND across two different variables sets two filters', async () => {
    const log = await runSpssSyntax("SELECT IF (age >= 18 AND gender = 'F').")
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().columnFilters).toEqual({
      col_1: { operator: 'greater_than_or_equal', value: '18' },
      col_2: { operator: 'equals', value: 'F' }
    })
  })

  it('SELECT IF rejects OR (cannot be represented by the AND-only filter store)', async () => {
    const log = await runSpssSyntax('SELECT IF (age > 18 OR gender = 1).')
    expect(log.some(e => e.key === 'terminal.log.selectIfSyntax')).toBe(true)
    expect(useDatasetStore.getState().columnFilters).toEqual({})
  })

  it('SELECT IF rejects two conditions on the same variable', async () => {
    const log = await runSpssSyntax('SELECT IF (age > 18 AND age < 65).')
    expect(log.some(e => e.key === 'terminal.log.selectIfSyntax')).toBe(true)
    expect(useDatasetStore.getState().columnFilters).toEqual({})
  })

  it('FILTER BY var sets a nonzero column filter', async () => {
    const log = await runSpssSyntax('FILTER BY active.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().columnFilters).toEqual({
      col_3: { operator: 'not_equals', value: '0' }
    })
  })

  it('FILTER OFF clears every active column filter', async () => {
    useDatasetStore.setState({
      columnFilters: { col_1: { operator: 'greater_than', value: '18' } }
    })
    const log = await runSpssSyntax('FILTER OFF.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(useDatasetStore.getState().columnFilters).toEqual({})
  })
})

describe('runSpssSyntax — GRAPH/EXAMINE forward value labels to R (real bug regression)', () => {
  // The dialogs (ChartDialog, ExploreDialog) resolve a grouping variable's
  // raw codes through its valueLabels; the syntax dispatcher builds the same
  // analysis:run params independently and had drifted — GRAPH /BOXPLOT and
  // EXAMINE both sent the raw code only, so a chart or table pasted/typed as
  // syntax showed "1"/"2" instead of the labels the equivalent dialog run
  // showed.
  const analysisRun = vi.fn().mockResolvedValue({ jobId: 'job-1' })

  beforeEach(() => {
    analysisRun.mockClear()
    ;(globalThis as unknown as { window: Window }).window = {
      api: { analysis: { run: analysisRun } }
    } as unknown as Window

    useDatasetStore.setState({
      datasetId: 'ds-1',
      columnFilters: {},
      variables: [
        makeVariable({ colId: 'col_1', name: 'score' }),
        makeVariable({
          colId: 'col_2',
          name: 'grp',
          valueLabels: { '1': 'Male', '2': 'Female' }
        })
      ]
    })
  })

  it('GRAPH /BOXPLOT=score BY grp sends groupValueLabels', async () => {
    const log = await runSpssSyntax('GRAPH /BOXPLOT=score BY grp.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledTimes(1)
    const params = analysisRun.mock.calls[0]?.[0].params as Record<string, unknown>
    expect(params.groupValueLabels).toEqual({ '1': 'Male', '2': 'Female' })
  })

  it('EXAMINE VARIABLES=score BY grp sends factorValueLabels', async () => {
    const log = await runSpssSyntax('EXAMINE VARIABLES=score BY grp.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(analysisRun).toHaveBeenCalledTimes(1)
    const params = analysisRun.mock.calls[0]?.[0].params as Record<string, unknown>
    expect(params.factorValueLabels).toEqual({ col_2: { '1': 'Male', '2': 'Female' } })
  })
})

describe('runSpssSyntax — IF (real bug regression: conditional assignment now executes)', () => {
  // IF used to be guidance-only (GUIDANCE_COMMANDS → "use Compute Variable
  // instead") and never wrote anything, so an AI-proposed
  // "IF (...) target = 1. EXECUTE." card could be approved and still leave
  // the target variable untouched. Unlike COMPUTE, IF must only touch rows
  // where the condition is true — the rest keep their existing value.
  const getChunk = vi.fn()
  const updateCells = vi.fn().mockResolvedValue(undefined)
  const variableAdd = vi.fn()

  beforeEach(() => {
    getChunk.mockReset()
    updateCells.mockClear()
    variableAdd.mockReset()
    ;(globalThis as unknown as { window: Window }).window = {
      api: {
        data: { getChunk, updateCells },
        variable: { add: variableAdd }
      }
    } as unknown as Window
  })

  it('writes only the matching rows on an existing target, leaving the rest untouched', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      rowCount: 3,
      variables: [
        makeVariable({ colId: 'col_1', name: 'sonuc' }),
        makeVariable({ colId: 'col_2', name: 'yb_yatisi' }),
        makeVariable({ colId: 'col_3', name: 'ciddi_seyir' })
      ]
    })
    getChunk.mockResolvedValue({
      rows: [
        [3, 0, 0], // sonuc = 3 → matches
        [1, 1, 0], // yb_yatisi = 1 → matches
        [1, 0, 0] // neither → left alone
      ]
    })

    const log = await runSpssSyntax('IF (sonuc = 3 OR yb_yatisi = 1) ciddi_seyir = 1.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(log.some(e => e.key === 'terminal.log.ifApplied')).toBe(true)
    expect(variableAdd).not.toHaveBeenCalled()
    expect(updateCells).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      updates: [
        { rowIndex: 0, colId: 'col_3', value: 1 },
        { rowIndex: 1, colId: 'col_3', value: 1 }
      ]
    })
  })

  it('creates the target variable when it does not exist yet', async () => {
    useDatasetStore.setState({
      datasetId: 'ds-1',
      rowCount: 2,
      variables: [makeVariable({ colId: 'col_1', name: 'sonuc' })]
    })
    getChunk.mockResolvedValue({ rows: [[3], [1]] })
    variableAdd.mockResolvedValue([
      makeVariable({ colId: 'col_1', name: 'sonuc' }),
      makeVariable({ colId: 'col_2', name: 'ciddi_seyir' })
    ])

    const log = await runSpssSyntax('IF (sonuc = 3) ciddi_seyir = 1.')
    expect(log.some(e => e.level === 'error')).toBe(false)
    expect(variableAdd).toHaveBeenCalledWith(
      expect.objectContaining({ variable: expect.objectContaining({ name: 'ciddi_seyir' }) })
    )
    expect(updateCells).toHaveBeenCalledWith({
      datasetId: 'ds-1',
      updates: [{ rowIndex: 0, colId: 'col_2', value: 1 }]
    })
  })

  it('rejects syntax missing the parenthesized condition', async () => {
    useDatasetStore.setState({ datasetId: 'ds-1', rowCount: 0, variables: [] })
    const log = await runSpssSyntax('IF sonuc = 3 ciddi_seyir = 1.')
    expect(log.some(e => e.key === 'terminal.log.ifSyntax')).toBe(true)
    expect(getChunk).not.toHaveBeenCalled()
  })
})
