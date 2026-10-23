// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.1: "Freeze up to this column" pins that column (and every
 * column before it) left via AG Grid's native pinned:'left' colDef — same
 * mechanism the row-number column already uses — then "Unfreeze columns"
 * clears it. Also confirms clicking a now-frozen column still works
 * (freeze shouldn't break selection, per the rowDrag lesson). */
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

  // Right-click the 2nd column's header, freeze up to it (freezes col 0+1).
  await win.locator(`.ag-header-cell[col-id="${varInfo[1]}"]`).first().click({ button: 'right' })
  await win.waitForTimeout(200)
  await win.getByRole('menuitem', { name: 'Bu sütuna kadar dondur' }).click()
  await win.waitForTimeout(300)

  const pinnedAfterFreeze = await win.evaluate(([c0, c1, c2]) => {
    const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
    return {
      c0: api.getColumn(c0)?.getPinned(),
      c1: api.getColumn(c1)?.getPinned(),
      c2: api.getColumn(c2)?.getPinned()
    }
  }, varInfo)

  // Clicking a frozen column cell must still select it (freeze shouldn't
  // break click handling, unlike the earlier rowDrag lesson).
  await win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${varInfo[0]}"]`).first().click()
  await win.waitForTimeout(150)
  const frozenCellSelectable = await win.evaluate(
    c0 =>
      document
        .querySelector(`.ag-row[row-index="0"] .ag-cell[col-id="${c0}"]`)
        ?.className.includes('selectedCell') ?? false,
    varInfo[0]
  )

  // Unfreeze.
  await win.locator(`.ag-header-cell[col-id="${varInfo[1]}"]`).first().click({ button: 'right' })
  await win.waitForTimeout(200)
  await win.getByRole('menuitem', { name: 'Dondurmayı kaldır' }).click()
  await win.waitForTimeout(300)

  const pinnedAfterUnfreeze = await win.evaluate(([c0, c1]) => {
    const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
    return { c0: api.getColumn(c0)?.getPinned(), c1: api.getColumn(c1)?.getPinned() }
  }, varInfo)

  console.log(
    'RESULT:' +
      JSON.stringify({ pinnedAfterFreeze, frozenCellSelectable, pinnedAfterUnfreeze, errors })
  )

  const pass =
    pinnedAfterFreeze.c0 === 'left' &&
    pinnedAfterFreeze.c1 === 'left' &&
    !pinnedAfterFreeze.c2 &&
    frozenCellSelectable === true &&
    !pinnedAfterUnfreeze.c0 &&
    !pinnedAfterUnfreeze.c1 &&
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
