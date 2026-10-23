// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies B5 (roadmap Faz 4 — structural shortcuts + view options):
 *   1. Focus Cell crosshair — View toggle tints the focused cell's row+column.
 *   2. Gridlines toggle — View toggle removes the cell borders.
 *   3. Ctrl+Shift++ inserts a row above the focused row.
 *   4. Ctrl+- deletes the selected rows.
 *   5. Ctrl+0 hides the focused column; Ctrl+Shift+0 shows all again.
 *   6. Equal column width — context menu sizes selected columns alike.
 *
 * Fixture: /tmp/sai-30.csv (ad[text], yas[num], puan[num]; 30 rows).
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
    const r = await window.api.file.import({ filePath: '/tmp/sai-30.csv' })
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
  const rowCount = () => win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().rowCount)

  // ── 1. Focus Cell crosshair ─────────────────────────────────────────────
  await cell(3, 1).click()
  await win.waitForTimeout(150)
  const crossBefore = await win.locator('[class*="focusCross"]').count()
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().toggleFocusCellHighlight()
  })
  await win.waitForTimeout(200)
  await cell(3, 1).click()
  await win.waitForTimeout(250)
  const crossAfter = await win.locator('[class*="focusCross"]').count()
  const focusCross = crossBefore === 0 && crossAfter > 0
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().toggleFocusCellHighlight()
  })
  await win.waitForTimeout(200)

  // ── 2. Gridlines toggle ─────────────────────────────────────────────────
  const gridLinesOnCount = await win.locator('[class*="noGridLines"]').count()
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().toggleGridLines()
  })
  await win.waitForTimeout(250)
  const gridLinesOffCount = await win.locator('[class*="noGridLines"]').count()
  const gridToggle = gridLinesOnCount === 0 && gridLinesOffCount > 0
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().toggleGridLines()
  })
  await win.waitForTimeout(200)

  // ── 3. Ctrl+Shift++ inserts a row ───────────────────────────────────────
  const beforeInsert = await rowCount()
  await cell(2, 1).click()
  await win.waitForTimeout(120)
  await win.keyboard.press('Control+Shift+Equal')
  await win.waitForTimeout(700)
  const afterInsert = await rowCount()
  const insertShortcut = afterInsert === beforeInsert + 1

  // ── 4. Ctrl+- deletes the selected row ──────────────────────────────────
  await cell(2, 1).click()
  await win.waitForTimeout(120)
  await win.keyboard.press('Control+Minus')
  await win.waitForTimeout(700)
  const afterDelete = await rowCount()
  const deleteShortcut = afterDelete === afterInsert - 1

  // ── 5. Ctrl+0 hides a column, Ctrl+Shift+0 restores ─────────────────────
  const colsVisible = () =>
    win.evaluate(() => document.querySelectorAll('.ag-header-cell[col-id^="col_"]').length)
  const colsBefore = await colsVisible()
  await cell(1, 2).click()
  await win.waitForTimeout(120)
  await win.keyboard.press('Control+Digit0')
  await win.waitForTimeout(400)
  const colsHidden = await colsVisible()
  await win.keyboard.press('Control+Shift+Digit0')
  await win.waitForTimeout(400)
  const colsRestored = await colsVisible()
  const hideShortcut = colsHidden === colsBefore - 1 && colsRestored === colsBefore

  // ── 6. Equal column width: select A..C, right-click C, choose the item ───
  await cell(0, 0).click()
  await win.waitForTimeout(100)
  await cell(0, 2).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  await cell(0, 2).click({ button: 'right' })
  await win.waitForTimeout(400)
  await win.locator('[role="menu"] [role="menuitem"]', { hasText: 'eşit genişlik' }).first().click()
  await win.waitForTimeout(500)
  const widths = await win.evaluate(
    ids =>
      ids.map(id =>
        Math.round(
          document.querySelector(`.ag-header-cell[col-id="${id}"]`).getBoundingClientRect().width
        )
      ),
    varInfo
  )
  const equalWidth = widths.every(w => Math.abs(w - widths[0]) <= 1)

  const result = {
    focusCross,
    gridToggle,
    insertShortcut,
    deleteShortcut,
    hideShortcut,
    equalWidth,
    widths,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))
  const pass =
    focusCross &&
    gridToggle &&
    insertShortcut &&
    deleteShortcut &&
    hideShortcut &&
    equalWidth &&
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
