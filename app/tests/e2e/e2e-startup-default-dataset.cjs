// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Regression test for "uygulama ilk açıldığında boş sayfa geliyor, no rows
 * to show diyor, sütun yer değişince default değerler geliyor" — App.tsx
 * itself auto-creates a blank default dataset on startup (file:new) so
 * DataView never shows the placeholder screen. This is the REAL first-load
 * race: App.tsx's own useEffect calls file.new()+setDataset on mount, which
 * is exactly the double-loadData-trigger scenario (onGridReady fires +
 * the loadData-dependency effect fires on the same initial mount). No
 * scripted interaction here at all — just launch and look, matching
 * exactly what the user does. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')

  // No manual import, no interaction — just wait for the app's own startup
  // sequence (settings load → file:new → setDataset → DataView mount) to
  // settle, exactly like a real user staring at the freshly-opened window.
  await win.waitForTimeout(2000)

  const state = await win.evaluate(() => {
    const s = window.__SAI_TEST__.useDatasetStore.getState()
    return { datasetId: s.datasetId, rowCount: s.rowCount, variableCount: s.variables.length }
  })
  const domRowCount = await win.evaluate(
    () => document.querySelectorAll('.ag-center-cols-container .ag-row').length
  )
  const noRowsOverlayVisible = await win.evaluate(() => {
    const overlay = document.querySelector('.ag-overlay-no-rows-center')
    return !!overlay && overlay.offsetParent !== null
  })

  console.log('RESULT:' + JSON.stringify({ state, domRowCount, noRowsOverlayVisible, errors }))

  const pass =
    state.datasetId !== null &&
    state.rowCount > 0 &&
    domRowCount > 0 &&
    !noRowsOverlayVisible &&
    errors.length === 0

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

main().catch(e => {
  console.error(e)
  process.exit(1)
})
