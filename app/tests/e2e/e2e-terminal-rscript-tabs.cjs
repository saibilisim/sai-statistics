// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* R script tabs (2026-10-21) and the Code tab as part of the project
 * (2026-11-01), in the real app.
 *
 *   Tabs    — "+" opens script2.R; each tab keeps its own text; the dirty dot
 *             follows the active tab.
 *   Save    — the first Save asks where (dialog stubbed); the next Save of the
 *             same tab writes in place WITHOUT a dialog; the tab takes the
 *             file's name.
 *   Close   — closing a tab with unsaved text asks first: Cancel keeps it,
 *             OK closes it.
 *   Project — File ▸ Save writes the tabs + SPSS syntax into the .sdf
 *             (code.json); New asks before dropping unsaved code and starts
 *             with empty editors; Open brings the file's code back; a
 *             restart does not carry code over (no app-wide draft).
 *
 * Usage: node tests/e2e/run-e2e.cjs rscript-tabs   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')

const APP = path.join(__dirname, '..', '..')
const TMP = path.join(APP, 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const OUT = path.join(TMP, 'sai-tab-script.R')
if (fs.existsSync(OUT)) fs.unlinkSync(OUT)
const SDF = path.join(TMP, 'e2e-rscript-tabs.sdf')
if (fs.existsSync(SDF)) fs.unlinkSync(SDF)

const label = (tr, en) => `button[aria-label="${tr}"], button[aria-label="${en}"]`
const NEW = label('Yeni betik', 'New script')
const SAVE = label('R betiğini kaydet', 'Save R script')

async function launch() {
  const env = { ...process.env }
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: APP, env })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)
  await win.waitForFunction(() => window.__SAI_TEST__?.useDatasetStore.getState().datasetId)
  await app.evaluate(
    ({ dialog }, { out, sdf }) => {
      globalThis.__saveDialogs = 0
      globalThis.__msgBoxes = 0
      dialog.showSaveDialog = async (...a) => {
        const opts = a[a.length - 1] ?? {}
        const isSdf = (opts.filters ?? []).some(f => f.extensions.includes('sdf'))
        if (isSdf) return { canceled: false, filePath: sdf }
        globalThis.__saveDialogs++
        return { canceled: false, filePath: out }
      }
      dialog.showMessageBoxSync = () => {
        globalThis.__msgBoxes++
        return 1 // Discard
      }
    },
    { out: OUT, sdf: SDF }
  )
  return { app, win }
}

const state = win =>
  win.evaluate(() => {
    const s = window.__SAI_TEST__.useTerminalStore.getState()
    return {
      tabs: s.rScripts.map(t => t.name),
      active: s.rScripts.find(t => t.id === s.activeScriptId)?.name,
      rSource: s.rSource,
      syntax: s.source,
      title: document.title
    }
  })

async function sendMenu(app, channel, ...args) {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0].webContents.send(payload.channel, ...payload.args)
    },
    { channel, args }
  )
}

async function main() {
  const checks = {}

  // ── Run 1: tabs, save, close ──
  let { app, win } = await launch()
  await win.evaluate(() => {
    const T = window.__SAI_TEST__
    T.useTerminalStore.setState({
      rScripts: [{ id: 'first', name: 'script.R', source: '', saved: '', filePath: null }],
      activeScriptId: 'first',
      rSource: ''
    })
    T.useUIStore.getState().setActiveTab('terminal')
    T.useTerminalStore.getState().setMode('r')
  })
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

  // ── The Code tab belongs to the project ──
  await win.locator(NEW).click()
  await win.evaluate(() => {
    const t = window.__SAI_TEST__.useTerminalStore.getState()
    t.setRSource('kept <- "project"')
    t.setSource('FREQUENCIES VARIABLES=x.')
  })
  st = await state(win)
  checks.titleMarksCode = st.title.endsWith(' *')

  await sendMenu(app, 'menu:file:save')
  await win.waitForFunction(() => !document.title.endsWith(' *'), null, { timeout: 15000 })
  const entry = new AdmZip(SDF).getEntry('code.json')
  const code = entry ? JSON.parse(entry.getData().toString('utf-8')) : null
  checks.saveWritesCode =
    code !== null &&
    code.syntax === 'FREQUENCIES VARIABLES=x.' &&
    code.scripts.map(t => t.source).join('|') === 'a <- 10|kept <- "project"' &&
    code.activeScript === 1

  // Unsaved code: New asks first (stub answers Discard), then starts empty.
  await win.evaluate(() =>
    window.__SAI_TEST__.useTerminalStore.getState().setSource('DESCRIPTIVES x.')
  )
  const boxesBefore = await app.evaluate(() => globalThis.__msgBoxes)
  await sendMenu(app, 'menu:file:new')
  await win.waitForFunction(
    () => window.__SAI_TEST__.useTerminalStore.getState().source === '',
    null,
    { timeout: 15000 }
  )
  st = await state(win)
  checks.newAsksThenEmpty =
    (await app.evaluate(() => globalThis.__msgBoxes)) === boxesBefore + 1 &&
    st.tabs.join(',') === 'script.R' &&
    st.rSource === ''

  await sendMenu(app, 'menu:file:open', SDF)
  await win.waitForFunction(
    () => window.__SAI_TEST__.useTerminalStore.getState().rScripts.length === 2,
    null,
    { timeout: 15000 }
  )
  st = await state(win)
  checks.openRestoresCode =
    st.syntax === 'FREQUENCIES VARIABLES=x.' &&
    st.active === 'script.R' &&
    st.rSource === 'kept <- "project"' &&
    !st.title.endsWith(' *')
  await app.close()

  // ── Run 2: a restart does not carry code over ──
  ;({ app, win } = await launch())
  st = await state(win)
  checks.restartStartsClean = st.tabs.length === 1 && st.rSource === '' && st.syntax === ''
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
