// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-packages-handler.ts — IPC for R package availability.
 *
 * `r:check-packages` answers the analysis dialogs' package gate
 * (use-package-gate.ts). `r:check-required-setup` is the first-run check.
 * `r:install-package` installs one allow-listed package into the user's R
 * library — since 0.2.28 only reachable for a system-R user (setup dialog,
 * package gate): the shipped runtime carries every package. Package names are
 * validated against the shared allow-list at the trust boundary
 * (handleValidated + the InstallPackageRequest zod refine).
 */

import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contracts'
import type {
  CheckPackagesResult,
  InstallPackageResult,
  RequiredSetupResult
} from '@shared/ipc-contracts'
import { InstallPackageRequestSchema } from '@shared/ipc-schemas'
import { ALLOWED_PACKAGE_NAMES, REQUIRED_PACKAGE_NAMES } from '@shared/optional-packages'
import log from 'electron-log'
import {
  checkRPackages,
  installRPackage,
  isBundledR,
  isRReady,
  getRVersionString,
  probeRPackages
} from './r-bridge'
import { handleValidated, validateSender } from './security'

export function registerRPackagesHandlers(): void {
  ipcMain.handle(IPC.R_CHECK_PACKAGES, async (event): Promise<CheckPackagesResult> => {
    validateSender(event)
    // The shipped runtime carries every package (vendor-r-runtime-win.ps1 loads
    // each one before it ships): answer without starting R, so an analysis
    // dialog's package gate opens instantly. A damaged copy is still caught by
    // the startup setup check, which repairs it silently.
    if (isBundledR()) return Object.fromEntries(ALLOWED_PACKAGE_NAMES.map(p => [p, true]))
    return checkRPackages([...ALLOWED_PACKAGE_NAMES])
  })

  // P0.4 — first-run welcome flow: is R findable, and are the packages every
  // analysis script needs (jsonlite, arrow) actually installed?
  ipcMain.handle(IPC.R_CHECK_REQUIRED_SETUP, async (event): Promise<RequiredSetupResult> => {
    validateSender(event)
    if (!isRReady()) {
      return { rFound: false, missingRequired: [...REQUIRED_PACKAGE_NAMES] }
    }
    const rVersion = getRVersionString()
    const installed = await probeRPackages([...REQUIRED_PACKAGE_NAMES])
    // Unreadable answer (logged in r-bridge): no dialog — a list of "missing"
    // packages the user can do nothing sensible about is worse than silence.
    if (!installed) return { rFound: true, rVersion, missingRequired: [] }
    const missingRequired = REQUIRED_PACKAGE_NAMES.filter(pkg => !installed[pkg])
    if (missingRequired.length > 0 && isBundledR()) {
      // The shipped runtime contains every required package, so one missing is
      // a damaged copy, not a choice to put to the user: repair it silently
      // into the user library (same install queue as every other install).
      log.warn(`[r-packages] bundled R lacks ${missingRequired.join(', ')} — reinstalling`)
      for (const pkg of missingRequired) {
        void installRPackage(pkg).then(r => {
          log.info(`[r-packages] ${pkg} → ${r.success ? 'ok' : 'failed'}`)
        })
      }
      return { rFound: true, rVersion, missingRequired: [] }
    }
    return { rFound: true, rVersion, missingRequired }
  })

  handleValidated(
    IPC.R_INSTALL_PACKAGE,
    InstallPackageRequestSchema,
    async (payload): Promise<InstallPackageResult> => {
      return installRPackage(payload.package)
    }
  )
}
