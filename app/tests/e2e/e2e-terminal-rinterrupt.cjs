// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Stop interrupts the running R command and KEEPS the session (2026-10-21).
 *
 * On Windows Stop used to restart R — every object in the session was lost.
 * Now a real Ctrl+C is raised in R's console (electron/ipc/win-console-
 * interrupt.ts); on Linux/macOS it is SIGINT, as before.
 *
 *   loop    — a busy R loop is stopped from the Stop button; R prints
 *             "Interrupted.", returns to idle, and `keep` (defined before)
 *             is still there; the IPC reports no restart.
 *   sleep   — Sys.sleep(60) is stopped the same way, well before 60 s.
 *   queue   — commands queued behind the stopped one do not run.
 *   again   — the session still runs commands afterwards.
 *
 * Usage: node tests/e2e/run-e2e.cjs rinterrupt   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const path = require('path')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(800)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('r')
  })

  const term = () =>
    win.evaluate(() => {
      const s = window.__SAI_TEST__.useTerminalStore.getState()
      return { status: s.rStatus, out: s.rOutput.map(c => c.text).join('') }
    })
  const waitStatus = async (want, ms) => {
    const end = Date.now() + ms
    for (;;) {
      const st = await term()
      if (st.status === want) return true
      if (Date.now() > end) return false
      await win.waitForTimeout(150)
    }
  }
  const write = code => win.evaluate(c => window.api.terminal.rWrite({ code: c }), code)
  // Stop through the real button, timing until R is back at its prompt.
  const stopFromButton = async () => {
    const t0 = Date.now()
    await win.locator('button[data-r-stop]').click()
    const idle = await waitStatus('idle', 15000)
    return { idle, ms: Date.now() - t0 }
  }

  const checks = {}
  checks.ready = await waitStatus('idle', 40000)

  await write('keep <- 42')
  await waitStatus('idle', 10000)

  // ── loop ──
  await write('i <- 0; while (TRUE) i <- i + 1')
  await waitStatus('busy', 5000)
  await win.waitForTimeout(1500)
  let r = await stopFromButton()
  let st = await term()
  checks.loopStopped = r.idle && /Interrupted\./.test(st.out)
  await write('cat("KEEP=", keep, " I_POSITIVE=", i > 0, "\\n", sep = "")')
  await waitStatus('idle', 10000)
  st = await term()
  checks.sessionKept = /KEEP=42 I_POSITIVE=TRUE/.test(st.out)
  console.log('loop stop ms:', r.ms)

  // ── sleep + queue ──
  await write('Sys.sleep(60)')
  await write('queued_ran <- TRUE')
  await waitStatus('busy', 5000)
  await win.waitForTimeout(1000)
  r = await stopFromButton()
  checks.sleepStopped = r.idle && r.ms < 20000
  console.log('sleep stop ms:', r.ms)
  await write('cat("QUEUED=", exists("queued_ran"), "\\n", sep = "")')
  await waitStatus('idle', 10000)
  st = await term()
  checks.queueDropped = /QUEUED=FALSE/.test(st.out)

  // ── IPC result: no restart, and no restart notice was printed ──
  await write('Sys.sleep(60)')
  await waitStatus('busy', 5000)
  await win.waitForTimeout(800)
  const res = await win.evaluate(() => window.api.terminal.rInterrupt({}))
  await waitStatus('idle', 15000)
  checks.noRestart = res && res.restarted === false
  st = await term()
  checks.noRestartNotice = !/terminal\.r\.notice\.winInterrupt/.test(st.out)

  await write('cat("AGAIN=", 1 + 1, "\\n", sep = "")')
  await waitStatus('idle', 10000)
  st = await term()
  checks.again = /AGAIN=2/.test(st.out)

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()

  console.log('checks:', JSON.stringify(checks))
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length) {
    console.log('FAILED:', failed.map(([k]) => k).join(', '))
    process.exit(1)
  }
  console.log('ALL PASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
