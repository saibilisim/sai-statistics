// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the start-up Welcome dialog:
 *  1. A plain launch shows it (run-e2e.cjs sets SAI_NO_WELCOME=1 for every
 *     other script; this one removes it again).
 *  2. The Sample data tab lists the bundled resources/sample-data CSVs;
 *     selecting one + "Open" imports it and closes the dialog.
 *  3. A second launch: Escape closes it, leaving the default blank dataset.
 *  4. "Don't show again" persists settings.startup.showWelcome = false (the
 *     test restores the user's previous value afterwards).
 * Needs no fixture — sample data ships in resources/sample-data.
 */
const { _electron } = require('@playwright/test')

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}

const DIALOG = '[role="dialog"][aria-labelledby="welcome-title"]'

async function launch() {
  const env = { ...process.env }
  delete env.SAI_NO_WELCOME
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..',
    env
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

async function main() {
  const errors = []

  // ── 1 + 2: shows on plain launch; sample import ──────────────────────
  let { app, win } = await launch()
  win.on('pageerror', e => errors.push(e.message))
  const previous = await win.evaluate(async () => (await window.api.settings.get()).startup)
  if (previous && previous.showWelcome === false) {
    await win.evaluate(() => window.api.settings.set({ path: 'startup.showWelcome', value: true }))
    await app.close()
    ;({ app, win } = await launch())
    win.on('pageerror', e => errors.push(e.message))
  }

  await win.waitForSelector(DIALOG, { timeout: 15000 })
  await win.waitForTimeout(200)
  const focusedId = await win.evaluate(() => document.activeElement?.id ?? '')
  assert(focusedId === 'welcome-list', `initial focus on the file list (${focusedId})`)
  console.log('PASS dialog shown on plain launch, focus on list')

  await win.click('[role="tab"][id="welcome-tab-samples"]')
  const samples = await win.$$eval(`${DIALOG} [role="option"]`, els =>
    els.map(e => e.querySelector('span')?.textContent ?? '')
  )
  assert(samples.includes('iris'), `samples listed: ${samples.join(', ')}`)
  console.log(`PASS samples: ${samples.join(', ')}`)

  // Switching tabs preselects the first entry (SPSS-style), and keyboard
  // focus starts on the list rather than the × button.
  const firstSelected = await win.$eval(
    `${DIALOG} [role="option"][aria-selected="true"]`,
    e => e.querySelector('span')?.textContent ?? ''
  )
  assert(firstSelected === samples[0], `first sample preselected (${firstSelected})`)
  await win.focus('#welcome-list')
  await win.keyboard.press('ArrowDown')
  const afterArrow = await win.$eval(
    `${DIALOG} [role="option"][aria-selected="true"]`,
    e => e.querySelector('span')?.textContent ?? ''
  )
  assert(afterArrow === samples[1], `ArrowDown moves selection (${afterArrow})`)
  console.log('PASS preselection + arrow keys')

  const openBtn = win.locator(`${DIALOG} button`, { hasText: /^(Aç|Open)$/ })
  await win.click(`${DIALOG} [role="option"]:has-text("iris")`)
  await openBtn.click()
  await win.waitForSelector(DIALOG, { state: 'detached', timeout: 5000 })
  await win.waitForFunction(
    () => window.__SAI_TEST__.useDatasetStore.getState().rowCount === 150,
    null,
    { timeout: 20000 }
  )
  console.log('PASS sample import (iris, 150 rows) + dialog closed')
  await app.close()

  // ── 3 + 4: Escape closes; "don't show again" persists ────────────────
  ;({ app, win } = await launch())
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForSelector(DIALOG, { timeout: 15000 })
  await win.keyboard.press('Escape')
  await win.waitForSelector(DIALOG, { state: 'detached', timeout: 5000 })
  console.log('PASS Escape closes')

  // Reopen path for the checkbox: flip the flag through the dialog itself on
  // one more launch.
  await app.close()
  ;({ app, win } = await launch())
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForSelector(DIALOG, { timeout: 15000 })
  await win.check(`${DIALOG} input[type="checkbox"]`)
  await win.click(`${DIALOG} button[aria-label]`)
  await win.waitForSelector(DIALOG, { state: 'detached', timeout: 5000 })
  await win.waitForTimeout(300)
  const after = await win.evaluate(async () => (await window.api.settings.get()).startup)
  assert(after.showWelcome === false, "don't-show-again persisted")
  console.log('PASS dont-show-again persisted')

  // Restore the user's own preference.
  await win.evaluate(
    value => window.api.settings.set({ path: 'startup.showWelcome', value }),
    previous ? previous.showWelcome : true
  )
  await app.close()

  assert(errors.length === 0, `no page errors: ${errors.join(' | ')}`)
  console.log('ALL PASS')
}

main().catch(err => {
  console.error('FAIL', err)
  process.exit(1)
})
