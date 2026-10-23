// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the R console (5th tab, R mode) — Faz T2.1.
 *
 * Imports a CSV, starts the persistent R session (read-only `data` bridge),
 * then runs a few commands and asserts the streamed output lands in the
 * terminal-store: `1+1` → 2, `nrow(data)` → row count, a deliberate error is
 * captured on stderr, and the session returns to idle.
 *
 * Requires a real Rscript with jsonlite + arrow available.
 * Run: xvfb-run -a node tests/e2e/e2e-terminal-rconsole.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROWS = 40

function makeCsv() {
  const lines = ['age,income']
  for (let i = 0; i < ROWS; i++) lines.push(`${20 + (i % 30)},${1000 + i * 37}`)
  const file = path.join(os.tmpdir(), 'sai-rconsole-e2e.csv')
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

  const setup = await win.evaluate(async filePath => {
    const result = await window.api.file.import({ filePath })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        result.dataset.id,
        result.dataset.name,
        result.dataset.filePath,
        result.variables,
        result.dataset.rowCount,
        result.styles
      )
    return { datasetId: result.dataset.id }
  }, csvPath)
  console.log('setup:', JSON.stringify(setup))

  // Ensure the Terminal tab is mounted (RConsole subscribes to the stream).
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal'))
  await win.waitForTimeout(500)

  // Start the persistent R session.
  await win.evaluate(id => window.api.terminal.rStart({ datasetId: id }), setup.datasetId)

  // Wait until the session reports ready (idle) — R + package + parquet load.
  const waitFor = async (pred, timeoutMs, label) => {
    const start = Date.now()
    for (;;) {
      const ok = await win.evaluate(pred)
      if (ok) return true
      if (Date.now() - start > timeoutMs) {
        console.error(`timeout waiting for: ${label}`)
        return false
      }
      await win.waitForTimeout(300)
    }
  }

  const ready = await waitFor(
    () => window.__SAI_TEST__.useTerminalStore.getState().rStatus === 'idle',
    30000,
    'R session ready'
  )
  console.log('ready:', ready)

  // Helper: send a command, then wait for idle again.
  const send = async code => {
    await win.evaluate(c => window.api.terminal.rWrite({ code: c }), code)
    await win.waitForTimeout(400)
    await waitFor(
      () => window.__SAI_TEST__.useTerminalStore.getState().rStatus === 'idle',
      15000,
      `idle after: ${code}`
    )
  }

  await send('1 + 1')
  await send('nrow(data)')
  await send('cat(names(data), sep = " ")')
  await send('this_is_a_deliberate_error')

  // Enable "Show in Output" and produce a plot → captured to the terminal plot
  // strip AND promoted to the Output store.
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setShowInOutput(true))
  await send('plot(1:10)')
  const plotCaptured = await waitFor(
    () => window.__SAI_TEST__.useTerminalStore.getState().rPlots.length > 0,
    8000,
    'plot captured'
  )
  await win.waitForTimeout(500)

  // sai_show(df) → explicit table promotion to Output.
  await send('sai_show(head(data, 3))')
  const tablePromoted = await waitFor(
    () =>
      window.__SAI_TEST__.useOutputStore
        .getState()
        .blocks.some(b => b.analysisId === 'rconsole' && b.result.tables.length > 0),
    6000,
    'table promoted'
  )

  // Interrupt (Stop / SIGINT) a long-running command.
  await win.evaluate(() => window.api.terminal.rWrite({ code: 'Sys.sleep(30)' }))
  await win.waitForTimeout(1200)
  const busyDuringSleep = await win.evaluate(
    () => window.__SAI_TEST__.useTerminalStore.getState().rStatus
  )
  await win.evaluate(() => window.api.terminal.rInterrupt())
  const interruptedIdle = await waitFor(
    () => window.__SAI_TEST__.useTerminalStore.getState().rStatus === 'idle',
    8000,
    'idle after interrupt'
  )

  // Command history is populated by the UI run() path — drive the R input with
  // Ctrl+Enter (switch to R mode first so the R input textarea is visible).
  await win.evaluate(() => {
    const rTab = Array.from(document.querySelectorAll('[role="tab"]')).find(
      b => (b.textContent || '').trim() === 'R'
    )
    if (rTab) rTab.click()
  })
  await win.waitForTimeout(300)
  await win.evaluate(() => {
    const areas = Array.from(document.querySelectorAll('textarea'))
    const ta = areas.find(a => /R code|R kodu/.test(a.placeholder || '')) || areas[areas.length - 1]
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    ).set
    setter.call(ta, 'history_probe')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
  })
  await win.waitForTimeout(600)
  const history = await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rHistory)

  const result = await win.evaluate(() => {
    const st = window.__SAI_TEST__.useTerminalStore.getState()
    const blocks = window.__SAI_TEST__.useOutputStore.getState().blocks
    return {
      text: st.rOutput.map(c => c.text).join(''),
      stderrText: st.rOutput
        .filter(c => c.stream === 'stderr')
        .map(c => c.text)
        .join(''),
      status: st.rStatus,
      plots: st.rPlots.length,
      pngLen: st.rPlots[0] ? st.rPlots[0].png.length : 0,
      outBlocks: blocks.filter(b => b.analysisId === 'rconsole').length
    }
  })
  console.log('rOutput:\n' + result.text)
  console.log('status:', result.status)

  await win.screenshot({ path: __dirname + '/../../e2e-terminal-rconsole.png', fullPage: true })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })

  const gotTwo = /\b2\b/.test(result.text)
  const gotRows = new RegExp(`\\b${ROWS}\\b`).test(result.text)
  // Columns must be the Variable View names, not internal colIds / __row_idx.
  const gotNames =
    /\bage\b/.test(result.text) &&
    /\bincome\b/.test(result.text) &&
    !/col_\d|__row_idx/.test(result.text)
  const gotError = /Error/i.test(result.stderrText)
  const idle = result.status === 'idle'
  const gotPlot = plotCaptured && result.plots >= 1 && result.pngLen > 100
  const promoted = result.outBlocks >= 1
  const gotTable = tablePromoted
  const interrupted = busyDuringSleep === 'busy' && interruptedIdle
  const gotHistory = history.includes('history_probe')

  const pass =
    ready &&
    gotTwo &&
    gotRows &&
    gotNames &&
    gotError &&
    idle &&
    gotPlot &&
    promoted &&
    gotTable &&
    interrupted &&
    gotHistory
  console.log(
    'checks:',
    JSON.stringify({
      ready,
      gotTwo,
      gotRows,
      gotNames,
      gotError,
      idle,
      gotPlot,
      promoted,
      gotTable,
      interrupted,
      gotHistory
    })
  )

  await app.close()
  if (!pass) {
    console.error('E2E FAILED — see assertions above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
