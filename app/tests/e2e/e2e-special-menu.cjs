// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the value-label copy/paste context-menu items:
 *   1. Selecting a column with value labels + "Değer etiketlerini kopyala" stores them.
 *   2. Selecting another column + "Değer etiketlerini yapıştır" applies them (and the
 *      change persists to the backend via variable.update).
 *
 * Rewritten for the AG Grid migration (aggrid-gecis-roadmap.md G8): Univer's
 * native Copy/Paste-special submenus (and our merge-into-native-submenu
 * approach, register-context-menu.ts) are gone — these are now plain items
 * in DataViewContextMenu.tsx's single flat right-click menu
 * (buildContextMenuItems in DataView.tsx). Driven here via real right-clicks
 * + menu-item clicks instead of executeCommand(). The old "merged into
 * native submenu" + "sortInColHeader" assertions have no AG Grid equivalent
 * (there's no native submenu to merge into anymore) and are dropped. */
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

  // Give column 0 (col_1) some value labels, persisted like a real edit.
  await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.dsId
    const labels = { 1: 'Evet', 0: 'Hayir' }
    window.__SAI_TEST__.useDatasetStore.getState().updateVariable(0, { valueLabels: labels })
    await window.api.variable.update({
      datasetId: dsId,
      colId: 'col_1',
      updates: { valueLabels: labels }
    })
  })
  await win.waitForTimeout(300)

  // Value labels are a COLUMN-level concept, so copy/paste of them lives in
  // the column-HEADER right-click menu only (a deliberate move — a body cell
  // right-click no longer offers them, which is why this test used to fail;
  // denetim raporu §5).
  const rightClickHeader = async colId => {
    await win.locator(`.ag-header-cell[col-id="${colId}"]`).first().click({ button: 'right' })
  }
  const clickMenuItem = async label => {
    await win.getByRole('menuitem', { name: label }).click()
  }

  // COPY: right-click column 0's header, click "Değer etiketlerini kopyala".
  await rightClickHeader(varInfo[0])
  await clickMenuItem('Değer etiketlerini kopyala')
  await win.waitForTimeout(300)

  const clip = await win.evaluate(() => {
    return window.__SAI_TEST__.useSpecialMenuStore.getState().labelClipboard
  })

  // PASTE: right-click column 1's header (col_2), click "…yapıştır".
  await rightClickHeader(varInfo[1])
  await clickMenuItem('Değer etiketlerini yapıştır')
  await win.waitForTimeout(500)

  const result = await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.dsId
    const vars = await window.api.variable.getAll({ datasetId: dsId })
    return { col1: vars[0] && vars[0].valueLabels, col2: vars[1] && vars[1].valueLabels }
  })

  console.log('SPECIALMENU_TEST:' + JSON.stringify({ clip, result, errors }))

  const pass =
    clip?.sourceColId === varInfo[0] &&
    clip?.valueLabels?.['1'] === 'Evet' &&
    result.col2?.['1'] === 'Evet' &&
    result.col2?.['0'] === 'Hayir' &&
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
