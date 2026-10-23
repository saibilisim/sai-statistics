// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Verifies the R console debugger (Faz T3 P2) end to end:
 *  - browser() really stops: status 'debug', the debugger bar appears, the
 *    Environment pane lists the browsed frame (its call + variables);
 *  - expressions typed at the Browse prompt are evaluated in that frame
 *    (single and multi-line), an error there keeps the debugger;
 *  - Next (button + F10) steps, Step into enters a called function,
 *    Continue runs to the end and the pane returns to the global env;
 *  - debugonce() works; Stop (Shift+F8) and a typed Q both leave the
 *    debugger WITHOUT ending R, and the rest of the block is not run;
 *  - R's own echo of browser input is not duplicated in the console.
 * Also covers the new session start (`Rscript -`): the bridged `data` exists.
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
        level: s.rDebugLevel,
        frame: s.rFrame,
        env: s.rEnv.map(e => e.name),
        out: s.rOutput.map(c => c.text).join(''),
        // R's own output only (not the echoed input).
        rout: s.rOutput
          .filter(c => c.stream === 'stdout')
          .map(c => c.text)
          .join('')
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
      await win.waitForTimeout(200)
    }
  }
  const idle = (ms = 20000) => waitFor(s => s.status === 'idle', ms, 'idle')
  const paused = (ms = 15000) => waitFor(s => s.status === 'debug', ms, 'debug')
  const consoleText = () => win.$eval('[class*="rConsole"]', el => el.textContent || '')
  const input = win.locator('[class*="rInputArea"]')
  const type = async code => {
    await input.click()
    await input.fill(code)
    await input.press('Control+Enter')
  }
  const write = code => win.evaluate(c => window.api.terminal.rWrite({ code: c }), code)
  const bar = win.locator('[class*="debugBar"]')
  const barBtn = name => bar.locator('button', { hasText: name })

  check((await idle(40000)).status === 'idle', 'R session ready (started as Rscript -)')
  await write('cat("rows:", nrow(data), "\\n")')
  await idle()
  check(/rows: 150/.test((await term()).out), 'bridged dataset `data` is there (150 rows)')

  // ── browser() ──────────────────────────────────────────────────────────
  await write(
    'f <- function() {\n  x <- 41\n  browser()\n  y <- x + 1\n  z <- h(y)\n  cat("z=", z, "\\n")\n  z\n}\nh <- function(v) {\n  w <- v * 2\n  w\n}'
  )
  await idle()
  await type('f()')
  let st = await paused()
  if (st.status !== 'debug') console.log(`  console tail: ${JSON.stringify(st.out.slice(-600))}`)
  check(
    st.status === 'debug' && st.level === 1,
    `browser() pauses (status=${st.status}, level=${st.level})`
  )
  check(await bar.isVisible(), 'debugger bar is shown')
  st = await waitFor(s => s.frame !== null, 5000, 'frame')
  check(
    st.frame === 'f()' && st.env.includes('x'),
    `Environment shows the frame f() with x (${st.frame}; ${st.env})`
  )
  await win.screenshot({ path: path.join(appDir, 'tmp', 'term-rdebug.png') })

  await type('x')
  st = await paused()
  check(/\[1\] 41/.test(st.out), 'an expression at Browse is evaluated in the frame ([1] 41)')
  const txt = await consoleText()
  check(
    (txt.match(/Browse\[1\]> x/g) || []).length === 1,
    'the typed line is echoed once (R echo dropped)'
  )

  await type('{\n  x * 2\n}')
  st = await paused()
  check(/\[1\] 82/.test(st.out), 'a multi-line expression at Browse works ([1] 82)')

  await type('stop("boom")')
  st = await paused()
  check(st.status === 'debug' && /boom/.test(st.out), 'an error at Browse keeps the debugger')

  await barBtn(/^(Next line|Sonraki satır)$/).click()
  st = await paused()
  check(/debug.*y <- x \+ 1/.test(st.out), 'Next steps to the next statement')
  await win.keyboard.press('F10')
  st = await waitFor(s => s.status === 'debug' && s.env.includes('y'), 8000, 'F10')
  check(
    /z <- h\(y\)/.test(st.out) && st.env.includes('y'),
    'F10 steps again; y appears in the frame'
  )

  // Step into h()
  await win.keyboard.press('Shift+F4')
  st = await waitFor(
    s => s.status === 'debug' && s.frame && s.frame.startsWith('h('),
    8000,
    'step into'
  )
  check(st.frame && st.frame.startsWith('h('), `Step into enters h() (frame ${st.frame})`)

  // Continue leaves h(); f() was being stepped, so R pauses there again
  // (R's own semantics, RStudio too) — continue until the call finishes.
  for (let i = 0; i < 3 && (await term()).status !== 'idle'; i++) {
    await win.keyboard.press('Shift+F5')
    await win.waitForTimeout(300)
    await waitFor(s => s.status === 'debug' || s.status === 'idle', 8000, 'continue')
  }
  st = await idle()
  check(st.status === 'idle' && /z= 84/.test(st.out), 'Continue runs to the end (z= 84)')
  check(st.frame === null && st.env.includes('f'), 'Environment is back to the global env')
  check(!(await bar.isVisible()), 'debugger bar is gone')

  // ── debugonce + Stop ───────────────────────────────────────────────────
  await type('g <- function(a) {\n  b <- a + 1\n  b * 3\n}')
  await idle()
  await type('debugonce(g); g(2); cat("NOTRUN\\n")')
  st = await paused()
  check(st.status === 'debug' && st.frame === 'g(2)', `debugonce() pauses in g(2) (${st.frame})`)
  await win.keyboard.press('Shift+F8')
  st = await idle()
  const after = await consoleText()
  check(st.status === 'idle', 'Stop leaves the debugger (session idle, not dead)')
  check(!/NOTRUN/.test(st.rout), 'the rest of the block is not run after Stop')
  check(/stopped|durduruldu/i.test(after), 'a "debugging stopped" notice is shown')

  // A typed Q must not end R either.
  await type('debugonce(g); g(5)')
  await paused()
  await type('Q')
  st = await idle()
  await type('1 + 1')
  st = await idle()
  check(
    st.status === 'idle' && /\[1\] 2/.test(st.out),
    'typing Q leaves the debugger; R is still alive'
  )

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
