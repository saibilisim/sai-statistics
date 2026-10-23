// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies two Ribbon-adjacent UX fixes reported after G8:
 *  1. Clicking a column header selects the entire column; clicking a row
 *     number (pinned left column) selects the entire row.
 *  2. A structural op (insert row) on a small dataset no longer flashes the
 *     full-screen loading overlay (debounced — only shows past 150ms).
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

  // 1a. Column header click → whole column selected.
  const headerCell = win.locator(`.ag-header-cell[col-id="${varInfo[0]}"]`).first()
  await headerCell.click()
  await win.waitForTimeout(150)
  const colSelected = await win.evaluate(colId => {
    const cells = [
      ...document.querySelectorAll(`.ag-center-cols-container .ag-cell[col-id="${colId}"]`)
    ]
    return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
  }, varInfo[0])

  // 1b. Row number click → whole row selected.
  const rowNumCell = win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="__row_num__"]`).first()
  const rowNumExists = (await rowNumCell.count()) > 0
  let rowSelected = false
  if (rowNumExists) {
    await rowNumCell.click()
    await win.waitForTimeout(150)
    rowSelected = await win.evaluate(() => {
      const cells = [...document.querySelectorAll('.ag-row[row-index="0"] .ag-cell')].filter(
        c => c.getAttribute('col-id') !== '__row_num__'
      )
      return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
    })
  }

  // 2. Structural op (insert row) on a small dataset must not show the
  // loading overlay (checked via a tight poll immediately after triggering).
  const dsId = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)
  const overlaySeen = await win.evaluate(async id => {
    await window.api.data.insertRow({ datasetId: id, rowIndex: 0 })
    const store = window.__SAI_TEST__.useDatasetStore.getState()
    store.setRowCount(store.rowCount + 1)
    store.bumpDataVersion()
    let seen = false
    const deadline = Date.now() + 500
    while (Date.now() < deadline) {
      if (document.querySelector('[class*="loadingOverlay"]')) {
        seen = true
        break
      }
      await new Promise(r => setTimeout(r, 5))
    }
    return seen
  }, dsId)

  console.log(
    'RESULT:' + JSON.stringify({ colSelected, rowNumExists, rowSelected, overlaySeen, errors })
  )

  const pass = colSelected && rowNumExists && rowSelected && !overlaySeen && errors.length === 0

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
