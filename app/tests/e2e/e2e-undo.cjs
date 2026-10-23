// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies structural undo/redo: delete a column, undo (column + its data come
 * back), redo (column gone again). Drives the real IPC handlers via window.api. */
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
  await win.waitForTimeout(1500)

  const r = await win.evaluate(async () => {
    const api = window.api
    const imp = await api.file.import({ filePath: '/tmp/sai-test.csv' })
    const dsId = imp.dataset.id
    const before = imp.variables.length

    await api.variable.delete({ datasetId: dsId, colId: 'col_3' })
    const afterDelete = (await api.variable.getAll({ datasetId: dsId })).length
    const dataDel = await api.data.getAll({ datasetId: dsId })

    const undo = await api.data.undo({ datasetId: dsId })
    const afterUndo = (await api.variable.getAll({ datasetId: dsId })).length
    const dataUndo = await api.data.getAll({ datasetId: dsId })

    const redo = await api.data.redo({ datasetId: dsId })
    const afterRedo = (await api.variable.getAll({ datasetId: dsId })).length

    return {
      before,
      afterDelete,
      delCols: dataDel.rows[0]?.length,
      undoApplied: undo.applied,
      afterUndo,
      undoCols: dataUndo.rows[0]?.length,
      undoPuan: dataUndo.rows[0]?.[2],
      redoApplied: redo.applied,
      afterRedo
    }
  })
  console.log('UNDO_TEST:' + JSON.stringify(r))

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
