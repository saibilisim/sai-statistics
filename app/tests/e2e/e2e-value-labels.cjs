// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Repro of "veri gidiyor": edit a cell through the real Univer edit pipeline,
 * then click the value-labels toggle. Expectation (bug): the edit — and for a
 * hand-typed dataset all data — is wiped because the toggle rewrites the
 * column from the stale rowsRef. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => {
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)

  await win.evaluate(async () => {
    const result = await window.api.file.import({ filePath: '/tmp/sai-test.csv' })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        result.dataset.id,
        result.dataset.name,
        result.dataset.filePath,
        result.variables,
        result.dataset.rowCount,
        result.styles
      )
  })
  await win.waitForTimeout(3000)

  await win.evaluate(() => {
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .updateVariable(0, { valueLabels: { 1: 'Erkek', 2: 'Kadın' } })
  })
  await win.waitForTimeout(800)

  // Edit cell (row 0, col cinsiyet): double-click on the canvas, type 2, Enter.
  await win.mouse.dblclick(85, 80)
  await win.waitForTimeout(800)
  await win.keyboard.press('Control+A')
  await win.keyboard.type('2')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(1200)
  await win.screenshot({ path: '/tmp/sai5-1-after-edit.png' })

  // Click the value-labels toggle.
  await win.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find(x => (x.getAttribute('title') || '').toLowerCase().includes('etiket'))
    b.click()
  })
  await win.waitForTimeout(1500)
  await win.screenshot({ path: '/tmp/sai5-2-labels-on-after-edit.png' })

  // The cell edit marks the dataset dirty, so the unsaved-changes close guard
  // would otherwise show a blocking native dialog. Auto-"Discard" (1) for the test.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
