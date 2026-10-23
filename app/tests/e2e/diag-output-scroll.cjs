// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Diagnostic: injects a tall fake output block into the output store, switches
 * to the Output tab, and measures whether the .content scroll container is
 * actually scrollable (scrollHeight > clientHeight) and whether programmatic
 * scrolling works. Pure renderer — needs no R. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  const result = await win.evaluate(async () => {
    const T = window.__SAI_TEST__
    // Build a fake result with a very tall table (60 rows) so content overflows.
    const rows = []
    for (let i = 0; i < 60; i++) rows.push([`row ${i}`, i, i * 1.5, i * 2, i * 3])
    const result = {
      success: true,
      tables: [
        {
          titleKey: 'Diagnostic Tall Table',
          columns: ['A', 'B', 'C', 'D', 'E'],
          rows,
          footnoteKey: null
        }
      ],
      plots: [],
      warnings: [],
      notes: []
    }
    T.useOutputStore.getState().addBlock({
      id: 'diag-1',
      analysisId: 'frequencies',
      titleKey: 'Diagnostic',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result
    })
    T.useUIStore.getState().setActiveTab('output')
    await new Promise(r => setTimeout(r, 400))

    const content = document.querySelector('[class*="content"]')
    // find the actual scroll container: the OutputView content div
    const candidates = Array.from(document.querySelectorAll('div')).filter(d => {
      const cs = getComputedStyle(d)
      return cs.overflowY === 'auto' || cs.overflowY === 'scroll'
    })
    const info = candidates.map(d => ({
      cls: d.className,
      sh: d.scrollHeight,
      ch: d.clientHeight,
      scrollable: d.scrollHeight > d.clientHeight + 2
    }))

    // Try to scroll the OutputView content to bottom
    let scrolled = null
    const oc = candidates.find(d => /content/i.test(d.className))
    if (oc) {
      oc.scrollTop = 99999
      await new Promise(r => setTimeout(r, 100))
      scrolled = { after: oc.scrollTop, max: oc.scrollHeight - oc.clientHeight }
    }

    return {
      contentFound: Boolean(content),
      overflowContainers: info,
      scrolled,
      appContentRect: (() => {
        const ac = document.querySelector('[class*="app-content"], .app-content')
        return ac ? { h: ac.clientHeight, w: ac.clientWidth } : null
      })(),
      windowInner: { h: window.innerHeight, w: window.innerWidth }
    }
  })

  console.log(JSON.stringify(result, null, 2))
  await win.screenshot({ path: __dirname + '/../../diag-output-scroll.png' })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
