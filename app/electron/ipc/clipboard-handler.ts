// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * clipboard-handler.ts — reads the OS clipboard's `text/html` flavor for
 * DataView's paste (color/font transfer from Excel/Sheets/LibreOffice, see
 * src/lib/html-clipboard.ts).
 *
 * Deliberately Electron's native `clipboard.readHTML()` (main process), not
 * the renderer's `navigator.clipboard.read()` Async Clipboard API: Chromium/
 * Electron's implementation of that API does not reliably report `text/html`
 * among a clipboard entry's available types even when the OS clipboard
 * genuinely holds it (a known Electron limitation, not a permission issue —
 * no `session.setPermissionRequestHandler` is even installed in this app, so
 * there is nothing to grant/deny here). `clipboard.readHTML()` talks to the
 * OS clipboard directly and has none of that gap.
 */
import { clipboard, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contracts'
import { validateSender } from './security'

export function registerClipboardHandlers(): void {
  // No payload — reads whatever is currently on the OS clipboard. Returns
  // '' (never throws) when there is no HTML flavor, same as a cache-miss.
  ipcMain.handle(IPC.CLIPBOARD_READ_HTML, (event): string => {
    validateSender(event)
    return clipboard.readHTML()
  })
}
