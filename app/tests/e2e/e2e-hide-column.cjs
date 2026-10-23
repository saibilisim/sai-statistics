// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.8: "Sütunu gizle" (Hide column) hides that column via AG
 * Grid's native `hide` colDef; "Tüm sütunları göster" (Show all columns)
 * brings it back; hiding the second-to-last visible column disables the
 * hide item on the last one (no dead-end where you can't get it back). */
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

  // Hide the 2nd column.
  await win.locator(`.ag-header-cell[col-id="${varInfo[1]}"]`).first().click({ button: 'right' })
  await win.waitForTimeout(200)
  await win.getByRole('menuitem', { name: 'Sütunu gizle' }).click()
  await win.waitForTimeout(300)

  const visibleAfterHide = await win.evaluate(([c0, c1, c2]) => {
    const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
    return {
      c0: api.getColumn(c0)?.isVisible(),
      c1: api.getColumn(c1)?.isVisible(),
      c2: api.getColumn(c2)?.isVisible()
    }
  }, varInfo)

  // Right-click the still-visible first column → "Show all columns" should
  // be present and bring col 1 back.
  await win.locator(`.ag-header-cell[col-id="${varInfo[0]}"]`).first().click({ button: 'right' })
  await win.waitForTimeout(200)
  const showAllVisible = await win.getByRole('menuitem', { name: 'Tüm sütunları göster' }).count()
  await win.getByRole('menuitem', { name: 'Tüm sütunları göster' }).click()
  await win.waitForTimeout(300)

  const visibleAfterUnhide = await win.evaluate(c1 => {
    const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
    return api.getColumn(c1)?.isVisible()
  }, varInfo[1])

  console.log(
    'RESULT:' + JSON.stringify({ visibleAfterHide, showAllVisible, visibleAfterUnhide, errors })
  )

  const pass =
    visibleAfterHide.c0 === true &&
    visibleAfterHide.c1 === false &&
    visibleAfterHide.c2 === true &&
    showAllVisible === 1 &&
    visibleAfterUnhide === true &&
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
