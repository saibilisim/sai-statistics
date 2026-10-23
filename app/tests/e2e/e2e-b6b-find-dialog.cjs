// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the full Bul ve Değiştir dialog (Google-Sheets model: quick bar +
 * ⋯ opens the power dialog — chosen over a Word/LibreOffice-style modal-only
 * design because the grid must stay visible while searching):
 *   1. ⋯ opens the dialog carrying the bar's term + match count.
 *   2. "Yalnızca seçili alanda" restricts matches to the selection.
 *   3. Direction: Columns changes which match is "next" (column-major order).
 *   4. "Tümünü Bul" selects every matching cell at once.
 *   5. "Tümünü Değiştir" from the dialog rewrites all matches.
 *   6. "Boş hücreleri bul" + Tümünü Bul selects every blank cell — Excel's
 *      F5 ▸ Special ▸ Blanks, folded into Find instead of a 2nd dialog.
 *      (Filling them afterwards is Ctrl+Enter, covered by e2e-b3-data-entry.)
 *
 * Fixture: /tmp/sai-30.csv (ad "Kisi01".."Kisi30").
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
  const dialog = win.locator('[role="dialog"][aria-label="Bul ve Değiştir"]')
  const status = () => dialog.locator('[role="status"]').innerText()
  const check = label => dialog.locator(`label:has-text("${label}") input`)
  const dlgBtn = label => dialog.locator('button', { hasText: label }).first()

  const openDialog = async term => {
    await win.keyboard.press('Control+f')
    await win.waitForTimeout(300)
    await win.locator('[role="search"] input').first().fill(term)
    await win.waitForTimeout(400)
    await win.locator('[role="search"] button[aria-label*="Diğer seçenekler"]').click()
    await win.waitForTimeout(400)
  }

  // ── 1. Selection scope: select A1:A5, then search "Kisi0" (9 grid-wide) ──
  await cell(0, 0).click()
  await win.waitForTimeout(100)
  await cell(4, 0).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  await openDialog('Kisi0')
  const beforeScope = await status() // 1 / 9
  await check('Yalnızca seçili alanda').check()
  await win.waitForTimeout(400)
  const afterScope = await status() // 1 / 5 (rows 0..4)
  await check('Yalnızca seçili alanda').uncheck()
  await win.waitForTimeout(400)

  // ── 2. Direction: Columns — order changes, count stays ───────────────────
  await dialog.locator('input[type=radio]').nth(1).check()
  await win.waitForTimeout(400)
  const afterDirection = await status()

  // ── 3. Tümünü Bul selects all 9 matches ─────────────────────────────────
  await dlgBtn('Tümünü Bul').click()
  await win.waitForTimeout(500)
  const selectedCells = await win.locator('.ag-cell[class*="selectedCell"]').count()

  // ── 4. Tümünü Değiştir: "Kisi0" → "Case0" across the 9 matches ──────────
  await dialog.locator('input[type=text]').nth(1).fill('Case0')
  await win.waitForTimeout(200)
  await dlgBtn('Tümünü Değiştir').click()
  await win.waitForTimeout(800)
  const a1 = (await cell(0, 0).innerText()).trim()
  const a9 = (await cell(8, 0).innerText()).trim()
  const a10 = (await cell(9, 0).innerText()).trim() // Kisi10 — untouched
  // "Kisi01" with "Kisi0"→"Case0" becomes "Case01" (substring replace).
  const replacedAll = a1 === 'Case01' && a9 === 'Case09' && a10 === 'Kisi10'

  // ── 5. Empty cells: blank three cells, find them, select all, fill via
  //       Ctrl+Enter (Excel's F5 ▸ Blanks flow). ──────────────────────────
  await win.evaluate(async colId => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    await window.api.data.updateCells({
      datasetId: ds.datasetId,
      updates: [
        { rowIndex: 1, colId, value: null },
        { rowIndex: 3, colId, value: null },
        { rowIndex: 5, colId, value: null }
      ]
    })
    ds.bumpDataVersion()
  }, varInfo[2])
  await win.waitForTimeout(1200)

  // The dialog from the previous step is still open — reuse it rather than
  // reopening (Ctrl+F while it's up wouldn't surface the ⋯ button again).
  await check('Boş hücreleri bul').check()
  await win.waitForTimeout(500)
  const emptyCount = await status() // 1 / 3
  await dlgBtn('Tümünü Bul').click()
  await win.waitForTimeout(500)
  const emptySelected = await win.locator('.ag-cell[class*="selectedCell"]').count()
  await dlgBtn('Kapat').click()
  await win.waitForTimeout(300)

  const result = {
    emptyCount,
    emptySelected,
    beforeScope,
    afterScope,
    afterDirection,
    selectedCells,
    a1,
    a9,
    a10,
    replacedAll,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    beforeScope.includes('9') &&
    afterScope.includes('5') &&
    afterDirection.includes('9') &&
    selectedCells === 9 &&
    replacedAll &&
    emptyCount.includes('3') &&
    emptySelected === 3 &&
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
