// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Reverse items…" sub-dialog shared by the survey dialogs: a checklist of the
 * items currently assigned, the checked ones are reverse-scored (min + max - x).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import {
  CheckOption,
  OptionSection,
  SubDialogFooter
} from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'

export function ReverseItemsPanel({
  items,
  value,
  onChange,
  onClose
}: {
  items: Variable[]
  value: string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(() => new Set(value))
  return (
    <>
      <OptionSection titleKey="analysis:scaleShared.reverseSection" grid={false}>
        <div className={shellStyles.optionHint}>{t('analysis:scaleShared.reverseHint')}</div>
        {items.length === 0 && (
          <div className={shellStyles.hintText}>{t('analysis:scaleShared.reverseNone')}</div>
        )}
        {items.map(v => (
          <CheckOption
            key={v.colId}
            checked={local.has(v.colId)}
            onChange={c => {
              setLocal(prev => {
                const next = new Set(prev)
                if (c) next.add(v.colId)
                else next.delete(v.colId)
                return next
              })
            }}
          >
            {v.label ? `${v.name} — ${v.label}` : v.name}
          </CheckOption>
        ))}
      </OptionSection>
      <SubDialogFooter
        onContinue={() => {
          onChange(items.filter(v => local.has(v.colId)).map(v => v.colId))
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}
