// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Explore Normal Q-Q plot renders with translated title, no key leaks. */
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
      id: 'explore',
      analysisId: 'explore',
      titleKey: 'analysis.explore.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        tables: [],
        warnings: [],
        notes: [],
        plots: [
          {
            titleKey: 'output.explore.qqTitle:Score',
            type: 'plotly',
            data: {
              data: [
                { type: 'scatter', mode: 'markers', x: [-1.6, 0, 1.6], y: [35, 50, 65] },
                { type: 'scatter', mode: 'lines', x: [-1.6, 1.6], y: [34, 66] }
              ],
              layout: {}
            }
          }
        ]
      }
    })
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(1500)
  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const pt = Array.from(document.querySelectorAll('[class*="plotTitle"]')).map(e => e.textContent)
    return {
      plots: document.querySelectorAll('.js-plotly-plot').length,
      plotTitles: pt,
      hasQQTitle: pt.some(t => t.includes('Normal Q-Q')),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass = info.plots === 1 && info.hasQQTitle && info.rawKeyLeaks.length === 0
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
