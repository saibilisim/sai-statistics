// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Smoke test for release_check.md P0.4 (first-run setup dialog) and general
 * boot health after the round of fixes in this branch.
 *
 * By default this only checks that R status resolves (not stuck on
 * "starting" — a real race this test caught between R detection and the
 * renderer's status listener mounting, fixed via the r:get-status pull) and
 * that no unexpected console errors appear. To also exercise the "missing
 * required package" branch of the setup dialog, temporarily rename a required
 * package out of ~/R/library (e.g. `mv ~/R/library/arrow ~/R/library/arrow.bak`)
 * before running, then restore it after.
 *
 * Run: xvfb-run -a node tests/e2e/e2e-release-check-smoke.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')

// The dev CSP intentionally omits font-src (see main.ts buildCsp comment);
// Univer/AG-Grid inline data-URI fonts trip it. Pre-existing, unrelated to
// this branch's changes — filtered so it doesn't mask a real regression.
const KNOWN_BENIGN = /violates the following Content Security Policy/

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', err => errors.push(String(err)))
  win.on('console', msg => {
    if (msg.type() === 'error' && !KNOWN_BENIGN.test(msg.text())) errors.push(msg.text())
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(6000)

  const rStatus = await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().rStatus)
  console.log('rStatus after 6s:', rStatus)

  const dialogText = await win
    .locator('[role="dialog"]')
    .first()
    .innerText()
    .catch(() => null)
  console.log('dialog text:', JSON.stringify(dialogText))
  await win.screenshot({ path: 'e2e-setup-welcome.png' })

  console.log('console/page errors:', JSON.stringify(errors, null, 2))

  // Analiz sonuçları Output'u kirletir (outputDirty) — headless'ta kapanış
  // guard'ının native dialogu sonsuza dek bekler. Otomatik "kaydetme/dışa
  // aktarma yok" (1) seçilir (e2e-value-labels.cjs ile aynı desen).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()

  if (errors.length > 0) {
    console.error('FAIL: console/page errors present')
    process.exit(1)
  }
  if (rStatus === 'starting') {
    console.error('FAIL: rStatus never resolved past "starting" (push/mount race regression)')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
