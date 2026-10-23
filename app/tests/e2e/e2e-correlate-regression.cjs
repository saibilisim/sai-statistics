// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: injects results mirroring Bivariate Correlations (Pearson + Spearman
 * matrices, stacked Correlation/Sig/N) and Linear Regression (Model Summary,
 * ANOVA, Coefficients). Asserts titles/labels resolve, no raw key leaks, and
 * label vs numeric alignment. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  await win.evaluate(async () => {
    const T = window.__SAI_TEST__
    const store = T.useOutputStore.getState()
    const mk = (id, tables) => ({
      id,
      analysisId: id,
      titleKey: 'analysis.' + id + '.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: { success: true, tables, plots: [], warnings: [], notes: [] }
    })

    store.addBlock(
      mk('correlate', [
        {
          titleKey: 'output.correlate.title:Pearson',
          columns: ['', '', 'Y', 'X1'],
          rows: [
            ['Y', 'output.col.pearsonCorr', 1, 0.622858],
            ['', 'output.col.sigTwoTailed', '', 0.000001],
            ['', 'output.col.n', 50, 50],
            ['X1', 'output.col.pearsonCorr', 0.622858, 1],
            ['', 'output.col.sigTwoTailed', 0.000001, ''],
            ['', 'output.col.n', 50, 50]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.correlate.title:Spearman',
          columns: ['', '', 'Y', 'X1'],
          rows: [
            ['Y', 'output.col.spearman', 1, 0.668187],
            ['', 'output.col.sigTwoTailed', '', 0],
            ['', 'output.col.n', 50, 50]
          ],
          footnoteKey: null
        }
      ])
    )

    store.addBlock(
      mk('regression', [
        {
          titleKey: 'output.regression.modelSummaryTitle',
          columns: [
            'output.col.rVal',
            'output.col.rSquare',
            'output.col.adjRSquare',
            'output.col.stdErrEst'
          ],
          rows: [[0.63904, 0.408372, 0.383197, 15.458053]],
          footnoteKey: null
        },
        {
          titleKey: 'output.regression.anovaTitle',
          columns: [
            'output.col.source',
            'output.col.sumSq',
            'output.col.df',
            'output.col.meanSq',
            'output.col.f',
            'output.col.sig'
          ],
          rows: [
            ['output.col.regression', 7752.024389, 2, 3876.012194, 16.220922, 0.000004],
            ['output.col.residual', 11230.716427, 47, 238.951413, null, null],
            ['output.col.total', 18982.740815, 49, null, null, null]
          ],
          footnoteKey: 'output.regression.depFootnote:Y'
        },
        {
          titleKey: 'output.regression.coeffTitle',
          columns: [
            'output.col.model',
            'output.col.b',
            'output.col.stdError',
            'output.col.beta',
            'output.col.t',
            'output.col.sig'
          ],
          rows: [
            ['output.col.constant', 80.848554, 16.266753, null, 4.970172, 0.000009],
            ['X1', 1.703568, 0.299969, 0.644324, 5.67915, 0.000001],
            ['X2', -0.538516, 0.422808, -0.144503, -1.273666, 0.209045]
          ],
          footnoteKey: 'output.regression.depFootnote:Y'
        }
      ])
    )
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(800)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(
      td => td.textContent.trim() === '(Constant)' || td.textContent.trim() === '(Sabit)'
    )
    const num = tds.find(td => td.textContent.trim() === '0.408')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasCorrTitle: has('Correlations — Pearson') || has('Korelasyonlar — Pearson'),
      hasPearsonCorr: has('Pearson Correlation') || has('Pearson Korelasyonu'),
      hasSpearman: has('Spearman Correlation') || has('Spearman Korelasyonu'),
      hasModelSummary: has('Model Summary') || has('Model Özeti'),
      hasRSquare: has('R Square') || has('R Kare'),
      hasCoefficients: has('Coefficients') || has('Katsayılar'),
      hasConstant: has('(Constant)') || has('(Sabit)'),
      hasBeta: has('Beta'),
      hasDepFootnote: has('Dependent Variable: Y') || has('Bağımlı Değişken: Y'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../e2e-correlate-regression.png', fullPage: true })

  const pass =
    info.tables === 5 &&
    info.hasCorrTitle &&
    info.hasPearsonCorr &&
    info.hasSpearman &&
    info.hasModelSummary &&
    info.hasRSquare &&
    info.hasCoefficients &&
    info.hasConstant &&
    info.hasBeta &&
    info.hasDepFootnote &&
    info.labelAlign === 'left' &&
    info.numAlign === 'right' &&
    info.rawKeyLeaks.length === 0

  // Analiz sonuçları Output'u kirletir (outputDirty) — headless'ta kapanış
  // guard'ının native dialogu sonsuza dek bekler. Otomatik "kaydetme/dışa
  // aktarma yok" (1) seçilir (e2e-value-labels.cjs ile aynı desen).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED — see assertions above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
