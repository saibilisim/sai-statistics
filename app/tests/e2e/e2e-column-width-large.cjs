// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Regression test: widening a column (real mouse drag on the header resize
 * handle, same as the reported bug) on a moderately large dataset must not
 * hang the renderer. Originally written against Univer, where the
 * skipNextReloadRef race (chunked-load-roadmap.md C3.4) was the concrete
 * failure mode being guarded against. Under the AG Grid architecture
 * (aggrid-gecis-roadmap.md) that whole race is architecturally gone —
 * onColumnResized (DataView.tsx) just persists the new width via
 * updateVariable()/variable:update, there is no reload-vs-command race left
 * to have — but the test still earns its keep as a real-drag responsiveness
 * check, now driven against AG Grid's actual DOM header instead of Univer's
 * canvas. */
const fs = require('fs')
const { _electron } = require('@playwright/test')

const ROWS = 50000
const FIXTURE = '/tmp/sai-colwidth-50k.csv'

function writeCsv(path, rows) {
  const lines = ['id,age,income']
  for (let i = 0; i < rows; i++) lines.push(`${String(i)},${String(i % 90)},${String(rows - i)}`)
  fs.writeFileSync(path, lines.join('\n') + '\n')
}

async function main() {
  writeCsv(FIXTURE, ROWS)

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
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 900)
  })
  await win.waitForTimeout(1000)

  const dsId = await win.evaluate(async path => {
    const r = await window.api.file.import({ filePath: path })
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
    return r.dataset.id
  }, FIXTURE)

  await win.waitForFunction(
    () => !window.__SAI_TEST__.useUIStore.getState().isProcessing,
    undefined,
    {
      timeout: 30000
    }
  )
  await win.waitForTimeout(500)

  const colId = await win.evaluate(
    dsId => window.__SAI_TEST__.useDatasetStore.getState().variables[0].colId,
    dsId
  )
  const widthBefore = await win.evaluate(
    colId =>
      window.__SAI_TEST__.useGridBridgeStore.getState().gridApi.getColumn(colId).getActualWidth(),
    colId
  )

  const headerCell = win.locator(`.ag-header-cell[col-id="${colId}"]`).first()
  const box = await headerCell.boundingBox()
  const resizeX = box.x + box.width - 2
  const resizeY = box.y + box.height / 2

  // Real drag on the column's header resize handle, exactly like a user widening a column.
  await win.mouse.move(resizeX, resizeY)
  await win.mouse.down()
  await win.mouse.move(resizeX + 150, resizeY, { steps: 10 })
  await win.mouse.up()

  // The critical assertion: renderer must still respond right after — a
  // hung/racing reload would make this itself hang.
  const responsive = await Promise.race([
    win.evaluate(() => 1 + 1),
    new Promise(resolve => setTimeout(() => resolve('HUNG'), 8000))
  ])

  await win.waitForTimeout(1500)

  const finalState = await Promise.race([
    win.evaluate(
      colId => ({
        isProcessing: window.__SAI_TEST__.useUIStore.getState().isProcessing,
        col0width: window.__SAI_TEST__.useGridBridgeStore
          .getState()
          .gridApi.getColumn(colId)
          .getActualWidth()
      }),
      colId
    ),
    new Promise(resolve => setTimeout(() => resolve('HUNG'), 8000))
  ])

  console.log('responsive check:', responsive)
  console.log('width before:', widthBefore)
  console.log('final state:', JSON.stringify(finalState))

  const pass =
    responsive === 2 &&
    finalState !== 'HUNG' &&
    finalState.isProcessing === false &&
    finalState.col0width > widthBefore &&
    pageErrors.length === 0

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  fs.unlinkSync(FIXTURE)
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
