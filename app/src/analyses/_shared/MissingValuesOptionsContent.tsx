// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Options" sub-dialog for the analyses whose only option is the Missing
 * Values choice (Case Summaries, OLAP Cubes, Explore).
 *
 * Exists because those three used to render MissingValuesSection bare, with no
 * footer: the sub-dialog could only be dismissed with the × in its corner, and
 * because the radio wrote straight through to the parent's state, that ×
 * silently *applied* the change — the one control that looks like "cancel" was
 * the one that confirmed. Every other sub-dialog in the app ends in
 * Continue/Cancel, so these now do too, and Cancel genuinely discards.
 */

import { useState } from 'react'
import { SubDialogFooter } from '../../components/Dialogs/AnalysisDialogShell'
import { MissingValuesSection, type MissingStrategy } from './MissingValuesSection'

export function MissingValuesOptionsContent({
  value,
  onChange,
  onClose,
  variant
}: {
  value: MissingStrategy
  onChange: (v: MissingStrategy) => void
  onClose: () => void
  variant?: 'analysis' | 'pairwise'
}) {
  // Edited locally so Cancel can drop the change instead of it having already
  // been written to the parent on click.
  const [local, setLocal] = useState(value)

  return (
    <>
      <MissingValuesSection value={local} onChange={setLocal} variant={variant} />

      <SubDialogFooter
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}
