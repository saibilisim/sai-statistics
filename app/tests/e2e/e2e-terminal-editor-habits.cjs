// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Editor habits in the Terminal's code editor (2026-10-21):
 *
 *   find     — Ctrl+H (through the Edit menu accelerator) opens find/replace
 *              in the R script; the count shows the matches; Next walks them.
 *   replace  — Replace All rewrites every match, and ONE Ctrl+Z restores the
 *              original (one undo step).
 *   comment  — Ctrl+Shift+C comments the selected lines, again uncomments.
 *   spss     — Ctrl+F in SPSS mode opens the bar on the syntax editor.
 *
 * Usage: node tests/e2e/run-e2e.cjs editor-habits   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const path = require('path')

const SCRIPT = 'x <- mean(a)\ny <- mean(b)\nz <- median(c)'

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  await win.evaluate(src => {
    const T = window.__SAI_TEST__
    T.useUIStore.getState().setActiveTab('terminal')
    T.useTerminalStore.getState().setMode('r')
    T.useTerminalStore.getState().setRSource(src)
  }, SCRIPT)
  await win.waitForTimeout(600)

  const rSource = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rSource)
  const editor = win.locator('textarea[aria-label="R betiği"], textarea[aria-label="R script"]')
  const bar = win.locator('[role="search"]')
  const checks = {}

  // ── find (real accelerator) ──
  await editor.first().click()
  await win.keyboard.press('Control+h')
  await bar.waitFor({ timeout: 5000 })
  const findInput = bar.locator('input').first()
  await findInput.fill('mean')
  await win.waitForTimeout(200)
  checks.count = /1\/2/.test((await bar.textContent()) ?? '')
  await findInput.press('Enter')
  await win.waitForTimeout(200)
  checks.next = /2\/2/.test((await bar.textContent()) ?? '')

  // ── replace all + one undo ──
  await bar.locator('input').nth(1).fill('median')
  await bar
    .locator('button')
    .filter({ hasText: /^(Tümünü değiştir|Replace all)$/ })
    .click()
  await win.waitForTimeout(300)
  checks.replaceAll = (await rSource()) === SCRIPT.replace(/mean/g, 'median')
  await editor.first().focus()
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(300)
  checks.oneUndo = (await rSource()) === SCRIPT
  await win.keyboard.press('Escape')

  // ── comment toggle ──
  await editor.first().focus()
  await win.keyboard.press('Control+a')
  await win.keyboard.press('Control+Shift+c')
  await win.waitForTimeout(200)
  checks.commented =
    (await rSource()) ===
    SCRIPT.split('\n')
      .map(l => `# ${l}`)
      .join('\n')
  await win.keyboard.press('Control+Shift+c')
  await win.waitForTimeout(200)
  checks.uncommented = (await rSource()) === SCRIPT

  // ── SPSS editor ──
  await win.evaluate(() => {
    const T = window.__SAI_TEST__
    T.useTerminalStore.getState().setMode('spss')
    T.useTerminalStore.getState().setSource('FREQUENCIES age.\nDESCRIPTIVES age.')
  })
  await win.waitForTimeout(500)
  await win.locator('textarea').first().click()
  await win.keyboard.press('Control+f')
  const spssBar = win.locator('[role="search"]')
  await spssBar.waitFor({ timeout: 5000 })
  await spssBar.locator('input').first().fill('age')
  await win.waitForTimeout(200)
  checks.spssFind = /1\/2/.test((await spssBar.textContent()) ?? '')

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()

  console.log('checks:', JSON.stringify(checks))
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length) {
    console.log('FAILED:', failed.map(([k]) => k).join(', '))
    process.exit(1)
  }
  console.log('ALL PASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
