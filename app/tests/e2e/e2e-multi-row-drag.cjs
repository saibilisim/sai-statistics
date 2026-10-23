// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.2 under the NATIVE rowDragManaged setup (2026-07-22): dragging
 * a row that's part of a multi-row selection carries the WHOLE selection
 * together (relative order preserved) via AG Grid's rowDragMultiRow, which
 * reads the native row selection our onCellClicked→selectRow wires up.
 *
 * Fixture: /tmp/sai-drag.csv — id 1..12, so a row is still identifiable after
 * the reorder. It used to use sai-test.csv and assume its first column was an
 * id; that column is actually `cinsiyet` (only ever 1 or 2), so `indexOf(3)`
 * returned -1 and the assertion could never hold (denetim raporu §5). */
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
    const r = await window.api.file.import({ filePath: '/tmp/sai-drag.csv' })
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
  })
  await win.waitForTimeout(1200)

  const rowNum = i =>
    win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="__row_num__"]`).first()

  // Select rows 0 and 2 (ids 1 and 3) via Ctrl+click on the row-number cell.
  // Row-number click selects the whole row (and, via refreshHighlight, marks
  // the AG Grid node natively selected so rowDragMultiRow will carry it).
  await rowNum(0).click()
  await win.waitForTimeout(100)
  await rowNum(2).click({ modifiers: ['ControlOrMeta'] })
  await win.waitForTimeout(150)

  // Both rows 0 and 2 must be natively selected (this is what native
  // rowDragMultiRow reads to move the whole selection together).
  const selectedBeforeDrag = await win.evaluate(() =>
    [...document.querySelectorAll('.ag-center-cols-container .ag-row.ag-row-selected')]
      .map(r => Number(r.getAttribute('row-index')))
      .sort((a, b) => a - b)
  )

  // Native drag: grab row 2's drag handle and drag down to row 5's position.
  const source = rowNum(2)
  const target = rowNum(5)
  const srcBox = await source.boundingBox()
  const tgtBox = await target.boundingBox()
  await win.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height * 1.5, { steps: 5 })
  await win.waitForTimeout(80)
  await win.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2, { steps: 10 })
  await win.waitForTimeout(150)
  await win.mouse.up()
  await win.waitForTimeout(600)

  const dsId = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)
  const dbIds = await win.evaluate(async id => {
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows.map(row => row[0])
  }, dsId)

  console.log('RESULT:' + JSON.stringify({ selectedBeforeDrag, dbIds, errors }))

  // Both id=1 and id=3 should be adjacent, id=1 before id=3 (relative order
  // preserved), and both moved to be somewhere before/at the drop target.
  const idx1 = dbIds.indexOf(1)
  const idx3 = dbIds.indexOf(3)
  const pass =
    selectedBeforeDrag.length === 2 &&
    selectedBeforeDrag[0] === 0 &&
    selectedBeforeDrag[1] === 2 &&
    idx1 !== -1 &&
    idx3 !== -1 &&
    idx3 === idx1 + 1 && // adjacent, order preserved
    idx1 > 0 && // no longer at the very front
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
