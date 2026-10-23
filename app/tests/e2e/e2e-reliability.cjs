// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Reliability Analysis (Cronbach's alpha) — Reliability Statistics +
 * Item-Total Statistics. Asserts labels resolve, alignment, no raw key leaks. */
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
      id: 'reliability',
      analysisId: 'reliability',
      titleKey: 'analysis.reliability.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.reliability.statsTitle',
            columns: ['output.col.cronbachAlpha', 'output.col.nItems'],
            rows: [[0.8991, 4]],
            footnoteKey: null
          },
          {
            titleKey: 'output.reliability.itemTotalTitle',
            columns: [
              'output.col.variable',
              'output.col.scaleMeanDel',
              'output.col.scaleVarDel',
              'output.col.corrItemTotal',
              'output.col.alphaDel'
            ],
            rows: [
              ['Q1', 8.56, 12.7943, 0.8128, 0.8564],
              ['Q2', 8.65, 13.3207, 0.7923, 0.8651]
            ],
            footnoteKey: null
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
    const txt = tds.find(td => td.textContent.trim() === 'Q1')
    const num = tds.find(td => td.textContent.trim() === '0.899')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasRelStats: has('Reliability Statistics') || has('Güvenilirlik İstatistikleri'),
      hasAlpha: has("Cronbach's Alpha") || has('Cronbach Alfa'),
      hasItemTotal: has('Item-Total Statistics') || has('Madde-Toplam'),
      hasCorrItem: has('Corrected Item-Total') || has('Düzeltilmiş Madde-Toplam'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 2 &&
    info.hasRelStats &&
    info.hasAlpha &&
    info.hasItemTotal &&
    info.hasCorrItem &&
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
