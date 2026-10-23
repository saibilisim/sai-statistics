// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the deselect fix: Ctrl+click toggle-off must work regardless of
 * whether the target cell/row/column ended up selected via Shift-extend or
 * Ctrl-add — not just when it's its own standalone range. Also checks the
 * row-drag visual feedback classes appear during a drag. */
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

  const rowNum = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="__row_num__"]`).first()
  const isRowSelected = async i =>
    win.evaluate(idx => {
      const cells = [...document.querySelectorAll(`.ag-row[row-index="${idx}"] .ag-cell`)].filter(
        c => c.getAttribute('col-id') !== '__row_num__'
      )
      return cells.length > 0 && cells.every(c => c.className.includes('selectedCell'))
    }, i)

  // ── Shift-block, then Ctrl+click deselect a row INSIDE the block ───────
  await rowNum(0).click()
  await win.waitForTimeout(100)
  await rowNum(4).click({ modifiers: ['Shift'] }) // rows 0..4 selected as ONE range
  await win.waitForTimeout(150)
  const beforeDeselect = await Promise.all([0, 1, 2, 3, 4].map(isRowSelected))

  await rowNum(2).click({ modifiers: ['ControlOrMeta'] }) // toggle off row 2, mid-block
  await win.waitForTimeout(150)
  const afterDeselect = await Promise.all([0, 1, 2, 3, 4].map(isRowSelected))

  // ── Same for a regular cell inside a Shift-drawn rectangle ──────────────
  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()
  await cell(6, 0).click()
  await win.waitForTimeout(100)
  await win.keyboard.down('Shift')
  await cell(8, 1).click()
  await win.keyboard.up('Shift')
  await win.waitForTimeout(150)
  await cell(7, 0).click({ modifiers: ['ControlOrMeta'] }) // interior cell of the block
  await win.waitForTimeout(150)
  const interiorCellDeselected = await cell(7, 0).evaluate(
    el => !el.className.includes('selectedCell')
  )
  const neighborStillSelected = await cell(6, 0).evaluate(el =>
    el.className.includes('selectedCell')
  )

  // (Row-drag visual feedback is now native AG Grid rowDragManaged — covered
  // by e2e-multi-row-drag.cjs — so this test focuses purely on deselect.)

  console.log(
    'RESULT:' +
      JSON.stringify({
        beforeDeselect,
        afterDeselect,
        interiorCellDeselected,
        neighborStillSelected,
        errors
      })
  )

  const pass =
    beforeDeselect.every(Boolean) &&
    afterDeselect[0] === true &&
    afterDeselect[1] === true &&
    afterDeselect[2] === false &&
    afterDeselect[3] === true &&
    afterDeselect[4] === true &&
    interiorCellDeselected === true &&
    neighborStillSelected === true &&
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
