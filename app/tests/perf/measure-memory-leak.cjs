// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * measure-memory-leak.cjs — memory leak tour (K5.4, faz8-kalite-roadmap.md).
 * NOT part of run-e2e.cjs / CI — manual local tool.
 *
 * Opens/closes the Preferences dialog 50x and runs Descriptives 20x on a
 * moderate dataset, comparing renderer JS heap (performance.memory) and
 * main-process RSS before vs after. A real leak shows up as heap that keeps
 * climbing and doesn't come back down after a forced GC pass; normal
 * churn/GC-lag looks like growth that mostly reverts.
 *
 * Usage: node tests/perf/measure-memory-leak.cjs
 */
const { _electron } = require('@playwright/test')

function log(...args) {
  process.stdout.write(args.join(' ') + '\n')
}

async function main() {
  const app = await _electron.launch({
    // --js-flags=--expose-gc lets us force a GC pass in the renderer before
    // each heap snapshot, so we're comparing settled heap size, not
    // "whatever GC happened to have gotten to yet".
    args: ['out/main/main.cjs', '--no-sandbox', '--js-flags=--expose-gc'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => log(`  [pageerror] ${err.message}`))
  await win.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  await win.waitForTimeout(1000)

  await win.evaluate(async () => {
    const r = await window.api.file.import({ filePath: '/tmp/sai-stress-25k.csv' })
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
    window.__SAI_MEASURE_IMPORT_RESULT__ = r
  })
  await win.waitForTimeout(1500)
  log('dataset loaded (25K rows)')

  async function heapSnapshot() {
    return win.evaluate(
      () =>
        new Promise(resolve => {
          if (window.gc) window.gc()
          setTimeout(() => {
            if (window.gc) window.gc()
            resolve(performance.memory ? performance.memory.usedJSHeapSize : null)
          }, 200)
        })
    )
  }
  async function mainRss() {
    return app.evaluate(() => process.memoryUsage().rss)
  }

  const heapBefore = await heapSnapshot()
  const rssBefore = await mainRss()
  log(
    `baseline: renderer heap ${(heapBefore / 1024 / 1024).toFixed(1)}MB, main RSS ${(rssBefore / 1024 / 1024).toFixed(1)}MB`
  )

  // 50x open/close Preferences dialog
  log('opening/closing Preferences dialog 50x...')
  for (let i = 0; i < 50; i++) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('menu:preferences')
    })
    await win.waitForTimeout(60)
    await win.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('[aria-label]')).find(
        b => b.tagName === 'BUTTON' && /close|kapat/i.test(b.getAttribute('aria-label') || '')
      )
      if (btn) btn.click()
    })
    await win.waitForTimeout(60)
  }

  const heapAfterDialogs = await heapSnapshot()
  log(
    `after 50x dialog open/close: renderer heap ${(heapAfterDialogs / 1024 / 1024).toFixed(1)}MB (Δ ${((heapAfterDialogs - heapBefore) / 1024 / 1024).toFixed(1)}MB)`
  )

  // 20x Descriptives analysis
  log('running Descriptives 20x...')
  for (let i = 0; i < 20; i++) {
    await win.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = window.__SAI_MEASURE_IMPORT_RESULT__
          const vars = r.variables.filter(v => v.type === 'numeric').slice(0, 3)
          const timeout = setTimeout(() => reject(new Error('timed out')), 15000)
          let jobId
          const unsubComplete = window.api.on.jobComplete(payload => {
            if (payload.jobId !== jobId) return
            clearTimeout(timeout)
            unsubComplete()
            unsubError()
            resolve()
          })
          const unsubError = window.api.on.jobError(payload => {
            if (payload.jobId !== jobId) return
            clearTimeout(timeout)
            unsubComplete()
            unsubError()
            reject(new Error(payload.errorKey))
          })
          window.api.analysis
            .run({
              analysisId: 'descriptives',
              datasetId: r.dataset.id,
              scriptFile: 'descriptives.R',
              params: {
                variables: vars.map(v => v.colId),
                varNames: Object.fromEntries(vars.map(v => [v.colId, v.name])),
                options: { mean: true, sd: true, min: true, max: true }
              }
            })
            .then(({ jobId: id }) => {
              jobId = id
            })
            .catch(reject)
        })
    )
    // Clear the output store between runs so we're testing dialog/job churn,
    // not just accumulating result blocks (that growth would be real data,
    // not a leak — each block is user-visible content, not a strayed
    // reference).
    await win.evaluate(() => {
      window.__SAI_TEST__.useOutputStore.getState().clearAll?.()
    })
  }

  const heapAfterAnalyses = await heapSnapshot()
  const rssAfterAnalyses = await mainRss()
  log(
    `after 20x analysis: renderer heap ${(heapAfterAnalyses / 1024 / 1024).toFixed(1)}MB (Δ from baseline ${((heapAfterAnalyses - heapBefore) / 1024 / 1024).toFixed(1)}MB), main RSS ${(rssAfterAnalyses / 1024 / 1024).toFixed(1)}MB (Δ ${((rssAfterAnalyses - rssBefore) / 1024 / 1024).toFixed(1)}MB)`
  )

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()

  log('\n=== Summary ===')
  log(
    `Renderer heap: ${(heapBefore / 1024 / 1024).toFixed(1)}MB -> ${(heapAfterAnalyses / 1024 / 1024).toFixed(1)}MB`
  )
  log(
    `Main RSS:      ${(rssBefore / 1024 / 1024).toFixed(1)}MB -> ${(rssAfterAnalyses / 1024 / 1024).toFixed(1)}MB`
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
