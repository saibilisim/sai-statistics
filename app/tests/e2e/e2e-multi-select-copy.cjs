// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the fix for: (1) Ctrl-multi-selected rows now copy ALL of them,
 * not just the last-clicked range; (2) right-click on a cell that's part of
 * an existing multi-selection no longer collapses the selection before the
 * context menu opens, so "Kopyala" from that menu copies the whole
 * selection too. */
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

  await win.evaluate(async () => {
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
  })
  await win.waitForTimeout(1200)

  // ── Test 1: Ctrl-click row 0 and row 2's row-number cells, then Ctrl+C.
  const row0Num = win.locator('.ag-row[row-index="0"] .ag-cell[col-id="__row_num__"]').first()
  const row2Num = win.locator('.ag-row[row-index="2"] .ag-cell[col-id="__row_num__"]').first()
  await row0Num.click() // focuses the grid cell so Ctrl+C reaches the copy handler
  await clip.clear()
  await row0Num.click()
  await row2Num.click({ modifiers: ['Control'] })
  await win.waitForTimeout(150)

  await win.keyboard.press('Control+c')
  await win.waitForTimeout(150)
  const ctrlCopyText = await clip.readWhenReady()
  const ctrlCopyLines = ctrlCopyText.split('\n').filter(l => l.length > 0)

  // ── Test 2: right-click on the OTHER selected row (row0, not the last-
  // clicked row2) — selection must survive, and the context-menu Copy must
  // still grab both rows.
  await clip.clear()
  await row0Num.click({ button: 'right' })
  await win.waitForTimeout(150)
  // Copy became an icon-only toolbar button (B4.1, 2026-07-24): it carries a
  // title/aria-label but no text node, so `text=Kopyala` no longer matches.
  const copyBtn = win.locator('[role="menu"] button[title="Kopyala"]').first()
  const menuVisible = await copyBtn.isVisible()
  await copyBtn.click()
  await win.waitForTimeout(150)
  const rightClickCopyText = await clip.readWhenReady()
  const rightClickCopyLines = rightClickCopyText.split('\n').filter(l => l.length > 0)

  // ── Regression: Shift-selected contiguous rows still copy correctly.
  await clip.clear()
  const row5Num = win.locator('.ag-row[row-index="5"] .ag-cell[col-id="__row_num__"]').first()
  await row0Num.click()
  await row5Num.click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  await win.keyboard.press('Control+c')
  await win.waitForTimeout(150)
  const shiftCopyText = await clip.readWhenReady()
  const shiftCopyLines = shiftCopyText.split('\n').filter(l => l.length > 0)

  console.log(
    'RESULT:' +
      JSON.stringify({
        ctrlCopyLines,
        rightClickCopyLines,
        shiftCopyLines,
        menuVisible,
        errors
      })
  )

  const pass =
    ctrlCopyLines.length === 2 &&
    // Rows 0 and 2 of the fixture — identified by their `yas` values, since
    // `cinsiyet` is only ever 1/2 (the old '3.00' expectation could never
    // match this fixture and hid the real assertion). Copy follows the Data
    // View decimal mark (dataView.decimalSeparator, default comma), so accept
    // either mark — the assertion is about WHICH rows were copied.
    /\b25[.,]00\b/.test(ctrlCopyLines[0]) &&
    /\b22[.,]00\b/.test(ctrlCopyLines[1]) &&
    rightClickCopyLines.length === 2 &&
    shiftCopyLines.length === 6 &&
    menuVisible &&
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
