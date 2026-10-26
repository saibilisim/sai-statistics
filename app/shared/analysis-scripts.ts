// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R scripts that read/write caller-supplied filesystem paths or set up the
 * runtime. Only Main's own file handlers may run them (after a native dialog);
 * the renderer-facing analysis channels (`analysis:run`, AI `run_analysis` /
 * `run_syntax`) must never dispatch them.
 */
const INTERNAL_ONLY_SCRIPTS = new Set([
  'export-sav.R',
  'import-stat.R',
  'import-metadata.R',
  'setup.R'
])

/** True when `scriptFile` may be started from `analysis:run` or the AI bridge. */
export function isAnalysisScriptAllowed(scriptFile: string): boolean {
  return !scriptFile.startsWith('_') && !INTERNAL_ONLY_SCRIPTS.has(scriptFile)
}
