// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: copy consistency — Ctrl+C and right-click ▸ Copy must put the SAME
 * thing on the clipboard, and it must be what the user actually selected.
 *
 * Regressions covered (2026-09-28 user report):
 *   - Output: after clicking a table cell, selecting a note paragraph and
 *     pressing Ctrl+C copied the stale cell ("2,55") instead of the note.
 *   - AI chat: the Output view's window-level Ctrl+C handler hijacked a copy
 *     made in the chat panel (activeTab stays 'output' while the side panel
 *     is open), and right-click in the chat did nothing at all.
 *
 * Output content pane:
 *   O1  cell click, then triple-click note → Ctrl+C == note text
 *   O2  right-click that note selection ▸ Copy == O1
 *   O3  cell-range drag → Ctrl+C == right-click ▸ Copy Selection (TSV)
 *   O4  free selection spanning table + note → Ctrl+C == right-click copy
 * Contents navigator (left pane):
 *   N1  leftover text selection + nav click → Ctrl+C copies the block,
 *       identical to nav right-click ▸ Copy
 *   N2  Ctrl-click multi-select → Ctrl+C == right-click ▸ Copy
 * AI chat:
 *   C1  stale output cell selection + chat paragraph selected → Ctrl+C
 *       copies the chat text, right-click ▸ Kopyala gives the same
 *   C2  chat table selection → tab-separated text, HTML without app styles
 *
 * No dataset needed — blocks/messages injected via __SAI_TEST__.
 * Requires `pnpm build`. Run: node tests/e2e/e2e-copy-consistency.cjs
 */
const { _electron } = require('@playwright/test')
const path = require('path')
const { makeClipboard } = require('./e2e-clipboard.cjs')

const NOTE =
  'The standard error of the area was computed with DeLong nonparametric method; the interval and the p-value are read independently.'
const CHAT_PARA =
  'Gruplar arasındaki fark istatistiksel olarak anlamlı; etki büyüklüğü orta düzeyde.'
const CHAT_MD = [
  'Giriş satırı.',
  '',
  'Gruplar arasındaki fark **istatistiksel olarak anlamlı**; etki büyüklüğü orta düzeyde.',
  '',
  '| Grup | N |',
  '| --- | --- |',
  '| Kontrol | 30 |',
  '| Deney | 31 |'
].join('\n')

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

  // A real dataset with a SELECTED Data View cell: DataView stays mounted
  // behind the other tabs, and its window-level Ctrl+C handler used to copy
  // that cell over an Output/chat copy (the reported "0,00" bug). Without a
  // grid selection here that regression would be invisible.
  await win.evaluate(async () => {
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
  })
  await win.waitForTimeout(1200)
  const gridCell = win.locator(
    '.ag-row[row-index="1"] .ag-cell[col-id]:not([col-id="__row_num__"])'
  )
  await gridCell.first().click()
  const gridCellText = (await gridCell.first().innerText()).trim()

  await win.evaluate(note => {
    const T = window.__SAI_TEST__
    const mk = (id, title, rows, notes) =>
      T.useOutputStore.getState().addBlock({
        id,
        analysisId: 'frequencies',
        titleKey: title,
        timestamp: new Date().toISOString(),
        datasetName: 'diag',
        result: {
          success: true,
          tables: [
            {
              titleKey: 'Area Under the Curve',
              columns: ['Var', 'Area', 'SE'],
              rows,
              footnoteKey: null
            }
          ],
          plots: [],
          warnings: [],
          notes
        }
      })
    mk(
      'cc-1',
      'Copy Block One',
      [
        ['Albumin', 2.55, 0.041],
        ['Protein', 3.1, 0.052]
      ],
      [note]
    )
    mk('cc-2', 'Copy Block Two', [['Other', 7.25, 0.9]], [])
    T.useUIStore.getState().setActiveTab('output')
  }, NOTE)
  await win.waitForTimeout(500)

  const clip = makeClipboard(app, win)
  const readHtml = () => app.evaluate(({ clipboard }) => clipboard.readHTML())
  const menuItem = re => win.locator('[role="menu"] [role="menuitem"]', { hasText: re }).first()
  const cell = (blockId, r, c) =>
    win.locator(`#block-${blockId} table tbody tr`).nth(r).locator('td').nth(c)
  const noteEl = win.locator('#block-cc-1 div', { hasText: /^The standard error/ }).last()
  const navItem = title => win.locator('[class*="navItem"]', { hasText: title }).first()
  const outSel = () => win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().selection)
  // Reads the FINAL clipboard: a competing async writer (the DataView bug)
  // lands after the native copy, so the first non-empty read isn't enough.
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
  // Edit ▸ Copy / the menu's Ctrl+C accelerator (role: 'copy').
  const menuCopy = async () => {
    await clip.clear()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.copy()
    })
    return settled()
  }
  const rightCopy = async (target, re) => {
    await clip.clear()
    await target.click({ button: 'right' })
    await win.waitForTimeout(200)
    await menuItem(re).click()
    return norm(await clip.readWhenReady())
  }
  const r = {}

  // ── O1 / O2 ──────────────────────────────────────────────────────────────
  await cell('cc-1', 0, 1).click() // stale cell selection = "2,55"/"2.55"
  r.cellSelectedFirst = (await outSel())?.kind === 'cells'
  await noteEl.click({ clickCount: 3 })
  r.staleCellCleared = (await outSel()) === null
  const o1 = await ctrlC()
  r.O1_ctrlC = o1
  r.gridCellText = gridCellText
  r.O1_menu_ok = (await menuCopy()) === NOTE
  r.O1_ok = o1 === NOTE
  const o2 = await rightCopy(noteEl, /Copy|Kopyala/)
  r.O2_rightClick = o2
  r.O2_same = o2 === o1

  // ── O3 cell range ────────────────────────────────────────────────────────
  await win.mouse.click(5, 5) // collapse any text selection
  const a = await cell('cc-1', 0, 0).boundingBox()
  const b = await cell('cc-1', 1, 1).boundingBox()
  await win.mouse.move(a.x + 3, a.y + a.height / 2)
  await win.mouse.down()
  await win.mouse.move(b.x + b.width - 3, b.y + b.height / 2, { steps: 8 })
  await win.mouse.up()
  const s3 = await outSel()
  r.O3_range = s3 && s3.kind === 'cells' && s3.r2 === 1 && s3.c2 === 1
  const o3 = await ctrlC()
  const o3r = await rightCopy(cell('cc-1', 0, 0), /Copy Selection|Seçimi Kopyala/)
  r.O3_ctrlC = o3
  r.O3_rightClick = o3r
  r.O3_same = o3 === o3r && o3.split('\n').length === 2 && o3.includes('\t')

  // ── O4 selection spanning table + note ────────────────────────────────────
  await win.evaluate(() => {
    const block = document.querySelector('#block-cc-1')
    const td = block.querySelector('table tbody td')
    const divs = Array.from(block.querySelectorAll('div')).filter(d =>
      d.textContent.startsWith('The standard error')
    )
    const note = divs[divs.length - 1]
    const range = document.createRange()
    range.setStart(td.firstChild, 0)
    range.setEnd(note.firstChild, note.firstChild.length)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })
  const o4 = await ctrlC()
  const o4r = await rightCopy(noteEl, /Copy|Kopyala/)
  r.O4_ctrlC = o4
  r.O4_ok = o4.includes('Albumin') && o4.includes('Protein') && o4.endsWith(NOTE) && o4 === o4r

  // ── N1 navigator: leftover text selection must not win ────────────────────
  await noteEl.click({ clickCount: 3 })
  await navItem('Copy Block Two').click()
  const n1 = await ctrlC()
  const n1r = await rightCopy(navItem('Copy Block Two'), /Copy|Kopyala/)
  r.N1_ctrlC = n1
  r.N1_ok = n1.includes('Other') && !n1.includes('standard error') && n1 === n1r

  // ── N2 multi-select ───────────────────────────────────────────────────────
  await navItem('Copy Block One').click()
  await navItem('Copy Block Two').click({ modifiers: ['Control'] })
  const n2 = await ctrlC()
  const n2r = await rightCopy(navItem('Copy Block Two'), /Copy|Kopyala/)
  r.N2_ok = n2.includes('Albumin') && n2.includes('Other') && n2 === n2r

  // ── AI chat ───────────────────────────────────────────────────────────────
  await cell('cc-1', 0, 1).click() // stale output cell selection again
  await win.click('[role="tab"][title*="Ctrl+6"]')
  await win.waitForSelector('aside textarea', { timeout: 5000 })
  await win.evaluate(md => {
    window.__SAI_TEST__.useChatStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: 'Soru', createdAt: Date.now(), toolEvents: [] },
        { id: 'a1', role: 'assistant', content: md, createdAt: Date.now(), toolEvents: [] }
      ],
      isStreaming: false,
      streamingMessageId: null
    })
  }, CHAT_MD)
  await win.waitForSelector('aside table', { timeout: 5000 })
  r.chatStaleCellPresent = (await outSel())?.kind === 'cells'

  const para = win.locator('aside p', { hasText: 'Gruplar arasındaki' }).first()
  await para.click({ clickCount: 3 })
  const c1 = await ctrlC()
  r.C1_ctrlC = c1
  r.C1_ok = c1 === CHAT_PARA
  const c1r = await rightCopy(para, /Kopyala|Copy/)
  r.C1_rightClick = c1r
  r.C1_same = c1r === c1
  await para.click({ clickCount: 3 })
  r.C1_menu_ok = (await menuCopy()) === CHAT_PARA

  // Chat copy while the DATA tab is active (grid cell still selected).
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('data'))
  await win.waitForTimeout(300)
  await para.click({ clickCount: 3 })
  r.C3_dataTab_ctrlC = await ctrlC()
  r.C3_ok = r.C3_dataTab_ctrlC === CHAT_PARA
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('output'))
  await win.waitForTimeout(300)

  await win.evaluate(() => {
    const table = document.querySelector('aside table')
    const range = document.createRange()
    range.selectNode(table)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  })
  const c2 = await ctrlC()
  const c2html = await readHtml()
  const c2r = await rightCopy(win.locator('aside table td').first(), /Kopyala|Copy/)
  r.C2_ctrlC = c2
  r.C2_ok = /Grup\tN/.test(c2) && /Deney\t31/.test(c2) && c2 === c2r
  // "Clean" = no app classes and no theme styles leak into the HTML flavor.
  // Neutral inline borders/padding ARE expected: styleTablesForClipboard adds
  // them on purpose so the table doesn't paste into Word/Outlook with columns
  // running into each other.
  const c2body = c2html.replace(/<meta[^>]*>/g, '')
  r.C2_htmlClean =
    c2html.includes('<table') &&
    !/class=/.test(c2body) &&
    !/var\(--|background/.test(c2body) &&
    /border:1px solid/.test(c2body)

  r.errors = errors
  console.log('RESULT:' + JSON.stringify(r, null, 2))

  const pass =
    r.cellSelectedFirst &&
    r.staleCellCleared &&
    r.O1_ok &&
    r.O2_same &&
    r.O3_range &&
    r.O3_same &&
    r.O4_ok &&
    r.N1_ok &&
    r.N2_ok &&
    r.chatStaleCellPresent &&
    r.C1_ok &&
    r.C1_same &&
    r.C1_menu_ok &&
    r.C3_ok &&
    r.O1_menu_ok &&
    r.C2_ok &&
    r.C2_htmlClean &&
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
