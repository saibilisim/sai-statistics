// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies C7: columns WITH value labels edit through a dropdown of their
 * defined codes (SPSS behaviour) instead of free text.
 *   1. Double-clicking such a cell opens a <select>, listing the LABELS.
 *   2. Picking a label stores the RAW code (verified in DuckDB, not just UI).
 *   3. A column WITHOUT value labels still uses the plain text editor.
 *
 * Fixture: /tmp/sai-test.csv (cinsiyet 1/2 — labels assigned below).
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
  await win.waitForTimeout(1000)

  // Give "cinsiyet" (col 0) value labels and turn Value Labels mode on.
  await win.evaluate(async colId => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    const valueLabels = { 1: 'Erkek', 2: 'Kadın' }
    ds.updateVariable(0, { valueLabels })
    await window.api.variable.update({ datasetId: ds.datasetId, colId, updates: { valueLabels } })
    window.__SAI_TEST__.useUIStore.getState().toggleValueLabels()
  }, varInfo[0])
  await win.waitForTimeout(1000)

  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()

  // ── 1. Labelled column → select editor with label options ───────────────
  await cell(0, 0).dblclick()
  await win.waitForTimeout(600)
  // AG Grid v35's select editor is a combobox (not a native <select>): the
  // closed state already shows the FORMATTED current value (the label).
  const hasSelectEditor = await win.evaluate(
    () => !!document.querySelector('.ag-cell-editor.ag-select [role="combobox"]')
  )
  const closedDisplay = await win.evaluate(
    () => document.querySelector('.ag-picker-field-display')?.textContent?.trim() ?? ''
  )
  // Open the list to read the options.
  await win.locator('.ag-cell-editor .ag-picker-field-wrapper').first().click()
  await win.waitForTimeout(400)
  const opts = await win.evaluate(() =>
    [...document.querySelectorAll('.ag-list-item, [role="option"]')].map(x => x.textContent.trim())
  )
  const showsLabels = opts.includes('Erkek') && opts.includes('Kadın')

  // ── 2. Pick "Kadın" → the raw code 2 must land in DuckDB ────────────────
  await win.locator('.ag-list-item, [role="option"]').filter({ hasText: 'Kadın' }).first().click()
  await win.waitForTimeout(700)
  const displayed = (await cell(0, 0).innerText()).trim()
  const rawInDb = await win.evaluate(async () => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    const res = await window.api.data.getChunk({ datasetId: ds.datasetId, offset: 0, limit: 1 })
    return res.rows[0][0]
  })

  // ── 3. Unlabelled column (yas, col 1) → plain text editor ──────────────
  await cell(1, 1).dblclick()
  await win.waitForTimeout(400)
  const plainEditor = await win.evaluate(() => ({
    hasSelect: !!document.querySelector('.ag-cell-editor select'),
    hasInput: !!document.querySelector('.ag-cell-editor input')
  }))
  await win.keyboard.press('Escape')

  const result = {
    hasSelectEditor,
    closedDisplay,
    opts,
    showsLabels,
    displayed,
    rawInDb,
    plainEditor,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    hasSelectEditor &&
    closedDisplay === 'Erkek' &&
    showsLabels &&
    displayed === 'Kadın' &&
    rawInDb === 2 &&
    !plainEditor.hasSelect &&
    plainEditor.hasInput &&
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
