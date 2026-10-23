// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * R package manifest — typed view over shared/r-packages.json, which is the
 * single source of truth (see the $comment block in that file).
 *
 * BUNDLED — every package any analysis uses. The vendored runtime carries all
 *           of them, so a user who installs the packaged app installs nothing.
 *           They are also what the first-run setup check verifies for someone
 *           using their OWN R install. Until 0.2.28 eleven of them were
 *           "optional", installed on demand from an R Packages manager that no
 *           longer exists (2026-10-11).
 *
 * The list is also the install allow-list — the security boundary that keeps
 * arbitrary `install.packages()` names out of the IPC surface (a system-R user
 * can still install a missing one from the setup dialog).
 */

import manifest from './r-packages.json'

export interface RPackage {
  /** CRAN package name (also the allow-list key). */
  pkg: string
  /** conda-forge package name, used by the vendor scripts. */
  conda: string
  /** True for R's own "recommended" set, which r-recommended installs as a group. */
  recommended: boolean
}

export const BUNDLED_PACKAGES: readonly RPackage[] = manifest.bundled.map(p => ({
  pkg: p.r,
  conda: p.conda,
  recommended: 'recommended' in p && p.recommended === true
}))

export const BUNDLED_PACKAGE_NAMES: readonly string[] = BUNDLED_PACKAGES.map(p => p.pkg)

/**
 * CONSOLE — vendored for the R terminal only (ggplot2, readxl …). No analysis
 * needs them, so they are neither required of a system-R user nor on the
 * install allow-list (the terminal's Packages panel installs without one).
 */
export const CONSOLE_PACKAGE_NAMES: readonly string[] = manifest.console.packages.map(p => p.r)

/**
 * What the first-run setup check must find before the app can run its
 * analyses. Identical to BUNDLED_PACKAGE_NAMES — the alias is kept because
 * "required" is the word the setup dialog and IPC result use.
 */
export const REQUIRED_PACKAGE_NAMES: readonly string[] = BUNDLED_PACKAGE_NAMES

/**
 * Package repository for every install the app makes (vendored runtime, and the
 * setup dialog for a system-R user): a dated snapshot, so an install today and one
 * next year get the same, tested versions. See r-packages.json "runtime".
 */
export const CRAN_SNAPSHOT: string = manifest.runtime.cranSnapshot

/** Every name the app may install — the install allow-list. */
export const ALLOWED_PACKAGE_NAMES: readonly string[] = BUNDLED_PACKAGE_NAMES

export function isAllowedPackage(name: string): boolean {
  return ALLOWED_PACKAGE_NAMES.includes(name)
}
