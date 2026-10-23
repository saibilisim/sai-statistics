// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies Variable View name selection + copy:
 *   click a Name cell selects the variable (no editor opens), Shift-click
 *   extends, Ctrl-click toggles, drag over Name cells selects a range,
 *   Ctrl+A selects all; Ctrl+C / context menu copy the names in
 *   three formats (lines, one line, name<TAB>label); double-click still edits.
 * Uses the bundled iris sample (resources/sample-data) — no /tmp fixture.
 */
const path = require('path')
const { _electron } = require('@playwright/test')

const results = []
function check(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

async function main() {
  const appDir = path.join(__dirname, '..', '..')
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: appDir })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)

  const iris = path.join(appDir, 'resources', 'sample-data', 'iris.csv')
  await win.evaluate(async filePath => {
    const r = await window.api.file.import({ filePath })
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
  }, iris)
  await win.waitForTimeout(800)
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('variable'))
  await win.waitForSelector('.ag-row[row-index="4"] .ag-cell[col-id="name"]', { timeout: 10000 })

  const nameCell = i => win.locator(`.ag-row[row-index="${i}"] .ag-cell[col-id="name"]`).first()
  const selectedRows = () =>
    win.$$eval('.ag-center-cols-container .ag-row.ag-row-selected', els =>
      els.map(e => Number(e.getAttribute('row-index'))).sort((a, b) => a - b)
    )
  const editing = async () => (await win.$$('.ag-cell-inline-editing')).length > 0
  const clip = {
    clear: () => app.evaluate(({ clipboard }) => clipboard.writeText('')),
    // Windows hands \n back as \r\n — compare line content, not line endings.
    read: async () =>
      (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')
  }

  // Click selects, no editor.
  await nameCell(0).click()
  await win.waitForTimeout(150)
  check(JSON.stringify(await selectedRows()) === '[0]', 'click selects the variable')
  check(!(await editing()), 'single click does not open the editor')

  // Shift-click extends, Ctrl-click toggles.
  await nameCell(2).click({ modifiers: ['Shift'] })
  await win.waitForTimeout(150)
  check(
    JSON.stringify(await selectedRows()) === '[0,1,2]',
    `shift-click range (${await selectedRows()})`
  )
  await nameCell(1).click({ modifiers: ['Control'] })
  await win.waitForTimeout(150)
  check(
    JSON.stringify(await selectedRows()) === '[0,2]',
    `ctrl-click toggles (${await selectedRows()})`
  )

  // Ctrl+C copies selected names, one per line, in grid order.
  await clip.clear()
  await win.keyboard.press('Control+c')
  await win.waitForTimeout(200)
  check(
    (await clip.read()) === 'Sepal_Length\nPetal_Length',
    `Ctrl+C names (${JSON.stringify(await clip.read())})`
  )
  const status = await win.$eval('[role="status"]', el => el.textContent || '').catch(() => '')
  check(/2/.test(status), `status bar confirms the copy (${status})`)

  // Drag over Name cells selects a range.
  const b1 = await nameCell(1).boundingBox()
  const b3 = await nameCell(3).boundingBox()
  await win.mouse.move(b1.x + 10, b1.y + b1.height / 2)
  await win.mouse.down()
  await win.mouse.move(b3.x + 10, b3.y + b3.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(150)
  check(
    JSON.stringify(await selectedRows()) === '[1,2,3]',
    `drag selects a range (${await selectedRows()})`
  )

  // Context menu: one-line and with-labels formats.
  const menuItem = re => win.locator('[role="menu"] [role="menuitem"]', { hasText: re }).first()
  await nameCell(2).click({ button: 'right' })
  await clip.clear()
  await menuItem(/yan yana|one line/i).click()
  await win.waitForTimeout(200)
  check(
    (await clip.read()) === 'Sepal_Width Petal_Length Petal_Width',
    `context menu: one line (${JSON.stringify(await clip.read())})`
  )
  await nameCell(2).click({ button: 'right' })
  await clip.clear()
  await menuItem(/etiketleriyle|with labels/i).click()
  await win.waitForTimeout(200)
  check(
    (await clip.read()) ===
      'Sepal_Width\tSepal.Width\nPetal_Length\tPetal.Length\nPetal_Width\tPetal.Width',
    `context menu: names with labels (${JSON.stringify(await clip.read())})`
  )

  // Ctrl+A selects all; the context menu copies them.
  await nameCell(0).click()
  await win.keyboard.press('Control+a')
  await win.waitForTimeout(150)
  check((await selectedRows()).length === 5, 'Ctrl+A selects every variable')
  await clip.clear()
  await nameCell(0).click({ button: 'right' })
  await menuItem(/Değişken adlarını kopyala|Copy variable names/).click()
  await win.waitForTimeout(200)
  check((await clip.read()).split('\n').length === 5, 'context menu copies all selected names')

  // Double-click still edits the name.
  await nameCell(4).dblclick()
  await win.waitForTimeout(200)
  check(await editing(), 'double-click opens the name editor')
  await win.keyboard.press('Escape')

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
  await app.close()
  const failed = results.filter(r => !r.ok)
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
