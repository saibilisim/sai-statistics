// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: per-R-version user library + silent carry-over (r-user-library.ts,
 * r-bridge.ts migrateUserRLibrary). Runs the real app against a throwaway home
 * folder (SAI_R_USER_LIBRARY → tmp/e2e-rlib-home/R/library), so the developer's own
 * ~/R/library is never touched:
 *   1. a package in the pre-0.2.22 flat layout (~/R/library/<pkg>, built for
 *      the running R) must be moved into ~/R/library/<x.y>/;
 *   2. a package present under an OLDER version folder (~/R/library/4.2/
 *      randtests) that the shipped runtime already carries (every package is
 *      bundled since 0.2.28) must NOT be downloaded again — and the package
 *      check must report it installed. No internet needed. */
const fs = require('fs')
const path = require('path')
const { _electron } = require('@playwright/test')

const HOME = path.join(__dirname, '..', '..', 'tmp', 'e2e-rlib-home')
const LIB = path.join(HOME, 'R', 'library')

function fakePkg(dir, name, built) {
  fs.mkdirSync(path.join(dir, name), { recursive: true })
  fs.writeFileSync(
    path.join(dir, name, 'DESCRIPTION'),
    `Package: ${name}\nVersion: 0.0.1\nBuilt: R ${built}; x86_64-w64-mingw32; 2024-01-01; windows\n`
  )
}

function bundledRMinor() {
  const { execFileSync } = require('child_process')
  const win = process.platform === 'win32'
  const root = path.join(__dirname, '..', '..', 'resources', win ? 'r-runtime-win' : 'r-runtime')
  const exe = (
    win
      ? [
          path.join(root, 'bin', 'x64', 'Rscript.exe'),
          path.join(root, 'lib', 'R', 'bin', 'x64', 'Rscript.exe')
        ]
      : [path.join(root, 'bin', 'Rscript')]
  ).find(f => fs.existsSync(f))
  if (!exe) throw new Error(`no bundled R runtime under resources/${path.basename(root)}`)
  const out = execFileSync(exe, ['-e', 'cat(R.version$major, R.version$minor)'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: win
        ? `${path.dirname(exe)};${path.join(root, 'Library', 'bin')};${process.env.PATH}`
        : `${path.dirname(exe)}:${process.env.PATH}`
    }
  })
  const [maj, min] = out.trim().split(/\s+/)
  return `${maj}.${min.split('.')[0]}`
}

async function waitFor(check, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise(r => setTimeout(r, 1000))
  }
  return check()
}

async function main() {
  fs.rmSync(HOME, { recursive: true, force: true })
  // The fixtures must be laid out before launch, so the running R minor is
  // read from the bundled runtime directly (SAI_E2E_R_MINOR overrides).
  const minor = process.env.SAI_E2E_R_MINOR || bundledRMinor()
  fakePkg(LIB, 'saiflatfixture', `${minor}.0`)
  fakePkg(path.join(LIB, '4.2'), 'randtests', '4.2.0')

  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, SAI_R_USER_LIBRARY: LIB }
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  const results = []
  const ok = (name, pass, extra = '') => {
    results.push(pass)
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`)
  }

  const status = await win.evaluate(async () => {
    for (let i = 0; i < 60; i++) {
      const s = await window.api.r.getStatus()
      if (s.status !== 'starting') return s
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  })
  ok('R ready', status?.status === 'ready', JSON.stringify(status))
  const runMinor = /^\d+\.\d+/.exec(status?.version ?? '')?.[0]
  ok('fixture minor matches running R', runMinor === minor, `${runMinor} vs ${minor}`)

  const target = path.join(LIB, minor)
  const moved = await waitFor(
    () => fs.existsSync(path.join(target, 'saiflatfixture', 'DESCRIPTION')),
    30_000
  )
  ok('flat-layout package moved into its version folder', moved)
  ok('flat-layout copy no longer at the root', !fs.existsSync(path.join(LIB, 'saiflatfixture')))

  // Give the background carry-over time to act; a reinstall would show up as
  // a fresh randtests folder under the running version.
  await new Promise(r => setTimeout(r, 15_000))
  ok(
    'bundled package from an older version folder is not downloaded again',
    !fs.existsSync(path.join(target, 'randtests'))
  )
  ok(
    'old version folder left untouched',
    fs.existsSync(path.join(LIB, '4.2', 'randtests', 'DESCRIPTION'))
  )

  const t0 = Date.now()
  const check = await win.evaluate(() => window.api.rPackages.check())
  const ms = Date.now() - t0
  ok(
    'package check reports randtests and lme4 installed',
    check.randtests === true && check.lme4 === true,
    JSON.stringify(check)
  )
  ok('package check answers without starting R', ms < 1000, `${ms} ms`)

  await app.close()
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} checks passed`)
  process.exit(passed === results.length ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
