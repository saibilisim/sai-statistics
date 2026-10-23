// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * e2e-clipboard.cjs — clipboard access for e2e scripts, via Electron's
 * MAIN-process clipboard module.
 *
 * Two things this exists to get right:
 *
 * 1. NOT navigator.clipboard. The renderer's async Clipboard API requires
 *    document focus, which a window driven in the background on Windows never
 *    has. readText() there does not reject — it never settles, which hung
 *    e2e-output-navigator indefinitely. The main-process module reads the same
 *    OS clipboard with no focus requirement.
 *
 * 2. readWhenReady() polls instead of sleeping. The copy path is async, so a
 *    fixed waitForTimeout after the click is a guess: it held on an idle
 *    machine but lost when another Electron app was still shutting down
 *    alongside (two clipboard e2e scripts back to back failed, while each
 *    passed alone). Polling for a non-empty clipboard makes the tests
 *    independent of what ran before them.
 */

function makeClipboard(app, win) {
  const read = () => app.evaluate(({ clipboard }) => clipboard.readText())

  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const text = await read()
      if (predicate(text)) return text
      if (Date.now() >= deadline) return text // let the caller's assertion report it
      await win.waitForTimeout(100)
    }
  }

  return {
    read,
    /**
     * Clear, and confirm the clear actually landed before returning. The OS
     * clipboard is shared: when these scripts run back to back the previous
     * app is often still shutting down, and a clear that has not taken effect
     * yet leaves stale text behind — which readWhenReady would then accept as
     * "the copy arrived" and assert against the wrong content. Waiting for
     * empty is what makes these tests order-independent.
     */
    clear: async (timeoutMs = 5000) => {
      await app.evaluate(({ clipboard }) => {
        clipboard.clear()
      })
      return waitFor(t => !t || t.trim() === '', timeoutMs)
    },
    write: text => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text),
    /** Wait for the clipboard to hold something, then return it. */
    readWhenReady: (timeoutMs = 5000) => waitFor(t => Boolean(t) && t.trim() !== '', timeoutMs)
  }
}

module.exports = { makeClipboard }
