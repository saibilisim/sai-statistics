// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnalysisHistoryStore } from '../../store/analysis-history-store'
import { useDatasetStore } from '../../store/dataset-store'
import { dispatchMenu } from '../../lib/menu-dispatch'
import styles from './Ribbon.module.css'
import { HistoryIcon } from './ribbon-icons'

/** Dialog Recall (SPSS-style): dropdown listing the last few analyses run
 *  this session, oldest last. Picking one reopens that exact dialog via
 *  `dispatchMenu()` — same code path a native menu click uses — pre-filled
 *  with its own last field assignments (AnalysisDialogShell looks those up
 *  by analysisId on mount; see analysis-history-store.ts). Only the active
 *  dataset's runs are listed — a selection doesn't carry to another dataset. */
export function RecallDropdown() {
  const { t } = useTranslation(['common', 'analysis'])
  const allEntries = useAnalysisHistoryStore(s => s.entries)
  const datasetId = useDatasetStore(s => s.datasetId)
  const entries = allEntries.filter(e => e.datasetId === datasetId)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className={styles.dropdownContainer} ref={containerRef}>
      <button
        type="button"
        className={[styles.btn, isOpen ? styles.dropdownActive : ''].filter(Boolean).join(' ')}
        onClick={() => {
          setIsOpen(!isOpen)
        }}
        onMouseDown={e => {
          e.preventDefault()
        }}
        title={t('common:ribbon.recall')}
        aria-label={t('common:ribbon.recall')}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span className={styles.btnIcon}>{HistoryIcon}</span>
        <span className={styles.dropdownArrow}>▼</span>
      </button>
      {isOpen && (
        <div className={styles.popover} style={{ flexDirection: 'column', minWidth: 220 }}>
          {entries.length === 0 ? (
            <div className={styles.addPopoverEmpty}>{t('common:ribbon.recallEmpty')}</div>
          ) : (
            entries.map((entry, i) => (
              <button
                key={String(entry.timestamp) + String(i)}
                type="button"
                className={styles.addPopoverItem}
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
                onClick={() => {
                  setIsOpen(false)
                  dispatchMenu(entry.channel)
                }}
              >
                <span>{t(entry.titleKey as never)}</span>
                <span className={styles.dropdownArrow} style={{ marginLeft: 8 }}>
                  {new Date(entry.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
