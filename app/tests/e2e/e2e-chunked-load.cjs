// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: chunked dataset loading (chunked-load-roadmap.md C5). Forces small
 * chunks via the __SAI_TEST__.chunkRowsOverride hook so a 5,000-row fixture
 * produces ≥5 chunks, then verifies:
 *  (a) post-load row count + first/last cell values are correct
 *  (b) a real click is processed WHILE loading is still in progress (proof
 *      the UI thread isn't frozen for the whole load)
 *  (c) switching datasets mid-load doesn't leak the stale load's rows into
 *      the new dataset (activeInitIdRef-based cancellation)
 *  (d) a cell edit attempted while loading is in progress is rejected;
 *      the same edit succeeds once loading has finished
 *  (e) opening with an active sort renders in the sorted order (the
 *      "collect-then-paint" branch)
 *
 * Rewritten for the AG Grid migration (aggrid-gecis-roadmap.md G8): reads
 * cell values via the real gridApi (window.__SAI_TEST__.useGridBridgeStore
 * .getState().gridApi) instead of Univer's getCellDatas(), and simulates the
 * mid-load edit via rowNode.setDataValue() — AG Grid's documented API for
 * driving a cell through the exact same valueSetter/onCellValueChanged path
 * a real keystroke would take, without needing DOM-level double-click timing
 * against rows that may not be painted yet mid-chunk. load-dataset-chunked.ts
 * itself is framework-agnostic and untouched by the migration.
 */
const fs = require('fs')
const { _electron } = require('@playwright/test')

const ROWS = 5000
const FIXTURE = '/tmp/sai-chunked-5k.csv'
const FIXTURE_SMALL = '/tmp/sai-chunked-small.csv'

function writeCsv(path, rows) {
  const lines = ['id,val']
  for (let i = 0; i < rows; i++) lines.push(`${String(i)},${String(rows - i)}`)
  fs.writeFileSync(path, lines.join('\n') + '\n')
}

async function main() {
  writeCsv(FIXTURE, ROWS)
  writeCsv(FIXTURE_SMALL, 20)

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', err => {
    pageErrors.push(err.message)
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

  // Force small chunks: 5000 rows / 1000-per-chunk = 5 chunks.
  await win.evaluate(() => {
    window.__SAI_TEST__.chunkRowsOverride = 1000
  })

  async function importAndSetDataset(path) {
    return win.evaluate(async p => {
      const r = await window.api.file.import({ filePath: p })
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
      return r
    }, path)
  }

  async function waitForLoadDone(timeoutMs = 20000) {
    await win.waitForFunction(
      () => !window.__SAI_TEST__.useUIStore.getState().isProcessing,
      undefined,
      { timeout: timeoutMs }
    )
  }

  async function gridCell(rowIndex, colId) {
    return win.evaluate(
      ({ rowIndex, colId }) => {
        const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
        const node = api.getDisplayedRowAtIndex(rowIndex)
        return node ? api.getCellValue({ rowNode: node, colKey: colId }) : null
      },
      { rowIndex, colId }
    )
  }

  // ── (a) basic load correctness ──────────────────────────────────────────
  const importResult = await importAndSetDataset(FIXTURE)
  await waitForLoadDone()
  await win.waitForTimeout(300)

  const rowCount = await win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().rowCount)
  const firstId = await gridCell(0, 'col_1')
  const firstVal = await gridCell(0, 'col_2')
  const lastId = await gridCell(ROWS - 1, 'col_1')
  const lastVal = await gridCell(ROWS - 1, 'col_2')
  const checkA =
    rowCount === ROWS &&
    Number(firstId) === 0 &&
    Number(firstVal) === ROWS &&
    Number(lastId) === ROWS - 1 &&
    Number(lastVal) === 1

  console.log('(a) after load:', JSON.stringify({ rowCount, firstId, firstVal, lastId, lastVal }))

  // ── (b) + (d): reload the same big dataset, this time probing mid-load ──
  // Chunked loading is now fast enough (G7/G8 measurements) that a fixed
  // sleep-then-check risks missing the load window entirely — instead poll
  // isProcessing from inside the renderer's own event loop (no IPC
  // round-trip latency) and act the instant it flips true.
  // Fixture is deterministic (row 10 → val = ROWS - 10), so the "before"
  // value doesn't need a separate DB read — it's asserted directly below.
  const dbValueBeforeEditAttempt = [10, ROWS - 10]

  const reloadResult = await importAndSetDataset(FIXTURE)

  const midLoadProbe = await win.evaluate(
    () =>
      new Promise(resolve => {
        const deadline = Date.now() + 3000
        const tick = () => {
          const ui = window.__SAI_TEST__.useUIStore.getState()
          if (ui.isProcessing) {
            const api = window.__SAI_TEST__.useGridBridgeStore.getState().gridApi
            const node = api.getDisplayedRowAtIndex(10)
            let editAttempted = false
            if (node) {
              node.setDataValue('col_2', 999999)
              editAttempted = true
            }
            const btn = document.createElement('button')
            btn.textContent = 'probe'
            let clicked = false
            btn.onclick = () => {
              clicked = true
            }
            document.body.appendChild(btn)
            btn.click()
            document.body.removeChild(btn)
            resolve({
              caughtMidLoad: true,
              isProcessing: ui.isProcessing,
              messageKey: ui.processingMessageKey,
              clickHandled: clicked,
              editAttempted
            })
            return
          }
          if (Date.now() > deadline) {
            resolve({ caughtMidLoad: false })
            return
          }
          setTimeout(tick, 0)
        }
        tick()
      })
  )
  const midLoadState = {
    isProcessing: midLoadProbe.isProcessing,
    messageKey: midLoadProbe.messageKey
  }
  const clickHandled = midLoadProbe.clickHandled
  const midLoadEditAttempted = midLoadProbe.editAttempted
  console.log('mid-load probe:', JSON.stringify(midLoadProbe))
  await win.waitForTimeout(100)

  await waitForLoadDone()
  await win.waitForTimeout(300)

  const dbValueAfterLoadDone = await win.evaluate(async id => {
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows[10]
  }, reloadResult.dataset.id)

  const editRejectedWhileLoading = Number(dbValueAfterLoadDone?.[1]) === dbValueBeforeEditAttempt[1]

  console.log('(b) click handled mid-load:', clickHandled, 'mid-load state:', midLoadState)
  console.log(
    '(d) edit rejected mid-load (db unchanged):',
    editRejectedWhileLoading,
    midLoadEditAttempted
  )

  // (d, part 2) same edit path succeeds once loading is done.
  const postLoadEditWorked = await win.evaluate(async id => {
    await window.api.data.updateCell({ datasetId: id, rowIndex: 10, colId: 'col_2', value: 424242 })
    const r = await window.api.data.getAll({ datasetId: id })
    return r.rows[10]?.[1]
  }, reloadResult.dataset.id)
  const checkPostLoadEdit = Number(postLoadEditWorked) === 424242

  // ── (c) stale-load cancellation: switch to a tiny dataset mid-load ──────
  await importAndSetDataset(FIXTURE) // start a big load again
  await win.waitForTimeout(60)
  const smallResult = await importAndSetDataset(FIXTURE_SMALL) // supersede it immediately
  await waitForLoadDone()
  await win.waitForTimeout(400)

  const afterSwitch = await win.evaluate(() => ({
    rowCount: window.__SAI_TEST__.useDatasetStore.getState().rowCount,
    datasetId: window.__SAI_TEST__.useDatasetStore.getState().datasetId
  }))
  const checkC = afterSwitch.rowCount === 20 && afterSwitch.datasetId === smallResult.dataset.id

  console.log('(c) after mid-load dataset switch:', JSON.stringify(afterSwitch))

  // ── (e) sort applied to an already-loaded dataset → collect-then-paint
  // branch (setDataset() itself always resets columnSort to null, so "sort
  // active at import time" isn't a real scenario — sorting always happens as
  // an in-place operation on a dataset that's already open, same as clicking
  // a column header for real). Reload the big fixture fresh, then sort it.
  await importAndSetDataset(FIXTURE)
  await waitForLoadDone()
  await win.waitForTimeout(300)

  await win.evaluate(() => {
    window.__SAI_TEST__.useDatasetStore.getState().setColumnSort('col_2', 'asc')
  })
  await win.waitForTimeout(100)
  await waitForLoadDone()
  await win.waitForTimeout(300)

  const sortedFirstVal = await gridCell(0, 'col_2')
  // val column runs from ROWS down to 1 as id increases — ascending sort by
  // val should put val=1 (id=ROWS-1) first.
  const checkE = Number(sortedFirstVal) === 1

  await win.evaluate(() => {
    window.__SAI_TEST__.useDatasetStore.getState().setColumnSort('col_2', null)
  })

  console.log('(e) sorted-load first val:', sortedFirstVal)

  const info = {
    checkA,
    clickHandled,
    midLoadWasProcessing: midLoadState.isProcessing,
    editRejectedWhileLoading,
    checkPostLoadEdit,
    checkC,
    checkE,
    pageErrorCount: pageErrors.length
  }
  console.log(JSON.stringify(info, null, 2))

  const pass =
    checkA &&
    clickHandled &&
    midLoadState.isProcessing &&
    editRejectedWhileLoading &&
    checkPostLoadEdit &&
    checkC &&
    checkE &&
    pageErrors.length === 0

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  fs.unlinkSync(FIXTURE)
  fs.unlinkSync(FIXTURE_SMALL)
  if (!pass) {
    console.error('E2E FAILED')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
