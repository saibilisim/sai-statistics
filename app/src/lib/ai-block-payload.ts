// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-block-payload.ts — OutputBlock → the block payload of ai:interpret and
 * ai:send mentions (one shape for both).
 *
 * Block results carry i18n keys (titles, columns, some cells, notes). Main
 * only has the `dialogs` namespace, so the model used to read raw keys and
 * said so in its answers ("the output block contains unresolved i18n keys").
 * The renderer translates them here, exactly as the Output view does
 * (translateOutputKey), and sends the result as a key → text map. Main swaps
 * the text in only after its case-level filter (context-budget.ts), which
 * matches on the keys.
 */

import type { TFunction } from 'i18next'
import type { AiInterpretBlock } from '@shared/ai-types'
import type { AnalysisResult } from '@shared/analysis-types'
import i18n from '../i18n'
import type { OutputBlock } from '../store/output-store'
import { translateOutputKey } from './output-format'

/** Every translatable string in a result: titles, columns, key cells, notes. */
function keysOf(titleKey: string, result: AnalysisResult): Set<string> {
  const keys = new Set<string>([titleKey, ...result.warnings, ...result.notes])
  for (const p of result.plots) keys.add(p.titleKey)
  for (const table of result.tables) {
    keys.add(table.titleKey)
    for (const col of table.columns) keys.add(col)
    if (table.footnoteKey) keys.add(table.footnoteKey)
    for (const row of table.rows) {
      for (const cell of row)
        if (typeof cell === 'string' && cell.startsWith('output.')) keys.add(cell)
    }
  }
  return keys
}

/** Key → UI-language text, for the keys that actually translate. */
export function blockLabels(
  titleKey: string,
  result: AnalysisResult,
  t: TFunction = i18n.getFixedT(null, ['common', 'analysis'])
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const key of keysOf(titleKey, result)) {
    const text = translateOutputKey(key, t)
    if (text !== key) labels[key] = text
  }
  return labels
}

/** OutputBlock → payload: id/isCollapsed/aiNote stay in the renderer; the
 *  result is the stored AnalysisResult unchanged, plus its labels. */
export function blockToAiPayload(block: OutputBlock): AiInterpretBlock {
  const labels = blockLabels(block.titleKey, block.result)
  return {
    analysisId: block.analysisId,
    titleKey: block.titleKey,
    timestamp: block.timestamp,
    datasetName: block.datasetName,
    result: block.result,
    ...(Object.keys(labels).length > 0 ? { labels } : {})
  }
}
