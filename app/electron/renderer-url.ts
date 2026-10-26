// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app } from 'electron'
import { join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

/**
 * The one URL the main window is allowed to be on. Navigation and IPC senders
 * are pinned to it so a dropped/linked foreign file:// page never inherits the
 * preload's `window.api`.
 */
export function getRendererUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) return devUrl
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

export function stripQueryAndHash(url: string): string {
  return url.split(/[?#]/)[0] ?? url
}

function canonical(url: string): string {
  const bare = stripQueryAndHash(url)
  if (bare.startsWith('file:')) {
    try {
      // Decoded filesystem path: tolerant of %-encoding / drive-letter casing
      // differences between loadFile() and pathToFileURL().
      const p = fileURLToPath(bare)
      return process.platform === 'win32' ? p.toLowerCase() : p
    } catch {
      return bare
    }
  }
  return bare.replace(/\/$/, '')
}

/** True when `url` is the app's own renderer page (query/hash ignored). */
export function isRendererUrl(url: string): boolean {
  return canonical(url) === canonical(getRendererUrl())
}
