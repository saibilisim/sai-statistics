// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Generalized Linear Models — Goodness of Fit, Omnibus Test, Parameter
 * Estimates. Asserts labels resolve, alignment, no raw key leaks. */
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
      id: 'genlin',
      analysisId: 'genlin',
      titleKey: 'analysis.genlin.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.genlin.gofTitle',
            columns: ['output.col.statistic', 'output.col.value', 'output.col.df'],
            rows: [
              ['output.col.deviance', 153.797, 117],
              ['output.col.aic', 470.76, null],
              ['output.col.bic', 479.122, null]
            ],
            footnoteKey: 'output.genlin.distFootnote:poisson'
          },
          {
            titleKey: 'output.genlin.omniTitle',
            columns: ['output.col.chiSquare', 'output.col.df', 'output.col.sig'],
            rows: [[146.22, 2, 0]],
            footnoteKey: null
          },
          {
            titleKey: 'output.genlin.paramTitle',
            columns: [
              'output.col.model',
              'output.col.b',
              'output.col.stdError',
              'output.col.wald',
              'output.col.df',
              'output.col.sig',
              'output.col.expB',
              'output.col.expBLower',
              'output.col.expBUpper'
            ],
            rows: [
              ['output.col.constant', 0.9226, 0.062, 221.689, 1, 0, 2.516, 2.228, 2.841],
              ['X1', 0.5437, 0.054, 100.296, 1, 0, 1.722, 1.548, 1.916]
            ],
            footnoteKey: 'output.genlin.depFootnote:Count'
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
      td => td.textContent.trim() === 'Deviance' || td.textContent.trim() === 'Sapma (Deviance)'
    )
    const num = tds.find(td => td.textContent.trim() === '153.797')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasGoF: has('Goodness of Fit') || has('Uyum İyiliği'),
      hasDeviance: has('Deviance') || has('Sapma'),
      hasAIC: has('AIC'),
      hasOmnibus: has('Omnibus'),
      hasParam: has('Parameter Estimates') || has('Parametre Tahminleri'),
      hasExpB: has('Exp(B)'),
      hasDistFootnote:
        has('Probability Distribution: poisson') || has('Olasılık Dağılımı: poisson'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 3 &&
    info.hasGoF &&
    info.hasDeviance &&
    info.hasAIC &&
    info.hasOmnibus &&
    info.hasParam &&
    info.hasExpB &&
    info.hasDistFootnote &&
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
