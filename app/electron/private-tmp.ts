// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let dir: string | null = null

/**
 * Per-process scratch directory (mode 0700 on POSIX). Dataset copies and R
 * params go here instead of the shared temp dir, where a default-umask file
 * (0644) is readable by every other local account while an analysis runs.
 */
export function privateTmpDir(): string {
  if (dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 }) // re-create if the OS swept it
    return dir
  }
  dir = mkdtempSync(join(tmpdir(), 'sai-private-'))
  return dir
}

/** App shutdown: remove whatever is left in the scratch directory. */
export function removePrivateTmpDir(): void {
  if (!dir) return
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best effort
  }
  dir = null
}
