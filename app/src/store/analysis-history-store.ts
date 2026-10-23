// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'

/** SPSS's "Dialog Recall" — session-only, resets on app restart just like the
 *  real feature. Not persisted to disk: the value (reopen a recent dialog
 *  pre-filled) doesn't justify the extra electron-store/IPC round trip. */
export interface AnalysisHistoryEntry {
  analysisId: string
  /** Dataset the run used. colIds are per-dataset sequence numbers (col_1,
   *  col_2, …), so another dataset's col_3 is an unrelated variable — a
   *  selection is recalled only on the dataset it was made on. */
  datasetId: string
  /** Menu channel that reopens this exact dialog (e.g. 'menu:analyze:oneway-anova'). */
  channel: string
  titleKey: string
  timestamp: number
  /** fieldKey -> colId[], not full Variable objects — colIds outlive renames;
   *  a deleted variable is simply dropped on rehydration (see recall-store.ts). */
  assignments: Record<string, string[]>
}

const MAX_HISTORY = 6

interface AnalysisHistoryState {
  entries: AnalysisHistoryEntry[]
  push: (entry: Omit<AnalysisHistoryEntry, 'timestamp'>) => void
  /** Most recent entry for this analysisId, if any — backs "reopening a
   *  dialog normally shows its own last selections" (no Recall list needed). */
  lastFor: (analysisId: string, datasetId: string | null) => AnalysisHistoryEntry | null
}

export const useAnalysisHistoryStore = create<AnalysisHistoryState>()((set, get) => ({
  entries: [],

  push: entry => {
    set(s => ({
      entries: [{ ...entry, timestamp: Date.now() }, ...s.entries].slice(0, MAX_HISTORY)
    }))
  },

  lastFor: (analysisId, datasetId) => {
    return get().entries.find(e => e.analysisId === analysisId && e.datasetId === datasetId) ?? null
  }
}))
