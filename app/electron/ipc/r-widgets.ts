// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-widgets.ts — serves htmlwidgets (plotly, DT, leaflet …) printed in the R
 * console to the renderer's Viewer tabs (Faz T3).
 *
 * R writes each widget as index.html + lib/ into the session's side directory
 * (_r_console.R print.htmlwidget). They are served under a private scheme,
 * `sai-widget://<id>/…`, and shown in an <iframe sandbox="allow-scripts">: an
 * opaque origin with no access to the app page, preload API or IPC.
 *
 * The app's own CSP stays as strict as before (CLAUDE.md §9) — only
 * `frame-src sai-widget:` is added. Widget documents get their own CSP: their
 * scripts may run (inline + eval: htmlwidgets' bindings need both), but they
 * load nothing from the network except images (map tiles) and cannot connect
 * anywhere.
 */
import { protocol } from 'electron'
import { readFile } from 'fs/promises'
import { resolve, sep, extname } from 'path'
import log from 'electron-log'

export const WIDGET_SCHEME = 'sai-widget'

export const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json'
}

/** widget id → the folder holding its index.html + lib/. */
const widgets = new Map<string, string>()

/** Must run before app 'ready' (Electron requirement for privileged schemes). */
export function registerWidgetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // standard: relative URLs (lib/…) resolve; no fetch/CORS/service-worker privileges.
    { scheme: WIDGET_SCHEME, privileges: { standard: true } }
  ])
}

export function addWidget(id: string, dir: string): string {
  widgets.set(id, resolve(dir))
  return `${WIDGET_SCHEME}://${id}/index.html`
}

/** The session's side dir is going away (restart / quit). */
export function clearWidgets(): void {
  widgets.clear()
}

/** After app 'ready'. Serves only files inside a registered widget folder. */
export function registerWidgetProtocol(): void {
  protocol.handle(WIDGET_SCHEME, async request => {
    try {
      const url = new URL(request.url)
      const root = widgets.get(url.hostname)
      if (!root) return new Response('Not found', { status: 404 })
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = resolve(root, rel === '' ? 'index.html' : rel)
      // Path traversal guard: stay inside this widget's folder.
      if (file !== root && !file.startsWith(root + sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      const body = await readFile(file)
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Security-Policy': WIDGET_CSP,
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch (err) {
      log.warn(`[r-widgets] ${request.url}: ${String(err)}`)
      return new Response('Not found', { status: 404 })
    }
  })
}
