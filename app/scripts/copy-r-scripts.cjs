// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Post-build step: copy r-scripts/ into out/main/r-scripts.
 *
 * When the built (but un-packaged) app is launched as `electron out/main/main.cjs`
 * — e.g. by the e2e harness — Electron's app.getAppPath() resolves to out/main,
 * so analysis-handler looks for R scripts at out/main/r-scripts. `electron-vite
 * build` does not emit that folder, so we mirror it here.
 *
 * (Real `pnpm dev` uses app/r-scripts; the packaged app uses resources/r-scripts
 * via electron-builder `extraResources`. This step only covers the built-app run.)
 */
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'r-scripts')
const dest = path.join(__dirname, '..', 'out', 'main', 'r-scripts')

if (!fs.existsSync(src)) {
  console.error('[copy-r-scripts] source not found:', src)
  process.exit(1)
}

fs.rmSync(dest, { recursive: true, force: true })
fs.cpSync(src, dest, { recursive: true })
const count = fs.readdirSync(dest).filter(f => f.endsWith('.R')).length
console.log(`[copy-r-scripts] copied ${count} R scripts → out/main/r-scripts`)
