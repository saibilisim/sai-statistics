// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies (1) data:get-filtered returns the correctly filtered subset from
 * DuckDB — the read the analysis layer will use for Select Cases — and (2) the
 * "Toggle weight cases" context-menu action sets/clears weightVariable and
 * rejects a non-numeric column. Uses the 30-row /tmp/sai-30.csv (cols: ad, yas, puan).
 *
 * Rewritten for the AG Grid migration (aggrid-gecis-roadmap.md G8): the old
 * univerAPI.executeCommand('sai.command.toggle-weight') path no longer
 * exists — weight toggling is now a plain DOM right-click context-menu item
 * (DataViewContextMenu.tsx), driven here via a real mouse right-click +
 * menu-item click instead of a synthetic command dispatch. */
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
    window.__SAI_TEST__.dsId = r.dataset.id
    return r.variables.map(v => ({ colId: v.colId, name: v.name, type: v.type }))
  })
  await win.waitForTimeout(1500)

  // (1) Filtered read: yas > 35 → yas is 21..50, so 36..50 = 15 rows.
  const yasCol = varInfo.find(v => v.name === 'yas')
  const adCol = varInfo.find(v => v.name === 'ad')
  const filtered = await win.evaluate(
    async ({ dsId, colId }) => {
      const all = await window.api.data.getAll({ datasetId: dsId })
      const res = await window.api.data.getFiltered({
        datasetId: dsId,
        columnFilters: { [colId]: { operator: 'greater_than', value: '35' } }
      })
      return { total: all.rows.length, filtered: res.rows.length }
    },
    { dsId: await win.evaluate(() => window.__SAI_TEST__.dsId), colId: yasCol.colId }
  )

  // (2) Weight toggle via a real right-click on a "yas" cell, then a click on
  // the "toggleWeight" menu item.
  const rightClickColumnCell = async colId => {
    const cell = win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${colId}"]`).first()
    await cell.click({ button: 'right' })
  }
  const clickMenuItem = async label => {
    await win.getByRole('menuitem', { name: label }).click()
  }

  const readWeight = () =>
    win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().weightVariable)

  await rightClickColumnCell(yasCol.colId)
  await clickMenuItem('Ağırlık olarak işaretle / kaldır')
  await win.waitForTimeout(200)
  const afterSet = await readWeight()

  await rightClickColumnCell(yasCol.colId)
  await clickMenuItem('Ağırlık olarak işaretle / kaldır')
  await win.waitForTimeout(200)
  const afterClear = await readWeight()

  await rightClickColumnCell(adCol.colId) // ad = text column
  await clickMenuItem('Ağırlık olarak işaretle / kaldır')
  await win.waitForTimeout(200)
  const afterText = await readWeight()

  console.log(
    'FILTERWEIGHT_TEST:' +
      JSON.stringify({ filtered, weight: { afterSet, afterClear, afterText }, errors })
  )

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
