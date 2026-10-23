// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import { cx } from '../../lib/cx'
import styles from './DialogBase.module.css'

interface ConfirmDialogProps {
  titleKey: string
  messageKey: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

/** Small confirm/cancel prompt for destructive actions that don't warrant a
 *  full DialogBase (e.g. Output ▸ Clear All) — same overlay/keyboard
 *  behavior (Escape/Enter/focus-trap) via use-dialog-keyboard.ts. */
export function ConfirmDialog({
  titleKey,
  messageKey,
  onConfirm,
  onCancel,
  danger
}: ConfirmDialogProps) {
  const { t } = useTranslation(['common', 'dialogs'])
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogKeyboard({ containerRef: dialogRef, onCancel, onSubmit: onConfirm })

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className={styles.dialogNarrow} ref={dialogRef}>
        <div className={styles.header}>
          <span id="confirm-title" className={styles.title}>
            {t(titleKey as never)}
          </span>
          <button className={styles.closeBtn} onClick={onCancel} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className={styles.body}>{t(messageKey as never)}</div>
        <div className={styles.footer}>
          <div className={styles.footerLeft} />
          <div className={styles.footerRight}>
            <button
              className={cx(styles.btn, danger ? styles.danger : styles.primary)}
              onClick={onConfirm}
            >
              {t('common.ok')}
            </button>
            <button className={styles.btn} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
