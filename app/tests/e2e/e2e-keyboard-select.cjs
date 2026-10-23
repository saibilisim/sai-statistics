// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.5: Shift+Space selects the focused cell's whole row,
 * Ctrl+Space selects its whole column — Excel/Calc/Sheets convention. Also
 * verifies typing a literal space into an editing cell does NOT trigger
 * either shortcut. */
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

  // Focus row 3, col 1 (a single click focuses without opening the editor).
  await cell(3, 1).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Shift+ ')
  await win.waitForTimeout(150)
  const rowSelected = await win.evaluate(colId => {
    const cells = [...document.querySelectorAll('.ag-row[row-index="3"] .ag-cell')].filter(
      c => c.getAttribute('col-id') !== '__row_num__'
    )
    return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
  }, varInfo[1])

  // Ctrl+Space on the same focused cell → whole column selected.
  await win.keyboard.press('Control+ ')
  await win.waitForTimeout(150)
  const colSelected = await win.evaluate(colId => {
    const cells = [...document.querySelectorAll(`.ag-cell[col-id="${colId}"]`)]
    return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
  }, varInfo[1])

  // Enter edit mode, type a space — must NOT trigger row-select.
  await cell(5, 0).dblclick()
  await win.waitForTimeout(150)
  await win.keyboard.press('Shift+ ')
  await win.waitForTimeout(150)
  const editingRowNotSelected = await win.evaluate(() => {
    const cells = [...document.querySelectorAll('.ag-row[row-index="5"] .ag-cell')].filter(
      c => c.getAttribute('col-id') !== '__row_num__'
    )
    return !cells.every(c => c.className.includes('selectedCell'))
  })
  await win.keyboard.press('Escape')

  console.log(
    'RESULT:' + JSON.stringify({ rowSelected, colSelected, editingRowNotSelected, errors })
  )

  const pass = rowSelected && colSelected && editingRowNotSelected && errors.length === 0

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
