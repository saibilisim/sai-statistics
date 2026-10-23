// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useUIStore } from '../../store/ui-store'
import { useAnalysisHistoryStore } from '../../store/analysis-history-store'
import { consumePendingRunMeta } from '../../store/pending-run-meta'
import { ANALYSIS_ID_TO_CHANNEL } from './analysis-channels'
import type { AnalysisRunRequest } from '@shared/ipc-contracts'
import type { Variable } from '@shared/data-types'

/** Dialog Recall (SPSS-style): what a dialog needs to pass so a successful
 *  run gets remembered — a display title and the field assignments the user
 *  made (stored as colId[], not Variable[], so a later rename doesn't
 *  invalidate the entry). The menu channel that reopens the dialog is looked
 *  up from `ANALYSIS_ID_TO_CHANNEL` by `payload.analysisId`, not passed here. */
export interface RunRecallInfo {
  titleKey: string
  assignments: Record<string, Variable[]>
}

/**
 * The "submit an analysis job" wrapper every analysis dialog's handleSubmit
 * ends with: set a running flag, invoke `window.api.analysis.run`, switch to
 * the Output tab on success, log on failure, always clear the running flag.
 * Was hand-copied (down to the exact `console.error` string) into 54 dialog
 * files; this is that block, once. Dialogs still build their own `params`
 * and do their own field validation before calling `run()` — only the
 * submit/error/loading mechanics are shared.
 */
export function useRunAnalysis() {
  const setActiveTab = useUIStore(s => s.setActiveTab)
  const [running, setRunning] = useState(false)

  const run = async (payload: AnalysisRunRequest, onDone?: () => void, recall?: RunRecallInfo) => {
    setRunning(true)
    try {
      const meta = consumePendingRunMeta()
      const request = {
        ...payload,
        ...(meta?.summary ? { summary: meta.summary } : {}),
        ...(meta?.syntax ? { syntax: meta.syntax } : {})
      }
      // E2E hook (same spirit as __SAI_TEST__): the exact request as queued,
      // so tests can compare what the dialog sent against what the syntax
      // path would have sent. No production consumer reads this.
      const w = window as unknown as { __SAI_RUNS__?: unknown[] }
      w.__SAI_RUNS__ ??= []
      w.__SAI_RUNS__.push(JSON.parse(JSON.stringify(request)))
      await window.api.analysis.run(request)
      setActiveTab('output')
      const channel = ANALYSIS_ID_TO_CHANNEL[payload.analysisId]
      if (recall && channel) {
        useAnalysisHistoryStore.getState().push({
          analysisId: payload.analysisId,
          datasetId: payload.datasetId,
          channel,
          titleKey: recall.titleKey,
          assignments: Object.fromEntries(
            Object.entries(recall.assignments).map(([key, vars]) => [key, vars.map(v => v.colId)])
          )
        })
      }
      onDone?.()
    } catch (err) {
      console.error('Failed to queue analysis:', err)
    } finally {
      setRunning(false)
    }
  }

  return { running, run }
}
