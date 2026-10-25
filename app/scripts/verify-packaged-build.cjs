// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * verify-packaged-build.cjs — check that the thing electron-builder just
 * produced is actually shippable.
 *
 * Everything else in this repo tests the SOURCE. This tests the ARTIFACT, and
 * that gap is exactly how a runtime missing R's recommended package set
 * shipped: `pnpm build` was green, the R suite was green (it uses a system R),
 * and the packaged app had Survival, Bootstrap, Discriminant, KNN and Trees
 * quietly broken. Nothing looked at the output folder.
 *
 * Checks, in order of how early they fail:
 *   1. The unpacked app directory exists.
 *   2. The vendored R runtime landed in it (electron-builder's extraResources
 *      copy is a separate step from the vendor script and has broken on its
 *      own before, on the .deb/rpm side).
 *   3. That runtime's OWN Rscript can load every package in
 *      shared/r-packages.json's bundled list — run from the packaged tree, not
 *      the source tree, so a bad copy or a relocation problem shows up here.
 *   4. The packaged Electron binary boots and its log says it is using the
 *      bundled R from inside the package — not a system R, not none
 *      (optional, --with-app; needs a display on Linux).
 *
 * Usage:
 *   node scripts/verify-packaged-build.cjs [--dist <dir>] [--with-app]
 *
 * Exits non-zero with a specific message on the first failed check.
 */
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appDir = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const withApp = argv.includes('--with-app')
const distArg = argv.indexOf('--dist')
const distDir = distArg >= 0 ? argv[distArg + 1] : path.join(appDir, 'dist')

const fail = msg => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}
const ok = msg => console.log(`✓ ${msg}`)

// ── 1. Unpacked app directory ───────────────────────────────────────────────
const UNPACKED = ['win-unpacked', 'linux-unpacked', 'mac', 'mac-arm64']
const unpacked = UNPACKED.map(d => path.join(distDir, d)).find(fs.existsSync)
if (!unpacked) {
  fail(
    `no unpacked app under ${distDir} (looked for ${UNPACKED.join(', ')}). ` +
      'Run electron-builder first.'
  )
}
ok(`unpacked app: ${path.relative(appDir, unpacked)}`)

// ── 2. Vendored R runtime present ───────────────────────────────────────────
// macOS buries Resources inside the .app; the others keep it at the top level.
const resourceRoots = [
  path.join(unpacked, 'resources'),
  ...(fs.existsSync(unpacked)
    ? fs
        .readdirSync(unpacked)
        .filter(f => f.endsWith('.app'))
        .map(f => path.join(unpacked, f, 'Contents', 'Resources'))
    : [])
]
const resources = resourceRoots.find(r => fs.existsSync(path.join(r, 'r-runtime')))
if (!resources) {
  fail(
    'the bundled R runtime is NOT in the package (resources/r-runtime missing).\n' +
      "  The app will fall back to the user's own R — which is the whole thing the\n" +
      '  vendored runtime exists to avoid. Did the vendor step run before packaging?'
  )
}
const rRoot = path.join(resources, 'r-runtime')
ok(`bundled R runtime present: ${path.relative(unpacked, rRoot)}`)

// ── 3. That runtime can load every bundled package ──────────────────────────
// Same candidate order as r-bridge.ts's detectBundledR().
const rscript = [
  path.join(rRoot, 'bin', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'),
  path.join(rRoot, 'lib', 'R', 'bin', 'x64', 'Rscript.exe')
].find(fs.existsSync)
if (!rscript) fail(`no Rscript inside ${rRoot} — the runtime copy is incomplete`)

const manifest = require(path.join(appDir, 'shared', 'r-packages.json'))
const bundled = manifest.bundled.map(p => p.r)
const rExpr =
  `for (p in c(${bundled.map(p => `'${p}'`).join(',')})) ` +
  `library(p, character.only=TRUE); cat('SAI_PKG_OK')`

// Windows has no RPATH: Rscript.exe finds its DLLs via PATH, exactly as
// r-bridge.ts's withBundledRPath() arranges at spawn time.
const env = { ...process.env }
if (process.platform === 'win32') {
  env.PATH = [rRoot, path.join(rRoot, 'Library', 'bin'), path.dirname(rscript), env.PATH].join(
    path.delimiter
  )
}
const res = spawnSync(rscript, ['--no-save', '--no-restore', '-e', rExpr], {
  env,
  encoding: 'utf-8'
})
const out = `${res.stdout || ''}${res.stderr || ''}`
if (!out.includes('SAI_PKG_OK')) {
  fail(
    `the packaged R cannot load all ${bundled.length} bundled packages.\n` +
      `  Expected: ${bundled.join(', ')}\n  Output: ${out.trim().slice(0, 800)}`
  )
}
ok(`packaged R loads all ${bundled.length} bundled packages`)

// ── 4. The packaged app boots and finds that runtime ────────────────────────
if (!withApp) {
  console.log('\nPackage verified. (Pass --with-app to also boot the packaged binary.)')
  process.exit(0)
}

// macOS: the binary is <name>.app/Contents/MacOS/<name>, not a top-level file.
const macApp = fs.readdirSync(unpacked).find(f => f.endsWith('.app'))
const exeDir = macApp ? path.join(unpacked, macApp, 'Contents', 'MacOS') : unpacked
const exeCandidates = fs
  .readdirSync(exeDir)
  .filter(f => f.endsWith('.exe') || f.endsWith('.AppImage') || !path.extname(f))
  // Electron's helpers sit next to the Linux binary and sort before it.
  .filter(f => !f.startsWith('chrome'))
  .map(f => path.join(exeDir, f))
  .filter(f => fs.statSync(f).isFile())
const exe = exeCandidates[0]
if (!exe) fail(`no executable found in ${unpacked}`)

// A packaged build logs to its file only (main.ts turns the console transport
// off), so read r-bridge's startup line from that file. A fresh
// --user-data-dir keeps an earlier run's log, settings and single-instance
// lock out of it; Windows/Linux keep logs under it, macOS in ~/Library/Logs.
const userData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sai-verify-'))
const logFiles = [path.join(userData, 'logs', 'main.log')]
if (process.platform === 'darwin') {
  for (const name of ['SAI Statistics', 'sai-statistics']) {
    logFiles.push(path.join(require('os').homedir(), 'Library', 'Logs', name, 'main.log'))
  }
}
// Only what this run appends counts.
const startSize = new Map(logFiles.map(f => [f, fs.existsSync(f) ? fs.statSync(f).size : 0]))
const readNewLog = () =>
  logFiles
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f).subarray(startSize.get(f)).toString('utf-8'))
    .join('\n')

const child = spawn(exe, ['--no-sandbox', `--user-data-dir=${userData}`], { stdio: 'ignore' })
const BOOT_TIMEOUT_MS = 90000
const started = Date.now()
const timer = setInterval(() => {
  const logText = readNewLog()
  const bundledLine = /\[r-bridge\] Found bundled R: (.+) \(/.exec(logText)
  let verdict = null
  if (bundledLine) {
    // The path must lie inside this package, not some other copy of the app.
    const real = p => (fs.existsSync(p) ? fs.realpathSync(p) : p)
    const rel = path.relative(real(unpacked), real(bundledLine[1].trim()))
    verdict =
      rel && !rel.startsWith('..') && !path.isAbsolute(rel)
        ? () => ok(`packaged app boots and uses its bundled R: ${rel}`)
        : () => fail(`the packaged app found an R outside the package: ${bundledLine[1]}`)
  } else if (/\[r-bridge\] Found system R/.test(logText)) {
    // The fallback a user without the bundled runtime gets — on a runner that
    // happens to have R installed it would otherwise look like a pass.
    verdict = () =>
      fail(
        'the packaged app fell back to a SYSTEM R — its bundled runtime was not found:\n' +
          logText.slice(-800)
      )
  } else if (/Rscript not found/.test(logText)) {
    verdict = () => fail('the packaged app booted but found no R at all:\n' + logText.slice(-800))
  } else if (child.exitCode !== null) {
    verdict = () =>
      fail(
        `the packaged app exited (code ${child.exitCode}) before detecting R:\n` +
          logText.slice(-800)
      )
  } else if (Date.now() - started > BOOT_TIMEOUT_MS) {
    verdict = () =>
      fail(
        `no R detection line in the app log after ${BOOT_TIMEOUT_MS / 1000}s:\n` +
          logText.slice(-800)
      )
  }
  if (!verdict) return
  clearInterval(timer)
  child.kill()
  verdict()
  console.log('\nPackage verified.')
  process.exit(0)
}, 1000)
