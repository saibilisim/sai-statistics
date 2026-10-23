// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NameBoxBar.tsx — the Name Box + formula bar row above DataView's grid
 * (B1, extracted from DataView.tsx; purely presentational — all state and
 * commit logic lives in use-cell-focus.ts).
 */
import { useTranslation } from 'react-i18next'
import styles from './DataView.module.css'

export interface NameBoxBarProps {
  nameBoxValue: string
  setNameBoxValue: (value: string) => void
  onNameBoxKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  formulaBarValue: string
  setFormulaBarValue: (value: string) => void
  onFormulaBarKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  activeCell: { row: number; col: number } | null
}

export function NameBoxBar(props: NameBoxBarProps) {
  const { t } = useTranslation(['common', 'menu'])
  const {
    nameBoxValue,
    setNameBoxValue,
    onNameBoxKeyDown,
    formulaBarValue,
    setFormulaBarValue,
    onFormulaBarKeyDown,
    activeCell
  } = props

  return (
    <div className={styles.nameBoxBar}>
      <input
        className={styles.nameBox}
        type="text"
        value={nameBoxValue}
        spellCheck={false}
        aria-label={t('dataset.nameBoxLabel')}
        title={t('dataset.nameBoxLabel')}
        placeholder="A1"
        onChange={e => {
          setNameBoxValue(e.target.value)
        }}
        onKeyDown={onNameBoxKeyDown}
        onFocus={e => {
          e.target.select()
        }}
      />
      <span className={styles.formulaMarker} aria-hidden="true">
        =
      </span>
      <input
        className={styles.formulaBar}
        type="text"
        value={formulaBarValue}
        spellCheck={false}
        aria-label={t('dataset.formulaBarLabel')}
        title={t('dataset.formulaBarLabel')}
        placeholder={t('dataset.formulaBarPlaceholder')}
        disabled={!activeCell}
        onChange={e => {
          setFormulaBarValue(e.target.value)
        }}
        onKeyDown={onFormulaBarKeyDown}
      />
    </div>
  )
}
