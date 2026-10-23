// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * apply-case-vars.ts — writes an analysis's case-level output into the dataset
 * as new columns (roadmap ★11).
 *
 * Runs once, centrally, for every analysis: a dialog asks R for the columns via
 * `params.createVars`, R returns them in `AnalysisResult.caseVars`, and this
 * turns them into real variables through the same transform:* write path (and
 * therefore the same undo snapshot) that Compute Variable uses. No analysis
 * gets its own write code, mirroring the single `analysis:run` handler.
 *
 * The outcome is folded into the result's notes/warnings BEFORE the output
 * block is added, so the user reads what happened to the dataset in the same
 * block as the analysis that caused it — the app has no toast channel, and a
 * dataset mutation that reports nowhere is exactly the kind of silence this
 * project treats as a defect.
 */
import type { TFunction } from 'i18next'
import type { AnalysisResult } from '@shared/analysis-types'
import { useDatasetStore } from '@/store/dataset-store'
import { translateOutputKey } from './output-format'

/**
 * @returns the result to render — unchanged when the analysis produced no
 *   case variables, otherwise carrying one extra note (or warning on failure).
 */
export async function applyCaseVars(result: AnalysisResult, t: TFunction): Promise<AnalysisResult> {
  const caseVars = result.caseVars
  if (caseVars.length === 0) return result

  const ds = useDatasetStore.getState()
  const datasetId = ds.datasetId
  if (datasetId === null || datasetId === '') {
    return { ...result, warnings: [...result.warnings, 'output.newVars.noDataset'] }
  }

  // R sends the label as an i18n key (§6 — R never emits user-visible text).
  // It has to become real text HERE, because a variable label is stored in the
  // dataset and shown verbatim in Variable View, where nothing would translate
  // it later. translateOutputKey, not a bare t(): output.* keys live under the
  // `analysis` namespace, so t('output.cox.newVar.xbeta') alone finds nothing
  // and the raw key would end up in Variable View.
  const translated = caseVars.map(cv => ({
    ...cv,
    label: cv.label === '' ? '' : translateOutputKey(cv.label, t)
  }))

  try {
    const written = await window.api.transform.createVariables({
      datasetId,
      variables: translated
    })
    const after = useDatasetStore.getState()
    after.setVariables(written.variables)
    after.setRowCount(written.rowCount)
    after.bumpDataVersion()
    // Same contract as every other transform: the dataset is now DIFFERENT
    // from the file on disk, and saving it stays the user's separate action.
    after.setModified(true)
    const names = caseVars.map(v => v.name).join(', ')
    return { ...result, notes: [...result.notes, `output.newVars.created:${names}`] }
  } catch (err) {
    // The analysis itself succeeded; only the column write failed (a name
    // collision with a variable added since the dialog opened is the likely
    // one). Show the analysis, and say plainly that the dataset is unchanged.
    const detail = err instanceof Error ? err.message : String(err)
    return { ...result, warnings: [...result.warnings, `output.newVars.failed:${detail}`] }
  }
}
