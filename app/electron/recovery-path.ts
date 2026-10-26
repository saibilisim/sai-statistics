// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app } from 'electron'
import { join, resolve } from 'path'

/** Crash-recovery snapshot written by the periodic checkpoint (main.ts). */
export const RECOVERY_PATH = join(app.getPath('userData'), 'recovery.sdf')

export function isRecoveryPath(p: string): boolean {
  const a = resolve(p)
  const b = resolve(RECOVERY_PATH)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
