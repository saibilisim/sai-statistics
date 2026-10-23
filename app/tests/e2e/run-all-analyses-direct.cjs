// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* 61 analizin tamamını (AI'sız, doğrudan analysis:run ile) gerçek R motoruna
 * karşı çalıştırır — R hesaplama + IPC/param-wiring doğruluğunu test eder.
 * AI-manifest'teki 9 analiz ayrıca gerçek AI sohbetiyle de test edilir (ayrı
 * script); burada hepsi (61) doğrudan çağrılıp ham sonuç JSON'a yazılır,
 * py ile karşılaştırma ayrı bir adımda yapılır.
 *
 * Run: xvfb-run -a node tests/e2e/run-all-analyses-direct.cjs
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const MASTER_CSV = '/tmp/sai-ai-test/master_dataset.csv'
const PANEL_CSV = '/tmp/sai-ai-test/panel_dataset.csv'
const OUT_JSON = path.join(__dirname, '..', '..', 'all-analyses-direct-results.json')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => console.log('[pageerror]', err.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  // Global job-result koleksiyonu kur.
  await win.evaluate(() => {
    window.__jobResults = {}
    window.api.on.jobComplete(p => {
      window.__jobResults[p.jobId] = { status: 'ok', result: p.result }
    })
    window.api.on.jobError(p => {
      window.__jobResults[p.jobId] = { status: 'error', errorKey: p.errorKey, details: p.details }
    })
  })

  const master = await win.evaluate(async filePath => {
    const result = await window.api.file.import({ filePath })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        result.dataset.id,
        result.dataset.name,
        result.dataset.filePath,
        result.variables,
        result.dataset.rowCount,
        result.styles
      )
    return { datasetId: result.dataset.id, variables: result.variables }
  }, MASTER_CSV)
  console.log(
    'master dataset imported:',
    master.datasetId,
    master.variables.map(v => v.name).join(',')
  )

  const panel = await win.evaluate(async filePath => {
    const result = await window.api.file.import({ filePath })
    return { datasetId: result.dataset.id, variables: result.variables }
  }, PANEL_CSV)
  console.log(
    'panel dataset imported:',
    panel.datasetId,
    panel.variables.map(v => v.name).join(',')
  )

  const cid = name => {
    const v = master.variables.find(x => x.name === name)
    if (!v) throw new Error(`master var not found: ${name}`)
    return v.colId
  }
  const pcid = name => {
    const v = panel.variables.find(x => x.name === name)
    if (!v) throw new Error(`panel var not found: ${name}`)
    return v.colId
  }

  const jobs = [
    // ── Manifest'teki 9 (doğrudan çağrı ile de doğrulanıyor) ──────────────
    {
      name: 'descriptives',
      analysisId: 'descriptives',
      scriptFile: 'descriptives.R',
      params: { variables: [cid('score')], varNames: { [cid('score')]: 'score' } }
    },
    {
      name: 'frequencies',
      analysisId: 'frequencies',
      scriptFile: 'frequencies.R',
      params: {
        variables: [cid('group2')],
        varNames: { [cid('group2')]: 'group2' },
        options: { showTable: true, order: 'ascending' }
      }
    },
    {
      name: 'crosstabs',
      analysisId: 'crosstabs',
      scriptFile: 'crosstabs.R',
      params: {
        rows: [cid('group3')],
        cols: [cid('group2')],
        rowNames: { [cid('group3')]: 'group3' },
        colNames: { [cid('group2')]: 'group2' },
        options: { cells: { observed: true }, stats: { chisquare: true } }
      }
    },
    {
      name: 'ttest1',
      analysisId: 'ttest1',
      scriptFile: 'ttest-onesample.R',
      params: { variables: [cid('score')], varNames: { [cid('score')]: 'score' }, testValue: 50 }
    },
    {
      name: 'ttestInd',
      analysisId: 'ttestInd',
      scriptFile: 'ttest-independent.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        groupVar: cid('group2'),
        groupName: 'group2',
        group1: 'A',
        group2: 'B'
      }
    },
    {
      name: 'ttestPaired',
      analysisId: 'ttestPaired',
      scriptFile: 'ttest-paired.R',
      params: {
        var1: [cid('pretest')],
        var2: [cid('posttest')],
        varNames: { [cid('pretest')]: 'pretest', [cid('posttest')]: 'posttest' }
      }
    },
    {
      name: 'correlate',
      analysisId: 'correlate',
      scriptFile: 'correlation.R',
      params: {
        variables: [cid('score'), cid('score2')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2' },
        methods: { pearson: true }
      }
    },
    {
      name: 'regression',
      analysisId: 'regression',
      scriptFile: 'regression-linear.R',
      params: {
        dependent: cid('score'),
        dependentName: 'score',
        independents: [cid('score2'), cid('score3')],
        varNames: { [cid('score2')]: 'score2', [cid('score3')]: 'score3' }
      }
    },
    {
      name: 'anova',
      analysisId: 'anova',
      scriptFile: 'anova-oneway.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        factor: cid('group3'),
        factorName: 'group3'
      }
    },

    // ── Bayes varyantları ──────────────────────────────────────────────
    {
      name: 'bayesTTestInd',
      analysisId: 'bayesTTestInd',
      scriptFile: 'bayes-ttest-independent.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        groupVar: cid('group2'),
        group1: 'A',
        group2: 'B'
      }
    },
    {
      name: 'bayesTTestPaired',
      analysisId: 'bayesTTestPaired',
      scriptFile: 'bayes-ttest-paired.R',
      params: {
        var1: [cid('pretest')],
        var2: [cid('posttest')],
        varNames: { [cid('pretest')]: 'pretest', [cid('posttest')]: 'posttest' }
      }
    },
    {
      name: 'bayesTTest1',
      analysisId: 'bayesTTest1',
      scriptFile: 'bayes-ttest-onesample.R',
      params: { variables: [cid('score')], varNames: { [cid('score')]: 'score' }, testValue: 50 }
    },
    {
      name: 'bayesAnova',
      analysisId: 'bayesAnova',
      scriptFile: 'bayes-anova.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        factor: cid('group3')
      }
    },
    {
      name: 'bayesCorrelate',
      analysisId: 'bayesCorrelate',
      scriptFile: 'bayes-correlation.R',
      params: {
        variables: [cid('score'), cid('score2')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2' }
      }
    },
    {
      name: 'bayesRegression',
      analysisId: 'bayesRegression',
      scriptFile: 'bayes-regression.R',
      params: {
        dependent: cid('score'),
        independents: [cid('score2'), cid('score3')],
        varNames: { [cid('score2')]: 'score2', [cid('score3')]: 'score3' }
      }
    },

    // ── Compare Means ekstra ─────────────────────────────────────────
    {
      name: 'means',
      analysisId: 'means',
      scriptFile: 'means.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        factor: cid('group3'),
        factorName: 'group3'
      }
    },
    {
      name: 'proportions',
      analysisId: 'proportions',
      scriptFile: 'proportions.R',
      params: {
        design: 'one',
        variable: cid('outcome01'),
        varName: 'outcome01',
        successValue: '1',
        testValue: 0.3,
        ciLevel: 95
      }
    },

    // ── Correlate ekstra ─────────────────────────────────────────────
    {
      name: 'partialCorr',
      analysisId: 'partialCorr',
      scriptFile: 'correlation-partial.R',
      params: {
        variables: [cid('score'), cid('score2')],
        controls: [cid('score3')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2', [cid('score3')]: 'score3' }
      }
    },
    {
      name: 'distances',
      analysisId: 'distances',
      scriptFile: 'distances.R',
      params: {
        variables: [cid('score'), cid('score2'), cid('score3')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2', [cid('score3')]: 'score3' },
        measure: 'euclidean'
      }
    },

    // ── Regression ekstra ──────────────────────────────────────────
    {
      name: 'curve',
      analysisId: 'curve',
      scriptFile: 'regression-curve.R',
      params: {
        dependent: cid('score'),
        dependentName: 'score',
        independent: cid('score2'),
        independentName: 'score2',
        models: { linear: true, quadratic: true }
      }
    },
    {
      name: 'logistic',
      analysisId: 'logistic',
      scriptFile: 'regression-logistic.R',
      params: {
        dependent: cid('outcome01'),
        dependentName: 'outcome01',
        covariates: [cid('score')],
        varNames: { [cid('score')]: 'score' }
      }
    },
    {
      name: 'multinom',
      analysisId: 'multinom',
      scriptFile: 'regression-multinomial.R',
      params: {
        dependent: cid('group3'),
        covariates: [cid('score')],
        varNames: { [cid('score')]: 'score' }
      }
    },
    {
      name: 'ordinal',
      analysisId: 'ordinal',
      scriptFile: 'regression-ordinal.R',
      params: {
        dependent: cid('group3'),
        covariates: [cid('score')],
        varNames: { [cid('score')]: 'score' }
      }
    },
    {
      name: 'probit',
      analysisId: 'probit',
      scriptFile: 'regression-probit.R',
      params: {
        dependent: cid('outcome01'),
        dependentName: 'outcome01',
        covariates: [cid('score')],
        varNames: { [cid('score')]: 'score' }
      }
    },

    // ── GLM ailesi ─────────────────────────────────────────────────
    {
      name: 'glmUni',
      analysisId: 'glmUni',
      scriptFile: 'glm-univariate.R',
      params: {
        dependent: cid('score'),
        dependentName: 'score',
        factors: [cid('group3')],
        factorNames: { [cid('group3')]: 'group3' }
      }
    },
    {
      name: 'glmMulti',
      analysisId: 'glmMulti',
      scriptFile: 'glm-multivariate.R',
      params: {
        dependents: [cid('score'), cid('score2')],
        dependentNames: { [cid('score')]: 'score', [cid('score2')]: 'score2' },
        factors: [cid('group3')],
        factorNames: { [cid('group3')]: 'group3' }
      }
    },
    {
      name: 'glmRep',
      analysisId: 'glmRep',
      scriptFile: 'glm-repeated.R',
      params: {
        variables: [cid('rm1'), cid('rm2'), cid('rm3')],
        varNames: { [cid('rm1')]: 'rm1', [cid('rm2')]: 'rm2', [cid('rm3')]: 'rm3' },
        factor: cid('group2'),
        factorName: 'group2'
      }
    },
    {
      name: 'genlin',
      analysisId: 'genlin',
      scriptFile: 'genlin.R',
      params: {
        dependent: cid('count_var'),
        dependentName: 'count_var',
        predictors: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        distribution: 'poisson'
      }
    },

    // ── Mixed / GEE (panel dataset, long format) ─────────────────────
    {
      name: 'mixed',
      analysisId: 'mixed',
      scriptFile: 'mixed-models.R',
      datasetId: 'panel',
      params: {
        dependent: pcid('y'),
        dependentName: 'y',
        predictors: [pcid('time'), pcid('x')],
        varNames: { [pcid('time')]: 'time', [pcid('x')]: 'x' },
        subject: pcid('subject')
      }
    },
    {
      name: 'glmm',
      analysisId: 'glmm',
      scriptFile: 'glmm.R',
      datasetId: 'panel',
      params: {
        dependent: pcid('y_bin'),
        dependentName: 'y_bin',
        predictors: [pcid('time'), pcid('x')],
        varNames: { [pcid('time')]: 'time', [pcid('x')]: 'x' },
        subject: pcid('subject'),
        family: 'binomial'
      }
    },
    {
      name: 'gee',
      analysisId: 'gee',
      scriptFile: 'gee.R',
      datasetId: 'panel',
      params: {
        dependent: pcid('y'),
        dependentName: 'y',
        predictors: [pcid('time'), pcid('x')],
        varNames: { [pcid('time')]: 'time', [pcid('x')]: 'x' },
        subject: pcid('subject'),
        family: 'gaussian',
        corstr: 'exchangeable'
      }
    },

    // ── Nonparametrik ─────────────────────────────────────────────
    {
      name: 'nparChiSq',
      analysisId: 'nparChiSq',
      scriptFile: 'npar-chisquare.R',
      params: { variables: [cid('group3')], varNames: { [cid('group3')]: 'group3' } }
    },
    {
      name: 'nparBinomial',
      analysisId: 'nparBinomial',
      scriptFile: 'npar-binomial.R',
      params: {
        variables: [cid('outcome01')],
        varNames: { [cid('outcome01')]: 'outcome01' },
        testProp: 0.3
      }
    },
    {
      name: 'nparRuns',
      analysisId: 'nparRuns',
      scriptFile: 'npar-runs.R',
      params: { variables: [cid('score')], cutPoint: 52.5, options: {} }
    },
    {
      name: 'nparKS',
      analysisId: 'nparKS',
      scriptFile: 'npar-ks.R',
      params: { variables: [cid('score')], dist: 'norm' }
    },
    {
      name: 'nparMW',
      analysisId: 'nparMW',
      scriptFile: 'npar-mann-whitney.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        groupVar: cid('group2'),
        groupName: 'group2',
        group1: 'A',
        group2: 'B'
      }
    },
    {
      name: 'nparKW',
      analysisId: 'nparKW',
      scriptFile: 'npar-kruskal-wallis.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        factor: cid('group3'),
        factorName: 'group3'
      }
    },
    {
      name: 'nparWilcoxon',
      analysisId: 'nparWilcoxon',
      scriptFile: 'npar-wilcoxon.R',
      params: {
        var1: [cid('pretest')],
        var2: [cid('posttest')],
        varNames: { [cid('pretest')]: 'pretest', [cid('posttest')]: 'posttest' }
      }
    },
    {
      name: 'nparFriedman',
      analysisId: 'nparFriedman',
      scriptFile: 'npar-friedman.R',
      params: {
        variables: [cid('rm1'), cid('rm2'), cid('rm3')],
        varNames: { [cid('rm1')]: 'rm1', [cid('rm2')]: 'rm2', [cid('rm3')]: 'rm3' }
      }
    },

    // ── Survival ──────────────────────────────────────────────────
    {
      name: 'survivalKM',
      analysisId: 'survivalKM',
      scriptFile: 'survival-km.R',
      params: {
        timeVar: cid('time_to_event'),
        statusVar: cid('event_status'),
        eventValue: '1',
        factor: cid('group2'),
        factorName: 'group2'
      }
    },
    {
      name: 'survivalCox',
      analysisId: 'survivalCox',
      scriptFile: 'survival-cox.R',
      params: {
        timeVar: cid('time_to_event'),
        statusVar: cid('event_status'),
        eventValue: '1',
        covariates: [cid('score')],
        varNames: { [cid('score')]: 'score' }
      }
    },
    {
      name: 'lifetab',
      analysisId: 'lifetab',
      scriptFile: 'life-tables.R',
      params: { time: cid('time_to_event'), status: cid('event_status'), interval: 10 }
    },

    // ── Classify / dimension ─────────────────────────────────────
    {
      name: 'discriminant',
      analysisId: 'discriminant',
      scriptFile: 'discriminant.R',
      params: {
        groupVar: cid('group2'),
        independents: [cid('score'), cid('score2'), cid('score3')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2', [cid('score3')]: 'score3' }
      }
    },
    {
      name: 'hier',
      analysisId: 'hier',
      scriptFile: 'hierarchical.R',
      params: {
        variables: [cid('score'), cid('score2'), cid('score3')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2', [cid('score3')]: 'score3' },
        method: 'ward.D2',
        clusters: 3
      }
    },
    {
      name: 'kmeans',
      analysisId: 'kmeans',
      scriptFile: 'kmeans.R',
      params: {
        variables: [cid('score'), cid('score2'), cid('score3')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2', [cid('score3')]: 'score3' },
        clusters: 3
      }
    },
    {
      name: 'knn',
      analysisId: 'knn',
      scriptFile: 'knn.R',
      params: {
        groupVar: cid('group2'),
        independents: [cid('score'), cid('score2')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2' },
        options: {}
      }
    },
    {
      name: 'tree',
      analysisId: 'tree',
      scriptFile: 'tree.R',
      params: {
        groupVar: cid('group2'),
        independents: [cid('score'), cid('score2'), cid('score3')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2', [cid('score3')]: 'score3' },
        options: {}
      }
    },
    {
      name: 'factor',
      analysisId: 'factor',
      scriptFile: 'factor.R',
      params: {
        variables: ['item1', 'item2', 'item3', 'item4', 'item5'].map(cid),
        varNames: Object.fromEntries(
          ['item1', 'item2', 'item3', 'item4', 'item5'].map(n => [cid(n), n])
        ),
        options: {}
      }
    },
    {
      name: 'mds',
      analysisId: 'mds',
      scriptFile: 'mds.R',
      params: {
        variables: [cid('score'), cid('score2'), cid('score3'), cid('score4')],
        varNames: Object.fromEntries(['score', 'score2', 'score3', 'score4'].map(n => [cid(n), n])),
        dimensions: 2
      }
    },

    // ── Scale / reliability ────────────────────────────────────
    {
      name: 'reliability',
      analysisId: 'reliability',
      scriptFile: 'reliability.R',
      params: {
        variables: ['item1', 'item2', 'item3', 'item4', 'item5'].map(cid),
        varNames: Object.fromEntries(
          ['item1', 'item2', 'item3', 'item4', 'item5'].map(n => [cid(n), n])
        ),
        options: {}
      }
    },

    // ── ROC ──────────────────────────────────────────────────
    {
      name: 'roc',
      analysisId: 'roc',
      scriptFile: 'roc.R',
      params: {
        stateVar: cid('outcome01'),
        stateValue: '1',
        testVar: cid('score'),
        testName: 'score',
        variables: [cid('score')],
        options: {}
      }
    },
    {
      name: 'rocAnalysis',
      analysisId: 'rocAnalysis',
      scriptFile: 'roc-analysis.R',
      params: {
        stateVar: cid('outcome01'),
        stateValue: '1',
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        options: {}
      }
    },

    // ── Data / diğer ──────────────────────────────────────────
    {
      name: 'explore',
      analysisId: 'explore',
      scriptFile: 'explore.R',
      params: {
        variables: [cid('score')],
        varNames: { [cid('score')]: 'score' },
        factors: [cid('group2')],
        factorNames: { [cid('group2')]: 'group2' },
        options: {}
      }
    },
    {
      name: 'normality',
      analysisId: 'normality',
      scriptFile: 'normality.R',
      params: { variables: [cid('score')], varNames: { [cid('score')]: 'score' } }
    },
    {
      name: 'missing',
      analysisId: 'missing',
      scriptFile: 'missing-values.R',
      params: {
        variables: [cid('score_miss'), cid('score2')],
        varNames: { [cid('score_miss')]: 'score_miss', [cid('score2')]: 'score2' }
      }
    },
    {
      name: 'mi',
      analysisId: 'mi',
      scriptFile: 'mi.R',
      params: {
        variables: [cid('score_miss'), cid('score2')],
        varNames: { [cid('score_miss')]: 'score_miss', [cid('score2')]: 'score2' },
        m: 5,
        seed: 123
      }
    },
    {
      name: 'multipleResponse',
      analysisId: 'mr',
      scriptFile: 'multiple-response.R',
      params: {
        variables: [cid('resp1'), cid('resp2'), cid('resp3')],
        varNames: { [cid('resp1')]: 'resp1', [cid('resp2')]: 'resp2', [cid('resp3')]: 'resp3' },
        countedValue: 1
      }
    },
    {
      name: 'caseSummaries',
      analysisId: 'caseSummaries',
      scriptFile: 'case-summaries.R',
      params: {
        variables: [cid('score'), cid('score2')],
        varNames: { [cid('score')]: 'score', [cid('score2')]: 'score2' },
        groupVar: cid('group2'),
        groupVarName: 'group2',
        limitCases: 20
      }
    },
    {
      name: 'ratio',
      analysisId: 'ratio',
      scriptFile: 'ratio.R',
      params: { numerator: cid('score'), denominator: cid('score4'), group: cid('group2') }
    },
    {
      name: 'power',
      analysisId: 'power',
      scriptFile: 'power.R',
      params: { test: 'tTwo', effectSize: 0.5, alpha: 0.05, power: 0.8 }
    }
  ]

  const results = {}
  for (const job of jobs) {
    const datasetId = job.datasetId === 'panel' ? panel.datasetId : master.datasetId
    try {
      const { jobId } = await win.evaluate(
        async ({ analysisId, datasetId, scriptFile, params }) =>
          window.api.analysis.run({ analysisId, datasetId, scriptFile, params }),
        { analysisId: job.analysisId, datasetId, scriptFile: job.scriptFile, params: job.params }
      )
      const outcome = await (async () => {
        const start = Date.now()
        for (;;) {
          const r = await win.evaluate(id => window.__jobResults[id] ?? null, jobId)
          if (r) return r
          if (Date.now() - start > 60000) return { status: 'timeout' }
          await win.waitForTimeout(300)
        }
      })()
      results[job.name] = outcome
      console.log(
        `${job.name}: ${outcome.status}${outcome.status !== 'ok' ? ' — ' + JSON.stringify(outcome.errorKey ?? outcome.details ?? '') : ''}`
      )
    } catch (err) {
      results[job.name] = { status: 'exception', message: String(err) }
      console.log(`${job.name}: EXCEPTION — ${String(err)}`)
    }
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2))
  console.log(`\nWritten to ${OUT_JSON}`)

  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1
    })
    await app.close()
  } catch (err) {
    console.error('app close failed:', err)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
