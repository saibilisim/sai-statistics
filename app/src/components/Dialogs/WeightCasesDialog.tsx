// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import styles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

export function WeightCasesDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const weightVariable = useDatasetStore(s => s.weightVariable)
  const setWeight = useDatasetStore(s => s.setWeight)

  const numericVars = variables.filter(v => v.type === 'numeric')
  const [selected, setSelected] = useState<string | null>(weightVariable)

  const handleOk = () => {
    setWeight(selected)
    onClose()
  }

  return (
    <DialogBase
      titleKey="dialog.weightCases.title"
      onOk={handleOk}
      onCancel={onClose}
      onReset={() => {
        setSelected(null)
      }}
    >
      <div className={styles.pickerLayout}>
        <div className={styles.pickerLeft}>
          <p className={styles.colLabel}>{t('dialog.weightCases.numericVars')}</p>
          <ul
            className={styles.varList}
            role="listbox"
            aria-label={t('dialog.weightCases.numericVars')}
          >
            {numericVars.map(v => (
              <li
                key={v.colId}
                role="option"
                aria-selected={selected === v.colId}
                className={cx(styles.varItem, selected === v.colId && styles.itemSelected)}
                onClick={() => {
                  setSelected(v.colId === selected ? null : v.colId)
                }}
              >
                <span className={styles.varName}>{v.name}</span>
                {v.label && <span className={styles.varLabel}>{v.label}</span>}
              </li>
            ))}
            {numericVars.length === 0 && (
              <li className={styles.emptyNote}>{t('dialog.weightCases.noNumericVars')}</li>
            )}
          </ul>
        </div>

        <div className={styles.pickerArrow} aria-hidden="true">
          →
        </div>

        <div className={styles.pickerRight}>
          <p className={styles.colLabel}>{t('dialog.weightCases.target')}</p>
          <div className={styles.targetBox}>
            {selected ? (
              (variables.find(v => v.colId === selected)?.name ?? selected)
            ) : (
              <span className={styles.noneText}>{t('dialog.weightCases.noWeight')}</span>
            )}
          </div>
        </div>
      </div>
      <p className={styles.limitationNote}>{t('dialog.weightCases.scopeNote')}</p>
    </DialogBase>
  )
}
