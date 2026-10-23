// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Linear Regression diagnostics — Model Summary with Durbin-Watson and
 * Coefficients with Collinearity (Tolerance/VIF). Asserts labels resolve,
 * alignment, no raw key leaks. */
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
    T.useOutputStore.getState().addBlock({
      id: 'regression',
      analysisId: 'regression',
      titleKey: 'analysis.regression.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.regression.modelSummaryTitle',
            columns: [
              'output.col.rVal',
              'output.col.rSquare',
              'output.col.adjRSquare',
              'output.col.stdErrEst',
              'output.col.durbinWatson'
            ],
            rows: [[0.807, 0.652, 0.633, 0.993, 1.903]],
            footnoteKey: null
          },
          {
            titleKey: 'output.regression.coeffTitle',
            columns: [
              'output.col.model',
              'output.col.b',
              'output.col.stdError',
              'output.col.beta',
              'output.col.t',
              'output.col.sig',
              'output.col.tolerance',
              'output.col.vif'
            ],
            rows: [
              ['output.col.constant', 2.123, 0.129, null, 16.47, 0.0000001, null, null],
              ['X1', 1.469, 0.176, 0.91, 8.338, 0.0000001, 0.5222, 1.9151]
            ],
            footnoteKey: 'output.regression.depFootnote:Y'
          }
        ]
      }
    })
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
    const num = tds.find(td => td.textContent.trim() === '1.903')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasDW: has('Durbin-Watson'),
      hasTolerance: has('Tolerance') || has('Tolerans'),
      hasVIF: has('VIF'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 2 &&
    info.hasDW &&
    info.hasTolerance &&
    info.hasVIF &&
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
    console.error('E2E FAILED')
    process.exit(1)
  }
  console.log('E2E PASSED')
}
main().catch(err => {
  console.error(err)
  process.exit(1)
})
