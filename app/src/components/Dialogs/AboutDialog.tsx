// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import { useUIStore } from '../../store/ui-store'
import styles from './AboutDialog.module.css'

interface Props {
  onClose: () => void
}

/** Help ▸ About previously sent 'menu:about' to nothing (no case in App.tsx). */
export function AboutDialog({ onClose }: Props) {
  const { t } = useTranslation(['dialogs', 'common'])
  const rVersion = useUIStore(s => s.rVersion)
  const dialogRef = useRef<HTMLDivElement>(null)

  useDialogKeyboard({ containerRef: dialogRef, onCancel: onClose, onSubmit: onClose })

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div className={styles.dialog} ref={dialogRef}>
        <div className={styles.body}>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('common:common.close')}
          >
            ×
          </button>

          <img className={styles.icon} src="./icon.png" alt="" />

          <h1 id="about-title" className={styles.appName}>
            SAI Statistics
          </h1>
          <p className={styles.description}>{t('dialogs:about.description')}</p>

          <div className={styles.infoCard}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{t('dialogs:about.version')}</span>
              <span className={styles.infoValue}>{__APP_VERSION__}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{t('dialogs:about.rVersion')}</span>
              <span className={styles.infoValue}>{rVersion ?? '—'}</span>
            </div>
          </div>

          <p className={styles.copyright}>{t('dialogs:about.copyright')}</p>
        </div>

        <div className={styles.footer}>
          <button className={styles.btn} onClick={onClose}>
            {t('common:common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
