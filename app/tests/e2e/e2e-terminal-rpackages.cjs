// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the R side panel's Packages tab (Faz T3 P1):
 *  - the list comes from the live session (base packages present);
 *  - ticking / unticking runs library() / detach() — echoed in the console,
 *    the checkbox follows the session's search path;
 *  - Install puts a package from the dated snapshot repo into the USER
 *    library (here a throwaway folder via SAI_R_USER_LIBRARY, never the real
 *    ~/R/library), the session sees it at once and it loads;
 *  - a malformed package name is refused at the IPC boundary.
 * Needs internet for the install step (one tiny pure-R package: praise).
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const { _electron } = require('@playwright/test')

const results = []
function check(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

async function main() {
  const appDir = path.join(__dirname, '..', '..')
  const userLib = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-e2e-rlib-'))
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: appDir,
    env: { ...process.env, SAI_R_USER_LIBRARY: userLib }
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  })

  const pkgs = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rPackages)
  const status = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rStatus)
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const v = await fn()
      if (v || Date.now() > end) return v
      await win.waitForTimeout(250)
    }
  }
  check(await until(async () => (await status()) === 'idle', 40000), 'R session ready')

  // ── List ──
  await win.locator('[class*="sideTab"]', { hasText: /^(Paketler|Packages)$/ }).click()
  const list = await until(async () => {
    const p = await pkgs()
    return p && p.length > 0 ? p : null
  }, 20000)
  check(
    list &&
      list.some(p => p.name === 'stats' && p.attached) &&
      list.some(p => p.name === 'jsonlite'),
    `package list from the session (${list ? list.length : 0} packages)`
  )

  // ── Load / unload via the checkbox ──
  const row = name =>
    win
      .locator('[class*="pkgRow"]')
      .filter({ has: win.locator(`text="${name}"`) })
      .first()
  await row('tools').locator('input[type="checkbox"]').click()
  const loaded = await until(
    async () => (await pkgs())?.find(p => p.name === 'tools')?.attached,
    10000
  )
  const outText = () => win.$eval('[class*="rConsole"]', el => el.textContent || '')
  check(loaded && /> library\(tools\)/.test(await outText()), 'tick → library(tools), echoed')
  await until(async () => (await status()) === 'idle', 10000)
  await row('tools').locator('input[type="checkbox"]').click()
  const unloaded = await until(
    async () => (await pkgs())?.find(p => p.name === 'tools')?.attached === false,
    10000
  )
  check(unloaded, 'untick → detach("package:tools")')
  // Typed in the console too: the list follows the search path.
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'library(tools)' }))
  check(
    await until(async () => (await pkgs())?.find(p => p.name === 'tools')?.attached, 10000),
    'library() typed in the console updates the list'
  )

  // ── Install into the (throwaway) user library ──
  const input = win.locator('[class*="pkgInstall"] input')
  await input.fill('praise')
  await win.locator('[class*="pkgInstall"] button').click()
  const installedMsg = await win
    .locator('[class*="pkgStatus"]', { hasText: /kuruldu|installed/ })
    .waitFor({ timeout: 240000 })
    .then(
      () => true,
      () => false
    )
  check(installedMsg, 'install reports success')
  check(
    fs.existsSync(path.join(userLib)) && fs.readdirSync(userLib).length > 0,
    'installed into the user library override'
  )
  const praise = await until(async () => (await pkgs())?.find(p => p.name === 'praise'), 15000)
  check(praise && praise.user, `listed with the user badge (${JSON.stringify(praise)})`)
  await row('praise').locator('input[type="checkbox"]').click()
  await until(async () => (await status()) === 'idle', 10000)
  await win.evaluate(() =>
    window.api.terminal.rWrite({ code: 'cat("ok:", nchar(praise()) > 0, "\\n")' })
  )
  check(
    await until(async () => /ok: TRUE/.test(await outText()), 10000),
    'the new package loads and runs'
  )
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rpackages.png') })

  // ── Malformed name refused at the IPC boundary ──
  const bad = await win
    .evaluate(() => window.api.terminal.rPkgInstall({ name: 'x"); system("calc' }))
    .then(
      () => 'accepted',
      e => String(e)
    )
  check(bad !== 'accepted', 'malformed package name rejected')

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
  await app.close()
  fs.rmSync(userLib, { recursive: true, force: true })
  const failed = results.filter(r => !r.ok)
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
