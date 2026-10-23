// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* R script tabs + draft carry-over (2026-10-21), in the real app.
 *
 *   Tabs    — "+" opens script2.R; each tab keeps its own text; the dirty dot
 *             follows the active tab.
 *   Save    — the first Save asks where (dialog stubbed); the next Save of the
 *             same tab writes in place WITHOUT a dialog; the tab takes the
 *             file's name.
 *   Close   — closing a tab with unsaved text asks first: Cancel keeps it,
 *             OK closes it.
 *   Drafts  — unsaved text survives a restart; an E2E-mode start (SAI_E2E=1,
 *             set by run-e2e) does NOT restore, so tests never inherit one
 *             another's scripts. The key is cleared at the end.
 *
 * Usage: node tests/e2e/run-e2e.cjs rscript-tabs   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const APP = path.join(__dirname, '..', '..')
const TMP = path.join(APP, 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const OUT = path.join(TMP, 'sai-tab-script.R')
if (fs.existsSync(OUT)) fs.unlinkSync(OUT)
const KEY = 'sai.terminalDrafts.v1'

const label = (tr, en) => `button[aria-label="${tr}"], button[aria-label="${en}"]`
const NEW = label('Yeni betik', 'New script')
const SAVE = label('R betiğini kaydet', 'Save R script')

async function launch(e2eMode) {
  const env = { ...process.env }
  if (e2eMode) env.SAI_E2E = '1'
  else delete env.SAI_E2E
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: APP, env })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)
  await app.evaluate(({ dialog }, out) => {
    globalThis.__saveDialogs = 0
    dialog.showSaveDialog = async () => {
      globalThis.__saveDialogs++
      return { canceled: false, filePath: out }
    }
    dialog.showMessageBoxSync = () => 1
  }, OUT)
  return { app, win }
}

const state = win =>
  win.evaluate(() => {
    const s = window.__SAI_TEST__.useTerminalStore.getState()
    return {
      tabs: s.rScripts.map(t => t.name),
      active: s.rScripts.find(t => t.id === s.activeScriptId)?.name,
      rSource: s.rSource,
      isE2E: window.api.isE2E
    }
  })

async function main() {
  const checks = {}

  // ── Run 1 (normal start): tabs, save, close ──
  let { app, win } = await launch(false)
  await win.evaluate(key => {
    localStorage.removeItem(key)
    const T = window.__SAI_TEST__
    T.useTerminalStore.setState({
      rScripts: [{ id: 'first', name: 'script.R', source: '', saved: '', filePath: null }],
      activeScriptId: 'first',
      rSource: ''
    })
    T.useUIStore.getState().setActiveTab('terminal')
    T.useTerminalStore.getState().setMode('r')
  }, KEY)
  await win.waitForSelector(NEW, { timeout: 15000 })
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setRSource('a <- 1'))
  await win.locator(NEW).click()
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setRSource('b <- 2'))
  let st = await state(win)
  checks.newTab = st.tabs.join(',') === 'script.R,script2.R' && st.active === 'script2.R'

  await win.locator('[role="tab"]', { hasText: /^script\.R/ }).click()
  st = await state(win)
  checks.switchKeepsText = st.active === 'script.R' && st.rSource === 'a <- 1'

  await win.locator(SAVE).click()
  await win.waitForTimeout(500)
  st = await state(win)
  checks.firstSaveAsks =
    fs.existsSync(OUT) &&
    fs.readFileSync(OUT, 'utf8') === 'a <- 1' &&
    st.active === 'sai-tab-script.R' &&
    (await app.evaluate(() => globalThis.__saveDialogs)) === 1

  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setRSource('a <- 10'))
  await win.locator(SAVE).click()
  await win.waitForTimeout(500)
  checks.secondSaveInPlace =
    fs.readFileSync(OUT, 'utf8') === 'a <- 10' &&
    (await app.evaluate(() => globalThis.__saveDialogs)) === 1

  // script2.R holds unsaved text: Cancel keeps it, OK closes it.
  const closeScript2 = win.locator(
    'button[aria-label="Betiği kapat: script2.R"], button[aria-label="Close script: script2.R"]'
  )
  await closeScript2.click()
  const confirm = win.locator('[role="dialog"][aria-labelledby="confirm-title"]')
  await confirm.waitFor({ timeout: 5000 })
  await confirm
    .locator('button')
    .filter({ hasText: /^(İptal|Cancel)$/ })
    .click()
  st = await state(win)
  checks.cancelKeeps = st.tabs.includes('script2.R')
  await closeScript2.click()
  await confirm
    .locator('button')
    .filter({ hasText: /^(Tamam|OK)$/ })
    .click()
  st = await state(win)
  checks.okCloses = !st.tabs.includes('script2.R')

  // Leave unsaved text behind for the carry-over check.
  await win.locator(NEW).click()
  await win.evaluate(() =>
    window.__SAI_TEST__.useTerminalStore.getState().setRSource('kept <- "draft"')
  )
  await win.waitForTimeout(1500) // autosave debounce
  await app.close()

  // ── Run 2 (E2E mode): nothing restored ──
  ;({ app, win } = await launch(true))
  st = await state(win)
  checks.e2eStartsClean = st.isE2E === true && st.tabs.length === 1 && st.rSource === ''
  await app.close()

  // ── Run 3 (normal start): the draft is back ──
  ;({ app, win } = await launch(false))
  st = await state(win)
  checks.draftRestored =
    st.isE2E === false && st.tabs.includes('sai-tab-script.R') && st.rSource === 'kept <- "draft"'
  await win.evaluate(key => {
    localStorage.removeItem(key)
  }, KEY)
  // Drop the restored tabs too, so the autosave cannot write them back.
  await win.evaluate(() =>
    window.__SAI_TEST__.useTerminalStore.setState({
      rScripts: [{ id: 'clean', name: 'script.R', source: '', saved: '', filePath: null }],
      activeScriptId: 'clean',
      rSource: ''
    })
  )
  await win.waitForTimeout(1200)
  await win.evaluate(key => {
    localStorage.removeItem(key)
  }, KEY)
  await app.close()

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
