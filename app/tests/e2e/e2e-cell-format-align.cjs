// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Companion check: hAlign specifically (RibbonDropdown popover path, a
 * distinct interaction from the plain-button format controls).
 *
 * This used to also assert vertical alignment, clicking "Ortaya Hizala" then
 * "Üste Hizala". There is no such feature: CellFormat (shared/data-types.ts)
 * has hAlign and no vertical counterpart, and neither vAlign nor
 * verticalAlign appears anywhere in src/ or shared/. The test was written
 * against a control that does not exist, so it could only ever fail — dropped
 * rather than left as permanent red. If vertical alignment is ever added, the
 * assertion to restore is display:flex + alignItems:flex-start on the cell. */
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

  const cell = win.locator(`.ag-row[row-index="2"] .ag-cell[col-id="${varInfo[0]}"]`).first()
  await cell.click()
  await win.waitForTimeout(150)

  await win.getByRole('button', { name: 'Sola Hizala' }).click()
  await win.waitForTimeout(100)
  await win.getByRole('button', { name: 'Ortala' }).click()
  await win.waitForTimeout(150)

  const afterHAlign = await cell.evaluate(el => el.style.textAlign)

  console.log('RESULT:' + JSON.stringify({ afterHAlign, errors }))

  const pass = afterHAlign === 'center' && errors.length === 0

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
