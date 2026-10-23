// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Generates resources/legal/THIRD_PARTY_NOTICES.txt — the license texts of
 * every npm package compiled into the shipped bundles.
 *
 * Why: main/preload/renderer are minified (electron.vite.config.ts), which
 * strips the license comments the libraries carried, and most of them are no
 * longer shipped as node_modules either (bundle-only deps are devDependencies).
 * MIT/BSD/ISC still require the notice to travel with the binary, so it is
 * rebuilt here from the build's own hidden source maps: a package is listed
 * exactly when some of its code ended up in a bundle. Runs between
 * `electron-vite build` and `electron-builder` (package.json dist* scripts);
 * electron-builder ships it via extraResources → resources/legal/.
 *
 * Electron/Chromium (LICENSE.electron.txt, LICENSES.chromium.html) and the R
 * runtime (r-runtime/lib/R/COPYING) bring their own notices.
 */
const fs = require('node:fs')
const path = require('node:path')

const APP = path.join(__dirname, '..')
const OUT = path.join(APP, 'out')
const TARGET = path.join(APP, 'resources', 'legal', 'THIRD_PARTY_NOTICES.txt')
const LICENSE_RE = /^(licen[sc]e|copying|notice)(\.|-|$)/i

function mapFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return mapFiles(p)
    return e.name.endsWith('.map') ? [p] : []
  })
}

/** node_modules/<name> or node_modules/@scope/<name> directory of a source path. */
function packageDir(source) {
  const norm = source.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/node_modules/')
  if (idx === -1) return null
  const rest = norm.slice(idx + '/node_modules/'.length).split('/')
  const nameParts = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)
  return norm.slice(0, idx) + '/node_modules/' + nameParts.join('/')
}

const maps = mapFiles(OUT)
if (maps.length === 0) {
  console.error('[third-party-notices] no source maps under out/ — run electron-vite build first')
  process.exit(1)
}

const dirs = new Set()
for (const mapPath of maps) {
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
  const base = path.resolve(path.dirname(mapPath), map.sourceRoot ?? '')
  for (const src of map.sources ?? []) {
    const dir = packageDir(path.resolve(base, src))
    if (dir) dirs.add(dir)
  }
}

const packages = new Map()
for (const dir of dirs) {
  const pkgFile = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgFile)) continue
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (packages.has(key)) continue
  const licenseFile = fs.readdirSync(dir).find(n => LICENSE_RE.test(n))
  const license =
    typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see package')
  const text = licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim() : null
  packages.set(key, { name: pkg.name, version: pkg.version, license, text })
}

const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
const rule = '='.repeat(78)
const body = sorted
  .map(p =>
    [
      rule,
      `${p.name} ${p.version} — ${p.license}`,
      rule,
      p.text ?? `Licensed under ${p.license}. No license file was shipped with this package.`
    ].join('\n')
  )
  .join('\n\n')

const header = [
  'SAI Statistics — Third-Party Software Notices',
  '',
  'SAI Statistics includes the open-source components listed below. Each is',
  'distributed under its own license, reproduced here. Electron and Chromium',
  'notices are in LICENSE.electron.txt and LICENSES.chromium.html next to the',
  'application; the bundled R runtime is distributed under the GNU GPL',
  '(resources/r-runtime/lib/R/COPYING).',
  ''
].join('\n')

fs.mkdirSync(path.dirname(TARGET), { recursive: true })
fs.writeFileSync(TARGET, `${header}\n${body}\n`)
const missing = sorted.filter(p => !p.text).map(p => p.name)
console.log(
  `[third-party-notices] ${sorted.length} packages → ${path.relative(APP, TARGET)}` +
    (missing.length ? ` (no license file: ${missing.join(', ')})` : '')
)
