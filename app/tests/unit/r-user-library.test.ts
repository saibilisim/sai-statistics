// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-user-library.test.ts — per-R-version user library (~/R/library/<x.y>).
 *
 * A package with compiled code only loads in the R minor it was built for, so
 * after an R upgrade the old packages must never be on the new R's path, and
 * the ones the user had are reinstalled for the new version. These tests pin
 * the fs side of that: the pre-0.2.22 flat layout is sorted by each package's
 * "Built:" field, and the carry-over list compares the newest other version
 * folder with the current one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  rMinor,
  userRLibDir,
  moveLegacyPackages,
  packagesToCarryOver
} from '../../electron/ipc/r-user-library'

let root: string

function pkg(dir: string, name: string, built: string | null): void {
  mkdirSync(join(dir, name), { recursive: true })
  const builtLine = built ? `Built: R ${built}; x86_64-w64-mingw32; 2026-01-01; windows\n` : ''
  writeFileSync(join(dir, name, 'DESCRIPTION'), `Package: ${name}\nVersion: 1.0\n${builtLine}`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sai-rlib-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('rMinor / userRLibDir', () => {
  it('keeps major.minor only', () => {
    expect(rMinor('4.3.3')).toBe('4.3')
    expect(rMinor('4.6')).toBe('4.6')
    expect(rMinor('unknown')).toBeNull()
    expect(rMinor(undefined)).toBeNull()
  })
  it('puts each R minor in its own folder; unknown version falls back to the root', () => {
    expect(userRLibDir('4.6.1', '/home/u')).toBe(join('/home/u', 'R', 'library', '4.6'))
    expect(userRLibDir(undefined, '/home/u')).toBe(join('/home/u', 'R', 'library'))
  })
})

describe('moveLegacyPackages', () => {
  it('sorts flat-layout packages into the version they were built for', async () => {
    pkg(root, 'lme4', '4.3.3')
    pkg(root, 'rlang', '4.3.1')
    pkg(root, 'odd', '4.5.0')
    expect(await moveLegacyPackages(root)).toBe(3)
    expect(existsSync(join(root, '4.3', 'lme4', 'DESCRIPTION'))).toBe(true)
    expect(existsSync(join(root, '4.3', 'rlang', 'DESCRIPTION'))).toBe(true)
    expect(existsSync(join(root, '4.5', 'odd', 'DESCRIPTION'))).toBe(true)
    expect(existsSync(join(root, 'lme4'))).toBe(false)
  })

  it('leaves unreadable builds, lock dirs and already-present targets alone', async () => {
    pkg(root, 'nobuilt', null)
    mkdirSync(join(root, '00LOCK-arrow'))
    pkg(root, 'dup', '4.3.3')
    pkg(join(root, '4.3'), 'dup', '4.3.3')
    expect(await moveLegacyPackages(root)).toBe(0)
    expect(existsSync(join(root, 'nobuilt', 'DESCRIPTION'))).toBe(true)
    expect(existsSync(join(root, 'dup', 'DESCRIPTION'))).toBe(true)
  })

  it('is a no-op without a library and on a second run', async () => {
    expect(await moveLegacyPackages(join(root, 'missing'))).toBe(0)
    pkg(root, 'lme4', '4.3.3')
    await moveLegacyPackages(root)
    expect(await moveLegacyPackages(root)).toBe(0)
  })
})

describe('packagesToCarryOver', () => {
  const allowed = ['lme4', 'BayesFactor', 'mice']

  it('lists allowed packages of the newest other version (loadability is checked by the caller)', async () => {
    pkg(join(root, '4.2'), 'mice', '4.2.0')
    pkg(join(root, '4.3'), 'lme4', '4.3.3')
    pkg(join(root, '4.3'), 'BayesFactor', '4.3.3')
    pkg(join(root, '4.3'), 'rlang', '4.3.3') // dependency, not allow-listed
    pkg(join(root, '4.6'), 'BayesFactor', '4.6.0')
    // BayesFactor is also in 4.6 but still listed: present is not the same as
    // loadable (a dependency may be missing) — r-bridge checks that.
    expect(await packagesToCarryOver(root, '4.6', allowed)).toEqual(['lme4', 'BayesFactor'])
  })

  it('compares versions numerically (4.10 is newer than 4.9)', async () => {
    pkg(join(root, '4.9'), 'mice', '4.9.0')
    pkg(join(root, '4.10'), 'lme4', '4.10.0')
    expect(await packagesToCarryOver(root, '5.0', allowed)).toEqual(['lme4'])
  })

  it('is empty on a fresh install or when only the current version exists', async () => {
    expect(await packagesToCarryOver(root, '4.6', allowed)).toEqual([])
    pkg(join(root, '4.6'), 'lme4', '4.6.0')
    expect(await packagesToCarryOver(root, '4.6', allowed)).toEqual([])
  })
})
