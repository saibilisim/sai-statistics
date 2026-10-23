// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies B4 (roadmap Faz 3 — advanced clipboard):
 *   1. Paste Special ▸ Transpose (Ctrl+Shift+V) — a clipboard row pastes as a column.
 *   2. Paste Special ▸ Format (visuals only, value kept) and ▸ Formula
 *      (formula copied with relative refs shifted).
 *   3. Copy shows a marching-ants dashed frame (a .copiedTop edge class appears).
 *   4. Ctrl+X cut then paste clears the source cells (a move).
 *   5. Ctrl+\ clears a cell's visual format (keeps the value).
 *
 * Fixture: /tmp/sai-30.csv (ad[text], yas[num], puan[num]; 30 rows).
 */
const { _electron } = require('@playwright/test')
const { makeClipboard } = require('./e2e-clipboard.cjs')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const clip = makeClipboard(app, win)

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
  const formulaBar = win.locator('input[class*="formulaBar"]')
  const clickMenuItem = async text => {
    await win.locator('[role="menu"] [role="menuitem"]', { hasText: text }).first().click()
    await win.waitForTimeout(300)
  }

  // ── 1. Paste Special ▸ Transpose: "1\t2\t3" (a row) → column C1..C3 ──────
  await cell(0, 2).click()
  await win.waitForTimeout(100)
  await clip.write('1\t2\t3')
  await win.keyboard.press('Control+Shift+V')
  await win.waitForTimeout(200)
  await clickMenuItem('transpoze')
  const transpose =
    (await cellNum(0, 2)) === 1 && (await cellNum(1, 2)) === 2 && (await cellNum(2, 2)) === 3

  // ── 2a. Paste Special ▸ Format: bold C1, copy it, paste format onto C5 →
  //       C5 becomes bold but keeps its own value. ───────────────────────────
  const c5Before = await cellNum(4, 2)
  await win.evaluate(colId => {
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setCustomStyles({ cells: { r0: { [colId]: { bold: true } } } })
  }, varInfo[2])
  await win.waitForTimeout(150)
  await cell(0, 2).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+c')
  await win.waitForTimeout(200)
  await cell(4, 2).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+Shift+V')
  await win.waitForTimeout(200)
  await clickMenuItem('biçimi')
  const formatPaste =
    (await win.evaluate(
      colId =>
        window.__SAI_TEST__.useDatasetStore.getState().customStyles?.cells?.r4?.[colId]?.bold ===
        true,
      varInfo[2]
    )) && (await cellNum(4, 2)) === c5Before

  // ── 2b. Paste Special ▸ Formula: put "=B1+100" in C1, copy it, paste the
  //       formula onto C6 → it shifts to "=B6+100" (relative refs follow). ──
  await cell(0, 2).click()
  await win.waitForTimeout(120)
  await formulaBar.click()
  await formulaBar.fill('=B1+100')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)
  await cell(0, 2).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+c')
  await win.waitForTimeout(200)
  await cell(5, 2).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+Shift+V')
  await win.waitForTimeout(200)
  await clickMenuItem('formülleri')
  // yas row5 = 18 + (6 % 40) = 24 → 24 + 100 = 124
  const yas6 = await cellNum(5, 1)
  const formulaPaste = (await cellNum(5, 2)) === yas6 + 100

  // ── 3. Marching ants: copy B3 → a .copiedTop edge class appears ─────────
  await cell(2, 1).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+c')
  await win.waitForTimeout(200)
  const marchingAnts = (await win.locator('[class*="copiedTop"]').count()) > 0

  // ── 4. Cut B1 (yas=19), paste at B10 → B10=19 and B1 cleared ────────────
  await cell(0, 1).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+x')
  await win.waitForTimeout(150)
  await cell(9, 1).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+v')
  await win.waitForTimeout(400)
  const cutMove = (await cellNum(9, 1)) === 19 && (await cellText(0, 1)) === ''

  // ── 5. Ctrl+\ clears a cell's format (set bold via store, then clear) ───
  await win.evaluate(colId => {
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setCustomStyles({ cells: { r5: { [colId]: { bold: true } } } })
  }, varInfo[0])
  await win.waitForTimeout(150)
  await cell(5, 0).click()
  await win.waitForTimeout(100)
  await win.keyboard.press('Control+\\')
  await win.waitForTimeout(200)
  const formatCleared = await win.evaluate(colId => {
    const cs = window.__SAI_TEST__.useDatasetStore.getState().customStyles
    return cs?.cells?.r5?.[colId]?.bold === undefined
  }, varInfo[0])

  const result = {
    transpose,
    formatPaste,
    formulaPaste,
    marchingAnts,
    cutMove,
    formatCleared,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))
  const pass =
    transpose &&
    formatPaste &&
    formulaPaste &&
    marchingAnts &&
    cutMove &&
    formatCleared &&
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
