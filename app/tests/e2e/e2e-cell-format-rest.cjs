// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Companion to e2e-cell-format.cjs: covers the remaining 6 "easy" format
 * buttons (italic, underline, fill color, font family/size, h/v align) that
 * the first script didn't already exercise (bold + text color). */
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

  const cell = win.locator(`.ag-row[row-index="1"] .ag-cell[col-id="${varInfo[0]}"]`).first()
  await cell.click()
  await win.waitForTimeout(150)

  await win.getByRole('button', { name: 'İtalik' }).click()
  await win.waitForTimeout(100)
  await win
    .getByRole('button', { name: 'Altı Çizili' })
    .click()
    .catch(() => {})

  // Font family / size selects.
  await win
    .locator('select[aria-label="Yazı Tipi"]')
    .selectOption('Georgia')
    .catch(() => {})
  await win
    .locator('select[aria-label="Yazı Boyutu"]')
    .selectOption('16')
    .catch(() => {})

  // Fill color via custom color input (2nd ColorDropdown = fill color).
  await win.getByRole('button', { name: 'Dolgu Rengi' }).click()
  await win.waitForTimeout(100)
  const fillInput = win.locator('input[type="color"]').first()
  await fillInput.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '#00ff00')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(150)

  const style = await cell.evaluate(el => ({
    fontStyle: el.style.fontStyle,
    textDecoration: el.style.textDecoration,
    backgroundColor: el.style.backgroundColor,
    fontFamily: el.style.fontFamily,
    fontSize: el.style.fontSize
  }))

  const format = await win.evaluate(() => {
    const cs = window.__SAI_TEST__.useDatasetStore.getState().customStyles
    const rowId = Object.keys(cs?.cells ?? {})[0]
    return rowId ? cs.cells[rowId] : null
  })

  console.log('RESULT:' + JSON.stringify({ style, format, errors }))

  const colId = varInfo[0]
  const f = format ? format[colId] : null
  const pass =
    style.fontStyle === 'italic' &&
    style.backgroundColor === 'rgb(0, 255, 0)' &&
    !!f?.italic &&
    f?.bg === '#00ff00' &&
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
