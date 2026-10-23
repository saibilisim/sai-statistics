// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CommandsMenu — "Komutlar" popover for the SPSS editor: ready-to-run examples
 * built from the active dataset's own variables, plus the searchable list of
 * every supported command. Replaces the old wall-of-commands placeholder.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import { SUPPORTED_COMMANDS } from '../../lib/spss-syntax'
import { useDatasetStore } from '../../store/dataset-store'
import { cx } from '../../lib/cx'
import { ChevronDownIcon } from './terminal-icons'
import styles from './TerminalView.module.css'

interface Example {
  labelKey: string
  code: string
}

/** SPSS statements that run as-is on the current dataset. */
function buildExamples(variables: Variable[]): Example[] {
  const categorical = variables.filter(v => v.measure !== 'scale')
  const scale = variables.filter(v => v.measure === 'scale' && v.type === 'numeric')
  const out: Example[] = []
  const cat1 = categorical[0]
  const cat2 = categorical[1]
  const num1 = scale[0]
  if (cat1) {
    out.push({
      labelKey: 'terminal.examples.frequencies',
      code: `FREQUENCIES VARIABLES=${cat1.name}.`
    })
  }
  if (num1) {
    const nums = scale
      .slice(0, 3)
      .map(v => v.name)
      .join(' ')
    out.push({
      labelKey: 'terminal.examples.descriptives',
      code: `DESCRIPTIVES VARIABLES=${nums}.`
    })
  }
  if (num1 && cat1) {
    out.push({
      labelKey: 'terminal.examples.means',
      code: `MEANS TABLES=${num1.name} BY ${cat1.name}.`
    })
  }
  if (cat1 && cat2) {
    out.push({
      labelKey: 'terminal.examples.crosstabs',
      code: `CROSSTABS /TABLES=${cat1.name} BY ${cat2.name}.`
    })
  }
  return out
}

interface CommandsMenuProps {
  /** Insert a whole statement on its own line. */
  onInsertStatement: (code: string) => void
  /** Insert a command keyword (followed by a space) for the user to complete. */
  onInsertCommand: (command: string) => void
}

export function CommandsMenu({ onInsertStatement, onInsertCommand }: CommandsMenuProps) {
  const { t } = useTranslation(['analysis'])
  const variables = useDatasetStore(s => s.variables)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const examples = useMemo(() => buildExamples(variables), [variables])
  const commands = useMemo(() => {
    const q = query.trim().toUpperCase()
    const all = [...SUPPORTED_COMMANDS].sort()
    return q === '' ? all : all.filter(c => c.includes(q))
  }, [query])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (fn: () => void) => {
    fn()
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={styles.menuRoot} ref={rootRef}>
      <button
        type="button"
        className={cx(styles.button, open && styles.buttonActive)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(o => !o)
        }}
      >
        {t('terminal.commands.button')}
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div className={styles.menuPopover} role="menu">
          <input
            type="search"
            className={styles.varSearch}
            value={query}
            autoFocus
            onChange={e => {
              setQuery(e.target.value)
            }}
            placeholder={t('terminal.commands.search')}
            aria-label={t('terminal.commands.search')}
          />
          {query.trim() === '' && examples.length > 0 && (
            <>
              <div className={styles.menuSection}>{t('terminal.commands.examples')}</div>
              {examples.map(ex => (
                <button
                  key={ex.code}
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    pick(() => {
                      onInsertStatement(ex.code)
                    })
                  }}
                >
                  <span className={styles.menuItemLabel}>{t(ex.labelKey as never)}</span>
                  <code className={styles.menuItemCode}>{ex.code}</code>
                </button>
              ))}
            </>
          )}
          <div className={styles.menuSection}>{t('terminal.commands.all')}</div>
          <div className={styles.menuCommandGrid}>
            {commands.map(c => (
              <button
                key={c}
                type="button"
                role="menuitem"
                className={styles.menuCommand}
                onClick={() => {
                  pick(() => {
                    onInsertCommand(c)
                  })
                }}
              >
                {c}
              </button>
            ))}
            {commands.length === 0 && (
              <span className={styles.sideEmpty}>{t('terminal.commands.none')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
