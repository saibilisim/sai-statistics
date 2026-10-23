// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: keyboard navigation for the analysis dialog shells (faz8-kalite-
 * roadmap.md K1 — useDialogKeyboard hook shared by DialogBase and
 * AnalysisDialogShell). Opens the real Frequencies dialog (AnalysisDialogShell)
 * via the actual menu IPC channel (not a store injection — the hook only
 * mounts against a real DOM container), then asserts:
 *  - focus starts inside the dialog on open
 *  - Tab from the last focusable element wraps to the first (focus trap)
 *  - Shift+Tab from the first element wraps to the last
 *  - Escape closes the dialog (calls onCancel) and does not require Cancel click
 *  - focus returns to the element that had it before the dialog opened
 */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => {
    console.log('[pageerror]', err.message)
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // Load a dataset so Frequencies has variables to list.
  await win.evaluate(async () => {
    const result = await window.api.file.import({ filePath: '/tmp/sai-test.csv' })
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
  })
  await win.waitForTimeout(1000)

  // A real, focusable trigger element — establishes "what had focus before
  // the dialog opened" so the focus-restore assertion means something.
  await win.evaluate(() => {
    const btn = document.createElement('button')
    btn.id = 'e2e-kbnav-trigger'
    btn.textContent = 'trigger'
    document.body.appendChild(btn)
    btn.focus()
  })

  // Open the real Frequencies dialog through the same IPC path the native
  // menu uses (App.tsx's window.api.on.menuCommand listener), not a store
  // shortcut — the keyboard hook only matters against the real DOM.
  await app.evaluate(({ BrowserWindow }) => {
    const [win] = BrowserWindow.getAllWindows()
    win.webContents.send('menu:analyze:frequencies')
  })
  await win.waitForTimeout(800)

  const opened = await win.evaluate(() => !!document.querySelector('[role="dialog"][aria-modal]'))
  console.log('dialog opened:', opened)

  const focusInsideOnOpen = await win.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal]')
    return !!dialog && dialog.contains(document.activeElement)
  })

  // Shift+Tab from the first focusable element should wrap to the last.
  await win.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal]')
    const focusables = Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null)
    focusables[0].focus()
  })
  await win.keyboard.press('Shift+Tab')
  await win.waitForTimeout(150)
  const wrappedToLast = await win.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal]')
    const focusables = Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null)
    return document.activeElement === focusables[focusables.length - 1]
  })

  // Tab from the last focusable element should wrap to the first.
  await win.keyboard.press('Tab')
  await win.waitForTimeout(150)
  const wrappedToFirst = await win.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal]')
    const focusables = Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null)
    return document.activeElement === focusables[0]
  })

  // Escape closes the dialog outright (no Cancel click needed).
  await win.keyboard.press('Escape')
  await win.waitForTimeout(500)
  const closedByEscape = await win.evaluate(
    () => !document.querySelector('[role="dialog"][aria-modal]')
  )

  const focusRestored = await win.evaluate(
    () => document.activeElement && document.activeElement.id === 'e2e-kbnav-trigger'
  )

  const info = {
    opened,
    focusInsideOnOpen,
    wrappedToLast,
    wrappedToFirst,
    closedByEscape,
    focusRestored
  }
  console.log(JSON.stringify(info, null, 2))

  const pass =
    opened &&
    focusInsideOnOpen &&
    wrappedToLast &&
    wrappedToFirst &&
    closedByEscape &&
    focusRestored

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
