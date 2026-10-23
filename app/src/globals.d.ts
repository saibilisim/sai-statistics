// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
// Re-export the window.api type from preload so src/ can see it.
// The actual bridge is set up in electron/preload.ts.
import type { api } from '../electron/preload'

declare global {
  interface Window {
    api: typeof api
  }
  // Injected at build time by electron.vite.config.ts (renderer.define).
  const __APP_VERSION__: string
}
