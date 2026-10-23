// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * terminal-drafts.ts — the Terminal's editor buffers survive closing the app,
 * as RStudio's unsaved scripts do (2026-10-21; before this, quitting with an
 * unsaved R script lost it without a prompt — the close guard only knows about
 * datasets and Output).
 *
 * Every R script tab (text, last-saved text, name) and the SPSS syntax buffer
 * go to localStorage, debounced; the next start restores them, unsaved marks
 * included. A per-viewer convenience, so browser storage is the right place;
 * the stored value is validated before use (it is just a string on disk), and
 * an unavailable/full storage only means no carry-over.
 *
 * Restored tabs keep their file path for display, but Save still asks where
 * to write until the user picks the file again: Main only writes to paths
 * chosen in a dialog during the current session.
 */

import { z } from 'zod'
import { useTerminalStore, scriptsWithLiveText } from '../store/terminal-store'

const KEY = 'sai.terminalDrafts.v1'
// localStorage holds ~5 MB per origin; a draft set beyond this is not saved
// rather than evicting everything else the app keeps there.
const MAX_CHARS = 2_000_000
const SAVE_DELAY_MS = 800

const DraftsSchema = z.object({
  scripts: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(260),
        source: z.string(),
        saved: z.string(),
        filePath: z.string().nullable()
      })
    )
    .min(1)
    .max(50),
  activeScriptId: z.string(),
  syntax: z.string()
})

function read(): z.infer<typeof DraftsSchema> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = DraftsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Puts the last session's buffers back. Call once, before the UI renders. */
export function restoreTerminalDrafts(): void {
  const drafts = read()
  if (!drafts) return
  const active = drafts.scripts.find(s => s.id === drafts.activeScriptId) ?? drafts.scripts[0]
  if (!active) return
  useTerminalStore.setState({
    rScripts: drafts.scripts,
    activeScriptId: active.id,
    rSource: active.source,
    source: drafts.syntax
  })
}

/** Saves the buffers shortly after every change. Returns the unsubscribe. */
export function startTerminalDraftAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    timer = null
    const s = useTerminalStore.getState()
    const value = JSON.stringify({
      scripts: scriptsWithLiveText(s),
      activeScriptId: s.activeScriptId,
      syntax: s.source
    })
    if (value.length > MAX_CHARS) return
    try {
      localStorage.setItem(KEY, value)
    } catch {
      // Storage full or unavailable — the drafts just don't carry over.
    }
  }
  const unsubscribe = useTerminalStore.subscribe((s, prev) => {
    if (
      s.rSource === prev.rSource &&
      s.rScripts === prev.rScripts &&
      s.activeScriptId === prev.activeScriptId &&
      s.source === prev.source
    ) {
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  })
  // Flush on close so the last keystrokes before quitting are kept.
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      save()
    }
  }
  window.addEventListener('beforeunload', flush)
  return () => {
    unsubscribe()
    window.removeEventListener('beforeunload', flush)
  }
}
