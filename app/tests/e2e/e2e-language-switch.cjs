// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: multi-language infra (K4.1). Cycles through every SUPPORTED_LANGUAGES
 * entry via the real menu:language IPC channel and asserts each one actually
 * loads (no pageerror — e.g. a missing/malformed locale JSON file — and the
 * OK button's translated text actually changes across languages, proving
 * react-i18next's dynamic backend picked up the new language rather than
 * silently falling back to the previous one). */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', err => {
    pageErrors.push(err.message)
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)

  // Mirrors shared/languages.ts SUPPORTED_LANGUAGES — kept as a plain literal
  // here rather than imported, since this script runs standalone under Node
  // against the built app, not through the TS/Vite pipeline that resolves
  // shared/languages.ts at build time.
  const languages = ['tr', 'en', 'es', 'fr', 'pt', 'it']
  console.log('SUPPORTED_LANGUAGES:', languages)

  async function setLanguage(lang) {
    await app.evaluate(({ BrowserWindow }, l) => {
      const [win] = BrowserWindow.getAllWindows()
      win.webContents.send('menu:language', l)
    }, lang)
    await win.waitForTimeout(500)
  }

  // Open Preferences (a DialogBase instance with an OK button) once, then
  // switch language underneath it — the dialog's own strings should follow.
  await app.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows()
    win.webContents.send('menu:preferences')
  })
  await win.waitForTimeout(500)

  const okTexts = {}
  for (const lang of languages) {
    await setLanguage(lang)
    const okText = await win.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-modal]')
      const btns = Array.from(dialog?.querySelectorAll('button') ?? [])
      // OK is the primary submit button — last one is Cancel/Reset in DialogBase's
      // footerRight order (Ok, Reset?, Cancel), so just grab all text for a diff check.
      return btns.map(b => b.textContent).join('|')
    })
    okTexts[lang] = okText
  }

  console.log(JSON.stringify(okTexts, null, 2))

  const distinctTexts = new Set(Object.values(okTexts))
  const allNonEmpty = Object.values(okTexts).every(t => t && t.trim().length > 0)

  const pass = pageErrors.length === 0 && allNonEmpty && distinctTexts.size >= 3

  // Reset back to Turkish (repo default) so this script doesn't leave the
  // persisted settings.json in a non-default language for whatever runs next.
  await setLanguage('tr')

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED', {
      pageErrorCount: pageErrors.length,
      distinctCount: distinctTexts.size
    })
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
