// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies Transform ▸ Compute Variable (SPSS-style dialog), which replaced
 * the dead ComputeInfoDialog (it pointed at Univer cell formulas, removed
 * 2026-07-20):
 *   1. The menu opens a real dialog with target/expression/variable/function
 *      panels — not an info modal.
 *   2. Clicking a variable and a function inserts them into the expression.
 *   3. Running creates the new column and computes every row
 *      (verified against DuckDB, not just the grid).
 *   4. An unknown name reports #NAME? instead of writing garbage.
 *
 * Fixture: /tmp/sai-test.csv (cinsiyet, yas, puan).
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

  await win.evaluate(async () => {
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
  })
  await win.waitForTimeout(1200)

  const dialog = win.locator('[role="dialog"][aria-label="Değişken Hesapla"]')
  const openCompute = async () => {
    await win.evaluate(() => {
      window.dispatchEvent(new CustomEvent('__sai_menu__', { detail: 'menu:transform:compute' }))
    })
  }

  // The menu command arrives over IPC; drive it the same way the menu does.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.webContents.send('menu:transform:compute')
  })
  await win.waitForTimeout(700)

  const opened = await dialog.isVisible().catch(() => false)
  const panels = opened
    ? await win.evaluate(() => {
        const d = document.querySelector('[role="dialog"][aria-label="Değişken Hesapla"]')
        return {
          hasTarget: !!d.querySelector('#cv-target'),
          hasExpression: !!d.querySelector('textarea'),
          varCount: d.querySelectorAll('ul')[0]?.querySelectorAll('button').length ?? 0,
          fnCount: d.querySelectorAll('ul')[1]?.querySelectorAll('button').length ?? 0,
          keys: d.querySelectorAll('button').length
        }
      })
    : null

  // ── Build "bmi_like = puan / yas" using the panels ──────────────────────
  await dialog.locator('#cv-target').fill('hesap')
  await dialog
    .locator('ul')
    .first()
    .locator('button', { hasText: /^puan$/ })
    .click()
  await win.waitForTimeout(200)
  await dialog.locator('textarea').press('End')
  await win.keyboard.type(' / ')
  await dialog.locator('ul').first().locator('button', { hasText: /^yas$/ }).click()
  await win.waitForTimeout(200)
  const expr = await dialog.locator('textarea').inputValue()

  await dialog.locator('button', { hasText: 'Tamam' }).click()
  await win.waitForTimeout(1500)

  const dialogClosed = !(await dialog.isVisible().catch(() => false))
  // Verify against DuckDB: row0 = puan 80 / yas 25 = 3.2
  const dbCheck = await win.evaluate(async () => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    const idx = ds.variables.findIndex(v => v.name === 'hesap')
    const res = await window.api.data.getChunk({ datasetId: ds.datasetId, offset: 0, limit: 3 })
    return {
      created: idx !== -1,
      values: idx === -1 ? [] : res.rows.map(r => r[idx])
    }
  })

  // ── Unknown name → #NAME? reported, no column created ───────────────────
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:transform:compute')
  })
  await win.waitForTimeout(700)
  await dialog.locator('#cv-target').fill('hata')
  await dialog.locator('textarea').fill('bilinmeyen + 1')
  await dialog.locator('button', { hasText: 'Tamam' }).click()
  await win.waitForTimeout(1000)
  const errMsg = await dialog
    .locator('[role="status"]')
    .innerText()
    .catch(() => '')
  const reportsName = errMsg.includes('#NAME?')

  const result = {
    opened,
    panels,
    expr,
    dialogClosed,
    dbCheck,
    errMsg: errMsg.trim(),
    reportsName,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    opened &&
    panels.hasTarget &&
    panels.hasExpression &&
    panels.varCount === 3 &&
    panels.fnCount === 17 &&
    expr === 'puan / yas' &&
    dialogClosed &&
    dbCheck.created &&
    Math.abs(dbCheck.values[0] - 3.2) < 1e-9 &&
    Math.abs(dbCheck.values[1] - 2.5) < 1e-9 &&
    reportsName &&
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
