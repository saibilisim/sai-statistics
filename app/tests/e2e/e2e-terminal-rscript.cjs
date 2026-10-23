// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the R mode's IDE features (Faz T3) end to end, through the UI:
 *  Editor  — Ctrl+Enter runs the WHOLE multi-line statement under the caret
 *            (not half of it) and moves to the next one; Ctrl+Shift+Enter
 *            runs everything; R highlighting renders token spans.
 *  Complete— typing `summ` pops R's own completions, Enter inserts `summary()`
 *            with the caret inside; `data$Sep` completes column names.
 *  Help    — F1 on a function name fills the Help pane (no console echo).
 *  Env     — the Environment pane lists `data` (150 × 5) and new objects.
 *  View    — the pane's View button opens `data` in an AG Grid tab; header
 *            click sorts via DuckDB; a 200k-row View() pages (last rows
 *            readable); closing the tab removes it; the sort column is
 *            allow-listed (unknown column rejected).
 *  Robust  — clobbering the old loop variables (`con`, `buf`) no longer
 *            breaks the console; "Send to R script" lands in the editor.
 * Uses the bundled iris sample (resources/sample-data) — no /tmp fixture.
 * Screenshots: tmp/term-rscript-editor.png, tmp/term-rscript-view.png.
 */
const path = require('path')
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
        env: s.rEnv.map(e => ({ name: e.name, cls: e.cls, dims: e.dims })),
        views: s.rViews,
        help: s.rHelp,
        rSource: s.rSource,
        mode: s.mode,
        out: s.rOutput.map(c => c.text).join('')
      }
    })
  const waitFor = async (pred, ms, label) => {
    const end = Date.now() + ms
    for (;;) {
      const st = await term()
      if (pred(st)) return st
      if (Date.now() > end) {
        console.log(`  (timeout: ${label})`)
        return st
      }
      await win.waitForTimeout(250)
    }
  }
  const idle = (ms = 20000) => waitFor(s => s.status === 'idle', ms, 'idle')
  const envHas = name => s => s.env.some(e => e.name === name)
  // SAI notices are stored as i18n keys — read the translated console text.
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

  // ── Session + Environment pane ──
  let st = await waitFor(s => s.status === 'idle' && s.env.length > 0, 40000, 'ready + env')
  const dataItem = st.env.find(e => e.name === 'data')
  check(
    dataItem && dataItem.dims && dataItem.dims[0] === 150 && dataItem.dims[1] === 5,
    `env lists data 150×5 (${JSON.stringify(dataItem)})`
  )
  check(
    !st.env.some(e => ['sai_data', 'sai_show', 'View', 'con', 'buf'].includes(e.name)),
    'session helpers/loop vars hidden from the env pane'
  )
  const envRow = win.locator('[class*="envRow"]', { hasText: 'data' }).first()
  check(await envRow.isVisible(), 'env pane shows the data row')

  // ── Editor: Ctrl+Enter runs the whole multi-line statement ──
  const script = [
    'm <- mean(data$Sepal_Length)',
    'fit <- lm(Sepal_Length ~',
    '  Petal_Length, data = data)',
    '',
    'z <- 42'
  ].join('\n')
  await win.evaluate(s => window.__SAI_TEST__.useTerminalStore.getState().setRSource(s), script)
  const editor = win.locator('[class*="rEditorWrap"] textarea').first()
  await editor.waitFor({ timeout: 5000 })
  check(
    (await win.$$('[class*="rEditorWrap"] [class*="tok_function"]')).length > 0,
    'R highlighting renders function tokens'
  )
  // Caret on the SECOND line of the lm() call.
  const secondLine = script.indexOf('  Petal_Length')
  await editor.click()
  await editor.evaluate((el, pos) => {
    el.setSelectionRange(pos, pos)
    el.dispatchEvent(new Event('select', { bubbles: true }))
  }, secondLine + 3)
  await win.keyboard.press('Control+Enter')
  st = await waitFor(envHas('fit'), 15000, 'fit')
  check(
    st.env.some(e => e.name === 'fit' && e.cls === 'lm'),
    'Ctrl+Enter on line 2 ran the whole lm() call'
  )
  check(!st.env.some(e => e.name === 'm' || e.name === 'z'), 'only that statement ran')
  check(/> fit <- lm\(Sepal_Length ~\n\+ {3}Petal_Length/.test(st.out), 'echo uses > / + prompts')
  const caretAfter = await editor.evaluate(el => el.selectionStart)
  check(
    caretAfter === script.indexOf('z <- 42'),
    `caret moved to the next statement (${caretAfter})`
  )
  await win.keyboard.press('Control+Shift+Enter')
  st = await waitFor(s => envHas('m')(s) && envHas('z')(s), 15000, 'run all')
  check(envHas('m')(st) && envHas('z')(st), 'Ctrl+Shift+Enter ran the whole script')
  check(/\n> z <- 42\n/.test(st.out), 'run-all echo starts each statement with >')
  await idle()

  // ── Completion (R's own engine) ──
  await editor.evaluate(el => el.setSelectionRange(el.value.length, el.value.length))
  await win.keyboard.press('End')
  await win.keyboard.press('Enter')
  await win.keyboard.type('summ', { delay: 40 })
  const box = win.locator('[class*="rEditorWrap"] [role="listbox"]')
  await box.waitFor({ timeout: 5000 }).catch(() => undefined)
  const opts = await box
    .locator('[role="option"]')
    .allTextContents()
    .catch(() => [])
  check(
    opts.some(o => o.startsWith('summary')),
    `suggestions pop up (${opts.slice(0, 4).join(', ')})`
  )
  await win.keyboard.press('Enter')
  await win.waitForTimeout(200)
  let val = await editor.inputValue()
  const caret = await editor.evaluate(el => el.selectionStart)
  check(
    val.endsWith('summary()') && caret === val.length - 1,
    `Enter inserts summary() (${val.slice(-12)})`
  )
  await win.keyboard.type('data$Sep', { delay: 40 })
  await win.keyboard.press('Tab')
  await box.waitFor({ timeout: 5000 }).catch(() => undefined)
  const colOpts = await box
    .locator('[role="option"]')
    .allTextContents()
    .catch(() => [])
  check(
    colOpts.includes('data$Sepal_Length') && colOpts.includes('data$Sepal_Width'),
    `Tab completes column names (${colOpts.join(', ')})`
  )
  await win.keyboard.press('Escape')
  check((await box.count()) === 0, 'Escape closes the list')
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rscript-editor.png') })

  // ── F1 help ──
  val = await editor.inputValue()
  const outLen = (await term()).out.length
  await editor.evaluate(
    (el, pos) => {
      el.setSelectionRange(pos, pos)
      el.dispatchEvent(new Event('select', { bubbles: true }))
    },
    val.indexOf('mean') + 2
  )
  await win.keyboard.press('F1')
  st = await waitFor(s => s.help !== null, 15000, 'help')
  check(st.help && /Arithmetic Mean/.test(st.help.text), 'F1 fills the Help pane')
  check(!/help\(/.test(st.out.slice(outLen)), 'help request is not echoed into the console')
  const helpText = await win
    .locator('[class*="helpText"]')
    .first()
    .textContent()
    .catch(() => '')
  check(/Arithmetic Mean/.test(helpText || ''), 'Help tab is shown with the page')
  await idle()

  // ── View(): env button → AG Grid tab ──
  await win.locator('[class*="sideTab"]', { hasText: /^(Ortam|Environment)$/ }).click()
  await win
    .locator('[class*="envRow"]', { hasText: 'data' })
    .first()
    .locator('button[class*="iconBtn"]')
    .click()
  st = await waitFor(s => s.views.length > 0, 15000, 'view')
  const v = st.views[0]
  check(
    v && v.rowCount === 150 && v.columns.length === 5,
    `View(data) payload (${v && v.rowCount})`
  )
  await win
    .locator('[class*="viewGrid"] .ag-row')
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => undefined)
  const rowCount = await win
    .locator('[class*="viewGrid"] .ag-center-cols-container .ag-row')
    .count()
  check(rowCount > 10, `grid renders rows (${rowCount})`)
  const firstSepal = () =>
    win
      .locator('[class*="viewGrid"] .ag-center-cols-container .ag-row[row-index="0"] [col-id="c0"]')
      .first()
      .textContent()
  const before = await firstSepal()
  await win
    .locator('[class*="viewGrid"] .ag-header-cell[col-id="c0"] .ag-header-cell-label')
    .click()
  await win.waitForTimeout(800)
  const asc = await firstSepal()
  check(Number(asc) === 4.3, `header click sorts ascending via DuckDB (${before} → ${asc})`)
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rscript-view.png') })
  const desc = await win.evaluate(
    id =>
      window.api.terminal.rViewRows({
        viewId: id,
        offset: 0,
        limit: 1,
        sortCol: 'Sepal_Length',
        sortDir: 'desc'
      }),
    v.viewId
  )
  check(desc.rows[0][0] === 7.9, `rViewRows desc (${JSON.stringify(desc.rows[0])})`)
  const bad = await win
    .evaluate(
      id =>
        window.api.terminal.rViewRows({
          viewId: id,
          offset: 0,
          limit: 1,
          sortCol: 'x"; DROP TABLE t; --'
        }),
      v.viewId
    )
    .then(
      () => 'accepted',
      e => String(e)
    )
  check(bad !== 'accepted', 'unknown sort column is rejected')

  // Large View(): paging reaches the last rows.
  await win.evaluate(() =>
    window.api.terminal.rWrite({
      code: 'big <- data.frame(i = 1:200000, s = rep(letters, length.out = 200000)); View(big)'
    })
  )
  st = await waitFor(s => s.views.some(x => x.title === 'big'), 30000, 'big view')
  const big = st.views.find(x => x.title === 'big')
  check(big && big.rowCount === 200000, `200k-row View (${big && big.rowCount})`)
  if (big) {
    const tail = await win.evaluate(
      id => window.api.terminal.rViewRows({ viewId: id, offset: 199995, limit: 10 }),
      big.viewId
    )
    check(tail.rows.length === 5 && tail.rows[4][0] === 200000, 'last page of the 200k view')
  }
  await idle()

  // Close the tab → removed.
  const nViews = (await term()).views.length
  await win.locator('[class*="editorTabClose"]').last().click()
  st = await term()
  check(st.views.length === nViews - 1, 'closing a view tab removes it')

  // ── Robustness: old loop variable names are just user variables now ──
  await win.evaluate(() =>
    window.api.terminal.rWrite({ code: 'rm(list = ls()); con <- 5; buf <- "x"' })
  )
  await idle()
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'cat("alive", 40 + 2, "\\n")' }))
  st = await waitFor(s => /alive 42/.test(s.out) && s.status === 'idle', 10000, 'alive')
  check(/alive 42/.test(st.out) && st.status === 'idle', 'console survives con/buf reassignment')
  if (!/alive 42/.test(st.out))
    console.log(`  out tail: ${JSON.stringify(st.out.slice(-400))} status=${st.status}`)

  // ── "Send to R script" path (dialogs' Paste R) ──
  await win.evaluate(() => {
    const s = window.__SAI_TEST__.useTerminalStore.getState()
    s.setMode('spss')
    s.appendRCode('t.test(data$Sepal_Length)')
  })
  st = await term()
  check(
    st.mode === 'r' && st.rSource.endsWith('\n\nt.test(data$Sepal_Length)'),
    'appendRCode → R mode, appended'
  )

  // ── Console comfort (P1): input completion, R-style errors + traceback, ANSI, find ──
  const consoleInput = win.locator('[class*="rInputArea"]').first()
  await consoleInput.click()
  await win.keyboard.type('summ', { delay: 40 })
  const inBox = win.locator('[class*="rInputWrap"] [role="listbox"]')
  await inBox.waitFor({ timeout: 5000 }).catch(() => undefined)
  check((await inBox.count()) === 1, 'console input shows R completions')
  await win.keyboard.press('Enter')
  check((await consoleInput.inputValue()) === 'summary()', 'Enter accepts in the console input')
  await consoleInput.fill('')

  await win.evaluate(() =>
    window.api.terminal.rWrite({
      code: 'f <- function(x) g(x); g <- function(y) stop("boom"); f(1)'
    })
  )
  const tb = win.locator('details[class*="traceback"]').last()
  await tb.waitFor({ timeout: 10000 }).catch(() => undefined)
  check(
    /Error in g\(x\) : boom/.test(await consoleText()),
    'R-style error message (Error in g(x) : boom)'
  )
  check(
    /3 çağrı/.test((await tb.locator('summary').textContent()) || ''),
    'traceback summary (3 calls)'
  )
  await tb.locator('summary').click()
  const calls = await tb.locator('li').allTextContents()
  check(
    calls.length === 3 && calls[0] === 'stop("boom")' && calls[2] === 'f(1)',
    `traceback innermost first (${calls.join(' | ')})`
  )
  await idle()

  await win.evaluate(() =>
    window.api.terminal.rWrite({ code: 'cat("\\033[31mkirmizi\\033[39m duz\\n")' })
  )
  const red = win.locator('[class*="rConsole"] span[class*="ansi_red"]', { hasText: 'kirmizi' })
  await red.waitFor({ timeout: 10000 }).catch(() => undefined)
  check((await red.count()) === 1, 'ANSI colour rendered as a themed span')
  check(!/\[31m/.test(await consoleText()), 'no raw escape codes in the console')
  await idle()

  await win.locator('[class*="consoleFindInput"]').fill('boom')
  await win.waitForTimeout(300)
  const findCount = (await win.locator('[class*="consoleFindCount"]').textContent()) || ''
  const painted = await win.evaluate(() => CSS.highlights.has('sai-console-find'))
  check(/^1 \/ \d+$/.test(findCount) && painted, `find highlights matches (${findCount})`)
  await win.locator('[class*="consoleFindInput"]').fill('')
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rscript-console.png') })

  // ── Plot export (P1): R redraws the recorded plot at the chosen size ──
  const fs = require('fs')
  const expDir = path.join(appDir, 'tmp', 'plot-export')
  fs.rmSync(expDir, { recursive: true, force: true })
  fs.mkdirSync(expDir, { recursive: true })
  const stubSave = file =>
    app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: p })
    }, file)
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'hist(iris$Sepal.Length)' }))
  st = await waitFor(s => s.status === 'idle', 15000, 'hist')
  const plotCard = win.locator('[class*="plotCard"]').first()
  await plotCard.waitFor({ timeout: 10000 })
  // UI path: card's Export → dialog → SVG → OK.
  const svgPath = path.join(expDir, 'p.svg')
  await stubSave(svgPath)
  await plotCard.locator('button[class*="iconBtn"]').click()
  await win.locator('input[name="plot-format"]').nth(1).check()
  await win.keyboard.press('Enter')
  const savedText = await waitText(/Grafik kaydedildi: p\.svg/, 15000)
  check(/Grafik kaydedildi: p\.svg/.test(savedText), 'export dialog → console confirms')
  check(fs.existsSync(svgPath) && /<svg/.test(fs.readFileSync(svgPath, 'utf8')), 'SVG file written')
  // PNG pixel size follows cm × DPI (16 × 10 cm @ 300 → 1890 × 1181).
  const rid = await win.evaluate(() => {
    const p = window.__SAI_TEST__.useTerminalStore.getState().rPlots
    return p[p.length - 1].rid
  })
  const pngPath = path.join(expDir, 'p.png')
  await stubSave(pngPath)
  await win.evaluate(
    id =>
      window.api.terminal.rPlotExport({
        plotId: id,
        format: 'png',
        widthCm: 16,
        heightCm: 10,
        dpi: 300
      }),
    rid
  )
  const png = fs.existsSync(pngPath) ? fs.readFileSync(pngPath) : null
  const pw = png ? png.readUInt32BE(16) : 0
  const ph = png ? png.readUInt32BE(20) : 0
  check(pw === 1890 && ph === 1181, `PNG is 1890×1181 (${pw}×${ph})`)
  const pdfPath = path.join(expDir, 'p.pdf')
  await stubSave(pdfPath)
  await win.evaluate(
    id =>
      window.api.terminal.rPlotExport({
        plotId: id,
        format: 'pdf',
        widthCm: 12,
        heightCm: 8,
        dpi: 300
      }),
    rid
  )
  check(
    fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).subarray(0, 4).toString() === '%PDF',
    'PDF file written'
  )
  const gone = await win
    .evaluate(() =>
      window.api.terminal.rPlotExport({
        plotId: 9999,
        format: 'png',
        widthCm: 5,
        heightCm: 5,
        dpi: 100
      })
    )
    .then(
      () => 'ok',
      e => String(e)
    )
  check(/plot_gone/.test(gone), 'unknown plot id is reported, not silently ignored')
  // The next command's plot is still captured after exports.
  const nPlots = await win.evaluate(
    () => window.__SAI_TEST__.useTerminalStore.getState().rPlots.length
  )
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'plot(1:3)' }))
  let more = nPlots
  for (let i = 0; i < 40 && more <= nPlots; i++) {
    await win.waitForTimeout(250)
    more = await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rPlots.length)
  }
  check(more > nPlots, 'plot capture keeps working after exports')
  await idle()

  // ── sai_commit(): a data frame becomes the new dataset (P1) ──
  const ds = () =>
    win.evaluate(() => {
      const d = window.__SAI_TEST__.useDatasetStore.getState()
      return {
        id: d.datasetId,
        name: d.datasetName,
        rows: d.rowCount,
        modified: d.isModified,
        vars: d.variables.map(v => ({ name: v.name, label: v.label, vl: v.valueLabels }))
      }
    })
  const dsBefore = await ds()
  await win.evaluate(() =>
    window.api.terminal.rWrite({
      code: [
        'd <- data.frame(g = factor(c("lo", "hi", "lo"), levels = c("lo", "hi")), x = c(1.5, 2, 3))',
        'attr(d$x, "label") <- "Ölçüm"',
        'sai_commit(d, "yeni_veri")'
      ].join('\n')
    })
  )
  let after = dsBefore
  for (let i = 0; i < 60 && after.id === dsBefore.id; i++) {
    await win.waitForTimeout(250)
    after = await ds()
  }
  check(
    after.id !== dsBefore.id && after.name === 'yeni_veri',
    `commit replaced the dataset (${after.name})`
  )
  check(
    after.rows === 3 && after.modified,
    `3 rows, marked unsaved (${after.rows}, ${after.modified})`
  )
  const g = after.vars.find(v => v.name === 'g')
  const x = after.vars.find(v => v.name === 'x')
  check(
    g && g.vl['1'] === 'lo' && g.vl['2'] === 'hi',
    `factor → codes + value labels (${JSON.stringify(g && g.vl)})`
  )
  check(x && x.label === 'Ölçüm', `label attribute → variable label (${x && x.label})`)
  const firstRow = await win
    .evaluate(id => window.api.data.getChunk({ datasetId: id, offset: 0, limit: 1 }), after.id)
    .catch(() => null)
  if (firstRow) {
    check(
      JSON.stringify(firstRow.rows[0]) === JSON.stringify([1, 1.5]),
      `stored codes (${JSON.stringify(firstRow.rows[0])})`
    )
  }
  check(
    /“yeni_veri”.*3 satır × 2 değişken/.test(await waitText(/yeni_veri/, 5000)),
    'console confirms the commit'
  )
  check(
    await win.locator('[class*="staleBadge"]').isVisible(),
    'R `data` flagged stale after the dataset changed'
  )

  // Unsaved changes → the import guard asks; Cancel keeps the open dataset.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 2
  })
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'sai_commit(head(d, 1), "iptal")' }))
  const cancelText = await waitText(/iptal edildi/, 10000)
  const kept = await ds()
  check(
    /iptal edildi/.test(cancelText) && kept.id === after.id,
    'Cancel in the unsaved-changes guard keeps the open dataset'
  )

  check(errors.length === 0, `no page errors ${errors.join(' | ')}`)
  // Leave without the close guard's prompt (the committed dataset is unsaved).
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
