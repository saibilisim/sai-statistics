// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * project-dirty.ts — the parts of the project besides the data (Output tab,
 * Code tab) report their unsaved state here, and Main's window-close guard
 * gets one combined flag (dataset edits it already knows itself). Sends
 * only on a change: editors report on every keystroke.
 */

type Part = 'output' | 'code'

const parts: Record<Part, boolean> = { output: false, code: false }
let pushed: boolean | null = null

export function setProjectDirtyPart(part: Part, dirty: boolean): void {
  parts[part] = dirty
  const any = parts.output || parts.code
  if (pushed === any) return
  pushed = any
  void window.api.app.setOutputDirty(any)
}
