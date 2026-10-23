// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Files + History panes and the working directory (2026-10-21), real R.
 *
 *   start    — a new session starts in Documents (it was the temp dir, so
 *              read.csv("x.csv") never found the user's files).
 *   choose   — "Choose folder…" (dialog stubbed) runs setwd(); the pane lists
 *              the folder, sub-folders first.
 *   data     — clicking a .csv writes `d <- read.csv("d.csv")` into the
 *              console input, without running it.
 *   script   — clicking a .R opens it in an editor tab; Save then writes the
 *              file in place, without a dialog.
 *   folders  — a sub-folder click and ".." change the working directory.
 *   history  — the pane lists those setwd() calls; double-click re-runs one.
 *
 * Usage: node tests/e2e/run-e2e.cjs rfiles   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const APP = path.join(__dirname, '..', '..')
const DIR = path.join(APP, 'tmp', 'files pane')
fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(DIR, 'sub'), { recursive: true })
fs.writeFileSync(path.join(DIR, 'a.R'), 'x <- 1\n')
fs.writeFileSync(path.join(DIR, 'd.csv'), 'p,q\n1,2\n')
const norm = p => path.resolve(p).replace(/\\/g, '/').toLowerCase()

async function main() {
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: APP })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  const documents = await app.evaluate(({ app: a }) => a.getPath('documents'))
  await app.evaluate(({ dialog }, dir) => {
    globalThis.__saveDialogs = 0
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    dialog.showSaveDialog = async () => {
      globalThis.__saveDialogs++
      return { canceled: true }
    }
    dialog.showMessageBoxSync = () => 1
  }, DIR)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  })

  const wd = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rWd)
  const waitWd = async (pred, ms = 20000) => {
    const end = Date.now() + ms
    for (;;) {
      const w = await wd()
      if ((w && pred(w)) || Date.now() > end) return w
      await win.waitForTimeout(200)
    }
  }
  const checks = {}

  let w = await waitWd(() => true, 40000)
  checks.startsInDocuments = !!w && norm(w.wd) === norm(documents)

  await win.locator('[role="tab"]', { hasText: /^(Dosyalar|Files)$/ }).click()
  await win.locator('button', { hasText: /^(Klasör seç…|Choose folder…)$/ }).click()
  w = await waitWd(x => norm(x.wd) === norm(DIR))
  checks.chooseDir = !!w && norm(w.wd) === norm(DIR)
  const names = await win
    .locator('ul[aria-label="Dosyalar"] li, ul[aria-label="Files"] li')
    .allTextContents()
  checks.listing = /^sub/.test(names[0] ?? '') && names.some(n => n.startsWith('d.csv'))

  // data file → read code in the console input, not run
  await win.locator('button[title^="d.csv"]').click()
  await win.waitForTimeout(300)
  const input = await win.evaluate(() => document.activeElement && document.activeElement.value)
  checks.readCode = input === 'd <- read.csv("d.csv")'
  const ranRead = await win.evaluate(() =>
    window.__SAI_TEST__.useTerminalStore.getState().rHistory.some(h => h.includes('read.csv'))
  )
  checks.readNotRun = !ranRead

  // script → editor tab; Save writes in place
  await win.locator('button[title^="a.R"]').click()
  await win.locator('[role="tab"]', { hasText: /^a\.R/ }).waitFor({ timeout: 5000 })
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setRSource('x <- 2\n'))
  await win
    .locator('button[aria-label="R betiğini kaydet"], button[aria-label="Save R script"]')
    .click()
  await win.waitForTimeout(500)
  checks.scriptSavedInPlace =
    fs.readFileSync(path.join(DIR, 'a.R'), 'utf8') === 'x <- 2\n' &&
    (await app.evaluate(() => globalThis.__saveDialogs)) === 0

  // folders
  await win.locator('button[title^="sub"]').click()
  w = await waitWd(x => norm(x.wd) === norm(path.join(DIR, 'sub')))
  checks.enterSub = !!w && norm(w.wd) === norm(path.join(DIR, 'sub'))
  await win
    .locator('button[aria-label="Üst klasöre geç"], button[aria-label="Go to the parent folder"]')
    .click()
  w = await waitWd(x => norm(x.wd) === norm(DIR))
  checks.up = !!w && norm(w.wd) === norm(DIR)

  // history: the setwd() calls are listed; double-click re-runs the one into sub
  await win.locator('[role="tab"]', { hasText: /^(Geçmiş|History)$/ }).click()
  const subCall = win
    .locator('ul[aria-label="Geçmiş"] button, ul[aria-label="History"] button')
    .filter({ hasText: /setwd\(".*\/sub"\)/ })
  checks.historyListed = (await subCall.count()) === 1
  await subCall.dblclick()
  w = await waitWd(x => norm(x.wd) === norm(path.join(DIR, 'sub')))
  checks.historyRerun = !!w && norm(w.wd) === norm(path.join(DIR, 'sub'))

  await app.close()
  fs.rmSync(DIR, { recursive: true, force: true })

  console.log('checks:', JSON.stringify(checks))
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length) {
    console.log('FAILED:', failed.map(([k]) => k).join(', '))
    process.exit(1)
  }
  console.log('ALL PASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
