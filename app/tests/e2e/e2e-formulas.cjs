// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the cell-formula feature (the "=A7+B7" system):
 *   1. Entering "=B1+10" in the formula bar computes the value into the cell
 *      and stores the formula in customStyles (local .sdf, not DuckDB).
 *   2. Editing a precedent cell (B1) recomputes the dependent formula cell.
 *   3. Ctrl+D fills a formula down with references shifted relatively
 *      (=B1+10 → =B2+10, =B3+10).
 *
 * Fixture: /tmp/sai-30.csv (ad[text], yas[num], puan[num]; 30 rows) — run
 * tests/e2e/setup-e2e-fixtures.cjs first.
 */
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
    const r = await window.api.file.import({ filePath: '/tmp/sai-30.csv' })
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

  const puanCol = varInfo[2] // numeric target column (C)
  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()
  const formulaBar = win.locator('input[class*="formulaBar"]')
  const cellNum = async (r, c) => {
    const txt = (await cell(r, c).innerText()).trim()
    return parseFloat(txt)
  }
  const storedFormula = (rowId, colId) =>
    win.evaluate(
      ([r, c]) => {
        const cs = window.__SAI_TEST__.useDatasetStore.getState().customStyles
        return cs?.cells?.[r]?.[c]?.formula ?? null
      },
      [rowId, colId]
    )

  // ── 1. Enter a formula via the formula bar: C1 = B1 + 10 (yas row0 = 19 → 29)
  await cell(0, 2).click()
  await win.waitForTimeout(150)
  await formulaBar.click()
  await formulaBar.fill('=B1+10')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(300)
  const entryValue = await cellNum(0, 2) // expect 29
  const entryStored = await storedFormula('r0', puanCol) // expect "=B1+10"

  // ── 2. Recompute: edit precedent B1 (yas) to 100 → C1 becomes 110 ───────
  await cell(0, 1).dblclick()
  await win.waitForTimeout(150)
  await win.keyboard.type('100')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(350)
  const recomputed = await cellNum(0, 2) // expect 110

  // ── 3. Fill down: select C1:C3, Ctrl+D → C2=B2+10 (30), C3=B3+10 (31) ────
  await cell(0, 2).click()
  await win.waitForTimeout(80)
  await cell(2, 2).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(120)
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(350)
  const fillC2 = await cellNum(1, 2) // B2=20 → 30
  const fillC3 = await cellNum(2, 2) // B3=21 → 31
  const fillC2Formula = await storedFormula('r1', puanCol) // "=B2+10"
  const fillC3Formula = await storedFormula('r2', puanCol) // "=B3+10"

  // ── 4. Stability under sort: C1 is bound to record dbRow0 (yas=100 after
  //       step 2). Sort by yas ascending → that record moves to the LAST
  //       visible row, but its formula still reads its OWN yas → puan stays
  //       110, and the formula bar shows the reference translated to the new
  //       visible position (=B30+10). ───────────────────────────────────────
  await win.evaluate(colId => {
    window.__SAI_TEST__.useDatasetStore.getState().setColumnSort(colId, 'asc')
  }, varInfo[1])
  await win.waitForTimeout(600)
  const lastYas = await cellNum(29, 1) // record dbRow0, yas=100 → sorts last
  const lastPuan = await cellNum(29, 2) // stable formula → still 110
  await cell(29, 2).click()
  await win.waitForTimeout(200)
  const barAfterSort = await formulaBar.inputValue() // expect "=B30+10"

  // ── 5. Stability under COLUMN reorder: clear the sort, move yas (col_2) to
  //       the front. puan's formula is bound to yas's colId, so it still reads
  //       yas → value stays 110, and the formula bar shows the reference
  //       translated to yas's new column position (=A1+10). ─────────────────
  await win.evaluate(() => {
    window.__SAI_TEST__.useDatasetStore.getState().setColumnSort(null)
  })
  await win.waitForTimeout(500)
  await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.useDatasetStore.getState().datasetId
    await window.api.variable.reorder({ datasetId: dsId, colIds: ['col_2', 'col_1', 'col_3'] })
    const vars = await window.api.variable.getAll({ datasetId: dsId })
    window.__SAI_TEST__.useDatasetStore.getState().setVariables(vars)
  })
  await win.waitForTimeout(900)
  const reorderPuan = await cellNum(0, 2) // col_3 (puan), dbRow0 → still 110 (reads yas)
  await cell(0, 2).click()
  await win.waitForTimeout(200)
  const barAfterReorder = await formulaBar.inputValue() // yas now at col A → "=A1+10"

  const result = {
    entryValue,
    entryStored,
    recomputed,
    fillC2,
    fillC3,
    fillC2Formula,
    fillC3Formula,
    lastYas,
    lastPuan,
    barAfterSort,
    reorderPuan,
    barAfterReorder,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    entryValue === 29 &&
    entryStored === '=B1+10' &&
    recomputed === 110 &&
    fillC2 === 30 &&
    fillC3 === 31 &&
    fillC2Formula === '=B2+10' &&
    fillC3Formula === '=B3+10' &&
    lastYas === 100 &&
    lastPuan === 110 &&
    barAfterSort === '=B30+10' &&
    reorderPuan === 110 &&
    barAfterReorder === '=A1+10' &&
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
