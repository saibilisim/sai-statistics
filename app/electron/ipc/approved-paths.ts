// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * approved-paths.ts — Main-side allow-list of filesystem paths the renderer may
 * ask Main to read directly (file:import / file:open with an explicit path).
 *
 * The renderer has no `fs`, so a renderer-supplied path must never be trusted
 * on its own (a compromised renderer could read any file the user can). A path
 * is only usable when Main itself saw it come from a trusted source: a native
 * open dialog, a real user file drop (preload `getPathForFile` → `file:approve-path`),
 * a recent-files menu click, or the recent-files list present at startup.
 */

import { app } from 'electron'
import { resolve } from 'path'

const approved = new Set<string>()

/** E2E runner (tests/e2e/run-e2e.cjs) drives Main with synthetic paths; never in a packaged build. */
function e2eBypass(): boolean {
  return !app.isPackaged && process.env['SAI_E2E'] === '1'
}

function normalize(p: string): string {
  const abs = resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export function approvePath(p: string): void {
  approved.add(normalize(p))
}

export function approvePaths(paths: readonly string[]): void {
  for (const p of paths) approvePath(p)
}

export function assertApprovedPath(p: string): void {
  if (e2eBypass() || approved.has(normalize(p))) return
  throw new Error('IPC Security Violation: path was not chosen through a trusted source')
}

/** Export targets must come from a save dialog; a renderer-supplied path is honored only by the E2E runner. */
export function testOnlyPath(p: string | undefined): string | undefined {
  return e2eBypass() ? p : undefined
}
