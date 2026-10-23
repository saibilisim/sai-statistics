// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies Ctrl/Shift multi-select on row and column headers:
 *  - Shift+click a row header extends the last row selection to the
 *    clicked row (contiguous block, full width).
 *  - Ctrl+click a row header adds a new discontiguous row to the selection.
 *  - Same two for column headers.
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

  const selectedCellCount = () =>
    win.evaluate(
      () =>
        document.querySelectorAll('.ag-center-cols-container .ag-cell').length &&
        [...document.querySelectorAll('.ag-center-cols-container .ag-cell')].filter(c =>
          c.className.includes('selectedCell')
        ).length
    )

  // ── Row header: shift-click extends 0..3 (4 rows × 3 cols = 12 cells) ──
  const rowNum = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="__row_num__"]`).first()
  await rowNum(0).click()
  await win.waitForTimeout(100)
  await rowNum(3).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  const rowExtendCount = await selectedCellCount()

  // Ctrl-click row 5 adds a single discontiguous row (still 4 rows selected
  // from the shift-block + 1 new = 5 rows × 3 cols = 15).
  await rowNum(5).click({ modifiers: ['ControlOrMeta'] })
  await win.waitForTimeout(150)
  const rowAddCount = await selectedCellCount()

  // ── Column header: shift-click extends col0..col1 (2 cols × 20 rows) ──
  const header = colId => win.locator(`.ag-header-cell[col-id="${colId}"]`).first()
  await header(varInfo[0]).click()
  await win.waitForTimeout(100)
  await header(varInfo[1]).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  const colExtendSelectedBoth = await win.evaluate(
    ([c0, c1]) => {
      const col0 = [...document.querySelectorAll(`.ag-cell[col-id="${c0}"]`)]
      const col1 = [...document.querySelectorAll(`.ag-cell[col-id="${c1}"]`)]
      return (
        col0.length > 0 &&
        col1.length > 0 &&
        col0.every(c => c.className.includes('selectedCell')) &&
        col1.every(c => c.className.includes('selectedCell'))
      )
    },
    [varInfo[0], varInfo[1]]
  )

  // Ctrl-click col2 adds a third, discontiguous column.
  await header(varInfo[2]).click({ modifiers: ['ControlOrMeta'] })
  await win.waitForTimeout(150)
  const colAddIncludesThird = await win.evaluate(c2 => {
    const cells = [...document.querySelectorAll(`.ag-cell[col-id="${c2}"]`)]
    return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
  }, varInfo[2])
  const colAddStillHasFirst = await win.evaluate(c0 => {
    const cells = [...document.querySelectorAll(`.ag-cell[col-id="${c0}"]`)]
    return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
  }, varInfo[0])

  console.log(
    'RESULT:' +
      JSON.stringify({
        rowExtendCount,
        rowAddCount,
        colExtendSelectedBoth,
        colAddIncludesThird,
        colAddStillHasFirst,
        errors
      })
  )

  const pass =
    rowExtendCount === 12 &&
    rowAddCount === 15 &&
    colExtendSelectedBoth === true &&
    colAddIncludesThird === true &&
    colAddStillHasFirst === true &&
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
