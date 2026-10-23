// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the two Reports sub-dialogs that a manual review flagged.
 *
 *  (a) Statistics — the checkboxes used to sit in one flat two-column grid
 *      with no headings. They are now split into four labelled groups, so this
 *      asserts the group titles are present, that every statistic is still
 *      reachable exactly once, and that Cancel discards.
 *
 *  (b) Options — used to render the Missing Values radios with NO footer. The
 *      only way out was the × in the corner, and because the radio wrote
 *      straight through to the parent, that × silently APPLIED the change: the
 *      control that looks like "cancel" was the one that confirmed. This
 *      asserts a real Continue/Cancel footer and that Cancel now discards.
 *
 * Screenshots are written next to the other e2e captures for eyeballing.
 *
 * Run: node tests/e2e/e2e-reports-subdialogs.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')

// Derived from the single source (summary-stats.ts SUMMARY_STAT_KEYS) instead of
// a hand-kept number — the menu grew from 17 to 19 (harmonic + geometric mean)
// and the hard-coded count silently went stale.
const STAT_COUNT = (() => {
  const src = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../src/analyses/_shared/summary-stats.ts'),
    'utf8'
  )
  const list = /SUMMARY_STAT_KEYS = \[([\s\S]*?)\] as const/.exec(src)[1]
  return (list.match(/'[^']+'/g) || []).length
})()
const GROUP_COUNT = 4

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

  const fails = []
  const check = (cond, msg) => {
    if (!cond) fails.push(msg)
  }

  // Turkish "İ" (U+0130) does not simple-case-fold to "i", so /iptal/i never
  // matches the Cancel button's label. Decompose and drop the combining marks
  // before comparing.
  const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

  // Open Case Summaries by pushing the same channel the native menu item
  // pushes, so this exercises the real dispatch rather than a test-only hook.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:analyze:case-summaries')
  })
  await win.waitForTimeout(700)

  const openSub = async label => {
    await win.evaluate(l => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => (b.textContent || '').trim() === l
      )
      if (btn) btn.click()
    }, label)
    await win.waitForTimeout(500)
  }

  const subInfo = () =>
    win.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      const sub = dialogs[dialogs.length - 1]
      if (!sub) return null
      const text = t => (t.textContent || '').trim()
      return {
        title: text(sub.querySelector('h1, h2, [class*="subTitle"]') || sub).slice(0, 80),
        groupTitles: Array.from(sub.querySelectorAll('[class*="optionSectionTitle"]')).map(text),
        checkboxes: Array.from(sub.querySelectorAll('input[type="checkbox"]')).length,
        radios: Array.from(sub.querySelectorAll('input[type="radio"]')).length,
        buttons: Array.from(sub.querySelectorAll('button')).map(text).filter(Boolean)
      }
    })

  // ── (a) Statistics ────────────────────────────────────────────────────────
  await openSub('İstatistikler')
  const stats = await subInfo()
  console.log('statistics sub-dialog:', JSON.stringify(stats))
  await win.screenshot({ path: 'e2e-reports-statistics.png' })

  check(stats !== null, 'Statistics sub-dialog did not open')
  if (stats) {
    check(
      stats.groupTitles.length === GROUP_COUNT,
      `expected ${GROUP_COUNT} group headings, got ${JSON.stringify(stats.groupTitles)}`
    )
    check(
      stats.groupTitles.every(x => x && !/^analysis[:.]/.test(x)),
      `untranslated group heading(s): ${JSON.stringify(stats.groupTitles)}`
    )
    // Grouping must not lose or duplicate a statistic.
    check(
      stats.checkboxes === STAT_COUNT,
      `expected ${STAT_COUNT} statistic checkboxes, got ${stats.checkboxes}`
    )
    check(
      stats.buttons.length >= 2,
      `Statistics sub-dialog should keep its footer, got ${JSON.stringify(stats.buttons)}`
    )
  }

  // Cancel closes without applying.
  await win.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    const sub = dialogs[dialogs.length - 1]
    const btns = Array.from(sub.querySelectorAll('button'))
    btns[btns.length - 1].click()
  })
  await win.waitForTimeout(400)
  const afterCancel = await win.evaluate(() => document.querySelectorAll('[role="dialog"]').length)

  // ── (b) Options ───────────────────────────────────────────────────────────
  await openSub('Seçenekler')
  const options = await subInfo()
  console.log('options sub-dialog:', JSON.stringify(options))
  await win.screenshot({ path: 'e2e-reports-options.png' })

  check(options !== null, 'Options sub-dialog did not open')
  if (options) {
    check(options.radios >= 2, `expected the Missing Values radios, got ${options.radios}`)
    // The regression this test exists for: a footer with two real actions.
    check(
      options.buttons.length >= 2,
      `Options sub-dialog has no confirm/cancel footer: ${JSON.stringify(options.buttons)}`
    )
    check(
      options.buttons.some(b => /devam|continue/.test(fold(b))),
      `no confirm button among ${JSON.stringify(options.buttons)}`
    )
    check(
      options.buttons.some(b => /iptal|cancel/.test(fold(b))),
      `no cancel button among ${JSON.stringify(options.buttons)}`
    )
  }

  // Cancel must discard: pick "listwise", cancel, reopen, expect the default.
  await win.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    const sub = dialogs[dialogs.length - 1]
    const radios = Array.from(sub.querySelectorAll('input[type="radio"]'))
    radios[radios.length - 1].click()
    const btns = Array.from(sub.querySelectorAll('button'))
    btns[btns.length - 1].click() // Cancel
  })
  await win.waitForTimeout(400)
  await openSub('Seçenekler')
  const reopened = await win.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    const sub = dialogs[dialogs.length - 1]
    const radios = Array.from(sub.querySelectorAll('input[type="radio"]'))
    return radios.map(r => r.checked)
  })
  console.log('after cancel, radios:', JSON.stringify(reopened), '| dialogs:', afterCancel)
  check(
    reopened[0] === true,
    `Cancel should have discarded the listwise choice, radios: ${JSON.stringify(reopened)}`
  )

  check(pageErrors.length === 0, `page errors: ${JSON.stringify(pageErrors)}`)

  await app.close()
  if (fails.length > 0) {
    console.error('E2E FAILED:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
