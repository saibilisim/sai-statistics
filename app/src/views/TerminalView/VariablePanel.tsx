// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * VariablePanel — the active dataset's variables beside the SPSS editor / R
 * console. Clicking a name inserts it where the user is typing (each mode
 * decides the inserted form: bare name for SPSS, `data$name` for R).
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import { ListIcon } from './terminal-icons'
import styles from './TerminalView.module.css'

interface VariablePanelProps {
  onInsert: (variable: Variable) => void
}

export function VariablePanel({ onInsert }: VariablePanelProps) {
  const { t } = useTranslation(['analysis'])
  const variables = useDatasetStore(s => s.variables)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return variables
    return variables.filter(
      v => v.name.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)
    )
  }, [variables, query])

  return (
    <aside className={styles.varPanel} aria-label={t('terminal.vars.title')}>
      <div className={styles.sidePanelHeader}>{t('terminal.vars.title')}</div>
      <input
        type="search"
        className={styles.varSearch}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
        }}
        placeholder={t('terminal.vars.search')}
        aria-label={t('terminal.vars.search')}
      />
      <ul className={styles.varItems}>
        {variables.length === 0 && <li className={styles.sideEmpty}>{t('terminal.vars.empty')}</li>}
        {shown.map(v => (
          <li key={v.colId}>
            <button
              type="button"
              className={styles.varItemBtn}
              title={
                v.label
                  ? `${v.label} — ${t('terminal.vars.insertHint')}`
                  : t('terminal.vars.insertHint')
              }
              onMouseDown={e => {
                // Keep focus (and the caret) in the editor / R input.
                e.preventDefault()
              }}
              onClick={() => {
                onInsert(v)
              }}
            >
              <span className={styles.varItemName}>{v.name}</span>
              {v.label && <span className={styles.varItemLabel}>{v.label}</span>}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** Toggle for the shared variable side panel. */
export function VarsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation(['analysis'])
  return (
    <button
      type="button"
      className={cx(styles.iconBtn, open && styles.iconBtnActive)}
      onClick={onToggle}
      aria-pressed={open}
      title={t('terminal.vars.toggle')}
      aria-label={t('terminal.vars.toggle')}
    >
      <ListIcon size={14} />
    </button>
  )
}
