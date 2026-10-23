// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Regression test for dataview-denetim-raporu-2026-07-26.md §2 — the critical
 * data-corruption bug.
 *
 * Before the __case_id fix, per-cell metadata (formats + formulas, stored in
 * customStyles keyed by the row's DuckDB INDEX) did not move when a structural
 * row operation renumbered those indices. Inserting a row at the top made the
 * new BLANK row inherit the first record's bold + formula; the next recompute
 * then evaluated that formula against the blank row and WROTE THE RESULT INTO
 * DUCKDB — a ghost value an analysis would read as real data.
 *
 * This script drives the exact reported scenario plus delete and reorder:
 *   1. C1 = "=B1+10" (ad/yas/puan fixture, yas row0 = 19 → 29) + bold.
 *   2. Insert a row above → the record must keep BOTH its formula and its
 *      bold, the new blank row must have neither, and no ghost value may
 *      appear in the blank row's DuckDB cell.
 *   3. Delete the blank row → everything returns to where it started.
 *   4. Drag-free reorder (data:reorder-rows) → the format follows its record.
 *
 * Fixture: /tmp/sai-30.csv — run tests/e2e/setup-e2e-fixtures.cjs first.
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

  const puanCol = varInfo[2]
  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()
  const formulaBar = win.locator('input[class*="formulaBar"]')

  /** The whole customStyles entry for a given customStyles row key. */
  const styleAt = (rowKey, colId) =>
    win.evaluate(
      ([r, c]) => {
        const cs = window.__SAI_TEST__.useDatasetStore.getState().customStyles
        return cs?.cells?.[r]?.[c] ?? null
      },
      [rowKey, colId]
    )

  /** What the grid actually paints — catches "the bold moved" visually. */
  const weightAt = async (r, c) =>
    (await cell(r, c).evaluate(el => getComputedStyle(el).fontWeight)).toString()

  /** Ground truth straight out of DuckDB (bypasses the grid entirely). */
  const dbRow = async i => {
    return win.evaluate(async idx => {
      const dsId = window.__SAI_TEST__.useDatasetStore.getState().datasetId
      const res = await window.api.data.getChunk({ datasetId: dsId, offset: idx, limit: 1 })
      return { row: res.rows[0] ?? null, caseId: res.caseIds ? res.caseIds[0] : null }
    }, i)
  }

  // ── 1. Formula + bold on the first record ────────────────────────────────
  await cell(0, 2).click()
  await win.waitForTimeout(150)
  await formulaBar.click()
  await formulaBar.fill('=B1+10')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(350)

  await cell(0, 2).click()
  await win.waitForTimeout(120)
  await win.evaluate(() => {
    window.__SAI_TEST__.useGridBridgeStore.getState().applyCellFormat({ bold: true })
  })
  await win.waitForTimeout(300)

  const before = {
    value: (await dbRow(0)).row,
    caseId: (await dbRow(0)).caseId,
    weight: await weightAt(0, 2)
  }

  // ── 2. Insert a row ABOVE the styled record ──────────────────────────────
  await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.useDatasetStore.getState().datasetId
    await window.api.data.insertRow({ datasetId: dsId, rowIndex: 0 })
    const s = window.__SAI_TEST__.useDatasetStore.getState()
    s.setRowCount(s.rowCount + 1)
    s.bumpDataVersion()
  })
  await win.waitForTimeout(1200)

  // Trigger a recompute the way the reported bug did: edit an unrelated cell.
  await cell(5, 1).dblclick()
  await win.waitForTimeout(150)
  await win.keyboard.type('42')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(500)

  const blank = await dbRow(0) // the new empty row
  const record = await dbRow(1) // the originally-styled record
  const afterInsert = {
    blankRow: blank.row,
    blankCaseId: blank.caseId,
    recordRow: record.row,
    recordCaseId: record.caseId,
    blankWeight: await weightAt(0, 2),
    recordWeight: await weightAt(1, 2),
    blankStyle: await styleAt(`r${blank.caseId}`, puanCol),
    recordStyle: await styleAt(`r${record.caseId}`, puanCol)
  }

  // ── 3. Delete the blank row again ────────────────────────────────────────
  await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.useDatasetStore.getState().datasetId
    await window.api.data.deleteRows({ datasetId: dsId, rowIndices: [0] })
    const s = window.__SAI_TEST__.useDatasetStore.getState()
    s.setRowCount(Math.max(0, s.rowCount - 1))
    s.bumpDataVersion()
  })
  await win.waitForTimeout(1200)

  const afterDelete = {
    row0: (await dbRow(0)).row,
    caseId: (await dbRow(0)).caseId,
    weight: await weightAt(0, 2)
  }

  // ── 4. Reorder: move the styled record (now DB index 0) to index 2 ───────
  await win.evaluate(async () => {
    const dsId = window.__SAI_TEST__.useDatasetStore.getState().datasetId
    const n = window.__SAI_TEST__.useDatasetStore.getState().rowCount
    const order = [1, 2, 0]
    for (let i = 3; i < n; i++) order.push(i)
    await window.api.data.reorderRows({ datasetId: dsId, rowIndices: order })
    window.__SAI_TEST__.useDatasetStore.getState().bumpDataVersion()
  })
  await win.waitForTimeout(1200)

  const moved = await dbRow(2)
  const afterReorder = {
    caseId: moved.caseId,
    movedWeight: await weightAt(2, 2),
    topWeight: await weightAt(0, 2),
    style: await styleAt(`r${moved.caseId}`, puanCol)
  }

  const result = { before, afterInsert, afterDelete, afterReorder, errors }
  console.log('RESULT:' + JSON.stringify(result, null, 2))

  const bold = w => w === '700' || w === 'bold'
  const normal = w => !bold(w)

  const pass =
    // 1. baseline: formula computed 19 + 10 and the record is bold
    before.value &&
    before.value[2] === 29 &&
    bold(before.weight) &&
    // 2. THE BUG: the blank row must stay blank in DuckDB — no ghost 10 —
    //    and must carry neither the bold nor the formula.
    afterInsert.blankRow &&
    afterInsert.blankRow[0] === null &&
    afterInsert.blankRow[2] === null &&
    afterInsert.blankStyle === null &&
    normal(afterInsert.blankWeight) &&
    // …while the record keeps its value, its formula and its bold.
    afterInsert.recordRow &&
    afterInsert.recordRow[2] === 29 &&
    afterInsert.recordCaseId === before.caseId &&
    afterInsert.recordStyle &&
    afterInsert.recordStyle.formula === '=B1+10' &&
    afterInsert.recordStyle.bold === true &&
    bold(afterInsert.recordWeight) &&
    // 3. delete puts everything back
    afterDelete.row0 &&
    afterDelete.row0[2] === 29 &&
    afterDelete.caseId === before.caseId &&
    bold(afterDelete.weight) &&
    // 4. reorder: the format travels with the record, not the position
    afterReorder.caseId === before.caseId &&
    bold(afterReorder.movedWeight) &&
    normal(afterReorder.topWeight) &&
    afterReorder.style &&
    afterReorder.style.formula === '=B1+10' &&
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
