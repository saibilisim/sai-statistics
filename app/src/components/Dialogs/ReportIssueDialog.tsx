// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import type { SystemInfoResult } from '@shared/ipc-contracts'
import styles from './DataDialogs.module.css'

interface Props {
  onClose: () => void
}

const R_STATUS_KEY: Record<SystemInfoResult['rStatus'], string> = {
  starting: 'status.rStarting',
  ready: 'status.rConnected',
  'not-found': 'status.rNotFound',
  error: 'status.rError'
}

/** Help ▸ "Report a Bug" (K7) — system info for bug reports + log folder + e-posta taslağı (support@). */
export function ReportIssueDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'dialogs'])
  const [info, setInfo] = useState<SystemInfoResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.diag.getSystemInfo().then(setInfo)
  }, [])

  const rStatusLabel = info ? String(t(R_STATUS_KEY[info.rStatus] as never)) : ''

  const summaryText = info
    ? [
        `${t('dialogs:reportIssue.appVersion')}: ${info.appVersion}`,
        `${t('dialogs:reportIssue.os')}: ${info.osPlatform} ${info.osRelease}`,
        `${t('dialogs:reportIssue.electronVersion')}: ${info.electronVersion}`,
        `${t('dialogs:reportIssue.rStatus')}: ${rStatusLabel}`,
        `${t('dialogs:reportIssue.rVersion')}: ${info.rVersion ?? '—'}`
      ].join('\n')
    : ''

  const handleCopy = () => {
    void navigator.clipboard.writeText(summaryText).then(() => {
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
    })
  }

  // Kullanıcı metni için boş bir alan + değiştirilmemesi istenen sistem bilgisi
  // bloğu ile mailto gövdesini kurar; gönderim tamamen kullanıcının e-posta
  // istemcisinde, onun kontrolünde olur.
  const handleEmailSupport = () => {
    const body = `${t('dialogs:reportIssue.emailBodyIntro')}\n\n\n--- ${t('dialogs:reportIssue.systemInfo')} ---\n${summaryText}`
    void window.api.diag.contactSupport(body)
  }

  return (
    <DialogBase titleKey="dialogs:reportIssue.title" onOk={onClose} onCancel={onClose}>
      <div className={styles.selectRootPadded}>
        <div className={styles.fullWidth}>
          <p className={styles.emptyNote}>{t('dialogs:reportIssue.systemInfo')}</p>
          {info && (
            <>
              <div className={styles.conditionRow}>
                <span className={styles.condLabel}>{t('dialogs:reportIssue.appVersion')}</span>
                <span>{info.appVersion}</span>
              </div>
              <div className={styles.conditionRow}>
                <span className={styles.condLabel}>{t('dialogs:reportIssue.os')}</span>
                <span>
                  {info.osPlatform} {info.osRelease}
                </span>
              </div>
              <div className={styles.conditionRow}>
                <span className={styles.condLabel}>{t('dialogs:reportIssue.electronVersion')}</span>
                <span>{info.electronVersion}</span>
              </div>
              <div className={styles.conditionRow}>
                <span className={styles.condLabel}>{t('dialogs:reportIssue.rStatus')}</span>
                <span>{rStatusLabel}</span>
              </div>
              <div className={styles.conditionRow}>
                <span className={styles.condLabel}>{t('dialogs:reportIssue.rVersion')}</span>
                <span>{info.rVersion ?? '—'}</span>
              </div>
            </>
          )}

          <div className={styles.buttonRow}>
            <button className={styles.btn} onClick={handleCopy} disabled={!info}>
              {copied ? t('dialogs:reportIssue.copied') : t('dialogs:reportIssue.copyInfo')}
            </button>
            <button
              className={styles.btn}
              onClick={() => {
                void window.api.diag.openLogFolder()
              }}
            >
              {t('dialogs:reportIssue.openLogFolder')}
            </button>
            <button className={styles.btn} onClick={handleEmailSupport} disabled={!info}>
              {t('dialogs:reportIssue.emailSupport')}
            </button>
          </div>

          <p className={styles.emptyNote}>{t('dialogs:reportIssue.privacyNote')}</p>
        </div>
      </div>
    </DialogBase>
  )
}
