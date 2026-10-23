// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the Data View right-click context-menu command paths:
 *   1. "Artan Sırala / Azalan Sırala" updates columnSort state.
 *   2. Insert-row/insert-column menu items reach the structural handler and
 *      actually grow row/column counts.
 *
 * Rewritten for the AG Grid migration (aggrid-gecis-roadmap.md G8): the old
 * Univer-era native context menu (with our merged-in custom commands) is
 * gone — replaced by DataViewContextMenu.tsx, a plain DOM popup
 * (role="menuitem" buttons) built fresh per right-click
 * (buildContextMenuItems in DataView.tsx). Driven here via real mouse
 * right-clicks + menu-item clicks instead of executeCommand(). */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', err => {
    errors.push(err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  // Import a dataset and make it active so the DataView mounts.
  const varInfo = await win.evaluate(async () => {
    const api = window.api
    const result = await api.file.import({ filePath: '/tmp/sai-test.csv' })
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
    window.__SAI_TEST__.dsId = result.dataset.id
    return result.variables.map(v => v.colId)
  })
  await win.waitForTimeout(1500)

  const gridReady = await win.evaluate(() =>
    Boolean(window.__SAI_TEST__.useGridBridgeStore.getState().gridApi)
  )

  const rightClickCell = async (rowIndex, colId) => {
    const cell = win.locator(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`).first()
    await cell.click({ button: 'right' })
  }
  const clickMenuItem = async label => {
    await win.getByRole('menuitem', { name: label }).click()
  }
  const readSort = () =>
    win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().columnSort)

  // 1. Sort commands via the right-click menu.
  await rightClickCell(0, varInfo[0])
  await clickMenuItem('Artan Sırala')
  await win.waitForTimeout(200)
  const asc = await readSort()

  await rightClickCell(0, varInfo[0])
  await clickMenuItem('Azalan Sırala')
  await win.waitForTimeout(200)
  const desc = await readSort()

  const sort = { asc, desc }

  // 2. Insert row/column via the right-click menu → structural handler.
  const dsId = await win.evaluate(() => window.__SAI_TEST__.dsId)
  const beforeRows = (
    await win.evaluate(async id => window.api.data.getAll({ datasetId: id }), dsId)
  ).rows.length
  const beforeCols = (
    await win.evaluate(async id => window.api.variable.getAll({ datasetId: id }), dsId)
  ).length

  await rightClickCell(0, varInfo[0])
  await clickMenuItem('Üstüne Satır Ekle')
  await win.waitForTimeout(600)

  await rightClickCell(0, varInfo[0])
  await clickMenuItem('Soluna Sütun Ekle')
  await win.waitForTimeout(600)

  const afterRows = (
    await win.evaluate(async id => window.api.data.getAll({ datasetId: id }), dsId)
  ).rows.length
  const afterCols = (
    await win.evaluate(async id => window.api.variable.getAll({ datasetId: id }), dsId)
  ).length

  const insert = { beforeRows, afterRows, beforeCols, afterCols }

  console.log('CTXMENU_TEST:' + JSON.stringify({ gridReady, sort, insert, errors }))

  const pass =
    gridReady &&
    asc?.direction === 'asc' &&
    desc?.direction === 'desc' &&
    afterRows === beforeRows + 1 &&
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

main().catch(err => {
  console.error(err)
  process.exit(1)
})
