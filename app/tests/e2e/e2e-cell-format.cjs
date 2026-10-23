// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the new Ribbon cell-formatting path (post-G8 follow-up):
 *  1. Real click on a grid cell selects it (rangesRef), enabling the format
 *     buttons (canEdit).
 *  2. Clicking "Kalın" (bold) in the Ribbon applies bold to the selected
 *     cell and repaints it (inline font-weight).
 *  3. Text color applies (inline color).
 *  4. The format survives a .sdf save + reopen round-trip (customStyles).
 */
const fs = require('fs')
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

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: '/tmp/sai-cell-format-test.sdf'
    })
  })

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
    window.__SAI_TEST__.dsId = r.dataset.id
    return r.variables.map(v => v.colId)
  })
  await win.waitForTimeout(1200)

  // Real click on row 0 / first data column — selects it via onCellMouseDown.
  const cell = win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${varInfo[0]}"]`).first()
  await cell.click()
  await win.waitForTimeout(150)

  const canEditAfterSelect = await win.evaluate(
    () => window.__SAI_TEST__.useGridBridgeStore.getState().applyCellFormat !== null
  )

  // Bold.
  await win.getByRole('button', { name: 'Kalın' }).click()
  await win.waitForTimeout(150)
  const boldStyle = await cell.evaluate(el => el.style.fontWeight)
  const boldActive = await win.getByRole('button', { name: 'Kalın' }).getAttribute('aria-pressed')

  // Text color via the custom-color <input type=color>.
  await win.getByRole('button', { name: 'Metin Rengi' }).click()
  await win.waitForTimeout(100)
  const colorInput = win.locator('input[type="color"]').first()
  await colorInput.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '#ff0000')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await win.waitForTimeout(150)
  await win.keyboard.press('Escape')
  const colorStyle = await cell.evaluate(el => el.style.color)

  const customStylesAfterFormat = await win.evaluate(
    () => window.__SAI_TEST__.useDatasetStore.getState().customStyles
  )

  // Save + reopen round-trip.
  const dsId = await win.evaluate(() => window.__SAI_TEST__.dsId)
  await win.evaluate(async id => {
    const styles = window.__SAI_TEST__.useDatasetStore.getState().customStyles
    await window.api.file.saveData({ datasetId: id, customStyles: styles })
  }, dsId)
  await win.waitForTimeout(300)

  const reopened = await win.evaluate(async () => {
    const r = await window.api.file.open('/tmp/sai-cell-format-test.sdf')
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
    return r.styles
  })

  console.log(
    'RESULT:' +
      JSON.stringify({
        canEditAfterSelect,
        boldStyle,
        boldActive,
        colorStyle,
        customStylesAfterFormat,
        reopenedStyles: reopened,
        errors
      })
  )

  const rowId = Object.keys(customStylesAfterFormat?.cells ?? {})[0]
  const pass =
    canEditAfterSelect === true &&
    boldStyle === 'bold' &&
    boldActive === 'true' &&
    colorStyle === 'rgb(255, 0, 0)' &&
    !!rowId &&
    reopened?.cells?.[rowId]?.[varInfo[0]]?.bold === true &&
    reopened?.cells?.[rowId]?.[varInfo[0]]?.color === '#ff0000' &&
    errors.length === 0

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  fs.existsSync('/tmp/sai-cell-format-test.sdf') && fs.unlinkSync('/tmp/sai-cell-format-test.sdf')
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
