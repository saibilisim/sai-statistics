// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies B3 (roadmap-aggrid-excel-features.md Faz 2 — data-entry accelerators):
 *   1. Ctrl+Enter — broadcasts the focused cell's value to the whole selection.
 *   2. Ctrl+'     — copies the cell directly above into the focused cell.
 *   3. Ctrl+;     — inserts today's date into a (text) cell.
 *   4. Fill-handle double-click — auto-fills down to the neighbour column's length.
 *   5. Alt+↓      — opens a dropdown of the column's existing values; picking
 *                   one enters it.
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
  const cellText = async (r, c) => (await cell(r, c).innerText()).trim()
  const cellNum = async (r, c) => parseFloat(await cellText(r, c))

  // ── 1. Ctrl+Enter broadcast: select B1:B3 (focus B3 = yas row2 = 21) ─────
  await cell(0, 1).click()
  await win.waitForTimeout(80)
  await cell(2, 1).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(120)
  await win.keyboard.press('Control+Enter')
  await win.waitForTimeout(250)
  const bcast =
    (await cellNum(0, 1)) === 21 && (await cellNum(1, 1)) === 21 && (await cellNum(2, 1)) === 21

  // ── 2. Ctrl+' copy from above: focus C4 (row3) → becomes C3 (row2, 71) ───
  await cell(3, 2).click()
  await win.waitForTimeout(100)
  await win.keyboard.press("Control+'")
  await win.waitForTimeout(250)
  const copyAbove = (await cellNum(3, 2)) === 71

  // ── 3. Ctrl+; date into a text cell A5 (row4) ───────────────────────────
  const expectedDate = await win.evaluate(() => new Date().toLocaleDateString())
  await cell(4, 0).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+;')
  await win.waitForTimeout(250)
  const dateInserted = (await cellText(4, 0)) === expectedDate

  // ── 4. Fill-handle double-click on C1 (row0, puan=57) → fills down ───────
  await cell(0, 2).click()
  await win.waitForTimeout(120)
  const box = await cell(0, 2).boundingBox()
  await win.mouse.dblclick(box.x + box.width - 3, box.y + box.height - 3)
  await win.waitForTimeout(350)
  const autoFill = (await cellNum(10, 2)) === 57 && (await cellNum(25, 2)) === 57

  // ── 5. Alt+↓ dropdown on A2 (row1) → pick "Kisi01" ──────────────────────
  await cell(1, 0).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Alt+ArrowDown')
  await win.waitForTimeout(250)
  const menuCount = await win.locator('[role="menu"] [role="menuitem"]').count()
  const menuOpen = menuCount > 0
  const firstItemText = menuOpen
    ? await win.locator('[role="menu"] [role="menuitem"]').first().innerText()
    : ''
  await win.locator('[role="menu"] [role="menuitem"]', { hasText: 'Kisi01' }).first().click()
  await win.waitForTimeout(300)
  const a2after = await cellText(1, 0)
  const dropdownPick = a2after === 'Kisi01'

  const result = {
    bcast,
    copyAbove,
    dateInserted,
    autoFill,
    menuOpen,
    menuCount,
    firstItemText,
    a2after,
    dropdownPick,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    bcast &&
    copyAbove &&
    dateInserted &&
    autoFill &&
    menuOpen &&
    dropdownPick &&
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
