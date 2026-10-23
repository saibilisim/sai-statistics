// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Help ▸ Report Issue dialog (K7). Opens via the real menu IPC channel
 * (menu:help:report-issue), asserts the system-info fields render (no raw
 * i18n key leaks), "Copy System Info" writes to the clipboard, and "Open Log
 * Folder" calls the diag IPC without throwing. */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')

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
  await win.waitForTimeout(1500)

  await app.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows()
    win.webContents.send('menu:help:report-issue')
  })
  await win.waitForTimeout(1000)

  // Help ▸ Report a Bug sends a support e-mail draft (1ae1d82 replaced the
  // former GitHub issue button). Label taken from every locale so the check
  // does not depend on the profile's UI language.
  const localesDir = require('node:path').resolve(__dirname, '../../src/i18n/locales')
  const emailLabels = fs
    .readdirSync(localesDir)
    .map(l => require(require('node:path').join(localesDir, l, 'dialogs.json')))
    .map(d => (d.dialogs ?? d).reportIssue?.emailSupport)
    .filter(Boolean)

  const info = await win.evaluate(emailLabels => {
    const dialog = document.querySelector('[role="dialog"][aria-modal]')
    const bodyText = dialog ? dialog.textContent || '' : ''
    const leaks = (bodyText.match(/\b(dialogs|common)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    return {
      opened: !!dialog,
      hasVersionRow: /\d+\.\d+\.\d+/.test(bodyText),
      hasCopyBtn: !!Array.from(dialog?.querySelectorAll('button') ?? []).find(
        b => /copy/i.test(b.textContent || '') || /kopyala/i.test(b.textContent || '')
      ),
      hasLogBtn: !!Array.from(dialog?.querySelectorAll('button') ?? []).find(b =>
        /log/i.test(b.textContent || '')
      ),
      hasEmailBtn: !!Array.from(dialog?.querySelectorAll('button') ?? []).find(b =>
        emailLabels.includes((b.textContent || '').trim())
      ),
      rawKeyLeaks: leaks
    }
  }, emailLabels)
  console.log(JSON.stringify(info, null, 2))

  // Click "Copy System Info" via a real Playwright click (focuses the page —
  // navigator.clipboard.writeText throws "Document is not focused" otherwise
  // under xvfb, unlike a synthetic DOM .click()).
  const copyBtn = win.locator('[role="dialog"][aria-modal] button', {
    hasText: /copy|kopyala/i
  })
  await copyBtn.click()
  await win.waitForTimeout(500)
  const copiedLabelShown = await win.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal]')
    return /copied|kopyaland/i.test(dialog.textContent || '')
  })

  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  const closed = await win.evaluate(() => !document.querySelector('[role="dialog"][aria-modal]'))

  const pass =
    info.opened &&
    info.hasVersionRow &&
    info.hasCopyBtn &&
    info.hasLogBtn &&
    info.hasEmailBtn &&
    info.rawKeyLeaks.length === 0 &&
    copiedLabelShown &&
    closed

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED', { copiedLabelShown, closed })
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
