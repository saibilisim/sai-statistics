// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * analysis-history-store.test.ts — Dialog Recall is per dataset. colIds are
 * per-dataset sequence numbers, so recalling dataset A's col_3 on dataset B
 * pre-filled an unrelated variable (an Independent-Samples T Test opened on
 * another file with a test variable already chosen).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAnalysisHistoryStore } from '../../src/store/analysis-history-store'

beforeEach(() => {
  useAnalysisHistoryStore.setState({ entries: [] })
})

describe('analysis history (Dialog Recall)', () => {
  it('recalls a selection only on the dataset it was made on', () => {
    useAnalysisHistoryStore.getState().push({
      analysisId: 'ttestInd',
      datasetId: 'ds_a',
      channel: 'menu:analyze:ttest-independent',
      titleKey: 'analysis:ttestInd.title',
      assignments: { variables: ['col_3'], group: ['col_1'] }
    })
    const { lastFor } = useAnalysisHistoryStore.getState()
    expect(lastFor('ttestInd', 'ds_a')?.assignments['variables']).toEqual(['col_3'])
    expect(lastFor('ttestInd', 'ds_b')).toBeNull()
    expect(lastFor('ttestInd', null)).toBeNull()
  })

  it('returns the newest run of that dataset', () => {
    const push = useAnalysisHistoryStore.getState().push
    const base = { analysisId: 'oneway', channel: 'menu:analyze:oneway-anova', titleKey: 't' }
    push({ ...base, datasetId: 'ds_a', assignments: { factor: ['col_1'] } })
    push({ ...base, datasetId: 'ds_b', assignments: { factor: ['col_2'] } })
    push({ ...base, datasetId: 'ds_a', assignments: { factor: ['col_4'] } })
    const { lastFor } = useAnalysisHistoryStore.getState()
    expect(lastFor('oneway', 'ds_a')?.assignments['factor']).toEqual(['col_4'])
    expect(lastFor('oneway', 'ds_b')?.assignments['factor']).toEqual(['col_2'])
  })
})
