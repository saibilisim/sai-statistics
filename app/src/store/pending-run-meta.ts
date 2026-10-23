// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * pending-run-meta.ts — one-shot handoff from AnalysisDialogShell to
 * useRunAnalysis for the auto-generated output header (variables summary +
 * syntax line).
 *
 * AnalysisDialogShell already knows `fieldDefs`/`assignments`/`generateSyntax`
 * at OK-click time, but the actual `window.api.analysis.run(payload)` call is
 * built and made by each of the ~50 dialogs individually (they own their own
 * analysis-specific `params`). Rather than thread two new props through every
 * dialog's onSubmit/handleSubmit signature, the shell drops the computed meta
 * here and useRunAnalysis's run() picks it up right before sending the
 * request. This is safe without an explicit id/token: handleOk() sets it and
 * synchronously calls onSubmit(), whose handler always reaches `run()` before
 * yielding to the event loop (no `await` in between) — so nothing else can
 * interleave and consume a stale value. Dialogs that don't go through the
 * shell (e.g. PowerDialog) never set this, so it stays `null` for them.
 */
export interface PendingRunMeta {
  summary?: string
  syntax?: string
}

let pending: PendingRunMeta | null = null

export function setPendingRunMeta(meta: PendingRunMeta): void {
  pending = meta
}

/** Single-use read — clears the stored value so it can never leak into an
 *  unrelated later run(). */
export function consumePendingRunMeta(): PendingRunMeta | null {
  const meta = pending
  pending = null
  return meta
}
