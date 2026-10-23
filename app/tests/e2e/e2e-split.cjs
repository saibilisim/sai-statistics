// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the Split File foundation:
 *   1. data:get-split-groups returns the distinct group values (ordered, NULL
 *      excluded), and respects the active Select-Cases filter.
 *   2. The "Dosyayı buna göre böl / bölmeyi kaldır" context-menu action
 *      sets/clears splitVariable.
 * Dataset /tmp/sai-group.csv → cols: grup (col_1: A,B,C), yas (col_2).
 *
 * Rewritten for the AG Grid migration (aggrid-gecis-roadmap.md G8): the old
 * univerAPI.executeCommand('sai.command.toggle-split') path no longer
 * exists — split toggling is now a plain DOM right-click context-menu item
 * (DataViewContextMenu.tsx), driven here via a real mouse right-click +
 * menu-item click. */
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

  await win.evaluate(async () => {
    const r = await window.api.file.import({ filePath: '/tmp/sai-group.csv' })
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
  })
  await win.waitForTimeout(1500)

  const groups = await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.dsId
    const all = await window.api.data.getSplitGroups({
      datasetId: dsId,
      columnFilters: {},
      splitColId: 'col_1'
    })
    // Filter yas (col_2) < 35 → A(22,25,28) + B(31,34) → groups A, B; C
    // (40,43,46) drops out. The threshold was 30 back when the fixture had
    // an A20/B25 row; with today's sai-group.csv that would leave only A and
    // stop exercising the "filter narrows to a SUBSET" case (denetim §5).
    const filtered = await window.api.data.getSplitGroups({
      datasetId: dsId,
      columnFilters: { col_2: { operator: 'less_than', value: '35' } },
      splitColId: 'col_1'
    })
    return { all: all.groups, filtered: filtered.groups }
  })

  const rightClickCell = async colId => {
    const cell = win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${colId}"]`).first()
    await cell.click({ button: 'right' })
  }
  const clickMenuItem = async label => {
    await win.getByRole('menuitem', { name: label }).click()
  }
  const readSplit = () =>
    win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().splitVariable)

  await rightClickCell('col_1') // grup column
  await clickMenuItem('Dosyayı buna göre böl / bölmeyi kaldır')
  await win.waitForTimeout(200)
  const afterSet = await readSplit()

  await rightClickCell('col_1')
  await clickMenuItem('Dosyayı buna göre böl / bölmeyi kaldır')
  await win.waitForTimeout(200)
  const afterClear = await readSplit()

  const toggle = { afterSet, afterClear }

  console.log('SPLIT_TEST:' + JSON.stringify({ groups, toggle, errors }))

  const pass =
    JSON.stringify(groups.all) === JSON.stringify(['A', 'B', 'C']) &&
    JSON.stringify(groups.filtered) === JSON.stringify(['A', 'B']) &&
    afterSet === 'col_1' &&
    afterClear === null &&
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
