// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Regression test: moving a column on a moderately large dataset used to
 * hang the renderer indefinitely (chunked-load-roadmap.md follow-up,
 * 2026-07-19, Univer era). Under the AG Grid architecture
 * (aggrid-gecis-roadmap.md) that whole skipNextReloadRef race is gone —
 * onColumnMoved (DataView.tsx) just persists the new order via
 * variable.reorder()/setVariables(), no reload-vs-native-command race left
 * to have — but the test still earns its keep as a real-drag responsiveness
 * + correctness check, now driven against AG Grid's actual DOM header drag
 * instead of Univer's move-cols command (onColumnMoved explicitly ignores
 * source==='api', so this can only be exercised with a real mouse drag). */
const fs = require('fs')
const { _electron } = require('@playwright/test')

const ROWS = 50000
const FIXTURE = '/tmp/sai-move-col-50k.csv'

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
  await win.waitForTimeout(1000)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 900)
  })

  const colIds = await win.evaluate(async path => {
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
    return r.variables.map(v => v.colId)
  }, FIXTURE)

  await win.waitForFunction(
    () => !window.__SAI_TEST__.useUIStore.getState().isProcessing,
    undefined,
    {
      timeout: 30000
    }
  )
  await win.waitForTimeout(500)

  // Real drag of the "id" (col 0) header past the "income" (col 2) header —
  // exactly like a user dragging a column header in the real UI.
  const fromHeader = win.locator(`.ag-header-cell[col-id="${colIds[0]}"]`).first()
  const toHeader = win.locator(`.ag-header-cell[col-id="${colIds[2]}"]`).first()
  const fromBox = await fromHeader.boundingBox()
  const toBox = await toHeader.boundingBox()

  await win.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(fromBox.x + fromBox.width / 2 + 20, fromBox.y + fromBox.height / 2, {
    steps: 5
  })
  await win.mouse.move(toBox.x + toBox.width - 5, toBox.y + toBox.height / 2, { steps: 15 })
  await win.mouse.up()

  // The critical assertion: the renderer must still respond to a trivial
  // evaluate call shortly after — a hung main thread would make this itself
  // hang, which is exactly the bug being guarded against.
  const responsive = await Promise.race([
    win.evaluate(() => 1 + 1),
    new Promise(resolve => setTimeout(() => resolve('HUNG'), 8000))
  ])

  await win.waitForTimeout(1000)

  const finalState = await Promise.race([
    win.evaluate(() => ({
      isProcessing: window.__SAI_TEST__.useUIStore.getState().isProcessing,
      variables: window.__SAI_TEST__.useDatasetStore.getState().variables.map(v => v.name)
    })),
    new Promise(resolve => setTimeout(() => resolve('HUNG'), 8000))
  ])

  console.log('responsive check:', responsive)
  console.log('final state:', JSON.stringify(finalState))

  const pass =
    responsive === 2 &&
    finalState !== 'HUNG' &&
    finalState.isProcessing === false &&
    finalState.variables[0] === 'age' &&
    finalState.variables[1] === 'income' &&
    finalState.variables[2] === 'id' &&
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
