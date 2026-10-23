// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutputStore } from '../../store/output-store'
import type { OutputDocItem } from '@shared/output-document'
import { ConfirmDialog } from '../../components/Dialogs/ConfirmDialog'
import styles from './OutputView.module.css'

/** Content-pane rendering of a non-block OutputDocItem — inline-editable
 *  heading/text, or a visual page-break marker (also honored by HTML/PDF/
 *  Word export via a CSS page-break rule). */
export function InsertedItemRow({
  item,
  isSelected,
  onSelect
}: {
  item: Extract<OutputDocItem, { kind: 'heading' | 'text' | 'pageBreak' }>
  isSelected: boolean
  onSelect: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
}) {
  const { t } = useTranslation(['common'])
  const updateItemText = useOutputStore(s => s.updateItemText)
  const removeItem = useOutputStore(s => s.removeItem)
  const [editing, setEditing] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const selectedStyle = { outline: isSelected ? '2px solid var(--color-accent)' : undefined }

  if (item.kind === 'pageBreak') {
    return (
      <div
        className={styles.pageBreakRow}
        id={`item-${item.id}`}
        style={selectedStyle}
        onClick={onSelect}
      >
        <span className={styles.pageBreakLabel}>{t('output.pageBreak')}</span>
        <button
          className={styles.blockDeleteBtn}
          onClick={e => {
            e.stopPropagation()
            setRemoveConfirmOpen(true)
          }}
          aria-label={t('output.removeItem')}
          title={t('output.removeItem')}
        >
          ×
        </button>
        {removeConfirmOpen && (
          <ConfirmDialog
            titleKey="output.removeConfirmTitle"
            messageKey="output.removeConfirmMessage"
            danger
            onConfirm={() => {
              setRemoveConfirmOpen(false)
              removeItem(item.id)
            }}
            onCancel={() => {
              setRemoveConfirmOpen(false)
            }}
          />
        )}
      </div>
    )
  }

  const placeholder =
    item.kind === 'heading' ? t('output.headingPlaceholder') : t('output.textPlaceholder')
  const rowClass = item.kind === 'heading' ? styles.insertedHeading : styles.insertedText

  return (
    <div
      className={styles.insertedItemRow}
      id={`item-${item.id}`}
      style={selectedStyle}
      onClick={onSelect}
    >
      {editing ? (
        <input
          className={rowClass}
          autoFocus
          defaultValue={item.text}
          placeholder={placeholder}
          onBlur={e => {
            updateItemText(item.id, e.target.value)
            setEditing(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <div
          className={rowClass}
          onDoubleClick={e => {
            e.stopPropagation()
            setEditing(true)
          }}
        >
          {item.text || placeholder}
        </div>
      )}
      <button
        className={styles.blockDeleteBtn}
        onClick={e => {
          e.stopPropagation()
          setRemoveConfirmOpen(true)
        }}
        aria-label={t('output.removeItem')}
        title={t('output.removeItem')}
      >
        ×
      </button>
      {removeConfirmOpen && (
        <ConfirmDialog
          titleKey="output.removeConfirmTitle"
          messageKey="output.removeConfirmMessage"
          danger
          onConfirm={() => {
            setRemoveConfirmOpen(false)
            removeItem(item.id)
          }}
          onCancel={() => {
            setRemoveConfirmOpen(false)
          }}
        />
      )}
    </div>
  )
}
