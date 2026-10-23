// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.4: right-clicking a column HEADER (not a body cell) opens the
 * DataView context menu with column-only items — AG Grid's onCellContextMenu
 * never fires for header cells, only body cells, so ColumnHeader.tsx wires
 * this separately. */
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
  await win.waitForTimeout(1200)

  // Right-click the actual column HEADER element.
  await win.locator(`.ag-header-cell[col-id="${varInfo[0]}"]`).first().click({ button: 'right' })
  await win.waitForTimeout(200)

  const menuVisible = await win.getByRole('menu').count()
  // Column-only items should be present...
  const hasInsertCol = await win.getByRole('menuitem', { name: 'Soluna Sütun Ekle' }).count()
  const hasDeleteCol = await win.getByRole('menuitem', { name: 'Sütunu Sil' }).count()
  // ...row-only items (copy/paste/insert-row/delete-rows) must be absent.
  const hasCopy = await win.getByRole('menuitem', { name: 'Kopyala', exact: true }).count()
  const hasInsertRow = await win.getByRole('menuitem', { name: 'Üstüne Satır Ekle' }).count()

  // Insert a column via the header menu, verify it actually works end-to-end.
  const dsId = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)
  const beforeCols = (
    await win.evaluate(async id => window.api.variable.getAll({ datasetId: id }), dsId)
  ).length
  await win.getByRole('menuitem', { name: 'Soluna Sütun Ekle' }).click()
  await win.waitForTimeout(500)
  const afterCols = (
    await win.evaluate(async id => window.api.variable.getAll({ datasetId: id }), dsId)
  ).length

  console.log(
    'RESULT:' +
      JSON.stringify({
        menuVisible,
        hasInsertCol,
        hasDeleteCol,
        hasCopy,
        hasInsertRow,
        beforeCols,
        afterCols,
        errors
      })
  )

  const pass =
    menuVisible === 1 &&
    hasInsertCol === 1 &&
    hasDeleteCol === 1 &&
    hasCopy === 0 &&
    hasInsertRow === 0 &&
    afterCols === beforeCols + 1 &&
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
