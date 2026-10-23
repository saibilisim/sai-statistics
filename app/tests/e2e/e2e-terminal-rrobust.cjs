// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: R console robustness — the awkward things real R code does.
 *
 * Each case below once hung the console or lost state:
 *   • sink() left open across commands swallowed the end-of-command marker and
 *     the console waited forever (Stop then restarted R, losing the workspace).
 *   • scan() from the console waited for input this console can't send.
 *   • Stop on Windows restarts R; it did so without the dataset, so `data`
 *     was gone afterwards.
 *   • options(warn = 2) / warn = -1 had no effect (our handler printed and
 *     muffled every warning).
 *   • An error from a primitive (`f$x` on a function) showed our own handler
 *     frame as the traceback.
 *   • R's Turkish "infinite recursion" message arrived in the Windows code page.
 * Plus protocol look-alikes in user output (a fake done marker, "+ ", text with
 * no trailing newline), parse errors, an unfinished expression and stderr/stdout
 * ordering — the session must stay in step after every one.
 *
 * Requires a real Rscript with jsonlite + arrow.
 * Run: node tests/e2e/run-e2e.cjs e2e-terminal-rrobust   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROWS = 60

function makeCsv() {
  const lines = ['id,age,income,grp']
  for (let i = 0; i < ROWS; i++) {
    lines.push(`${i + 1},${20 + (i % 30)},${i % 7 === 0 ? '' : 1000 + i * 37},${'ABC'[i % 3]}`)
  }
  const file = path.join(os.tmpdir(), 'sai-rrobust-e2e.csv')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

async function main() {
  const csvPath = makeCsv()
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => console.log('[pageerror]', err.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

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
  }, csvPath)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  })

  const status = () => win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rStatus)
  const waitIdle = async ms => {
    const end = Date.now() + ms
    for (;;) {
      if ((await status()) === 'idle') return true
      if (Date.now() > end) return false
      await win.waitForTimeout(150)
    }
  }
  const ready = await waitIdle(40000)

  /** Run `code`, wait for idle; returns {idle, out, err, tb, seq} of this command only. */
  const run = async (code, ms = 8000) => {
    await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().clearROutput())
    await win.evaluate(c => window.api.terminal.rWrite({ code: c }), code)
    await win.waitForTimeout(300)
    const idle = await waitIdle(ms)
    await win.waitForTimeout(300)
    const chunks = await win.evaluate(() =>
      window.__SAI_TEST__.useTerminalStore.getState().rOutput.map(c => ({ s: c.stream, t: c.text }))
    )
    const of = s =>
      chunks
        .filter(c => c.s === s)
        .map(c => c.t)
        .join('')
    return { idle, out: of('stdout'), err: of('stderr'), tb: of('traceback'), seq: chunks }
  }

  const checks = {}
  const log = (name, r) => console.log(`${name}:`, JSON.stringify(r).slice(0, 400))

  // ── Parse errors and unfinished input leave the session in step ──
  let r = await run('f <- function(x) {\n  y <- x * 2\n  y + 1\n}\nf(10)')
  checks.multiline = r.idle && /\[1\] 21/.test(r.out)
  r = await run('f(1, ))')
  checks.parseError = r.idle && /Error/.test(r.err)
  r = await run('g <- function(x) {\n  x + 1')
  checks.unfinished = r.idle && /Error/.test(r.err)
  r = await run('f(2)')
  checks.afterErrors = r.idle && /\[1\] 5/.test(r.out)

  // ── Output that looks like the protocol ──
  r = await run('cat("__SAI_DONE__ fake\\n"); cat("+ "); cat("no newline")')
  log('lookalikes', r)
  checks.lookalikes = r.idle && /__SAI_DONE__ fake/.test(r.out) && /no newline/.test(r.out)
  r = await run('3 + 3')
  checks.afterLookalikes = r.idle && /\[1\] 6/.test(r.out)

  // ── stdout/stderr interleave in order ──
  r = await run('cat("o1\\n"); message("e1"); cat("o2\\n"); message("e2")')
  const order = r.seq
    .filter(c => c.s === 'stdout' || c.s === 'stderr')
    .map(c => c.t.trim())
    .join(',')
  console.log('order:', order)
  checks.ordered = r.idle && order === 'o1,e1,o2,e2'

  // ── sink() across commands ──
  r = await run('tf <- tempfile(); sink(tf)', 6000)
  checks.sinkOpenReturns = r.idle
  r = await run('print("into-sink")', 6000)
  checks.sinkDiverts = r.idle && !/into-sink/.test(r.out)
  r = await run('sink(); cat(readLines(tf), "\\n")', 6000)
  log('sink', r)
  checks.sinkKept = r.idle && /into-sink/.test(r.out)

  // ── scan() from the console fails fast instead of hanging ──
  r = await run('z <- scan()', 6000)
  log('scan', r)
  checks.scanFails = r.idle && /scan\(\)/.test(r.err)

  // ── options(warn=) ──
  r = await run('options(warn = 2); as.numeric("x")')
  log('warn2', r)
  checks.warn2IsError = r.idle && /^Error/m.test(r.err)
  r = await run('options(warn = -1); as.numeric("x")')
  checks.warnNegHidden = r.idle && r.err === '' && /NA/.test(r.out)
  r = await run('options(warn = 0); as.numeric("x")')
  checks.warn0Shown = r.idle && /Warning/.test(r.err)

  // ── Traceback of a primitive's error is not our handler ──
  r = await run('d <- function() 1; d$x')
  log('primitive', r)
  checks.noHandlerFrame = r.idle && /Error/.test(r.err) && !/function \(err\)/.test(r.tb)

  // ── Infinite recursion: readable message, session alive ──
  r = await run('rec <- function(n) rec(n + 1); rec(1)', 15000)
  log('recursion', r)
  checks.recursionReadable = r.idle && /Error/.test(r.err) && !r.err.includes('�')

  // ── Stop: the session (restarted on Windows) still has `data` ──
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().clearROutput())
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'while (TRUE) { x <- 1 }' }))
  await win.waitForTimeout(1500)
  // The Stop button's own handler (it passes the dataset along).
  const stopped = await win.evaluate(() => {
    const btn = document.querySelector('[data-r-stop]')
    if (!btn) return false
    btn.click()
    return true
  })
  checks.stopIdle = stopped && (await waitIdle(40000))
  r = await run('nrow(data)')
  log('afterStop', r)
  checks.dataAfterStop = r.idle && new RegExp(`\\[1\\] ${ROWS}`).test(r.out)

  console.log('checks:', JSON.stringify(checks))
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  const pass = ready && Object.values(checks).every(Boolean)
  if (!pass) {
    console.error('E2E FAILED — see checks above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
