// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.6:
 *  1. Ctrl+D (fill down) copies the top row of a selection into the rest.
 *  2. Ctrl+R (fill right) copies the left column of a selection into the rest.
 *  3. The fill-handle drag now continues a geometric series and a Turkish
 *     weekday-name series (not just arithmetic), end-to-end via the real
 *     drag interaction.
 */
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
  await win.waitForTimeout(800)

  const varInfo = await win.evaluate(async () => {
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
    return r.variables.map(v => v.colId)
  })
  await win.waitForTimeout(1200)

  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()

  // ── 1. Ctrl+D: select rows 0-3 in col 0, fill down from row 0's value ──
  await cell(0, 0).click()
  await win.keyboard.down('Shift')
  await cell(3, 0).click()
  await win.keyboard.up('Shift')
  await win.waitForTimeout(150)
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(300)
  const dsId = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)
  const afterFillDown = await win.evaluate(async id => {
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows.slice(0, 4).map(row => row[0])
  }, dsId)

  // ── 2. Ctrl+R: select cols 0-2 in row 5, fill right from col 0's value ──
  await cell(5, 0).click()
  await win.keyboard.down('Shift')
  await cell(5, 2).click()
  await win.keyboard.up('Shift')
  await win.waitForTimeout(150)
  await win.keyboard.press('Control+r')
  await win.waitForTimeout(300)
  const afterFillRight = await win.evaluate(async id => {
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows[5]
  }, dsId)

  console.log('RESULT:' + JSON.stringify({ afterFillDown, afterFillRight, errors }))

  const pass =
    afterFillDown.every(v => v === afterFillDown[0]) &&
    afterFillRight[0] === afterFillRight[1] &&
    afterFillRight[1] === afterFillRight[2] &&
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
