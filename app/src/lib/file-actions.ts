// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * file-actions.ts — Shared dataset file operations used by both the native
 * menu dispatcher (App.tsx) and the shared ribbon, so the save pipeline lives
 * in one place (DRY).
 */

import { useDatasetStore } from '../store/dataset-store'
import { useSettingsStore } from '../store/settings-store'
import { useChatStore, toPersistedChat } from '../store/chat-store'
import { useStatusNoticeStore } from '../store/status-notice-store'
import { useOutputStore } from '../store/output-store'
import { buildOutputDocument } from './output-export'
import { currentProjectCode, isCodeModified, loadProjectCode, markCodeSaved } from './project-code'

/** Post-save bookkeeping shared by Save and Save As: adopts the written path
 *  as the dataset's file/name, clears the dirty flags (dataset + Output + Code,
 *  both embedded in the .sdf), records it in recent files and confirms in the
 *  StatusBar. */
export function applySavedPath(filePath: string): void {
  const name =
    filePath
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.sdf$/, '') ?? ''
  useDatasetStore.setState({ filePath, datasetName: name, isModified: false })
  useOutputStore.getState().markSaved()
  markCodeSaved()
  useSettingsStore.getState().addRecentFile(filePath)
  useStatusNoticeStore.getState().show('status.saveSuccess')
}

/** True when there's anything a Save would persist: dataset edits, Output
 *  changes (results/edits/order — output.json inside the .sdf) or Code tab
 *  changes (code.json). */
export function hasUnsavedChanges(): boolean {
  return (
    useDatasetStore.getState().isModified || useOutputStore.getState().dirty || isCodeModified()
  )
}

/**
 * Saves the project (.sdf): data + cell styles + AI chat + the Output tab +
 * the Code tab.
 * `saveAs` always shows the save dialog; otherwise it only appears for a
 * never-saved dataset. A cancelled dialog leaves the dirty flags untouched.
 */
export async function saveCurrentDataset(saveAs = false): Promise<void> {
  const state = useDatasetStore.getState()
  const datasetId = state.datasetId
  if (!datasetId) return

  const hasOutput = useOutputStore.getState().items.length > 0
  const request = {
    datasetId,
    customStyles: state.customStyles,
    chatHistory: toPersistedChat(useChatStore.getState().messages),
    outputDocument: hasOutput ? buildOutputDocument() : null,
    code: currentProjectCode()
  }
  try {
    const filePath = saveAs
      ? await window.api.file.saveDataAs(request)
      : await window.api.file.saveData(request)
    if (filePath) applySavedPath(filePath)
  } catch (err) {
    useStatusNoticeStore.getState().show('status.saveFailed', 'error', 5000)
    throw err
  }
}

/**
 * Guards dataset-replacing actions (New / Open / Import). Returns true when the
 * caller may proceed: there are no unsaved changes, or the user chose Discard,
 * or the user chose Save and the save completed. Returns false on Cancel (or a
 * cancelled Save dialog), so the in-progress action should abort.
 *
 * `replaces` names what else the action swaps out, so unsaved changes there
 * count too: Open replaces the Output tab (with the file's own output.json)
 * and the Code tab; New/Import replace the Code tab (a new dataset starts
 * with empty editors) but keep the current Output, which then gets saved with
 * the next dataset. Transformations (Aggregate, Merge, …) replace neither.
 */
export async function ensureCanReplaceDataset(
  replaces: { output?: boolean; code?: boolean } = {}
): Promise<boolean> {
  const unsaved =
    useDatasetStore.getState().isModified ||
    (replaces.output === true && useOutputStore.getState().dirty) ||
    (replaces.code === true && isCodeModified())
  if (!unsaved) return true
  const choice = await window.api.app.confirmUnsaved() // 0=Save, 1=Discard, 2=Cancel
  if (choice === 2) return false
  if (choice === 0) {
    await saveCurrentDataset()
    if (hasUnsavedChanges()) return false // Save dialog was cancelled
  }
  return true
}

/** Import through the same replacement guard for menu and dropped files. */
export async function importDataset(
  request: Parameters<Window['api']['file']['import']>[0]
): Promise<void> {
  if (!(await ensureCanReplaceDataset({ code: true }))) return
  const result = await window.api.file.import(request)
  if (!result) return
  loadProjectCode(null)
  useDatasetStore
    .getState()
    .setDataset(
      result.dataset.id,
      result.dataset.name,
      result.dataset.filePath,
      result.variables,
      result.dataset.rowCount,
      result.styles
    )
}
