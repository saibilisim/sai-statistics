// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* File > Export Output… > Word (.docx) / Excel (.xlsx) end to end:
 *   1. Put two analysis blocks in the Output tab — a table, a Plotly plot and
 *      an SVG plot — plus an inserted heading.
 *   2. Open the Export Output dialog from the menu channel, pick Word, OK
 *      (save dialog stubbed to app/tmp/…docx); same again for Excel.
 *   3. Open both files as zips: real tables, numbers written as numbers,
 *      one sheet per analysis, and every plot embedded as a PNG — i.e.
 *      docx/jszip and the Plotly/SVG rasterizing work inside the sandboxed,
 *      CSP-restricted renderer, and the bytes cross IPC intact.
 *
 * Usage: node tests/e2e/run-e2e.cjs output-export-office   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const JSZip = require('jszip')
const fs = require('fs')
const path = require('path')

const TMP = path.join(__dirname, '..', '..', 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const OUT = { word: path.join(TMP, 'sai-output.docx'), excel: path.join(TMP, 'sai-output.xlsx') }
for (const f of Object.values(OUT)) if (fs.existsSync(f)) fs.unlinkSync(f)

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect x="10" y="10" width="200" height="100" fill="steelblue"/></svg>'

async function exportVia(app, win, formatIndex, out) {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    // Unsaved-output guard on close → "Don't save".
    dialog.showMessageBoxSync = () => 1
    BrowserWindow.getAllWindows()[0].webContents.send('menu:file:export-output')
  }, out)
  await win.waitForSelector('input[name="exportFormat"]', { timeout: 10000 })
  // The dialog defaults to "selected blocks" while a block is selected.
  await win.locator('input[name="exportScope"]').first().check()
  await win.locator('input[name="exportFormat"]').nth(formatIndex).check()
  await win
    .locator('[role="dialog"] button')
    .filter({ hasText: /^(Tamam|OK)$/ })
    .click()
  for (let i = 0; i < 60 && !fs.existsSync(out); i++) await win.waitForTimeout(250)
  // Dialog closes on success; an error would leave it open with role="alert".
  const alert = await win
    .locator('[role="dialog"] [role="alert"]')
    .textContent({ timeout: 500 })
    .catch(() => null)
  return { exists: fs.existsSync(out), alert }
}

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  win.on('console', m => {
    if (m.type() === 'error' && /Content Security Policy|EvalError/i.test(m.text())) {
      errors.push(m.text())
    }
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  await win.evaluate(svg => {
    const T = window.__SAI_TEST__
    const table = {
      titleKey: 'output.descriptives.title',
      columns: ['output.col.n', 'output.col.mean', 'output.col.sig'],
      rows: [
        [120, 34.256, 0.0123],
        [118, -1.5, 0.00001]
      ],
      footnoteKey: null
    }
    for (const id of ['first', 'second']) {
      T.useOutputStore.getState().addBlock({
        id,
        analysisId: 'descriptives',
        titleKey: 'analysis.descriptives.title',
        timestamp: new Date().toISOString(),
        datasetName: 'e2e',
        result: {
          success: true,
          tables: [table],
          plots: [
            {
              titleKey: 'Bar',
              type: 'plotly',
              data: { data: [{ type: 'bar', x: ['a', 'b'], y: [3, 4] }], layout: {} }
            },
            { titleKey: 'Svg', type: 'svg', data: svg }
          ],
          warnings: [],
          notes: []
        }
      })
    }
    T.useOutputStore.getState().insertItem({ kind: 'heading', id: 'h1', text: 'Bölüm İki' })
    T.useUIStore.getState().setActiveTab('output')
  }, SVG)
  await win.waitForTimeout(800)

  const word = await exportVia(app, win, 2, OUT.word)
  const excel = await exportVia(app, win, 3, OUT.excel)
  await app.close()

  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
  check('word file written', word.exists, word.alert ?? '')
  check('excel file written', excel.exists, excel.alert ?? '')

  if (word.exists) {
    const zip = await JSZip.loadAsync(fs.readFileSync(OUT.word))
    const doc = await zip.file('word/document.xml').async('string')
    // docx stores identical images once, so count the picture references.
    const pictures = (doc.match(/<a:blip /g) ?? []).length
    const media = Object.values(zip.files).filter(f => !f.dir && f.name.startsWith('word/media/'))
    check('docx has real tables', (doc.match(/<w:tbl>/g) ?? []).length === 2)
    check('docx keeps numbers', doc.includes('34.256'))
    check('docx has inserted heading', doc.includes('Bölüm İki'))
    check('docx embeds all 4 plots', pictures === 4 && media.length > 0, `pictures=${pictures}`)
  }
  if (excel.exists) {
    const zip = await JSZip.loadAsync(fs.readFileSync(OUT.excel))
    const wb = await zip.file('xl/workbook.xml').async('string')
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string')
    const media = Object.values(zip.files).filter(f => !f.dir && f.name.startsWith('xl/media/'))
    check('xlsx one sheet per analysis', (wb.match(/<sheet /g) ?? []).length === 2)
    check(
      'xlsx numbers are numeric',
      sheet.includes('<v>34.256</v>') && sheet.includes('<v>0.0123</v>')
    )
    check('xlsx embeds all 4 plots', media.length === 4, `media=${media.length}`)
  }
  check('no renderer/CSP errors', errors.length === 0, errors.join(' | '))

  let failed = 0
  for (const c of checks) {
    if (!c.ok) failed++
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
  }
  console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
