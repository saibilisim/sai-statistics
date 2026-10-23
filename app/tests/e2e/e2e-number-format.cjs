// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.7: applying a cell-level number format (currency/percent)
 * changes only the DISPLAYED text, not the underlying stored value. */
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

  const cell = win.locator(`.ag-row[row-index="0"] .ag-cell[col-id="${varInfo[1]}"]`).first()
  await cell.click()
  await win.waitForTimeout(150)

  const textBefore = await cell.innerText()

  // Number format is a RibbonDropdown of buttons, not the <select> this test
  // was written against — that element does not exist in any form any more.
  // Open the dropdown by its trigger (aria-label = "Sayı Biçimi"), then click
  // the entry. The trigger and its entries can share a label, but the entries
  // only render while the popover is open, so there is no ambiguity.
  const openNumberFormat = async () => {
    await win.getByRole('button', { name: 'Sayı Biçimi' }).click()
    await win.waitForTimeout(150)
  }

  await openNumberFormat()
  await win.getByRole('button', { name: 'Yüzde' }).click()
  await win.waitForTimeout(200)
  const textAsPercent = await cell.innerText()

  // Currency is a submenu row ("Para Birimi ▸") that opens a currency list.
  await openNumberFormat()
  await win.getByRole('button', { name: 'Para Birimi' }).click()
  await win.waitForTimeout(150)
  await win.getByRole('button', { name: /Türk Lirası/ }).click()
  await win.waitForTimeout(200)
  const textAsCurrency = await cell.innerText()

  // Underlying value must be unchanged in the DB.
  const dsId = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().datasetId)
  const rawValueAfter = await win.evaluate(
    async ([id, cIdx]) => {
      const r = await window.api.data.getAll({ datasetId: id })
      return r.rows[0][cIdx]
    },
    [dsId, 1]
  )

  console.log(
    'RESULT:' + JSON.stringify({ textBefore, textAsPercent, textAsCurrency, rawValueAfter, errors })
  )

  const pass =
    textAsPercent === `${textBefore}%` &&
    /25/.test(textAsCurrency) &&
    /[₺$]|TRY/.test(textAsCurrency) &&
    // sai-test.csv row0's `yas` (2nd column) is 25 — number formatting is
    // display-only, so the raw DB value must come back untouched. (This said
    // 21 from an older fixture and failed on the value, not the feature.)
    rawValueAfter === 25 &&
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
