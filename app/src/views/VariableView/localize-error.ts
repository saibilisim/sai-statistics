// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { TFunction } from 'i18next'

/**
 * Maps known backend error messages (English) to localized strings.
 * Falls back to the raw message for unknown errors so nothing is silently hidden.
 */
export function localizeError(err: unknown, t: TFunction<['dialogs']>): string {
  if (!(err instanceof Error)) return t('dialogs:variableView.errorGeneric')
  const msg = err.message

  // "Variable already exists: foo" OR "Variable with name foo already exists"
  const varExistsMatch = /^Variable (?:already exists: |with name )(.+?)(?: already exists)?$/.exec(
    msg
  )
  if (varExistsMatch) {
    return `${t('dialogs:variableView.varNameExists')}: ${varExistsMatch[1] ?? ''}`
  }

  // "Invalid variable name structure: ..." — use the same friendly validation text
  if (msg.startsWith('Invalid variable name')) {
    return t('dialogs:variableView.invalidVarName')
  }

  // "Column not found: col_1" or "Column not found in dataset variables: col_1"
  if (msg.startsWith('Column not found')) {
    const col = msg.split(':').slice(1).join(':').trim()
    const label = t('dialogs:variableView.errorColumnNotFound')
    return col ? `${label}: ${col}` : label
  }

  // "Variable not found: col_1"
  if (msg.startsWith('Variable not found')) {
    const col = msg.split(':').slice(1).join(':').trim()
    const label = t('dialogs:variableView.errorVarNotFound')
    return col ? `${label}: ${col}` : label
  }

  // Unknown — show raw backend message so nothing is silently lost
  return msg
}
