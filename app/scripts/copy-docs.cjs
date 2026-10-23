// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Post-build step: copy resources/docs/ into out/main/docs.
 *
 * Same three-mode split as copy-r-scripts.cjs: when the built (but
 * un-packaged) app is launched as `electron out/main/main.cjs` — e.g. by the
 * e2e harness — Electron's app.getAppPath() resolves to out/main, so
 * menu-builder looks for docs at out/main/docs first. `electron-vite build`
 * does not emit that folder, so we mirror it here. (Real `pnpm dev` finds
 * resources/docs directly since app.getAppPath() there is the app/ project
 * root; the packaged app uses resources/docs via electron-builder
 * extraResources. menu-builder's getDocsDir() tries both locations.)
 */
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'resources', 'docs')
const dest = path.join(__dirname, '..', 'out', 'main', 'docs')

if (!fs.existsSync(src)) {
  console.error('[copy-docs] source not found:', src)
  process.exit(1)
}

fs.rmSync(dest, { recursive: true, force: true })
fs.cpSync(src, dest, { recursive: true })
console.log('[copy-docs] copied resources/docs → out/main/docs')
