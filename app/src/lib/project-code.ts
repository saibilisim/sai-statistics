// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * project-code.ts — the Code tab's buffers belong to the open project
 * (2026-11-01): Save writes them into the .sdf (code.json), Open puts the
 * file's own code back, New / Import start with empty editors.
 *
 * "Unsaved" is tracked against what the project last held, so the close and
 * replace guards ask before code is lost. An R script tab that is saved to
 * its own .R file and unchanged doesn't count — that work is already safe
 * on disk; neither does whitespace-only text.
 */

import type { ProjectCode } from '@shared/project-code'
import {
  useTerminalStore,
  scriptsWithLiveText,
  newScriptId,
  type RScriptTab
} from '../store/terminal-store'
import { setProjectDirtyPart } from './project-dirty'

type CodeState = Pick<
  ReturnType<typeof useTerminalStore.getState>,
  'rScripts' | 'activeScriptId' | 'rSource' | 'source'
>

/** What the dirty check compares: only text that would be lost. */
function unsavedKey(s: CodeState): string {
  const scripts = scriptsWithLiveText(s)
    .filter(t => t.source.trim() !== '' && !(t.filePath !== null && t.source === t.saved))
    .map(t => [t.name, t.source])
  return JSON.stringify([s.source.trim() === '' ? '' : s.source, scripts])
}

let baseline = unsavedKey(useTerminalStore.getState())

export function isCodeModified(): boolean {
  return unsavedKey(useTerminalStore.getState()) !== baseline
}

/** The buffers as stored in the .sdf; null when there is nothing to keep. */
export function currentProjectCode(): ProjectCode | null {
  const s = useTerminalStore.getState()
  const scripts = scriptsWithLiveText(s)
  const empty = (t: RScriptTab): boolean => t.source.trim() === '' && t.filePath === null
  if (s.source.trim() === '' && scripts.every(empty)) return null
  return {
    syntax: s.source,
    scripts: scripts.map(({ name, source, saved, filePath }) => ({
      name,
      source,
      saved,
      filePath
    })),
    activeScript: Math.max(
      0,
      scripts.findIndex(t => t.id === s.activeScriptId)
    )
  }
}

/** The project's code was just written to its .sdf. */
export function markCodeSaved(): void {
  baseline = unsavedKey(useTerminalStore.getState())
  setCodeDirty(false)
}

function setCodeDirty(dirty: boolean): void {
  if (useTerminalStore.getState().codeDirty !== dirty)
    useTerminalStore.setState({ codeDirty: dirty })
  setProjectDirtyPart('code', dirty)
}

/**
 * Replaces the editors with a project's code — `null` (a new/imported
 * dataset, or an .sdf saved before code.json) leaves one empty script.
 * Only fills the editors: nothing runs (CLAUDE.md §9, R terminal rule 2).
 */
export function loadProjectCode(code: ProjectCode | null): void {
  const scripts: RScriptTab[] = (
    code?.scripts ?? [{ name: 'script.R', source: '', saved: '', filePath: null }]
  ).map(t => ({ ...t, id: newScriptId() }))
  const active = scripts[Math.min(code?.activeScript ?? 0, scripts.length - 1)] as RScriptTab
  useTerminalStore.setState({
    rScripts: scripts,
    activeScriptId: active.id,
    rSource: active.source,
    source: code?.syntax ?? ''
  })
  markCodeSaved()
}

/** Keeps the close guard informed as the code changes. Returns the unsubscribe. */
export function startCodeDirtyTracking(): () => void {
  return useTerminalStore.subscribe((s, prev) => {
    if (
      s.rSource === prev.rSource &&
      s.rScripts === prev.rScripts &&
      s.activeScriptId === prev.activeScriptId &&
      s.source === prev.source
    ) {
      return
    }
    setCodeDirty(unsavedKey(s) !== baseline)
  })
}
