// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Types a letter into a numeric cell. Expectation: the edit is rejected — the
 * DuckDB value is unchanged (not deleted) and a warning banner appears. */
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
  await win.waitForTimeout(1500)

  const dsId = await win.evaluate(async () => {
    const r = await window.api.file.import({ filePath: '/tmp/sai-test.csv' })
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
    return r.dataset.id
  })
  await win.waitForTimeout(2500)

  // Edit the "yas" (numeric) cell of row 1: double-click, type letters, Enter.
  await win.mouse.dblclick(195, 80)
  await win.waitForTimeout(600)
  await win.keyboard.press('Control+A')
  await win.keyboard.type('abc')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(1200)
  await win.screenshot({ path: '/tmp/sai-numeric-reject.png' })

  const res = await win.evaluate(async dsId => {
    const data = await window.api.data.getAll({ datasetId: dsId })
    const banner = document.querySelector('[role="alert"]')
    return {
      firstRow: data.rows[0],
      bannerShown: !!banner,
      bannerText: banner ? banner.textContent : null
    }
  }, dsId)
  console.log('NUMREJECT:' + JSON.stringify(res))

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
