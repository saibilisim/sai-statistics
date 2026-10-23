// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Preferences ▸ AI ▸ "Veri paylaşımı" row (2026-10-11). The data-sharing
 * consent used to be reachable only through the first-use dialog; this row
 * shows its state and reopens the same dialog to give or withdraw it.
 *   1. consent given → row says so; the button opens the dialog ON TOP of
 *      Preferences with "withdraw" + "close" (no accept/decline);
 *   2. withdraw → settings.ai.consentGiven false, row updates live;
 *   3. reopen → accept/decline; accept → true again;
 *   4. Preferences OK afterwards does not overwrite the consent with the
 *      value it loaded when it opened.
 * The user's original consent value is restored at the end. */
const { _electron } = require('@playwright/test')
const path = require('path')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  const results = []
  const ok = (name, pass, extra = '') => {
    results.push(pass)
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`)
  }
  const consent = () =>
    win.evaluate(() => window.__SAI_TEST__.useSettingsStore.getState().settings.ai.consentGiven)
  const setConsent = v =>
    win.evaluate(
      v => window.__SAI_TEST__.useSettingsStore.getState().setSetting('ai', { consentGiven: v }),
      v
    )
  const original = await consent()
  await setConsent(true)

  await win.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sai:open-preferences', { detail: { category: 'ai' } }))
  )
  await win.waitForTimeout(800)

  // The row: label + state text + button, found by its label text.
  const row = () =>
    win.evaluate(() => {
      const label = Array.from(document.querySelectorAll('span')).find(
        s => s.textContent === 'Veri paylaşımı'
      )
      const r = label?.parentElement
      return r ? { text: r.textContent, hasBtn: !!r.querySelector('button') } : null
    })
  const clickRowButton = () =>
    win.evaluate(() => {
      const label = Array.from(document.querySelectorAll('span')).find(
        s => s.textContent === 'Veri paylaşımı'
      )
      label?.parentElement?.querySelector('button')?.click()
    })
  const consentDialog = () =>
    win.evaluate(() => {
      const d = document.querySelector('[aria-labelledby="ai-consent-title"]')
      if (!d) return null
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      return {
        buttons: Array.from(d.querySelectorAll('button')).map(b => b.textContent),
        onTop: dialogs[dialogs.length - 1] === d
      }
    })
  const clickInConsent = text =>
    win.evaluate(t => {
      const d = document.querySelector('[aria-labelledby="ai-consent-title"]')
      Array.from(d?.querySelectorAll('button') ?? [])
        .find(b => b.textContent === t)
        ?.click()
    }, text)

  const r1 = await row()
  ok('row present with a button', !!r1?.hasBtn, JSON.stringify(r1))
  ok('row shows consent given', !!r1?.text.includes('Onay verildi'))

  await clickRowButton()
  await win.waitForTimeout(400)
  const d1 = await consentDialog()
  ok('consent dialog opens on top of Preferences', !!d1?.onTop, JSON.stringify(d1))
  ok(
    'given → withdraw + close, no accept',
    !!d1 && d1.buttons.includes('Onayı geri çek') && !d1.buttons.includes('Kabul ediyorum')
  )

  await clickInConsent('Onayı geri çek')
  await win.waitForTimeout(400)
  ok('withdraw sets consentGiven=false', (await consent()) === false)
  ok('dialog closed after withdraw', (await consentDialog()) === null)
  ok('row updates to not given', !!(await row())?.text.includes('Onay verilmedi'))

  await clickRowButton()
  await win.waitForTimeout(400)
  const d2 = await consentDialog()
  ok('not given → accept/decline offered', !!d2 && !d2.buttons.includes('Onayı geri çek'))
  const acceptText = await win.evaluate(() => {
    const d = document.querySelector('[aria-labelledby="ai-consent-title"]')
    return d?.querySelector('button[class*="primary"]')?.textContent ?? null
  })
  await clickInConsent(acceptText)
  await win.waitForTimeout(400)
  ok('accept sets consentGiven=true', (await consent()) === true)

  // Withdraw again, then press Preferences OK: the dialog's local copy (loaded
  // with consent=true) must not write it back.
  await clickRowButton()
  await win.waitForTimeout(300)
  await clickInConsent('Onayı geri çek')
  await win.waitForTimeout(300)
  await win.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal]')
    const okBtn = Array.from(d?.querySelectorAll('button') ?? []).find(
      b => b.textContent === 'Tamam'
    )
    okBtn?.click()
  })
  await win.waitForTimeout(600)
  ok('Preferences OK keeps the withdrawn consent', (await consent()) === false)
  ok('no page errors', pageErrors.length === 0, pageErrors.join(' | '))

  await setConsent(original)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
