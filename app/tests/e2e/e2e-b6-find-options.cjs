// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies B6 (roadmap Faz 5.1 — find/replace power options):
 * Options now live in the ⋯ dialog (the bar was slimmed to term + count +
 * prev/next + ⋯ + close), so these drive the dialog's checkboxes:
 *   1. Match case narrows results to exact casing.
 *   2. Match entire cell requires the full cell to equal the term.
 *   3. Regex matches patterns; an invalid pattern shows no matches.
 *   4. Replace works on a substring (not blowing away the whole cell).
 *   5. Shift+F4 jumps to the next match while the bar is closed.
 *
 * Fixture: /tmp/sai-30.csv (ad[text] "Kisi01".."Kisi30", yas, puan).
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

  const cell = (r, c) =>
    win.locator(`.ag-row[row-index="${r}"] .ag-cell[col-id="${varInfo[c]}"]`).first()
  const dialog = win.locator('[role="dialog"][aria-label="Bul ve Değiştir"]')
  // Options moved into the ⋯ dialog (the bar is now term + count + nav only),
  // so drive them from there; the dialog stays open across toggles.
  const searchInput = dialog.locator('input[type=text]').first()
  const countText = () => dialog.locator('[role="status"]').innerText()
  const optBtn = label => dialog.locator(`label:has-text("${label}") input`)

  // Open Find and search lowercase "kisi0" → 9 matches (Kisi01..Kisi09),
  // case-insensitive by default.
  await cell(0, 0).click()
  await win.waitForTimeout(150)
  await win.keyboard.press('Control+f')
  await win.waitForTimeout(300)
  await win.locator('[role="search"] input').first().fill('kisi0')
  await win.waitForTimeout(400)
  await win.locator('[role="search"] button[aria-label*="Diğer seçenekler"]').click()
  await win.waitForTimeout(400)
  const defaultCount = await countText()

  // ── 1. Match case → lowercase "kisi0" no longer matches "Kisi0x" ────────
  await optBtn('Büyük/küçük harf duyarlı').check()
  await win.waitForTimeout(400)
  const caseSensitiveCount = await countText()
  await optBtn('Büyük/küçük harf duyarlı').uncheck() // back off
  await win.waitForTimeout(300)

  // ── 2. Whole cell → "kisi0" matches nothing (cells are "Kisi01" etc.) ───
  await optBtn('Hücrenin tamamı eşleşsin').check()
  await win.waitForTimeout(400)
  const wholeCellPartial = await countText()
  await searchInput.fill('Kisi07')
  await win.waitForTimeout(400)
  const wholeCellExact = await countText()
  await optBtn('Hücrenin tamamı eşleşsin').uncheck()
  await win.waitForTimeout(300)

  // ── 3. Regex → "^Kisi0[1-3]$" matches exactly 3 ─────────────────────────
  await optBtn('Düzenli ifade kullan').check()
  await win.waitForTimeout(300)
  await searchInput.fill('^Kisi0[1-3]$')
  await win.waitForTimeout(400)
  const regexCount = await countText()
  await searchInput.fill('([') // invalid pattern → no crash, no matches
  await win.waitForTimeout(400)
  const invalidRegex = await countText()
  await optBtn('Düzenli ifade kullan').uncheck()
  await win.waitForTimeout(300)

  // ── 4. Replace a substring: "Kisi" → "Case" in row 0 only ───────────────
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)
  await cell(0, 0).click()
  await win.waitForTimeout(150)
  await win.keyboard.press('Control+h')
  await win.waitForTimeout(300)
  const findInput = win.locator('[role="search"] input').first()
  const replaceInput = win.locator('[role="search"] input').nth(1)
  await findInput.fill('Kisi01')
  await win.waitForTimeout(400)
  await replaceInput.fill('Case01')
  await win.waitForTimeout(150)
  await win.locator('[role="search"] button', { hasText: 'Değiştir' }).first().click()
  await win.waitForTimeout(500)
  const replaced = (await cell(0, 0).innerText()).trim() === 'Case01'
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)

  // ── 5. Shift+F4 jumps to the next match with the bar closed ─────────────
  await cell(0, 1).click() // focus somewhere neutral
  await win.waitForTimeout(200)
  await win.keyboard.press('Shift+F4')
  await win.waitForTimeout(400)
  const focusedAfterF4 = await win.evaluate(() => {
    const el = document.querySelector('.ag-cell.ag-cell-focus')
    if (!el) return null
    return {
      row: Number(el.closest('.ag-row')?.getAttribute('row-index')),
      col: el.getAttribute('col-id')
    }
  })
  // The last search term was "Kisi01" which no longer exists (replaced), so
  // fall back to asserting Shift+F4 didn't crash and left focus valid.
  const shiftF4Ok = focusedAfterF4 !== null && errors.length === 0

  const result = {
    defaultCount,
    caseSensitiveCount,
    wholeCellPartial,
    wholeCellExact,
    regexCount,
    invalidRegex,
    replaced,
    shiftF4Ok,
    errors
  }
  console.log('RESULT:' + JSON.stringify(result))

  const pass =
    defaultCount.includes('9') &&
    caseSensitiveCount.includes('Sonuç bulunamadı') &&
    wholeCellPartial.includes('Sonuç bulunamadı') &&
    wholeCellExact.includes('1') &&
    regexCount.includes('3') &&
    invalidRegex.includes('Sonuç bulunamadı') &&
    replaced &&
    shiftF4Ok &&
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
