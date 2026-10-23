// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-user-library.ts — layout of the user's own R package library.
 *
 * Packages the app installs on demand (geepack, lme4, BayesFactor, …) live in
 * ~/R/library/<major.minor>/ — one folder per R minor version. A package with
 * compiled code only loads in the R minor it was built for: when an app update
 * moves the bundled R from 4.3 to 4.6, a 4.3-built rlang.dll fails with
 * "LoadLibrary failure: the specified procedure could not be found" (seen
 * 2026-10-10 in the R 4.3.3 ↔ 4.6.1 comparison), and worse, some 4.3 builds
 * DO load in a newer R and silently run old code. Per-version folders mean a
 * new R never sees packages built for another one; r-bridge.ts then reinstalls
 * the missing ones in the background (migrateUserRLibrary).
 *
 * Until 0.2.22 the packages sat directly in ~/R/library/ (the "flat" layout).
 * moveLegacyPackages() sorts those into the version folder they were built
 * for, read from each package's DESCRIPTION ("Built: R 4.3.3; …").
 *
 * Pure fs helpers only (no Electron import) so unit tests can drive them
 * against a temp directory.
 */

import { readdir, readFile, rename, mkdir } from 'fs/promises'
import { existsSync, type Dirent } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MINOR_RE = /^(\d+)\.(\d+)$/

/** "4.3" from "4.3.3" (or "4.3"); null for "unknown" / unparseable input. */
export function rMinor(version: string | undefined): string | null {
  return /^\d+\.\d+/.exec(version ?? '')?.[0] ?? null
}

/**
 * ~/R/library. SAI_R_USER_LIBRARY replaces it (tests/e2e/e2e-user-r-library.cjs
 * points it at a throwaway folder — moving the whole home breaks Electron's
 * userData lookup); it grants nothing R_LIBS in the same environment wouldn't.
 */
export function userRLibRoot(home: string = homedir()): string {
  return process.env['SAI_R_USER_LIBRARY'] || join(home, 'R', 'library')
}

/** The library this R version installs into and loads from. */
export function userRLibDir(rVersion: string | undefined, home: string = homedir()): string {
  const minor = rMinor(rVersion)
  // Version unknown (probe failed): the root itself, as before 0.2.22 — no
  // version folder lives there as a package, so nothing wrong-built is loaded.
  return minor ? join(userRLibRoot(home), minor) : userRLibRoot(home)
}

/** Entries of `dir`, or none when it does not exist / cannot be read. */
async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function hasPackage(dir: string, pkg: string): boolean {
  return existsSync(join(dir, pkg, 'DESCRIPTION'))
}

/** R minor a package was built for, from DESCRIPTION's "Built: R 4.3.3; …". */
async function builtMinor(pkgDir: string): Promise<string | null> {
  try {
    const desc = await readFile(join(pkgDir, 'DESCRIPTION'), 'utf8')
    const m = /^Built:\s*R\s+(\d+\.\d+)/m.exec(desc)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * Move packages from the pre-0.2.22 flat layout into their per-version folder.
 * A package whose build version cannot be read, or whose target already holds
 * that package, stays where it is — the root is no longer on R's library path,
 * so a leftover is inert. Returns how many packages were moved.
 */
export async function moveLegacyPackages(root: string): Promise<number> {
  let moved = 0
  for (const e of await entriesOf(root)) {
    if (!e.isDirectory() || MINOR_RE.test(e.name) || !hasPackage(root, e.name)) continue
    const minor = await builtMinor(join(root, e.name))
    if (!minor) continue
    const targetDir = join(root, minor)
    if (hasPackage(targetDir, e.name)) continue
    await mkdir(targetDir, { recursive: true })
    await rename(join(root, e.name), join(targetDir, e.name))
    moved++
  }
  return moved
}

function compareMinor(a: string, b: string): number {
  const [a1 = 0, a2 = 0] = a.split('.').map(Number)
  const [b1 = 0, b2 = 0] = b.split('.').map(Number)
  return a1 - b1 || a2 - b2
}

/**
 * Packages from `allowed` that the user had under the newest OTHER R version
 * folder — the candidates to reinstall after an R upgrade (or a downgrade).
 * Presence in the current folder is deliberately NOT a reason to skip: a
 * package can sit there and still fail to load (seen 2026-10-10: BayesFactor
 * installed, its dependency stringi lost to a network error), so the caller
 * filters by whether R can actually load each one. Empty when there is no
 * other version folder.
 */
export async function packagesToCarryOver(
  root: string,
  current: string,
  allowed: readonly string[]
): Promise<string[]> {
  const others = (await entriesOf(root))
    .filter(e => e.isDirectory() && MINOR_RE.test(e.name) && e.name !== current)
    .map(e => e.name)
    .sort(compareMinor)
  const previous = others.at(-1)
  if (!previous) return []
  const prevDir = join(root, previous)
  return allowed.filter(p => hasPackage(prevDir, p))
}
