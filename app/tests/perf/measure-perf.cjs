// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * measure-perf.cjs — local performance measurement protocol (K5.2,
 * faz8-kalite-roadmap.md). NOT part of run-e2e.cjs / CI — manual tool run
 * against the stress fixture from gen-stress-fixture.cjs.
 *
 * Measures (3 repeats each, prints per-run + mean):
 *   1. Import time (file:import, CSV -> DuckDB)
 *   2. data:get-all time + main-process RSS after (the OLD single-shot path —
 *      kept as a baseline comparison point, no longer what DataView itself uses)
 *   3. Chunked load (chunked-load-roadmap.md): time to first paint (grid
 *      interactive) + total load time (background chunks fully painted) +
 *      longest single main-thread block during the whole load
 *      (PerformanceObserver('longtask'); a UI-freeze regression would show
 *      up here as a large longtask instead of just a slow total)
 *   4. Scroll smoothness (rAF frames counted over a fixed wheel-scroll window)
 *   5. Descriptives analysis round-trip (job start -> job:complete)
 *
 * Usage: node tests/perf/measure-perf.cjs [csvPath]
 *   Default csvPath: /tmp/sai-stress-500k.csv (run gen-stress-fixture.cjs first)
 */
const { _electron } = require('@playwright/test')

const csvPath = process.argv[2] || '/tmp/sai-stress-500k.csv'
const REPEATS = parseInt(process.argv[3], 10) || 3

function log(...args) {
  process.stdout.write(args.join(' ') + '\n')
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

async function main() {
  log(`Measuring against: ${csvPath}\n`)

  const importTimes = []
  const getAllTimes = []
  const rssAfterGetAll = []
  const firstPaintTimes = []
  const totalLoadTimes = []
  const longestBlockTimes = []
  const scrollFps = []
  const descriptivesTimes = []

  for (let run = 1; run <= REPEATS; run++) {
    log(`--- Run ${String(run)}/${String(REPEATS)} ---`)
    const app = await _electron.launch({
      args: ['out/main/main.cjs', '--no-sandbox'],
      cwd: __dirname + '/../..'
    })
    const win = await app.firstWindow()
    win.on('console', msg => {
      const t = msg.text()
      if (t.includes('[job')) log(`  [console] ${t}`)
    })
    win.on('pageerror', err => log(`  [pageerror] ${err.message}`))
    await win.waitForLoadState('domcontentloaded')
    // K5.3's large-dataset info box is exactly what this script is about to
    // trigger (rowCount > 200K) — stub it out like the e2e scripts do for
    // the unsaved-changes dialog, so it can't steal OS-level focus/input
    // under xvfb and stall the mouse/wheel simulation below.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0 })
    })
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1200, 900)
    })
    await win.waitForTimeout(1000)
    log('  window ready')

    // 1. Import time
    log('  starting import...')
    const t0 = Date.now()
    const importResult = await win.evaluate(async path => {
      return window.api.file.import({ filePath: path })
    }, csvPath)
    const importMs = Date.now() - t0
    importTimes.push(importMs)
    log(`  import: ${String(importMs)}ms (${String(importResult.dataset.rowCount)} rows)`)

    log("  starting chunked load (setDataset -> DataView's real load path)...")
    // 3. Chunked load: install a longtask observer BEFORE triggering the
    // load so it captures every block for the whole duration, then trigger
    // setDataset (the same call the app itself makes after import — this is
    // what actually drives DataView's chunked initSpreadsheet).
    await win.evaluate(() => {
      window.__SAI_PERF_LONGTASKS__ = []
      window.__SAI_PERF_OBSERVER__ = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          window.__SAI_PERF_LONGTASKS__.push(entry.duration)
        }
      })
      window.__SAI_PERF_OBSERVER__.observe({ entryTypes: ['longtask'] })
    })

    const chunkedLoadStart = Date.now()
    await win.evaluate(r => {
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
    }, importResult)

    // Time to first paint: DataView's own loading overlay disappears once
    // the first chunk is painted and the grid is interactive (progressive
    // branch) — or once filtering/sorting + the full paint finishes
    // (collect-then-paint branch, no filter/sort active here so this is the
    // progressive path in practice).
    await win.waitForFunction(
      () => !document.querySelector('[class*="loadingOverlay"]'),
      undefined,
      { timeout: 240000 }
    )
    const firstPaintMs = Date.now() - chunkedLoadStart
    firstPaintTimes.push(firstPaintMs)
    log(`  first paint: ${String(firstPaintMs)}ms`)

    // Total load time: background chunk streaming fully done (StatusBar's
    // isProcessing/status.loadingRows clears — chunked-load-roadmap.md C4).
    await win.waitForFunction(
      () => !window.__SAI_TEST__.useUIStore.getState().isProcessing,
      undefined,
      { timeout: 240000 }
    )
    const totalLoadMs = Date.now() - chunkedLoadStart
    totalLoadTimes.push(totalLoadMs)

    const longtasks = await win.evaluate(() => {
      window.__SAI_PERF_OBSERVER__.disconnect()
      return window.__SAI_PERF_LONGTASKS__
    })
    const longestBlock = longtasks.length > 0 ? Math.max(...longtasks) : 0
    longestBlockTimes.push(longestBlock)
    log(
      `  total load: ${String(totalLoadMs)}ms, longest main-thread block: ${longestBlock.toFixed(0)}ms (${String(longtasks.length)} longtasks ≥50ms)`
    )

    await win.waitForTimeout(500) // let Univer finish its own internal settle

    log('  starting data:get-all...')
    // 2. data:get-all time + main-process RSS after
    const t1 = Date.now()
    await win.evaluate(id => window.api.data.getAll({ datasetId: id }), importResult.dataset.id)
    getAllTimes.push(Date.now() - t1)
    const rss = await app.evaluate(() => process.memoryUsage().rss)
    rssAfterGetAll.push(rss)
    log(
      `  data:get-all: ${String(getAllTimes[getAllTimes.length - 1])}ms, main RSS: ${(rss / 1024 / 1024).toFixed(0)}MB`
    )

    log('  starting scroll measurement...')
    // 4. Scroll smoothness: dispatch wheel events on the largest canvas for a
    // fixed duration, count animation frames via rAF during that window.
    const box = await win.evaluate(() => {
      const rects = [...document.querySelectorAll('canvas')].map(c => {
        const r = c.getBoundingClientRect()
        return { w: r.width, h: r.height, left: r.left, top: r.top }
      })
      const main = rects.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0]
      return { left: main.left + main.w / 2, top: main.top + main.h / 2 }
    })
    const frameCountPromise = win.evaluate(
      () =>
        new Promise(resolve => {
          let frames = 0
          const start = performance.now()
          function tick() {
            frames++
            if (performance.now() - start < 2000) {
              requestAnimationFrame(tick)
            } else {
              resolve(frames)
            }
          }
          requestAnimationFrame(tick)
        })
    )
    for (let i = 0; i < 40; i++) {
      await win.mouse.move(box.left, box.top)
      await win.mouse.wheel(0, 300)
      await win.waitForTimeout(45)
    }
    const frames = await frameCountPromise
    const fps = frames / 2 // 2-second window
    scrollFps.push(fps)
    log(`  scroll: ~${fps.toFixed(1)} fps over 2s of wheel-scrolling`)

    const numericVars = importResult.variables.filter(v => v.type === 'numeric').slice(0, 3)
    log(
      `  numeric vars for descriptives: ${JSON.stringify(numericVars.map(v => [v.colId, v.name]))}`
    )
    log('  starting descriptives round-trip...')
    // 5. Descriptives round-trip on a couple of numeric columns — listens on
    // the same job:complete/job:error IPC events App.tsx itself subscribes to.
    const t2 = Date.now()
    await win.evaluate(
      ({ datasetId, vars }) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`descriptives job timed out after 30s (jobId=${String(jobId)})`))
          }, 30000)
          let jobId
          const unsubComplete = window.api.on.jobComplete(payload => {
            console.log('[jobComplete]', payload.jobId, 'waiting for', jobId)
            if (payload.jobId !== jobId) return
            clearTimeout(timeout)
            unsubComplete()
            unsubError()
            resolve()
          })
          const unsubError = window.api.on.jobError(payload => {
            console.log(
              '[jobError]',
              payload.jobId,
              payload.errorKey,
              payload.details,
              'waiting for',
              jobId
            )
            if (payload.jobId !== jobId) return
            clearTimeout(timeout)
            unsubComplete()
            unsubError()
            reject(new Error(payload.errorKey))
          })
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
            .then(({ jobId: id }) => {
              console.log('[analysis.run resolved]', id)
              jobId = id
            })
            .catch(reject)
        }),
      { datasetId: importResult.dataset.id, vars: numericVars }
    )
    const descMs = Date.now() - t2
    descriptivesTimes.push(descMs)
    log(`  descriptives round-trip: ${String(descMs)}ms`)

    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1
    })
    await app.close()
  }

  log(`\n=== Summary (mean of ${String(REPEATS)} runs) ===`)
  log(`Import:                  ${mean(importTimes).toFixed(0)}ms`)
  log(`data:get-all (old, baseline): ${mean(getAllTimes).toFixed(0)}ms`)
  log(`Main RSS after get-all:  ${(mean(rssAfterGetAll) / 1024 / 1024).toFixed(0)}MB`)
  log(`Chunked load — first paint: ${mean(firstPaintTimes).toFixed(0)}ms`)
  log(`Chunked load — total:    ${mean(totalLoadTimes).toFixed(0)}ms`)
  log(`Longest main-thread block: ${mean(longestBlockTimes).toFixed(0)}ms`)
  log(`Scroll FPS:              ${mean(scrollFps).toFixed(1)}`)
  log(`Descriptives round-trip: ${mean(descriptivesTimes).toFixed(0)}ms`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
