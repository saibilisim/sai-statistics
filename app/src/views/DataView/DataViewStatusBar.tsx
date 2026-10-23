// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * DataViewStatusBar.tsx — the status bar under DataView's grid (extracted
 * from DataView.tsx; purely presentational): case/variable counts, filter /
 * weight / split indicators, focused-cell address, and the selection-mode
 * badge.
 */
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import type { SelectionMode } from './cell-selection-types'
import styles from './DataView.module.css'

export interface DataViewStatusBarProps {
  rowCount: number
  visibleRowCount: number
  filterActive: boolean
  variables: Variable[]
  weightVariable: string | null
  splitVariable: string | null
  activeCell: { row: number; col: number } | null
  selectionMode: SelectionMode
}

export function DataViewStatusBar(props: DataViewStatusBarProps) {
  const { t } = useTranslation(['common', 'menu'])
  const {
    rowCount,
    visibleRowCount,
    filterActive,
    variables,
    weightVariable,
    splitVariable,
    activeCell,
    selectionMode
  } = props

  const activeCellVarName = activeCell ? (variables[activeCell.col]?.name ?? '') : ''

  return (
    <div className={styles.statusBar}>
      <span>
        {rowCount > 0 ? (
          <>
            {t('dataset.cases')}:{' '}
            <strong>
              {visibleRowCount.toLocaleString()}
              {filterActive ? ` / ${rowCount.toLocaleString()}` : ''}
            </strong>
            {'  ·  '}
            {t('dataset.variables')}: <strong>{variables.length}</strong>
            {filterActive && (
              <>
                {'  ·  '}
                <strong style={{ color: 'var(--color-accent)' }}>{t('status.filterOn')}</strong>
              </>
            )}
            {weightVariable && (
              <>
                {'  ·  '}
                <strong style={{ color: 'var(--color-accent)' }}>
                  {t('status.weightOn', {
                    var: variables.find(v => v.colId === weightVariable)?.name ?? weightVariable
                  })}
                </strong>
              </>
            )}
            {splitVariable && (
              <>
                {'  ·  '}
                <strong style={{ color: 'var(--color-accent)' }}>
                  {t('status.splitOn', {
                    var: variables.find(v => v.colId === splitVariable)?.name ?? splitVariable
                  })}
                </strong>
              </>
            )}
            {activeCell && (
              <>
                {'  ·  '}
                {t('dataset.row')}: <strong>{activeCell.row + 1}</strong>
                {'  ·  '}
                <strong>{activeCellVarName}</strong>
              </>
            )}
            {selectionMode !== 'normal' && (
              <>
                {'  ·  '}
                <strong style={{ color: 'var(--color-accent)' }}>
                  {selectionMode === 'extend'
                    ? t('status.selectionModeExtend')
                    : t('status.selectionModeAdd')}
                </strong>
              </>
            )}
          </>
        ) : (
          t('dataset.empty')
        )}
      </span>
    </div>
  )
}
