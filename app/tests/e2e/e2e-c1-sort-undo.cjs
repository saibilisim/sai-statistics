// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies C1 follow-up: sort/filter are renderer-only view state, so
 * `data:undo` (a DuckDB snapshot restore) can't undo them. They now have
 * their own view-undo stack, tried BEFORE the DB → cell undo chain:
 *   1. Sorting then Undo restores the previous order.
 *   2. Redo re-applies the sort.
 *   3. The sort indicator (▲/▼) follows undo/redo.
 *   4. A view undo does NOT disturb the data (row count unchanged).
 *
 * Fixture: /tmp/sai-30.csv (yas ascending 19..48 in natural order).
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

  const col = varInfo[1] // yas
  const firstCell = () =>
    win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${col}"]`).first().innerText()
  const indicator = async () => {
    const n = await win.locator('[class*="sortIndicator"]').count()
    return n === 0 ? '' : (await win.locator('[class*="sortIndicator"]').first().innerText()).trim()
  }
  const rowCount = () => win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().rowCount)
  const clickUndo = () =>
    win.locator('button[title*="Geri Al"], button[aria-label*="Geri Al"]').first().click()
  const clickRedo = () =>
    win.locator('button[title*="İleri Al"], button[aria-label*="İleri Al"]').first().click()

  const before = (await firstCell()).trim() // 19.00
  const rowsBefore = await rowCount()

  // ── Sort descending via the context menu ────────────────────────────────
  await win.locator(`.ag-header-cell[col-id="${col}"]`).first().click({ button: 'right' })
  await win.waitForTimeout(400)
  await win.locator('[role="menu"] [role="menuitem"]', { hasText: 'Azalan Sırala' }).first().click()
  await win.waitForTimeout(700)
  const sorted = (await firstCell()).trim() // 48.00
  const sortedIndicator = await indicator() // ▼

  // ── Undo → back to the original order ───────────────────────────────────
  await clickUndo()
  await win.waitForTimeout(800)
  const afterUndo = (await firstCell()).trim()
  const undoIndicator = await indicator()
  const rowsAfterUndo = await rowCount()

  // ── Redo → sorted again ─────────────────────────────────────────────────
  await clickRedo()
  await win.waitForTimeout(800)
  const afterRedo = (await firstCell()).trim()
  const redoIndicator = await indicator()

  const result = {
    before,
    sorted,
    sortedIndicator,
    afterUndo,
    undoIndicator,
    afterRedo,
    redoIndicator,
    rowsBefore,
    rowsAfterUndo,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    sorted !== before &&
    sortedIndicator === '▼' &&
    afterUndo === before &&
    undoIndicator === '' &&
    afterRedo === sorted &&
    redoIndicator === '▼' &&
    rowsAfterUndo === rowsBefore &&
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
