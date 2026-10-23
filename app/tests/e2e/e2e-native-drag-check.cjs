// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Reproduces the user's 3 reports against the native-rowDragManaged setup:
 *  A) after dropping a native row drag, the row-number gutter must read
 *     1..N sequential IMMEDIATELY (no extra click needed).
 *  B) clicking a row-number cell selects the WHOLE row.
 *  C) clicking a data cell selects just that cell (not the whole row). */
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
  const cols = await win.evaluate(async () => {
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

  const readRowNums = () =>
    win.evaluate(() =>
      [...document.querySelectorAll('.ag-pinned-left-cols-container .ag-row')]
        .sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')))
        .map(r => r.querySelector('.ag-cell')?.textContent?.trim())
        .slice(0, 8)
    )

  // ── B) click row-number cell of row 3 → whole row selected ──────────────
  const rowNumCell = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="__row_num__"]`).first()
  await rowNumCell(3).click()
  await win.waitForTimeout(150)
  const rowSelState = await win.evaluate(colId => {
    const dataCells = [...document.querySelectorAll('.ag-row[row-index="3"] .ag-cell')].filter(
      c => c.getAttribute('col-id') !== '__row_num__'
    )
    const allCellsSel =
      dataCells.length > 0 && dataCells.every(c => c.className.includes('selectedCell'))
    const rowEl = document.querySelector('.ag-center-cols-container .ag-row[row-index="3"]')
    const nativeSel = rowEl?.className.includes('ag-row-selected') ?? false
    return { allCellsSel, nativeSel }
  }, cols[0])

  // ── C) click a data cell → only that cell selected, row not fully sel ──
  const dataCell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${cols[c]}"]`).first()
  await dataCell(5, 1).click()
  await win.waitForTimeout(150)
  const cellSelState = await win.evaluate(() => {
    const target = document.querySelector(
      '.ag-row[row-index="5"] .ag-cell[col-id]:not([col-id="__row_num__"])'
    )
    const rowEl = document.querySelector('.ag-center-cols-container .ag-row[row-index="5"]')
    const selCount = document.querySelectorAll(
      '.ag-row[row-index="5"] .ag-cell.' +
        [...(target?.classList || [])].find(c => c.includes('selectedCell'))
    ).length
    // Count selected cells in row 5
    const selectedInRow = [...document.querySelectorAll('.ag-row[row-index="5"] .ag-cell')].filter(
      c => /selectedCell/.test(c.className)
    ).length
    return { selectedInRow, nativeRowSel: rowEl?.className.includes('ag-row-selected') ?? false }
  })

  // ── A) native drag row 0 → down ~5 rows, then read numbers with NO extra click
  const handle = win
    .locator('.ag-row[row-index="0"] .ag-cell[col-id="__row_num__"] .ag-drag-handle')
    .first()
  const hasHandle = await handle.count()
  const h0 = await rowNumCell(0).boundingBox()
  const h5 = await rowNumCell(5).boundingBox()
  await win.mouse.move(h0.x + h0.width / 2, h0.y + h0.height / 2)
  await win.mouse.down()
  await win.mouse.move(h0.x + h0.width / 2, h0.y + h0.height * 2, { steps: 4 })
  await win.mouse.move(h5.x + h5.width / 2, h5.y + h5.height / 2, { steps: 8 })
  await win.waitForTimeout(150)
  await win.mouse.up()
  await win.waitForTimeout(150) // brief — BEFORE any extra click
  const numsRightAfterDrop = await readRowNums()
  const dbIdsAfter = await win.evaluate(async () => {
    const id = window.__SAI_TEST__.useDatasetStore.getState().datasetId
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows.map(row => row[0]).slice(0, 8)
  })

  // nums120/nums500/nums1100 were three "read the gutter after N ms" probes
  // from when the repaint timing was still being diagnosed; they were deleted
  // but their names were left in this log line, so the script crashed with
  // "nums120 is not defined" before ever asserting anything (denetim §5).
  const result = { rowSelState, cellSelState, hasHandle, numsRightAfterDrop, dbIdsAfter, errors }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    // A) the gutter reads 1..8 immediately after the drop, with no extra click
    numsRightAfterDrop.join(',') === '1,2,3,4,5,6,7,8' &&
    hasHandle > 0 &&
    // B) a row-number click selects the whole row in our own selection layer.
    //    AG Grid's native row selection also turns on here, by design — it is
    //    what feeds rowDragMultiRow — so it is not asserted against.
    rowSelState.allCellsSel &&
    // C) a data-cell click selects exactly one cell and does not select the row
    cellSelState.selectedInRow === 1 &&
    !cellSelState.nativeRowSel &&
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
