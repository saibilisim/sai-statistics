// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the Syntax/Terminal tab's usability features:
 *  SPSS — Commands menu examples, variable panel insert, run-selection only
 *         runs the selection, a failing statement marks its gutter line,
 *         "sent to Output" line opens the Output tab, .sps open/save (native
 *         dialogs stubbed), keyboard splitter resize.
 *  R    — SAI notices are translated (not English), the "not running" banner
 *         offers Start, captured plots land in the side panel, enlarge +
 *         "Send to Output", variable insert writes data$name into the input.
 * Uses the bundled iris sample (resources/sample-data) — no /tmp fixture.
 * Screenshots: tmp/term-ux-spss.png, tmp/term-ux-r.png.
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
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: appDir })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)

  const iris = path.join(appDir, 'resources', 'sample-data', 'iris.csv')
  await win.evaluate(async filePath => {
    const r = await window.api.file.import({ filePath })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        r.dataset.id,
        r.dataset.name,
        r.dataset.filePath,
        r.variables,
        r.dataset.rowCount,
        r.styles
      )
  }, iris)
  await win.waitForTimeout(800)
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal'))
  await win.waitForTimeout(400)

  const source = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().source)
  const editor = win.locator('[class*="editorSurface"] textarea').first()
  const runBtn = win.locator('[class*="subToolbar"]').first().locator('button[class*="primary"]')

  // ── Commands menu: examples are built from iris' own variables ──
  await win.locator('button[aria-haspopup="menu"]').first().click()
  const exampleCodes = await win.$$eval('[role="menu"] code', els => els.map(e => e.textContent))
  check(
    exampleCodes.some(c => c === 'FREQUENCIES VARIABLES=Species.'),
    `examples use dataset variables (${exampleCodes.join(' | ')})`
  )
  await win
    .locator('[role="menu"] [role="menuitem"]', { hasText: 'FREQUENCIES VARIABLES=Species.' })
    .click()
  check((await source()) === 'FREQUENCIES VARIABLES=Species.', 'example inserted into the editor')

  // ── Variable panel: click inserts the name at the caret ──
  await editor.fill('DESCRIPTIVES VARIABLES=')
  await editor.evaluate(el => {
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
  await win.locator('[class*="varItemBtn"]', { hasText: 'Sepal_Length' }).first().click()
  check(
    (await source()) === 'DESCRIPTIVES VARIABLES=Sepal_Length',
    `variable inserted (${await source()})`
  )

  // ── Run selection: only the selected statement runs; the bad one marks its line ──
  const blocksBefore = await win.evaluate(
    () => window.__SAI_TEST__.useOutputStore.getState().blocks.length
  )
  await editor.fill(
    'FREQUENCIES VARIABLES=Species.\nFOOBARCMD.\nDESCRIPTIVES VARIABLES=Sepal_Length.'
  )
  // Select line 2 the way a user would — with the keyboard.
  await editor.focus()
  await win.keyboard.press('Control+Home')
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('End')
  await win.keyboard.press('Shift+Home')
  await win.waitForTimeout(150)
  const runLabel = (await runBtn.textContent()) || ''
  check(
    /Seçimi|selection/i.test(runLabel),
    `run button switches to "run selection" (${runLabel.trim()})`
  )
  await runBtn.click()
  await win.waitForSelector('[class*="echoLine"]', { timeout: 10000 })
  await win.waitForTimeout(400)
  const echoes = await win.$$eval('[class*="echoLine"]', els => els.map(e => e.textContent))
  check(
    echoes.length >= 1 && echoes.every(e => !/FREQUENCIES|DESCRIPTIVES/.test(e)),
    `only the selection ran (${echoes.join(' | ')})`
  )
  const errNums = await win.$$eval('[class*="gutterError"]', els => els.map(e => e.textContent))
  check(
    errNums.length === 1 && errNums[0] === '2',
    `failing statement marks gutter line 2 (${errNums.join(',')})`
  )

  // Typing clears stale markers.
  await editor.press('End')
  await editor.type(' ')
  check((await win.$$('[class*="gutterError"]')).length === 0, 'editing clears error markers')

  // ── Run all → "sent to Output" line opens the Output tab ──
  await editor.fill('FREQUENCIES VARIABLES=Species.')
  await runBtn.click()
  const link = win.locator('[class*="linkLine"]').first()
  await link.waitFor({ timeout: 10000 })
  await link.click()
  await win.waitForTimeout(200)
  const tabAfter = await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().activeTab)
  check(tabAfter === 'output', `dispatched line opens Output (${tabAfter})`)
  const deadline = Date.now() + 30000
  let blocksAfter = blocksBefore
  while (Date.now() < deadline && blocksAfter <= blocksBefore) {
    await win.waitForTimeout(500)
    blocksAfter = await win.evaluate(
      () => window.__SAI_TEST__.useOutputStore.getState().blocks.length
    )
  }
  check(blocksAfter > blocksBefore, 'FREQUENCIES produced an Output block')
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal'))
  await win.waitForTimeout(300)

  // ── .sps save / open (native dialogs stubbed in Main) ──
  const spsPath = path.join(os.tmpdir(), `sai-e2e-${Date.now()}.sps`)
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: p })
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [p] })
  }, spsPath)
  await editor.fill('* saved by e2e.\nFREQUENCIES VARIABLES=Species.')
  await win
    .locator('[class*="subToolbar"]')
    .first()
    .locator('button[aria-label*="aydet"], button[aria-label*="Save"]')
    .click()
  await win.waitForTimeout(400)
  check(
    fs.existsSync(spsPath) && fs.readFileSync(spsPath, 'utf8').includes('saved by e2e'),
    '.sps saved'
  )
  fs.writeFileSync(spsPath, '﻿DESCRIPTIVES VARIABLES=Petal_Length.', 'utf8')
  await win
    .locator('[class*="subToolbar"]')
    .first()
    .locator('button[aria-label*="aç"], button[aria-label*="Open"]')
    .click()
  await win.waitForTimeout(400)
  check(
    (await source()) === 'DESCRIPTIVES VARIABLES=Petal_Length.',
    `.sps opened, BOM stripped (${await source()})`
  )
  fs.unlinkSync(spsPath)

  // ── Splitter: keyboard resize grows the editor ──
  const wrapH = () => win.$eval('[class*="editorWrap"]', el => el.getBoundingClientRect().height)
  const h0 = await wrapH()
  // The editor/console splitter — not the vertical variable-panel WidthHandle,
  // which is also a role="separator" and comes first in the DOM.
  await win.locator('[role="separator"][aria-orientation="horizontal"]').first().focus()
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('ArrowDown')
  const h1 = await wrapH()
  check(h1 > h0 + 30, `splitter resizes the editor (${Math.round(h0)} → ${Math.round(h1)})`)
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-ux-spss.png') })

  // ── R mode ──
  await win.locator('[role="tab"]', { hasText: /^R Terminal$/ }).click()
  const waitStatus = async (want, ms) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const st = await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rStatus)
      if (st === want) return true
      await win.waitForTimeout(250)
    }
    return false
  }
  check(await waitStatus('idle', 30000), 'R session starts')

  // Kill it → banner with Start; writing gives a translated notice.
  await win.evaluate(() => window.api.terminal.rKill())
  await waitStatus('dead', 5000)
  await win.evaluate(() => window.api.terminal.rWrite({ code: '1+1' }))
  await win.waitForTimeout(300)
  const rText = await win.$eval('[class*="rConsole"]', el => el.textContent || '')
  check(
    !/not running|Start it first/.test(rText) && /çalışmıyor/.test(rText),
    'notice is translated (TR)'
  )
  const banner = win.locator('[class*="deadBanner"] button')
  check(await banner.isVisible(), 'dead banner offers Start')
  await banner.click()
  check(await waitStatus('idle', 30000), 'Start brings the session back')

  // Variable insert → data$name in the R input.
  await win.locator('[class*="subToolbar"]:visible button[aria-pressed]').first().click()
  const rInput = win.locator('[class*="rInputArea"]').first()
  await rInput.fill('summary(')
  await rInput.evaluate(el => el.setSelectionRange(el.value.length, el.value.length))
  await win.locator('[class*="varItemBtn"]:visible', { hasText: 'Petal_Width' }).first().click()
  check(
    (await rInput.inputValue()) === 'summary(data$Petal_Width',
    `R insert (${await rInput.inputValue()})`
  )

  // Plot → side panel, enlarge, send to Output.
  await rInput.fill('hist(data$Sepal_Length)')
  await rInput.press('Control+Enter')
  const card = win.locator('[class*="plotCard"]').first()
  await card.waitFor({ timeout: 15000 })
  check(true, 'plot appears in the side panel')
  const rBlocks0 = await win.evaluate(
    () =>
      window.__SAI_TEST__.useOutputStore.getState().blocks.filter(b => b.analysisId === 'rconsole')
        .length
  )
  await card.locator('[class*="plotThumbBtn"]').click()
  await win.locator('[class*="lightboxImg"]').waitFor({ timeout: 3000 })
  check(true, 'plot enlarges')
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-ux-r-lightbox.png') })
  await win.keyboard.press('Escape')
  await win.waitForTimeout(200)
  check((await win.$$('[class*="lightboxImg"]')).length === 0, 'Escape closes the enlarged plot')
  await card.locator('button[class*="button"]').click()
  await win.waitForTimeout(200)
  const rBlocks1 = await win.evaluate(
    () =>
      window.__SAI_TEST__.useOutputStore.getState().blocks.filter(b => b.analysisId === 'rconsole')
        .length
  )
  check(rBlocks1 === rBlocks0 + 1, 'Send to Output adds a block')
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-ux-r.png') })

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
  // The run left Output blocks → the close guard's Save/Discard prompt would
  // block app.close() forever (modal). Answer "Discard".
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  const failed = results.filter(r => !r.ok)
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
