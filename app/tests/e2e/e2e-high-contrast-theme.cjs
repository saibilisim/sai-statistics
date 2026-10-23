// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: High Contrast theme (K2). Cycles the real menu:theme IPC channel
 * through light/dark/high-contrast, asserts each application actually
 * changes the root CSS custom properties (not just a no-op fallback to
 * 'light'), and that high-contrast lands on pure black/white with the
 * amber focus-ring token. Screenshots all three for a manual visual check. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => {
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  async function setTheme(theme) {
    await app.evaluate(({ BrowserWindow }, t) => {
      const [win] = BrowserWindow.getAllWindows()
      win.webContents.send('menu:theme', t)
    }, theme)
    await win.waitForTimeout(400)
  }

  async function readVars() {
    return win.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        dataTheme: document.documentElement.getAttribute('data-theme'),
        bgBase: style.getPropertyValue('--color-bg-base').trim(),
        textPrimary: style.getPropertyValue('--color-text-primary').trim(),
        borderFocus: style.getPropertyValue('--color-border-focus').trim()
      }
    })
  }

  await setTheme('light')
  const light = await readVars()
  await win.screenshot({ path: __dirname + '/../../e2e-theme-light.png' })

  await setTheme('dark')
  const dark = await readVars()
  await win.screenshot({ path: __dirname + '/../../e2e-theme-dark.png' })

  await setTheme('high-contrast')
  const hc = await readVars()
  await win.screenshot({ path: __dirname + '/../../e2e-theme-high-contrast.png' })

  const info = { light, dark, hc }
  console.log(JSON.stringify(info, null, 2))

  const pass =
    light.dataTheme === 'light' &&
    dark.dataTheme === 'dark' &&
    dark.bgBase !== light.bgBase &&
    hc.dataTheme === 'high-contrast' &&
    hc.bgBase === '#000000' &&
    hc.textPrimary === '#ffffff' &&
    hc.borderFocus === '#ffd60a' &&
    hc.bgBase !== dark.bgBase

  // Leave the app in a known state (light) so this script doesn't affect
  // whatever runs after it in the suite.
  await setTheme('light')

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

main().catch(err => {
  console.error(err)
  process.exit(1)
})
