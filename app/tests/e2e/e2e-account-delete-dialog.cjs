// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Preferences ▸ AI ▸ "Tehlikeli bölge" (2026-10-11). The danger zone is a
 * single "Hesabı sil" button; the password / Google verification lives in a
 * dialog it opens.
 *
 * No real account is touched: the Main handlers for account status and
 * deletion are replaced for this run (status → logged in, delete → a
 * wrong-password refusal), so the test also works on a machine with no SAI
 * session. Checks:
 *   1. the danger zone holds one button and no password field;
 *   2. the button opens the dialog ON TOP of Preferences;
 *   3. Enter in the password field neither deletes nor submits Preferences;
 *   4. a refused delete shows the error inside the dialog;
 *   5. Escape closes only the dialog — Preferences stays open. */
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

  await app.evaluate(({ ipcMain }) => {
    globalThis.__deleteCalls = 0
    ipcMain.removeHandler('ai:account:status')
    ipcMain.handle('ai:account:status', () => ({
      loggedIn: true,
      email: 'e2e@example.com',
      emailVerified: true,
      creditBalanceUsd: 1
    }))
    ipcMain.removeHandler('ai:account:delete')
    ipcMain.handle('ai:account:delete', () => {
      globalThis.__deleteCalls++
      return { ok: false, error: 'wrong_password' }
    })
  })
  const originalProvider = await win.evaluate(
    () => window.__SAI_TEST__.useSettingsStore.getState().settings.ai.provider
  )
  await win.evaluate(() =>
    window.__SAI_TEST__.useSettingsStore.getState().setSetting('ai', { provider: 'server' })
  )

  await win.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sai:open-preferences', { detail: { category: 'ai' } }))
  )
  await win.waitForTimeout(2000)

  const zone = () =>
    win.evaluate(() => {
      const label = Array.from(document.querySelectorAll('span')).find(s =>
        /tehlikeli/i.test(s.textContent)
      )
      const z = label?.parentElement
      return z
        ? {
            buttons: Array.from(z.querySelectorAll('button')).map(b => b.textContent),
            inputs: z.querySelectorAll('input').length
          }
        : null
    })
  const z1 = await zone()
  ok(
    'danger zone: one button, no password field',
    z1?.buttons.length === 1 && z1.inputs === 0,
    JSON.stringify(z1)
  )

  await win.evaluate(() => {
    const label = Array.from(document.querySelectorAll('span')).find(s =>
      /tehlikeli/i.test(s.textContent)
    )
    label?.parentElement?.querySelector('button')?.click()
  })
  await win.waitForTimeout(400)
  const onTop = await win.evaluate(() => {
    const d = document.querySelector('[aria-labelledby="acc-delete-title"]')
    if (!d) return false
    const last = document.body.lastElementChild
    return !!last?.contains(d)
  })
  ok('dialog opens on top of Preferences', onTop)
  if (process.env.SAI_E2E_SHOT) {
    const d = await win.$('[aria-labelledby="acc-delete-title"]')
    await d?.screenshot({ path: path.join(__dirname, '..', '..', 'tmp', 'danger-dialog.png') })
  }

  await win.fill('#acc-delete-pw', 'wrong-password')
  await win.press('#acc-delete-pw', 'Enter')
  await win.waitForTimeout(400)
  ok('Enter does not delete', (await app.evaluate(() => globalThis.__deleteCalls)) === 0)
  ok('Enter keeps the dialog open', !!(await win.$('[aria-labelledby="acc-delete-title"]')))

  await win.evaluate(() => {
    const d = document.querySelector('[aria-labelledby="acc-delete-title"]')
    const btn = Array.from(d?.querySelectorAll('button') ?? []).find(
      b => b.textContent === 'Hesabı sil'
    )
    btn?.click()
  })
  await win.waitForTimeout(500)
  ok('delete button reaches Main once', (await app.evaluate(() => globalThis.__deleteCalls)) === 1)
  const alert = await win.evaluate(
    () =>
      document.querySelector('[aria-labelledby="acc-delete-title"] [role="alert"]')?.textContent ??
      null
  )
  ok(
    'refusal shown inside the dialog, translated',
    !!alert && !alert.startsWith('ai.'),
    alert ?? ''
  )

  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  ok('Escape closes the dialog', !(await win.$('[aria-labelledby="acc-delete-title"]')))
  ok('Preferences still open', (await zone()) !== null)
  ok('no page errors', pageErrors.length === 0, pageErrors.join(' | '))

  await win.evaluate(
    p => window.__SAI_TEST__.useSettingsStore.getState().setSetting('ai', { provider: p }),
    originalProvider
  )
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
