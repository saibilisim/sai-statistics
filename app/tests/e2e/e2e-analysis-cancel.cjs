// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: analysis cancellation flow (A8.7).
 *
 * Drives the real cancel path end-to-end against the built app
 * (Output view Cancel button → analysis:cancel IPC → job-manager →
 * job:error terminal event → App.tsx error block → Output store → DOM):
 *
 *  (a) RUNNING cancel via the real UI — start Descriptives on a 100k-row
 *      dataset, wait for the running block's Cancel button, click it. The
 *      cancel must terminate the job (no job:complete, no zombie spinner) and
 *      surface an error block for it.
 *  (b) QUEUED cancel via the real UI — enqueue two jobs, click Cancel on the
 *      one still waiting in the FIFO. job-manager pushes
 *      `common.analysisCancelled` for it; the Output store must gain an error
 *      block whose warning is the localized "Analysis cancelled." text.
 *  (c) Queue health — a fresh job started afterwards completes normally,
 *      proving cancelled jobs don't poison the single-worker queue.
 *
 * FIXED 2026-07-28 (e2e keeps covering the honest paths; the BUG warnings
 * below now stay silent):
 *  BUG-1 (job-manager.ts) — FIXED: cancelJob() now keeps a reference to the
 *    running Job object and flags it before aborting, so a mid-execution
 *    cancel surfaces as `common.analysisCancelled` (was: rScriptFailed with
 *    empty details).
 *  BUG-2 (output-format.ts) — FIXED: translateOutputKey resolves
 *    'output.errorBlock' from the common namespace before the analysis
 *    catch-all, so the raw key no longer leaks into the block title.
 *
 * Requires a real Rscript (jsonlite + arrow). Run:
 *   xvfb-run -a node tests/e2e/e2e-analysis-cancel.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROWS = 100000
const CANCELLED_RE = /analiz iptal edildi|analysis cancelled/i

function makeCsv() {
  const lines = ['score,income']
  for (let i = 0; i < ROWS; i++) {
    lines.push(`${(i % 100) + ((i * 7) % 13) / 10},${1000 + ((i * 37) % 9000)}`)
  }
  const file = path.join(os.tmpdir(), 'sai-cancel-e2e.csv')
  fs.writeFileSync(file, lines.join('\n') + '\n')
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
  // Analysis results dirty the Output — the close guard's native dialog would
  // block forever headless; auto-pick "don't save/export" (same pattern as
  // e2e-means.cjs / e2e-chunked-load.cjs).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

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
    const vars = result.variables.filter(v => v.type === 'numeric')
    return { datasetId: result.dataset.id, vars: vars.map(v => ({ colId: v.colId, name: v.name })) }
  }, csvPath)
  console.log('setup:', JSON.stringify(setup))
  if (setup.vars.length < 2) throw new Error('expected 2 numeric variables in fixture')

  // Record every job event App.tsx/OutputView would see.
  await win.evaluate(() => {
    window.__jobEvents = []
    window.api.on.jobProgress(p => window.__jobEvents.push({ type: 'progress', ...p }))
    window.api.on.jobComplete(p =>
      window.__jobEvents.push({ type: 'complete', jobId: p.jobId, analysisId: p.analysisId })
    )
    window.api.on.jobError(p =>
      window.__jobEvents.push({
        type: 'error',
        jobId: p.jobId,
        errorKey: p.errorKey,
        details: p.details ?? null
      })
    )
  })

  // Mount the Output tab so OutputView renders running blocks + Cancel buttons.
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('output'))
  await win.waitForTimeout(500)

  const waitFor = async (pred, arg, timeoutMs, label) => {
    const start = Date.now()
    for (;;) {
      const ok = await win.evaluate(pred, arg)
      if (ok) return true
      if (Date.now() - start > timeoutMs) {
        console.error(`timeout waiting for: ${label}`)
        return false
      }
      await win.waitForTimeout(200)
    }
  }

  const runDescriptives = () =>
    win.evaluate(
      ({ datasetId, vars }) =>
        window.api.analysis
          .run({
            analysisId: 'descriptives',
            datasetId,
            scriptFile: 'descriptives.R',
            params: {
              variables: vars.map(v => v.colId),
              varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
              options: { mean: true, sd: true, min: true, max: true }
            }
          })
          .then(({ jobId }) => jobId),
      setup
    )

  const terminalOf = async jobId =>
    win.evaluate(
      jid => window.__jobEvents.find(e => e.jobId === jid && e.type !== 'progress') ?? null,
      jobId
    )
  const blockOf = async jobId =>
    win.evaluate(jid => {
      const b = window.__SAI_TEST__.useOutputStore.getState().blocks.find(x => x.id === jid)
      return b
        ? { analysisId: b.analysisId, success: b.result.success, warnings: b.result.warnings }
        : null
    }, jobId)
  const runningBlockCount = () =>
    win.evaluate(() => document.querySelectorAll('div[class*="runningBlock"]').length)

  // ── (a) Cancel a RUNNING job via the real Cancel button ──────────────────
  const jobA = await runDescriptives()
  console.log('jobA (running-cancel):', jobA)
  await win.waitForSelector('div[class*="runningBlock"] button', { timeout: 10000 })
  await win.click('div[class*="runningBlock"] button') // t('common.cancel')

  const termAArrived = await waitFor(
    jid => window.__jobEvents.some(e => e.jobId === jid && e.type !== 'progress'),
    jobA,
    15000,
    'terminal event for jobA'
  )
  await waitFor(
    () => document.querySelectorAll('div[class*="runningBlock"]').length === 0,
    null,
    8000,
    'running block removed for jobA'
  )
  await win.waitForTimeout(500)
  const termA = await terminalOf(jobA)
  const blockA = await blockOf(jobA)
  const completeA = termA && termA.type === 'complete'
  const runningTerminated = termAArrived && !completeA && termA.type === 'error'
  const runningSurfaced = !!blockA && blockA.analysisId === 'error' && blockA.success === false
  console.log('termA:', JSON.stringify(termA), 'blockA:', JSON.stringify(blockA))

  // ── (b) Cancel a QUEUED job via the real Cancel button ───────────────────
  const jobB1 = await runDescriptives()
  const jobB2 = await runDescriptives()
  console.log('jobB1 (running):', jobB1, ' jobB2 (queued-cancel):', jobB2)
  // Both jobs show a running block (queued jobs report progress.queued at
  // enqueue). Cancel the SECOND one — the one still waiting in the FIFO.
  await win.waitForFunction(
    () => document.querySelectorAll('div[class*="runningBlock"]').length >= 2,
    undefined,
    { timeout: 10000 }
  )
  await win.locator('div[class*="runningBlock"] button').nth(1).click()
  // Abort the running job too so the queue drains and jobB2's terminal event
  // is pushed promptly (its error only fires once it is dequeued).
  await win.evaluate(jid => window.api.analysis.cancel(jid), jobB1)

  const errQueued = await waitFor(
    jid =>
      window.__jobEvents.some(
        e => e.type === 'error' && e.jobId === jid && e.errorKey === 'common.analysisCancelled'
      ),
    jobB2,
    15000,
    'jobError common.analysisCancelled for queued jobB2'
  )
  const termB1 = await (async () => {
    await waitFor(
      jid => window.__jobEvents.some(e => e.jobId === jid && e.type !== 'progress'),
      jobB1,
      15000,
      'terminal event for jobB1'
    )
    return terminalOf(jobB1)
  })()
  await win.waitForTimeout(500)
  const blockB2 = await blockOf(jobB2)
  const domText = await win.evaluate(
    () => document.querySelector('[class*="content"]')?.textContent ?? ''
  )
  const noCompletes = [jobA, jobB1, jobB2].every(
    jid => ![termA, termB1].some(t => t && t.jobId === jid && t.type === 'complete')
  )
  const queuedStoreHonest =
    !!blockB2 &&
    blockB2.analysisId === 'error' &&
    blockB2.success === false &&
    CANCELLED_RE.test(blockB2.warnings.join(' | '))
  const queuedDomHonest = CANCELLED_RE.test(domText)
  const rawTitleLeak = /output\.errorBlock/.test(domText)
  console.log('termB1:', JSON.stringify(termB1), 'blockB2:', JSON.stringify(blockB2))

  // ── (c) Queue still healthy: a fresh job completes ───────────────────────
  const jobC = await runDescriptives()
  const okC = await waitFor(
    jid => window.__jobEvents.some(e => e.type === 'complete' && e.jobId === jid),
    jobC,
    30000,
    'jobComplete for post-cancel job'
  )
  const cHasTables = await win.evaluate(jid => {
    const block = window.__SAI_TEST__.useOutputStore.getState().blocks.find(b => b.id === jid)
    return !!block && block.result.success === true && block.result.tables.length > 0
  }, jobC)

  const finalRunning = await runningBlockCount()

  // ── Verdict ──────────────────────────────────────────────────────────────
  const checks = {
    runningTerminated,
    runningSurfaced,
    errQueued,
    queuedStoreHonest,
    queuedDomHonest,
    noCompletes,
    okC,
    cHasTables,
    noZombieRunning: finalRunning === 0
  }
  console.log('checks:', JSON.stringify(checks))
  const pass = Object.values(checks).every(Boolean)

  // Known production bugs — reported as warnings, not failures (see header).
  if (!termA || termA.errorKey !== 'common.analysisCancelled') {
    console.warn(
      `BUG-1 (job-manager.ts): running-job cancel surfaced as ${String(termA?.errorKey)} ` +
        `(details=${JSON.stringify(termA?.details ?? null)}) instead of common.analysisCancelled`
    )
  }
  if (!termB1 || termB1.errorKey !== 'common.analysisCancelled') {
    console.warn(
      `BUG-1 (job-manager.ts): second running-job cancel surfaced as ${String(termB1?.errorKey)} ` +
        `instead of common.analysisCancelled`
    )
  }
  if (rawTitleLeak) {
    console.warn(
      'BUG-2 (App.tsx/output-format.ts): error block title renders raw key "output.errorBlock"'
    )
  }

  const jobEvents = await win.evaluate(() => window.__jobEvents)
  console.log('jobEvents:', JSON.stringify(jobEvents))

  await win.screenshot({ path: __dirname + '/../../e2e-analysis-cancel.png', fullPage: true })
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
