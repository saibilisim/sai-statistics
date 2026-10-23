// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies htmlwidgets from the R console (Faz T3 P1 — Viewer):
 *  - print(<htmlwidget>) opens a Viewer tab in the editor area;
 *  - the widget really renders inside the sandboxed iframe (DT table rows);
 *  - isolation: the frame has no window.api, cannot touch the app page
 *    (opaque origin) and cannot reach the network (widget CSP);
 *  - closing the tab removes it.
 * DT (+ htmlwidgets) is installed through the Packages pane's installer into
 * a reusable throwaway library (tmp/e2e-rlib-widgets via SAI_R_USER_LIBRARY),
 * so only the first run needs internet and time.
 */
const path = require('path')
const fs = require('fs')
const { _electron } = require('@playwright/test')

const results = []
function check(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

async function main() {
  const appDir = path.join(__dirname, '..', '..')
  const userLib = path.join(appDir, 'tmp', 'e2e-rlib-widgets')
  fs.mkdirSync(userLib, { recursive: true })
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: appDir,
    env: { ...process.env, SAI_R_USER_LIBRARY: userLib }
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  })
  const term = () =>
    win.evaluate(() => {
      const s = window.__SAI_TEST__.useTerminalStore.getState()
      return { status: s.rStatus, widgets: s.rWidgets }
    })
  const until = async (fn, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const v = await fn()
      if (v || Date.now() > end) return v
      await win.waitForTimeout(250)
    }
  }
  check(await until(async () => (await term()).status === 'idle', 40000), 'R session ready')

  const inst = await win.evaluate(() => window.api.terminal.rPkgInstall({ name: 'DT' }))
  check(inst.success, `DT available in the user library (${inst.detail || 'ok'})`)
  await until(async () => (await term()).status === 'idle', 20000)

  await win.evaluate(() => window.api.terminal.rWrite({ code: 'DT::datatable(head(iris, 3))' }))
  const st = await until(async () => {
    const s = await term()
    return s.widgets.length > 0 ? s : null
  }, 30000)
  const w = st && st.widgets[0]
  check(w && w.url.startsWith('sai-widget://'), `Viewer tab opened (${w && w.url})`)

  // The widget's own document, inside the sandboxed iframe.
  const frameEl = win.locator('iframe[class*="widgetFrame"]')
  check(
    (await frameEl.getAttribute('sandbox')) === 'allow-scripts',
    'iframe sandbox = allow-scripts only'
  )
  const frame = await until(
    async () => win.frames().find(f => f.url().startsWith('sai-widget://')),
    10000
  )
  let rows = 0
  if (frame) {
    await frame.waitForSelector('table tbody tr', { timeout: 20000 }).catch(() => undefined)
    rows = await frame.$$eval('table tbody tr', trs => trs.length).catch(() => 0)
  }
  check(rows === 3, `DT renders the table inside the frame (${rows} rows)`)
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rwidget.png') })

  if (frame) {
    const iso = await frame.evaluate(async () => {
      let parentDoc = 'blocked'
      try {
        if (window.parent.document) parentDoc = 'reachable'
      } catch {
        parentDoc = 'blocked'
      }
      let net = 'blocked'
      try {
        await fetch('https://example.com/')
        net = 'reachable'
      } catch {
        net = 'blocked'
      }
      return { api: typeof window.api, parentDoc, net }
    })
    check(iso.api === 'undefined', 'no preload API inside the widget frame')
    check(iso.parentDoc === 'blocked', 'widget cannot touch the app page')
    check(iso.net === 'blocked', 'widget cannot reach the network (CSP)')
  }

  await win.locator('[class*="editorTabClose"]').last().click()
  check((await term()).widgets.length === 0, 'closing the Viewer tab removes it')

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
