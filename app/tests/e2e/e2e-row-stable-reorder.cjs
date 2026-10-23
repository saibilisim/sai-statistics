// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies:
 *  1. Row numbers stay the plain, always-ardışık 1..N display position
 *     across a sort (tried the opposite — a permanent per-record id that
 *     survives sort — and explicitly reverted after user feedback: the two
 *     behaviors are mutually exclusive, this is the confirmed choice).
 *  2. Ctrl+click toggle-off: clicking an already-selected cell/row/column
 *     again with Ctrl held removes it instead of duplicating the range.
 *  3. Dragging the row-number handle physically reorders rows (persisted
 *     via data:reorder-rows) when no sort/filter is active.
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

  const rowNumText = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="__row_num__"]`).first().innerText()

  // ── 1. Row numbers stay position-based (always ardışık) across sort ─────
  const before = await rowNumText(0) // should be "1"
  await win.evaluate(colId => {
    window.__SAI_TEST__.useDatasetStore.getState().setColumnSort(colId, 'desc')
  }, varInfo[1]) // sort by "age" desc — a different case is now on top...
  await win.waitForTimeout(400)
  const afterSortRow0 = await rowNumText(0) // ...but its displayed number is still "1"
  await win.evaluate(() => {
    window.__SAI_TEST__.useDatasetStore.getState().setColumnSort('', null)
  })
  await win.waitForTimeout(400)

  // ── 2. Ctrl+click toggle-off (row header) ───────────────────────────────
  const rowNum = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="__row_num__"]`).first()
  await rowNum(2).click()
  await win.waitForTimeout(100)
  await rowNum(2).click({ modifiers: ['ControlOrMeta'] }) // toggle off
  await win.waitForTimeout(150)
  const rowDeselected = await win.evaluate(() => {
    const cells = [...document.querySelectorAll('.ag-row[row-index="2"] .ag-cell')].filter(
      c => c.getAttribute('col-id') !== '__row_num__'
    )
    return cells.every(c => !c.className.includes('selectedCell'))
  })

  // ── 2b. Ctrl+click toggle-off (regular cell) ────────────────────────────
  const cell = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="${varInfo[0]}"]`).first()
  await cell(5).click()
  await win.waitForTimeout(100)
  await cell(5).click({ modifiers: ['ControlOrMeta'] })
  await win.waitForTimeout(150)
  const cellDeselected = await cell(5).evaluate(el => !el.className.includes('selectedCell'))

  // ── 3. Row drag reorder ──────────────────────────────────────────────────
  const idAtRow0Before = await win.evaluate(() => {
    const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
    return api.getDisplayedRowAtIndex(0)?.data?.[0]
  })
  const idAtRow2Before = await win.evaluate(() => {
    const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
    return api.getDisplayedRowAtIndex(2)?.data?.[0]
  })

  const source = rowNum(0)
  const target = rowNum(2)
  const srcBox = await source.boundingBox()
  const tgtBox = await target.boundingBox()
  await win.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2, { steps: 10 })
  await win.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2 + 2, { steps: 2 })
  await win.mouse.up()
  await win.waitForTimeout(600)

  const dsId = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)
  const dbRows = await win.evaluate(async id => {
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows.slice(0, 4).map(r => r[0])
  }, dsId)

  console.log(
    'RESULT:' +
      JSON.stringify({
        before,
        afterSortRow0,
        rowDeselected,
        cellDeselected,
        idAtRow0Before,
        idAtRow2Before,
        dbRowsAfterDrag: dbRows,
        errors
      })
  )

  const pass =
    before === '1' &&
    afterSortRow0 === '1' &&
    rowDeselected === true &&
    cellDeselected === true &&
    // the row that was at position 0 should now be at/near position 2 in the DB
    dbRows.includes(idAtRow0Before) &&
    dbRows[0] !== idAtRow0Before &&
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
