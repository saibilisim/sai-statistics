// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { NewVarSlot } from '@/components/Dialogs/NewVariablesPanel'

export const ORDINAL_SAVE_SLOTS: NewVarSlot[] = [
  {
    key: 'estimatedProbabilities',
    labelKey: 'analysis:ordinal.extra.estimatedProbabilities',
    defaultName: 'est',
    perCoefficient: true
  },
  { key: 'predictedGroup', labelKey: 'analysis:ordinal.newVar.predictedGroup', defaultName: 'pgr' },
  { key: 'probability', labelKey: 'analysis:ordinal.newVar.probability', defaultName: 'pre' },
  {
    key: 'actualProbability',
    labelKey: 'analysis:ordinal.extra.actualProbability',
    defaultName: 'acp'
  }
]
