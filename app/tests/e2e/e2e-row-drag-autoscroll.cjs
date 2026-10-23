// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies P1.3: holding the mouse near the bottom edge of the grid
 * viewport during a row drag auto-scrolls the grid down (Excel/Sheets/Calc
 * convention — AG Grid's native rowDrag gets this for free, this hand-
 * rolled drag has to do it itself). */
const fs = require('fs')
const { _electron } = require('@playwright/test')

const ROWS = 200
const FIXTURE = '/tmp/sai-autoscroll-200.csv'

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
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1000, 500) // small window → short viewport, few rows visible
  })
  await win.waitForTimeout(300)

  await win.evaluate(async path => {
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
  }, FIXTURE)
  await win.waitForTimeout(1200)

  const scrollTopBefore = await win.evaluate(
    () => document.querySelector('.ag-body-viewport')?.scrollTop ?? -1
  )

  const source = win.locator('.ag-row[row-index="2"] .ag-cell[col-id="__row_num__"]').first()
  const srcBox = await source.boundingBox()
  const viewportBox = await win.evaluate(() => {
    const el = document.querySelector('.ag-body-viewport')
    const r = el.getBoundingClientRect()
    return { bottom: r.bottom }
  })

  await win.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2)
  await win.mouse.down()
  // Move to just inside the bottom edge of the viewport and hold.
  await win.mouse.move(srcBox.x + srcBox.width / 2, viewportBox.bottom - 10, { steps: 5 })
  await win.waitForTimeout(600) // let the auto-scroll interval tick several times
  const scrollTopDuring = await win.evaluate(
    () => document.querySelector('.ag-body-viewport')?.scrollTop ?? -1
  )
  await win.mouse.up()
  await win.waitForTimeout(300)
  const scrollTopAfterRelease = await win.evaluate(
    () => document.querySelector('.ag-body-viewport')?.scrollTop ?? -1
  )
  // Confirm the interval actually stopped (scroll doesn't keep climbing
  // after mouseup even if the mouse is still near the edge).
  await win.waitForTimeout(500)
  const scrollTopSettled = await win.evaluate(
    () => document.querySelector('.ag-body-viewport')?.scrollTop ?? -1
  )

  console.log(
    'RESULT:' +
      JSON.stringify({
        scrollTopBefore,
        scrollTopDuring,
        scrollTopAfterRelease,
        scrollTopSettled,
        errors
      })
  )

  const pass =
    scrollTopBefore === 0 &&
    scrollTopDuring > scrollTopBefore &&
    scrollTopSettled === scrollTopAfterRelease &&
    errors.length === 0

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

main().catch(e => {
  console.error(e)
  process.exit(1)
})
