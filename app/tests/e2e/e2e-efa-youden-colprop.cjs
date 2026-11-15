// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the 2026-11 additions, end to end through real R runs —
 *   1. Factor Analysis with principal axis factoring on polychoric
 *      correlations, parallel analysis, scree plot, promax, sorted/suppressed
 *      loadings and the descriptives tables;
 *   2. ROC Curve with the Youden optimal cut-off table and its bootstrap CI;
 *   3. Crosstabs with the column-proportions z-test.
 * Each run must succeed, render every new table, and leak no raw output.* /
 * analysis.* key into the DOM. A second factor run covers the SPSS-complete
 * options (image factoring of a covariance matrix, pairwise deletion, oblimin
 * delta, Bartlett score coefficients, correlation-matrix extras, loading
 * plot). Finally the Factor dialog's Extraction sub-dialog must list the
 * seven methods and its Scores sub-dialog the three score methods.
 *
 * Needs no external fixture: a synthetic CSV is written here.
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CSV = path.join(os.tmpdir(), 'sai-efa-youden.csv')
const N = 240

function writeFixture() {
  let seed = 20261111
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const likert = v => String(v < -1 ? 1 : v < -0.3 ? 2 : v < 0.3 ? 3 : v < 1 ? 4 : 5)
  const lines = ['i1,i2,i3,i4,i5,i6,score,state,grp,outcome']
  for (let r = 0; r < N; r++) {
    const f1 = norm()
    const f2 = norm()
    const items = [f1, f1, f1, f2, f2, f2].map(f => likert(f + norm() * 0.8))
    const state = rnd() < 0.4 ? 1 : 0
    const score = (norm() + 1.2 * state).toFixed(2)
    const grp = ['A', 'B', 'C'][r % 3]
    const pYes = grp === 'B' ? 0.3 : 0.6
    const outcome = rnd() < pYes ? 'Yes' : 'No'
    lines.push([...items, score, String(state), grp, outcome].join(','))
  }
  fs.writeFileSync(CSV, lines.join('\n') + '\n')
}

async function main() {
  writeFixture()
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

  const fails = []
  const check = (cond, msg) => {
    if (!cond) fails.push(msg)
    else console.log('   ok  ' + msg)
  }

  await win.evaluate(async f => {
    const r = await window.api.file.import({ filePath: f })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        r.dataset.id,
        r.dataset.name,
        r.dataset.filePath,
        r.variables,
        r.dataset.rowCount,
        r.styles
      )
  }, CSV)
  await win.waitForTimeout(1000)
  const col = await win.evaluate(() => {
    const vs = window.__SAI_TEST__.useDatasetStore.getState().variables ?? []
    return Object.fromEntries(vs.map(v => [v.name, v.colId]))
  })

  const run = async (analysisId, scriptFile, params) => {
    const before = await win.evaluate(() =>
      window.__SAI_TEST__.useOutputStore.getState().blocks.map(b => b.id)
    )
    await win.evaluate(
      async ([a, s, p]) => {
        const ds = window.__SAI_TEST__.useDatasetStore.getState()
        await window.api.analysis.run({
          analysisId: a,
          datasetId: ds.datasetId,
          scriptFile: s,
          params: p
        })
      },
      [analysisId, scriptFile, params]
    )
    const t0 = Date.now()
    for (;;) {
      // The store's block order is not the display order — find the new block by id.
      const b = await win.evaluate(ids => {
        const fresh = window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.find(x => !ids.includes(x.id))
        return fresh && !fresh.running ? { error: fresh.error ?? null, result: fresh.result } : null
      }, before)
      if (b) return b
      if (Date.now() - t0 > 120000) return null
      await win.waitForTimeout(400)
    }
  }
  const titles = b => (b?.result?.tables ?? []).map(t => t.titleKey.split(':')[0])

  // ── 1. EFA ──────────────────────────────────────────────────────────────
  const items = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6']
  const efa = await run('factor', 'factor.R', {
    variables: items.map(n => col[n]),
    varNames: Object.fromEntries(items.map(n => [col[n], n])),
    options: {
      extraction: 'paf',
      matrix: 'polychoric',
      criterion: 'parallel',
      scree: true,
      rotation: 'promax',
      univariate: true,
      correlation: true,
      kmoBartlett: true,
      antiImage: true,
      sortBySize: true,
      suppressBelow: 0.3
    }
  })
  check(efa && !efa.error && efa.result?.success, `EFA run succeeded (${efa?.error ?? ''})`)
  const efaT = titles(efa)
  for (const k of [
    'output.factor.descTitle',
    'output.factor.corrTitle',
    'output.factor.kmoBartlettTitle',
    'output.factor.antiImageTitle',
    'output.factor.parallelTitle',
    'output.factor.factorMatrixTitle',
    'output.factor.patternMatrixTitle'
  ]) {
    check(efaT.includes(k), `EFA table ${k}`)
  }
  check((efa?.result?.plots ?? []).length === 1, 'EFA scree plot')
  const pm = efa?.result?.tables?.find(t => t.titleKey === 'output.factor.patternMatrixTitle')
  check(pm && pm.columns.length === 3, 'parallel analysis kept two factors')

  // ── 1b. EFA with the SPSS-complete options ───────────────────────────────
  // Image factoring of the covariance matrix, pairwise deletion, oblimin with
  // a delta, Bartlett score coefficients, the extra correlation-matrix tables
  // and the loading plot.
  const efa2 = await run('factor', 'factor.R', {
    variables: items.map(n => col[n]),
    varNames: Object.fromEntries(items.map(n => [col[n], n])),
    options: {
      extraction: 'image',
      matrix: 'covariance',
      missing: 'pairwise',
      criterion: 'fixed',
      nFactors: 2,
      rotation: 'oblimin',
      delta: -0.2,
      loadingPlot: true,
      sigLevels: true,
      determinant: true,
      inverse: true,
      reproduced: true,
      antiImage: true,
      scoreMethod: 'bartlett',
      scoreCoef: true
    }
  })
  check(
    efa2 && !efa2.error && efa2.result?.success,
    `EFA (image, covariance) succeeded (${efa2?.error ?? ''})`
  )
  const efa2T = titles(efa2)
  for (const k of [
    'output.factor.sigTitle',
    'output.factor.determinantTitle',
    'output.factor.inverseTitle',
    'output.factor.antiImageCovTitle',
    'output.factor.reproducedTitle',
    'output.factor.residualTitle',
    'output.factor.factorScoreCoefTitle',
    'output.factor.factorScoreCovTitle',
    'output.factor.patternMatrixTitle'
  ]) {
    check(efa2T.includes(k), `EFA option table ${k}`)
  }
  const fm2 = efa2?.result?.tables?.find(t => t.titleKey === 'output.factor.factorMatrixTitle')
  check(fm2 && fm2.columns.length === 5, 'covariance analysis: raw + rescaled loading columns')
  check(
    (efa2?.result?.plots ?? []).some(p => p.titleKey === 'output.factor.factorPlotRotTitle'),
    'loading plot in rotated space'
  )

  // ── 2. ROC with Youden ───────────────────────────────────────────────────
  const roc = await run('roc', 'roc.R', {
    variables: [col.score],
    varNames: { [col.score]: 'score' },
    stateVar: col.state,
    stateName: 'state',
    stateValue: '1',
    options: { plotCurve: true, diagonal: true, seCi: true, youden: true, youdenCi: true }
  })
  check(roc && !roc.error && roc.result?.success, `ROC run succeeded (${roc?.error ?? ''})`)
  check(titles(roc).includes('output.roc.youdenTitle'), 'Youden table')
  check(titles(roc).includes('output.roc.youdenCiTitle'), 'Youden bootstrap CI table')

  // ── 3. Crosstabs column proportions ──────────────────────────────────────
  const xt = await run('crosstabs', 'crosstabs.R', {
    rows: [col.outcome],
    rowNames: { [col.outcome]: 'outcome' },
    cols: [col.grp],
    colNames: { [col.grp]: 'grp' },
    options: {
      cells: { observed: true, colPct: true, colPropZ: true, bonferroni: true },
      stats: { chisquare: true }
    }
  })
  check(xt && !xt.error && xt.result?.success, `Crosstabs run succeeded (${xt?.error ?? ''})`)
  check(titles(xt).includes('output.crosstabs.colPropTitle'), 'column proportions table')

  // ── Rendered output: translated, no raw keys ─────────────────────────────
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(2000)
  const dom = await win.evaluate(() => {
    const text = document.querySelector('[class*="content"]')?.textContent ?? ''
    return {
      leaks: (text.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10),
      youden: /Youden/.test(text),
      parallel: /Parallel Analysis|Paralel Analiz/.test(text),
      colProp: /Column Proportions|Sütun Oranları/.test(text),
      plots: document.querySelectorAll('.js-plotly-plot').length
    }
  })
  check(dom.leaks.length === 0, `no raw keys in output (${dom.leaks.join(', ')})`)
  check(dom.youden && dom.parallel && dom.colProp, 'new tables rendered with translated titles')
  check(dom.plots >= 3, `plots rendered (${String(dom.plots)})`)
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-efa-youden-colprop.png') })

  // ── Factor dialog: Extraction sub-dialog ─────────────────────────────────
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:analyze:factor')
  })
  await win.waitForTimeout(800)
  const opened = await win.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      /^(Extraction|Çıkarma)/.test(b.textContent?.trim() ?? '')
    )
    if (!btn) return { button: false, options: 0 }
    btn.click()
    return { button: true }
  })
  await win.waitForTimeout(500)
  const methods = await win.evaluate(
    () =>
      Array.from(document.querySelectorAll('select')).find(s => s.options.length === 7)?.options
        .length ?? 0
  )
  check(opened.button, 'Extraction button in the Factor dialog')
  check(methods === 7, `Extraction method list has seven methods (${String(methods)})`)
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-efa-dialog.png') })

  // ── Factor dialog: Scores sub-dialog ─────────────────────────────────────
  // Close the Extraction sub-dialog (Cancel), then open Scores.
  await win.evaluate(() => {
    const cancel = Array.from(document.querySelectorAll('button')).filter(b =>
      /^(Cancel|İptal)$/.test(b.textContent?.trim() ?? '')
    )
    cancel[cancel.length - 1]?.click()
  })
  await win.waitForTimeout(400)
  const scoresBtn = await win.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      /^(Scores|Puanlar)/.test(b.textContent?.trim() ?? '')
    )
    btn?.click()
    return Boolean(btn)
  })
  await win.waitForTimeout(500)
  const scoreRadios = await win.evaluate(
    () =>
      Array.from(document.querySelectorAll('input[type="radio"]')).filter(r =>
        /Bartlett|Anderson|Regres/.test(r.closest('label')?.textContent ?? '')
      ).length
  )
  check(scoresBtn, 'Scores button in the Factor dialog')
  check(scoreRadios === 3, `Scores sub-dialog offers three methods (${String(scoreRadios)})`)

  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ')})`)
  await app.close()
  if (fails.length) {
    console.log('\nFAIL:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
