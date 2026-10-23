// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dialog Recall (SPSS-style): lets the Ribbon's "recent analyses" dropdown
 * reopen a dialog through the exact same code path a real native-menu click
 * uses (App.tsx's big `menu:*` switch), without a fake IPC round trip and
 * without prop-drilling the callback through <Ribbon/> (which today takes no
 * props at all, reading everything from stores instead — this follows that
 * same convention rather than introducing the app's first top-down prop).
 *
 * App.tsx sets this once via `setMenuDispatch` right after it defines
 * `dispatchMenuCommand`; nothing needs it before the app has mounted.
 */
let dispatchMenuCommand: ((channel: string, ...args: unknown[]) => void) | null = null

export function setMenuDispatch(fn: (channel: string, ...args: unknown[]) => void): void {
  dispatchMenuCommand = fn
}

/** No-ops (with a console warning) if called before App.tsx has mounted. */
export function dispatchMenu(channel: string, ...args: unknown[]): void {
  if (!dispatchMenuCommand) {
    console.warn('dispatchMenu called before App mounted:', channel)
    return
  }
  dispatchMenuCommand(channel, ...args)
}
