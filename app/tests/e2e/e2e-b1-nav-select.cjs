// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies B1 (roadmap-aggrid-excel-features.md Faz 1 completion):
 *   1. Name Box — typing "C7" + Enter focuses that cell; a range "A1:B3"
 *      selects the 6-cell rectangle.
 *   2. Ctrl+ArrowDown jumps to the data-block edge (last row); Ctrl+Shift+
 *      ArrowUp extends the selection back to the top of the column.
 *   3. F8 "extend" mode — after F8, a plain click extends the selection
 *      instead of replacing it; Escape leaves the mode.
 *   4. Range-aware Tab — inside a multi-cell selection, Tab moves the focus
 *      WITHIN the range (wrapping) without collapsing the selection.
 *
 * Fixture: /tmp/sai-30.csv (3 cols ad/yas/puan, 30 dense rows) — run
 * tests/e2e/setup-e2e-fixtures.cjs first.
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
  const nameBox = win.locator('input[placeholder="A1"]')
  const getFocused = () =>
    win.evaluate(() => {
      const el = document.querySelector('.ag-cell.ag-cell-focus')
      if (!el) return null
      const row = el.closest('.ag-row')?.getAttribute('row-index')
      return { row: row === null ? null : Number(row), colId: el.getAttribute('col-id') }
    })
  const selCount = () =>
    win.evaluate(() => document.querySelectorAll('.ag-cell[class*="selectedCell"]').length)

  // ── 1a. Name Box single cell: C7 → col index 2 (puan), visible row 6 ────
  await nameBox.click()
  await nameBox.fill('C7')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(200)
  const nb1 = await getFocused()
  const nameBoxSingle = nb1 && nb1.row === 6 && nb1.colId === varInfo[2]

  // ── 1b. Name Box range: A1:B3 → 3 rows × 2 cols = 6 selected cells ──────
  await nameBox.click()
  await nameBox.fill('A1:B3')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(200)
  const nameBoxRange = (await selCount()) === 6

  // ── 2a. Ctrl+ArrowDown from A1 → jumps to the last row (29) ─────────────
  await cell(0, 0).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+ArrowDown')
  await win.waitForTimeout(200)
  const jf = await getFocused()
  const ctrlArrowJump = jf && jf.row === 29 && jf.colId === varInfo[0]

  // ── 2b. Ctrl+Shift+ArrowUp → extends selection back up the whole column ─
  await win.keyboard.press('Control+Shift+ArrowUp')
  await win.waitForTimeout(200)
  // Column 'ad' has 30 rows; all rendered (small dataset) → 30 selected.
  const ctrlShiftExtend = (await selCount()) === 30

  // ── 3. F8 extend mode: click A1, F8, click cell(4,2) → range A1:C5 ──────
  await cell(0, 0).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('F8')
  await win.waitForTimeout(100)
  await cell(4, 2).click()
  await win.waitForTimeout(200)
  const f8Extend = (await selCount()) === 15 // 5 rows × 3 cols
  await win.keyboard.press('Escape')
  await win.waitForTimeout(100)
  // After Escape, a plain click must replace (single cell) again.
  await cell(10, 1).click()
  await win.waitForTimeout(150)
  const escapeResets = (await selCount()) === 1

  // ── 4. Range-aware Tab: A1:B2 (2×2), focus B2 → Tab wraps to A1, keeps
  //       selection intact. ─────────────────────────────────────────────
  await cell(0, 0).click()
  await win.waitForTimeout(80)
  await cell(1, 1).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  const beforeTabSel = await selCount() // 4
  await win.keyboard.press('Tab')
  await win.waitForTimeout(150)
  const tf = await getFocused()
  const afterTabSel = await selCount()
  const rangeTab =
    beforeTabSel === 4 && afterTabSel === 4 && tf && tf.row === 0 && tf.colId === varInfo[0]

  const result = {
    nameBoxSingle,
    nameBoxRange,
    ctrlArrowJump,
    ctrlShiftExtend,
    f8Extend,
    escapeResets,
    rangeTab,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    nameBoxSingle &&
    nameBoxRange &&
    ctrlArrowJump &&
    ctrlShiftExtend &&
    f8Extend &&
    escapeResets &&
    rangeTab &&
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
