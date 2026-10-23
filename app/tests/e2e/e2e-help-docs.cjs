// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Help ▸ User Guide / Statistics Guide (K6.1, faz8-kalite-roadmap.md).
 * Docs are opened via shell.openPath (default browser), so this can't watch
 * a browser window open — instead it stubs shell.openPath to record the
 * resolved path and asserts: the right file for the right language (tr and
 * es — every supported language has its own docs folder since 2026-10-10),
 * and that the file actually exists on disk (would 404 in the
 * browser otherwise — the strongest signal that would have caught the
 * "resources/docs missing from packaged build" class of bug). */
const fs = require('fs')
const path = require('path')
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
  await win.waitForTimeout(1000)

  const opened = await app.evaluateHandle(({ shell }) => {
    const calls = []
    shell.openPath = async p => {
      calls.push(p)
      return ''
    }
    return calls
  })

  async function setLanguage(lang) {
    await app.evaluate(({ BrowserWindow }, l) => {
      const [win] = BrowserWindow.getAllWindows()
      win.webContents.send('menu:language', l)
    }, lang)
    await win.waitForTimeout(300)
  }

  async function clickHelpMenuItem(labelSubstring) {
    await app.evaluate(({ Menu }, needle) => {
      function find(items) {
        for (const item of items) {
          if (item.label && item.label.includes(needle)) return item
          if (item.submenu) {
            const found = find(item.submenu.items)
            if (found) return found
          }
        }
        return null
      }
      const menu = Menu.getApplicationMenu()
      const item = find(menu.items)
      if (!item) throw new Error(`Menu item not found: ${needle}`)
      item.click()
    }, labelSubstring)
  }

  // tr: real doc content exists.
  await setLanguage('tr')
  await clickHelpMenuItem('Kullanıcı Kılavuzu')
  await clickHelpMenuItem('İstatistik Rehberi')

  // es: has its own doc folder since 2026-10-10 (all six languages do) — must
  // open es/, not fall back to en. The fallback itself (menu-builder.ts
  // openDoc) only matters for a language added later without docs.
  await setLanguage('es')
  await clickHelpMenuItem('Guía del usuario')
  await clickHelpMenuItem('Guía de estadística')

  await setLanguage('tr') // reset for whatever runs after this in the suite

  const calls = await opened.jsonValue()
  console.log(JSON.stringify(calls, null, 2))

  const allExist = calls.every(p => fs.existsSync(p))
  const trUserGuide = calls.find(p => p.includes(`${path.sep}tr${path.sep}user-guide.html`))
  const trStatsGuide = calls.find(p => p.includes(`${path.sep}tr${path.sep}statistics-guide.html`))
  const esOpensEs = calls.slice(2).every(p => p.includes(`${path.sep}es${path.sep}`))

  const pass = calls.length === 4 && allExist && !!trUserGuide && !!trStatsGuide && esOpensEs

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED', {
      allExist,
      trUserGuide: !!trUserGuide,
      trStatsGuide: !!trStatsGuide,
      esOpensEs
    })
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
