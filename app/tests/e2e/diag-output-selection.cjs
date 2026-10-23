// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Diagnostic: injects a fake output block (multi-row table) + a heading item,
 * switches to Output tab, then uses REAL Playwright mouse events (not
 * dispatchEvent) to drag across table cells and click the heading nav row —
 * exactly what a human does — to see whether selection actually updates.
 */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  await win.evaluate(() => {
    const T = window.__SAI_TEST__
    const rows = []
    for (let i = 0; i < 8; i++) rows.push([`row ${i}`, i, i * 1.5])
    const result = {
      success: true,
      tables: [{ titleKey: 'Diagnostic Table', columns: ['A', 'B', 'C'], rows, footnoteKey: null }],
      plots: [],
      warnings: [],
      notes: []
    }
    T.useOutputStore.getState().addBlock({
      id: 'diag-1',
      analysisId: 'frequencies',
      titleKey: 'Diagnostic',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result
    })
    T.useOutputStore
      .getState()
      .insertItem({ kind: 'heading', id: 'h1', text: 'My Heading' }, 'diag-1')
    T.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(500)

  // --- Table drag selection ---
  const cells = await win.locator('table td').all()
  console.log('td count:', cells.length)
  const first = await cells[0].boundingBox()
  const last = await cells[cells.length - 1].boundingBox()
  console.log('first cell box:', first)
  console.log('last cell box:', last)

  await win.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await win.mouse.down()
  await win.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 20 })
  await win.mouse.up()
  await win.waitForTimeout(200)

  const selAfterDrag = await win.evaluate(() => {
    const s = window.__SAI_TEST__.useOutputStore.getState().selection
    return s
  })
  console.log('selection after drag:', JSON.stringify(selAfterDrag))

  const selectedCellCount = await win.locator('table td[class*="cellSelected"]').count()
  console.log('cells with cellSelected class:', selectedCellCount)

  // --- Heading nav click ---
  const headingNavRow = win.locator('[class*="navItem"]', { hasText: 'My Heading' })
  const headingCount = await headingNavRow.count()
  console.log('heading nav row found:', headingCount)
  if (headingCount > 0) {
    await headingNavRow.first().click()
    await win.waitForTimeout(200)
    const selAfterHeadingClick = await win.evaluate(
      () => window.__SAI_TEST__.useOutputStore.getState().selection
    )
    console.log('selection after heading click:', JSON.stringify(selAfterHeadingClick))
  }

  await win.screenshot({ path: __dirname + '/../../diag-output-selection.png' })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
