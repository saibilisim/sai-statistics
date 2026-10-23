// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Screen Reader baseline (K3). No screen reader runs in this sandbox
 * (or in CI), so this asserts the structural ARIA contract a screen reader
 * would rely on: StatusBar is a live region (job:complete/error and R status
 * changes get announced without the user needing to poll), and each Output
 * block is an ARIA region labeled with its (translated) title, not just a
 * generic <div> soup. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => {
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  const statusBarInfo = await win.evaluate(() => {
    const el = document.querySelector('[role="status"][aria-live]')
    return {
      found: !!el,
      ariaLive: el ? el.getAttribute('aria-live') : null
    }
  })

  await win.evaluate(async () => {
    const T = window.__SAI_TEST__
    T.useOutputStore.getState().addBlock({
      id: 'a11y-region-test',
      analysisId: 'descriptives',
      titleKey: 'analysis.descriptives.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.descriptives.title',
            columns: ['output.col.n'],
            rows: [[10]],
            footnoteKey: null
          }
        ]
      }
    })
    T.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(600)

  const blockRegionInfo = await win.evaluate(() => {
    const region = document.querySelector('#block-a11y-region-test')
    return {
      found: !!region,
      role: region ? region.getAttribute('role') : null,
      hasLabel: !!(region && (region.getAttribute('aria-label') || '').length > 0),
      rawKeyLeak: region
        ? /\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/.test(region.getAttribute('aria-label') || '')
        : true
    }
  })

  const info = { statusBarInfo, blockRegionInfo }
  console.log(JSON.stringify(info, null, 2))

  const pass =
    statusBarInfo.found &&
    statusBarInfo.ariaLive === 'polite' &&
    blockRegionInfo.found &&
    blockRegionInfo.role === 'region' &&
    blockRegionInfo.hasLabel &&
    !blockRegionInfo.rawKeyLeak

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
