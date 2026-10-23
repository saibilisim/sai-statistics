// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * usePackageGate — renderer-side availability check for an optional R package.
 *
 * Lets a dialog gate its real UI on whether the backing R package is installed.
 * On mount it queries `window.api.rPackages.check()`; `install()` triggers the
 * on-demand CRAN install and re-reflects the result. The package name must be
 * in the shared allow-list (validated at the IPC boundary).
 */

import { useCallback, useEffect, useState } from 'react'

export type GateStatus = 'checking' | 'installed' | 'missing' | 'installing' | 'failed'

export interface PackageGate {
  status: GateStatus
  install: () => Promise<void>
  recheck: () => Promise<void>
}

export function usePackageGate(pkg: string, enabled = true): PackageGate {
  // When disabled (e.g. the frequentist path of a dual-mode dialog) we skip the
  // IPC check entirely and report 'installed' so the gate never blocks.
  const [status, setStatus] = useState<GateStatus>(enabled ? 'checking' : 'installed')

  const recheck = useCallback(async () => {
    if (!enabled) {
      setStatus('installed')
      return
    }
    try {
      const res = await window.api.rPackages.check()
      setStatus(res[pkg] ? 'installed' : 'missing')
    } catch (err) {
      console.error('rPackages.check failed:', err)
      setStatus('missing')
    }
  }, [pkg, enabled])

  // Mount-time fetch from the R package-check IPC — synchronizing with an
  // external system (the rule's own blessed use case), not adjusting state
  // from a prop/state change.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recheck()
  }, [recheck])

  const install = useCallback(async () => {
    setStatus('installing')
    try {
      const res = await window.api.rPackages.install({ package: pkg })
      setStatus(res.success ? 'installed' : 'failed')
    } catch (err) {
      console.error('rPackages.install failed:', err)
      setStatus('failed')
    }
  }, [pkg])

  return { status, install, recheck }
}
