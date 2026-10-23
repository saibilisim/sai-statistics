// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import { useTerminalStore } from '../../store/terminal-store'
import { useUIStore } from '../../store/ui-store'
import styles from './DialogBase.module.css'

interface DialogBaseProps {
  titleKey: string
  onOk: () => void
  onCancel: () => void
  onReset?: () => void
  onPasteR?: () => void
  /** Same contract as AnalysisDialogShell's: return the SPSS command this
   *  dialog's state describes, and the button drops it in the Terminal. Used
   *  by the dialogs that are not built on the shell (Power Analysis). */
  generateSyntax?: () => string | null
  okDisabled?: boolean
  children: React.ReactNode
}

export function DialogBase({
  titleKey,
  onOk,
  onCancel,
  onReset,
  onPasteR,
  generateSyntax,
  okDisabled,
  children
}: DialogBaseProps) {
  const { t } = useTranslation(['common', 'menu', 'analysis', 'dialogs'])
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogKeyboard({
    containerRef: dialogRef,
    onCancel,
    onSubmit: onOk,
    submitDisabled: okDisabled
  })

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className={styles.dialog} ref={dialogRef}>
        <div className={styles.header}>
          <span id="dialog-title" className={styles.title}>
            {t(titleKey as never)}
          </span>
          <button className={styles.closeBtn} onClick={onCancel} aria-label={t('common.close')}>
            ×
          </button>
        </div>

        <div className={styles.body}>{children}</div>

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {onPasteR && (
              <button className={styles.btn} onClick={onPasteR}>
                {t('common.pasteR')}
              </button>
            )}
            {generateSyntax && (
              <button
                className={styles.btn}
                onClick={() => {
                  const line = generateSyntax()
                  if (!line) return
                  useTerminalStore.getState().appendSyntax(line)
                  useUIStore.getState().setActiveTab('terminal')
                  onCancel()
                }}
              >
                {t('common.pasteSyntax')}
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <button
              className={`${styles.btn ?? ''} ${styles.primary ?? ''}`}
              onClick={onOk}
              disabled={okDisabled}
            >
              {t('common.ok')}
            </button>
            {onReset && (
              <button className={styles.btn} onClick={onReset}>
                {t('common.reset')}
              </button>
            )}
            <button className={styles.btn} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
