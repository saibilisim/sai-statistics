// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the R script report (Faz T3 P2) end to end:
 *  - "Build report" runs the script chunk by chunk (spin format: #' prose,
 *    # %% / # Title ---- sections) and opens the Report tab;
 *  - each chunk keeps its own console text, plots and sai_show() tables —
 *    which go to the report, NOT to the Output tab;
 *  - an error chunk is marked and the following chunks still run;
 *  - HTML and PDF export write real files (escaped HTML, inlined plot);
 *  - a session stopped mid-report leaves it marked incomplete.
 */
const path = require('path')
const fs = require('fs')
const { _electron } = require('@playwright/test')

const results = []
function check(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

const SCRIPT = [
  "#' # Iris raporu",
  "#' Veri setinde **150** gözlem var; model `lm()` ile kuruluyor.",
  "#' - birinci madde",
  "#' - ikinci madde",
  '',
  '# %% Model',
  'fit <- lm(Sepal.Length ~ Petal.Length, data = iris)',
  'print(coef(fit))',
  '',
  '# Grafik ----',
  'plot(iris$Petal.Length, iris$Sepal.Length)',
  '',
  '# %% Tablo',
  'sai_show(head(data, 3), "İlk satırlar")',
  '',
  '# %% Hata',
  'stop("bilerek <hata>")',
  '',
  '# %% Son',
  'cat("bitti\\n")'
].join('\n')

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
  await win.waitForTimeout(600)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  })

  const term = () =>
    win.evaluate(() => {
      const s = window.__SAI_TEST__.useTerminalStore.getState()
      return {
        status: s.rStatus,
        report: s.rReport,
        outputBlocks: window.__SAI_TEST__.useOutputStore
          ? window.__SAI_TEST__.useOutputStore.getState().blocks.length
          : -1
      }
    })
  const waitFor = async (pred, ms, label) => {
    const end = Date.now() + ms
    for (;;) {
      const st = await term()
      if (pred(st)) return st
      if (Date.now() > end) {
        console.log(`  (timeout: ${label}; status=${st.status})`)
        return st
      }
      await win.waitForTimeout(250)
    }
  }
  const consoleText = () => win.$eval('[class*="rConsole"]', el => el.textContent || '')
  const waitText = async (re, ms) => {
    const end = Date.now() + ms
    let txt = ''
    while (Date.now() < end) {
      txt = await consoleText()
      if (re.test(txt)) break
      await win.waitForTimeout(250)
    }
    return txt
  }

  check(
    (await waitFor(s => s.status === 'idle', 40000, 'ready')).status === 'idle',
    'R session ready'
  )
  await win.evaluate(src => window.__SAI_TEST__.useTerminalStore.getState().setRSource(src), SCRIPT)
  const blocksBefore = (await term()).outputBlocks

  const buildBtn = win.locator('button', { hasText: /^(Rapor oluştur|Build report)$/ })
  await buildBtn.click()
  await waitText(/Rapor hazır/, 60000)
  const st = await waitFor(s => s.report && s.status === 'idle', 5000, 'report')
  const items = (st.report && st.report.items) || []
  const kinds = items.map(i => (i.kind === 'heading' ? `h${i.level}` : i.kind)).join(',')
  check(
    kinds === 'h1,text,h2,code,h2,code,h2,code,h2,code,h2,code',
    `report structure follows the script (${kinds})`
  )
  const code = items.filter(i => i.kind === 'code')
  check(
    /Petal\.Length/.test(code[0] && code[0].output),
    'chunk 1 keeps its own console output (coef)'
  )
  check(
    code[1] && code[1].plots.length === 1 && code[1].output === '',
    'chunk 2 has exactly its plot'
  )
  check(
    code[2] && code[2].tables.length === 1 && code[2].tables[0].rows.length === 3,
    'sai_show() table is captured into the report'
  )
  check((await term()).outputBlocks === blocksBefore, 'report tables/plots did not go to Output')
  check(
    code[3] && code[3].error && code[3].output === 'Error: bilerek <hata>',
    `the error chunk is marked, in R's wording (${code[3] && code[3].output})`
  )
  check(code[4] && /bitti/.test(code[4].output), 'chunks after an error still run')
  check(st.report && st.report.incomplete === false, 'report is complete')

  // The Report tab, rendered with React (no raw HTML from R).
  const doc = win.locator('[class*="reportDoc"]')
  check(await doc.isVisible(), 'Report tab is shown')
  const docText = (await doc.textContent()) || ''
  check(
    /Iris raporu/.test(docText) && /bilerek <hata>/.test(docText),
    'report renders headings and output text'
  )
  check((await doc.locator('img').count()) === 1, 'report shows the plot')
  check(
    (await doc.locator('strong', { hasText: '150' }).count()) === 1,
    'inline Markdown (**bold**)'
  )
  check((await doc.locator('li').count()) === 2, 'Markdown list items')
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rreport.png') })

  // HTML + PDF export (save dialog stubbed).
  const htmlFile = path.join(appDir, 'tmp', 'e2e-report.html')
  const pdfFile = path.join(appDir, 'tmp', 'e2e-report.pdf')
  for (const f of [htmlFile, pdfFile]) fs.rmSync(f, { force: true })
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: p })
  }, htmlFile)
  await win.locator('button', { hasText: /^(HTML olarak kaydet|Save as HTML)$/ }).click()
  await waitText(/Rapor kaydedildi/, 10000)
  const html = fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile, 'utf8') : ''
  check(
    /<h1>script\.R<\/h1>/.test(html) && /data:image\/png;base64,/.test(html),
    'HTML export written (title, inlined plot)'
  )
  check(
    html.includes('bilerek &lt;hata&gt;') && !html.includes('<hata>'),
    'HTML export escapes R output'
  )
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: p })
  }, pdfFile)
  await win.locator('button', { hasText: /^(PDF olarak kaydet|Save as PDF)$/ }).click()
  const end = Date.now() + 20000
  while (!fs.existsSync(pdfFile) && Date.now() < end) await win.waitForTimeout(250)
  const pdfHead = fs.existsSync(pdfFile) ? fs.readFileSync(pdfFile).subarray(0, 5).toString() : ''
  check(pdfHead === '%PDF-', 'PDF export written')

  // A session that stops mid-report leaves the report incomplete.
  await win.evaluate(() =>
    window.__SAI_TEST__.useTerminalStore
      .getState()
      .setRSource("#' Uzun\nSys.sleep(4)\n# %% Sonra\ncat('ulasilmadi\\n')")
  )
  await win.locator('button[role="tab"]', { hasText: 'script.R' }).click()
  await buildBtn.click()
  await waitFor(s => s.status === 'busy', 10000, 'sleep running')
  await win.evaluate(() => window.api.terminal.rRestart({}))
  const inc = await waitFor(s => s.report && s.report.incomplete, 20000, 'incomplete')
  const incCode = ((inc.report && inc.report.items) || []).filter(i => i.kind === 'code')
  check(
    inc.report && inc.report.incomplete && incCode.length === 1,
    'stopped session → report incomplete, rest not run'
  )
  check(/yarıda kaldı/.test(await consoleText()), 'incomplete notice shown')

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
  await app.close()
  const failed = results.filter(r => !r.ok)
  console.log(failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILED`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
