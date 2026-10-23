// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: copy/paste in the Syntax/Terminal tab (SPSS syntax + R console).
 *
 * Electron shows no native context menu, so before this the consoles and
 * code editors had no right-click at all, and Ctrl+C used the browser's
 * default (theme colours leaked into the HTML flavour). Also covered: a
 * drag-select inside an SPSS echo line ended in a click that loaded the
 * command back into the editor, overwriting what the user had typed.
 *
 * A Data View cell is selected first — DataView stays mounted behind other
 * tabs and its window-level Ctrl+C once hijacked copies made elsewhere.
 *
 *   S1  drag-select part of an SPSS echo line → editor NOT overwritten;
 *       Ctrl+C == right-click ▸ Copy == the selected text
 *   S2  console right-click ▸ Select All → Ctrl+C == right-click ▸ Copy,
 *       echo + error on separate lines, no HTML flavour
 *   E1  SPSS editor: Copy / Cut / Paste / Select All via right-click
 *   R1  R console output: Select All → Ctrl+C == right-click ▸ Copy
 *   R2  R input: right-click ▸ Paste inserts clipboard text
 *
 * Requires `pnpm build`, /tmp/sai-test.csv and Rscript (R part).
 * Run: node tests/e2e/e2e-terminal-copy.cjs
 */
const { _electron } = require('@playwright/test')
const path = require('path')
const { makeClipboard } = require('./e2e-clipboard.cjs')

const norm = s => (s || '').replace(/\r\n/g, '\n').trim()

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  const datasetId = await win.evaluate(async () => {
    const res = await window.api.file.import({ filePath: '/tmp/sai-test.csv' })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        res.dataset.id,
        res.dataset.name,
        res.dataset.filePath,
        res.variables,
        res.dataset.rowCount,
        res.styles
      )
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('data')
    return res.dataset.id
  })
  await win.waitForTimeout(1200)
  await win
    .locator('.ag-row[row-index="1"] .ag-cell[col-id]:not([col-id="__row_num__"])')
    .first()
    .click()
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal'))
  await win.waitForTimeout(600)

  const clip = makeClipboard(app, win)
  const readHtml = () => app.evaluate(({ clipboard }) => clipboard.readHTML())
  const settled = async () => {
    await clip.readWhenReady()
    await win.waitForTimeout(500)
    return norm(await clip.read())
  }
  const ctrlC = async () => {
    await clip.clear()
    await win.keyboard.press('Control+c')
    return settled()
  }
  const menuItem = re => win.locator('[role="menu"] [role="menuitem"]', { hasText: re }).first()
  const openMenu = async (target, position) => {
    await target.click({ button: 'right', position })
    await win.waitForTimeout(200)
  }
  const rightCopy = async (target, position) => {
    await clip.clear()
    await openMenu(target, position)
    await menuItem(/^(Copy|Kopyala)$/).click()
    return settled()
  }
  const source = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().source)
  const r = {}

  // ── SPSS: run an unknown command → echo line + error line (no R needed) ──
  const editor = win.locator('[class*="editorSurface"] textarea').first()
  await editor.fill('FOOBARCMD.')
  await win
    .locator('[class*="subToolbar"]')
    .first()
    .locator('button', { hasText: /^(Run|Çalıştır)/ })
    .click()
  const echo = win.locator('[class*="echoLine"]').first()
  await echo.waitFor({ timeout: 10000 })
  const consoleEl = win.locator('[aria-live="polite"][class*="console"]').first()
  await editor.fill('KEEP ME.')

  // S1 — drag-select inside the echo line
  const box = await echo.boundingBox()
  await win.mouse.move(box.x + 2, box.y + box.height / 2)
  await win.mouse.down()
  await win.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 6 })
  await win.mouse.up()
  await win.waitForTimeout(150)
  r.S1_selected = await win.evaluate(() => window.getSelection().toString())
  r.S1_editorKept = (await source()) === 'KEEP ME.'
  const s1 = await ctrlC()
  const s1r = await rightCopy(echo, { x: 20, y: box.height / 2 })
  r.S1_ctrlC = s1
  r.S1_ok = s1 !== '' && s1 === norm(r.S1_selected) && s1 === s1r

  // S2 — Select All via menu, then both copy routes
  await openMenu(consoleEl)
  await menuItem(/Select All|Tümünü Seç/).click()
  const s2 = await ctrlC()
  const s2html = await readHtml()
  const s2r = await rightCopy(consoleEl)
  r.S2_ctrlC = s2
  const s2lines = s2.split('\n')
  r.S2_ok = s2 === s2r && s2lines[0] === '> FOOBARCMD' && s2lines.length >= 2
  r.S2_noHtml = !s2html

  // E1 — editor menu. Right-clicks land ON the selected text (as a user's
  // would): a right-click elsewhere moves the caret there, like any editor.
  const onSel = { x: 25, y: 12 }
  await editor.fill('FREQUENCIES age.')
  await editor.evaluate(el => el.setSelectionRange(0, 11))
  await clip.clear()
  await openMenu(editor, onSel)
  await menuItem(/^(Copy|Kopyala)$/).click()
  r.E1_copy = await settled()
  await editor.evaluate(el => {
    el.focus()
    el.setSelectionRange(0, 11)
  })
  r.E1_ctrlC = await ctrlC()
  await clip.clear()
  await editor.evaluate(el => el.setSelectionRange(0, 11))
  await openMenu(editor, onSel)
  await menuItem(/^(Cut|Kes)$/).click()
  r.E1_cutClip = await settled()
  r.E1_afterCut = await source()
  await clip.write('ZZZ')
  const edBox = await editor.boundingBox()
  await openMenu(editor, { x: edBox.width - 20, y: 12 }) // caret → end of line
  await menuItem(/^(Paste|Yapıştır)$/).click()
  await win.waitForTimeout(500)
  r.E1_afterPaste = await source()
  await openMenu(editor)
  await menuItem(/Select All|Tümünü Seç/).click()
  r.E1_selAll = await editor.evaluate(el => [el.selectionStart, el.selectionEnd, el.value.length])
  r.E1_ok =
    r.E1_copy === 'FREQUENCIES' &&
    r.E1_ctrlC === 'FREQUENCIES' &&
    r.E1_cutClip === 'FREQUENCIES' &&
    r.E1_afterCut === ' age.' &&
    r.E1_afterPaste === ' age.ZZZ' &&
    r.E1_selAll[0] === 0 &&
    r.E1_selAll[1] === r.E1_selAll[2]

  // ── R console ─────────────────────────────────────────────────────────────
  await win.locator('[role="tab"]', { hasText: /^R Terminal$/ }).click()
  const waitIdle = async ms => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const st = await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rStatus)
      if (st === 'idle') return true
      await win.waitForTimeout(300)
    }
    return false
  }
  r.R_ready = await waitIdle(40000)
  if (r.R_ready) {
    await win.evaluate(() => window.api.terminal.rWrite({ code: 'cat("alpha\\nbeta\\n")' }))
    await win.waitForTimeout(400)
    await waitIdle(15000)
    await win.waitForTimeout(300)
    const rPane = win.locator('[class*="rConsole"]').first()
    await openMenu(rPane)
    await menuItem(/Select All|Tümünü Seç/).click()
    const r1 = await ctrlC()
    const r1r = await rightCopy(rPane)
    r.R1_ctrlC = r1
    r.R1_ok = /alpha\nbeta/.test(r1) && r1 === r1r && !(await readHtml())

    const rInput = win.locator('[class*="rInputArea"]').first()
    await rInput.fill('x <- ')
    await rInput.evaluate(el => el.setSelectionRange(5, 5))
    await clip.write('mean(1:3)')
    await openMenu(rInput)
    await menuItem(/^(Paste|Yapıştır)$/).click()
    await win.waitForTimeout(500)
    r.R2_value = await rInput.inputValue()
    r.R2_ok = r.R2_value === 'x <- mean(1:3)'
  }

  r.datasetId = Boolean(datasetId)
  r.errors = errors
  console.log('RESULT:' + JSON.stringify(r, null, 2))
  const pass =
    r.S1_editorKept &&
    r.S1_ok &&
    r.S2_ok &&
    r.S2_noHtml &&
    r.E1_ok &&
    r.R_ready &&
    r.R1_ok &&
    r.R2_ok &&
    errors.length === 0

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await app.close()
  console.log(pass ? 'PASS' : 'FAIL')
  if (!pass) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
