// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * shared/r-packages.json is the single source of truth for R packages. Four
 * things consume it — the app (via shared/optional-packages.ts), the three
 * vendor scripts, and r-scripts/setup.R — and before it existed each of them
 * carried its own hand-maintained copy. They disagreed:
 *
 *   setup.R                 12 packages, including geepack
 *   REQUIRED_PACKAGE_NAMES  2  (jsonlite, arrow)
 *   OPTIONAL_PACKAGES       9, ALSO including geepack
 *   vendor scripts          11, hardcoded
 *
 * The practical damage: the vendored runtime shipped without R's recommended
 * set, so Survival/Bootstrap/Discriminant/KNN/Trees were broken in the
 * installed app; and the first-run setup check verified 2 of the 11 packages
 * it needed, reporting "all good" while those same analyses silently degraded
 * for anyone using their own R.
 *
 * This test fails the moment a consumer drifts from the manifest again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import manifest from '../../shared/r-packages.json'
import {
  BUNDLED_PACKAGE_NAMES,
  CONSOLE_PACKAGE_NAMES,
  REQUIRED_PACKAGE_NAMES,
  isAllowedPackage
} from '../../shared/optional-packages'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string): string => readFileSync(resolve(appRoot, p), 'utf-8')

describe('r-packages.json is internally coherent', () => {
  it('every entry has an R name and a conda name', () => {
    for (const p of manifest.bundled) {
      expect(p.r, `entry missing "r": ${JSON.stringify(p)}`).toBeTruthy()
      expect(p.conda, `${p.r} is missing its conda-forge name`).toBeTruthy()
    }
  })

  it('there is no optional list any more — every package is bundled', () => {
    // 2026-10-11: the eleven on-demand packages (lme4, BayesFactor, mice, …)
    // moved into the runtime; the R Packages manager was removed.
    expect('optional' in manifest).toBe(false)
    for (const p of ['lme4', 'mice', 'BayesFactor', 'geepack', 'emmeans', 'coin']) {
      expect(BUNDLED_PACKAGE_NAMES, `${p} must be bundled`).toContain(p)
    }
  })

  it('no duplicate names', () => {
    expect(new Set(BUNDLED_PACKAGE_NAMES).size).toBe(BUNDLED_PACKAGE_NAMES.length)
  })
})

// 2026-10-21: R-terminal packages (ggplot2 …) are vendored but stay out of the
// system-R requirement and the analysis install allow-list.
describe('console packages', () => {
  it('include the R terminal basics and overlap nothing bundled', () => {
    expect(CONSOLE_PACKAGE_NAMES).toContain('ggplot2')
    for (const p of CONSOLE_PACKAGE_NAMES) {
      expect(BUNDLED_PACKAGE_NAMES, `${p} is listed twice`).not.toContain(p)
    }
    expect(new Set(CONSOLE_PACKAGE_NAMES).size).toBe(CONSOLE_PACKAGE_NAMES.length)
  })

  it('are not required of a system-R user nor installable through the allow-list', () => {
    for (const p of CONSOLE_PACKAGE_NAMES) {
      expect(REQUIRED_PACKAGE_NAMES).not.toContain(p)
      expect(isAllowedPackage(p)).toBe(false)
    }
  })

  it('every vendor script reads them', () => {
    for (const script of [
      'scripts/vendor-r-runtime.sh',
      'scripts/vendor-r-runtime-mac.sh',
      'scripts/vendor-r-runtime-mac-cran.sh',
      'scripts/vendor-r-runtime-win.ps1'
    ]) {
      expect(read(script), script).toMatch(/console\.packages/)
    }
  })
})

describe('the app agrees with the manifest', () => {
  it('the first-run setup check covers every bundled package', () => {
    // Was ['jsonlite', 'arrow'] — 2 of 11 — so a system R missing survival or
    // MASS passed the check and degraded silently at analysis time.
    expect([...REQUIRED_PACKAGE_NAMES]).toEqual([...BUNDLED_PACKAGE_NAMES])
  })

  it('the install allow-list accepts every manifest package and nothing else', () => {
    for (const p of BUNDLED_PACKAGE_NAMES) {
      expect(isAllowedPackage(p), `${p} should be installable`).toBe(true)
    }
    // The allow-list is the security boundary around install.packages().
    for (const bad of ['', 'ggplot2', '../etc/passwd', 'jsonlite; rm -rf /']) {
      expect(isAllowedPackage(bad), `${bad} must be rejected`).toBe(false)
    }
  })
})

describe('the build scripts read the manifest instead of copying it', () => {
  const VENDOR_SCRIPTS = [
    'scripts/vendor-r-runtime.sh',
    'scripts/vendor-r-runtime-mac.sh',
    'scripts/vendor-r-runtime-mac-cran.sh',
    'scripts/vendor-r-runtime-win.ps1'
  ]

  for (const script of VENDOR_SCRIPTS) {
    it(`${script} derives its package list from r-packages.json`, () => {
      const src = read(script)
      expect(src, 'should reference the manifest').toContain('r-packages.json')
      // A re-hardcoded list would defeat the whole point. r-recommended is the
      // one literal that legitimately stays: it is a conda metapackage, not a
      // package the app itself uses.
      const literals = [...BUNDLED_PACKAGE_NAMES]
        .filter(p => p !== 'MASS') // appears in prose comments as a plain word
        .map(p => `r-${p.toLowerCase()}`)
        .filter(conda => new RegExp(`(^|\\s)${conda}(\\s|$)`, 'm').test(src))
      expect(literals, 'conda package names should come from the manifest').toEqual([])
    })
  }

  it('setup.R reads the manifest and extracts exactly the bundled list', () => {
    const src = read('r-scripts/setup.R')
    expect(src).toContain('r-packages.json')
    // Its base-R regex relies on the manifest's shape (it cannot use jsonlite —
    // installing jsonlite is its job). Re-run that extraction here so a change
    // to the JSON layout that breaks it fails in CI rather than at a user's
    // first install.
    const json = read('shared/r-packages.json')
    const bundledBlock = json
      .replace(/^[\s\S]*?"bundled"\s*:/, '')
      .replace(/"optional"\s*:[\s\S]*$/, '')
    const names = [...bundledBlock.matchAll(/"r"\s*:\s*"([^"]+)"/g)].map(m => m[1] as string)
    expect(names).toEqual([...BUNDLED_PACKAGE_NAMES])
  })
})
