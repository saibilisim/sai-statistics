// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Converts a captured key combo into an Electron accelerator string (the
 * same format menu-builder.ts's SHORTCUT_DEFS defaults use, e.g.
 * 'CmdOrCtrl+Shift+E'). Used by the Preferences ▸ Keyboard Shortcuts
 * "click to record" input.
 *
 * Returns null while the combo isn't finalized yet: a bare modifier key
 * (still being held) or a plain unmodified letter/digit — the latter is
 * refused on purpose, since binding e.g. plain "N" as a global accelerator
 * would swallow that keystroke everywhere in the app, including while typing
 * in a text field.
 */
export function acceleratorFromKeyboardEvent(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string | null {
  const { key } = e
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return null

  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey
  if (!hasModifier && !isFunctionKey) return null

  const specialKeys: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ' ': 'Space',
    ',': 'Comma',
    '.': 'Period',
    '+': 'Plus',
    '-': 'Minus'
  }

  const keyPart = isFunctionKey
    ? key
    : (specialKeys[key] ?? (key.length === 1 ? key.toUpperCase() : key))

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(keyPart)

  return parts.join('+')
}

/**
 * Display-only formatting for an Electron accelerator string. 'CmdOrCtrl' is
 * Electron's internal registration keyword (what menu-builder.ts actually
 * sends to `Menu.buildFromTemplate`) — it was never meant to be shown to the
 * user, so the Keyboard Shortcuts panel renders the platform-native word
 * instead: 'Cmd' on a packaged macOS build (`process.platform === 'darwin'`
 * at runtime — no build-time branching needed, the same code renders
 * correctly on whichever OS the app is actually running on), 'Ctrl' on
 * Windows/Linux. The stored/registered value itself stays 'CmdOrCtrl+...'
 * either way.
 */
export function formatAcceleratorForDisplay(accelerator: string, platform: string): string {
  if (!accelerator) return accelerator
  const isMac = platform === 'darwin'
  const words: Record<string, string> = isMac
    ? { CmdOrCtrl: 'Cmd', Alt: 'Option', Shift: 'Shift' }
    : { CmdOrCtrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }

  return accelerator
    .split('+')
    .map(part => words[part] ?? part)
    .join('+')
}
