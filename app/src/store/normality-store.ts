// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { AnalysisResult } from '@shared/analysis-types'

export type NormalityStatus = 'idle' | 'running' | 'done' | 'error'

interface NormalityState {
  /** Dataset the current result belongs to — null when no result yet. */
  resultDatasetId: string | null
  /** `normalityInputKey()` of the data the current result was computed on —
   *  a different key means the data changed since (edits, filter, weight,
   *  a variable turned scale …) and the result is stale. */
  resultKey: string | null
  /** Key captured when the running job was launched (becomes resultKey). */
  pendingKey: string | null
  result: AnalysisResult | null
  status: NormalityStatus
  errorKey: string | null
}

interface NormalityActions {
  setRunning: (inputKey: string) => void
  setResult: (datasetId: string, result: AnalysisResult) => void
  setError: (errorKey: string) => void
  reset: () => void
}

/** Everything the normality run depends on, folded into one comparable key. */
export function normalityInputKey(ds: {
  datasetId: string | null
  dataVersion: number
  contentVersion: number
  variables: { colId: string; measure: string }[]
  columnFilters: Record<string, unknown>
  weightVariable: string | null
  splitVariable: string | null
}): string {
  return JSON.stringify([
    ds.datasetId,
    ds.dataVersion,
    ds.contentVersion,
    ds.variables.filter(v => v.measure === 'scale').map(v => v.colId),
    ds.columnFilters,
    ds.weightVariable,
    ds.splitVariable
  ])
}

export const useNormalityStore = create<NormalityState & NormalityActions>()(set => ({
  resultDatasetId: null,
  resultKey: null,
  pendingKey: null,
  result: null,
  status: 'idle',
  errorKey: null,

  setRunning: inputKey => {
    set({ status: 'running', errorKey: null, pendingKey: inputKey })
  },

  setResult: (datasetId, result) => {
    set(s => ({
      status: 'done',
      result,
      resultDatasetId: datasetId,
      resultKey: s.pendingKey,
      errorKey: null
    }))
  },

  setError: errorKey => {
    set({ status: 'error', errorKey })
  },

  reset: () => {
    set({
      resultDatasetId: null,
      resultKey: null,
      pendingKey: null,
      result: null,
      status: 'idle',
      errorKey: null
    })
  }
}))
