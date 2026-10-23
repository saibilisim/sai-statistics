// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { BrowserWindow, ipcMain, shell } from 'electron'
import type { z } from 'zod'

/**
 * Registers an `ipcMain.handle` handler that is sender-checked and whose payload
 * is validated against a zod schema before the handler runs. This is the single
 * IPC trust boundary — handlers receive an already-validated, typed payload and
 * must not re-implement ad-hoc payload checks.
 */
export function handleValidated<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  handler: (payload: z.infer<S>, event: Electron.IpcMainInvokeEvent) => R | Promise<R>
): void {
  ipcMain.handle(channel, async (event, raw: unknown): Promise<R> => {
    validateSender(event)
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`Invalid IPC payload for "${channel}": ${parsed.error.message}`)
    }
    return handler(parsed.data, event)
  })
}

/**
 * Validates the sender of an IPC message.
 * Ensures the sender exists, and it is the main frame of a valid BrowserWindow.
 */
export function validateSender(event: Electron.IpcMainInvokeEvent): void {
  // `sender`/`senderFrame` are typed non-null, but Electron can hand back a
  // disposed/undefined frame at runtime (e.g. a navigated-away or destroyed
  // frame), so these guards are intentionally kept despite the static types.
  const webContents = event.sender as Electron.WebContents | undefined
  if (!webContents) {
    throw new Error('IPC Security Violation: No sender found')
  }

  // Ensure senderFrame exists and is the main frame (no child/iframes allowed to invoke main handlers)
  const senderFrame = event.senderFrame
  if (!senderFrame || senderFrame !== webContents.mainFrame) {
    throw new Error('IPC Security Violation: Invoked from an invalid frame')
  }

  const win = BrowserWindow.fromWebContents(webContents)
  if (!win) {
    throw new Error('IPC Security Violation: Sender window not found')
  }
}

/**
 * Opens a server-supplied URL (checkout, download page) in the system browser
 * only when it is a plain https URL — never file:, javascript:, custom schemes.
 */
export function openExternalHttps(url: string): boolean {
  try {
    if (new URL(url).protocol !== 'https:') return false
  } catch {
    return false
  }
  void shell.openExternal(url)
  return true
}
