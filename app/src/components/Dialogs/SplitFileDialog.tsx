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

export function SplitFileDialog({ onClose }: Props) {
  const { t } = useTranslation()
  const variables = useDatasetStore(s => s.variables)
  const splitVariable = useDatasetStore(s => s.splitVariable)
  const setSplit = useDatasetStore(s => s.setSplit)

  const [mode, setMode] = useState<'off' | 'split'>(splitVariable ? 'split' : 'off')
  const [selected, setSelected] = useState<string | null>(splitVariable)

  const handleOk = () => {
    setSplit(mode === 'split' ? selected : null)
    onClose()
  }

  const canOk = mode === 'off' || selected !== null

  return (
    <DialogBase
      titleKey="dialog.splitFile.title"
      onOk={handleOk}
      onCancel={onClose}
      onReset={() => {
        setMode('off')
        setSelected(null)
      }}
      okDisabled={!canOk}
    >
      <div className={styles.splitRoot}>
        <label className={styles.radioRow}>
          <input
            type="radio"
            checked={mode === 'off'}
            onChange={() => {
              setMode('off')
            }}
            aria-label={t('dialog.splitFile.off')}
          />
          {t('dialog.splitFile.off')}
        </label>
        <label className={styles.radioRow}>
          <input
            type="radio"
            checked={mode === 'split'}
            onChange={() => {
              setMode('split')
            }}
            aria-label={t('dialog.splitFile.on')}
          />
          {t('dialog.splitFile.on')}
        </label>

        {mode === 'split' && (
          <div className={cx(styles.pickerLayout, 'mt-md')}>
            <div className={styles.pickerLeft}>
              <p className={styles.colLabel}>{t('dialog.splitFile.variables')}</p>
              <ul
                className={styles.varList}
                role="listbox"
                aria-label={t('dialog.splitFile.variables')}
              >
                {variables.map(v => (
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
              </ul>
            </div>

            <div className={styles.pickerArrow} aria-hidden="true">
              →
            </div>

            <div className={styles.pickerRight}>
              <p className={styles.colLabel}>{t('dialog.splitFile.groupsBasedOn')}</p>
              <div className={styles.targetBox}>
                {selected ? (
                  (variables.find(v => v.colId === selected)?.name ?? selected)
                ) : (
                  <span className={styles.noneText}>{t('dialog.splitFile.none')}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <p className={styles.limitationNote}>{t('dialog.splitFile.scopeNote')}</p>
    </DialogBase>
  )
}
