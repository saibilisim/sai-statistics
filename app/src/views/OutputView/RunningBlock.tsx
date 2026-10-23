// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next'
import styles from './OutputView.module.css'

export interface RunningJob {
  jobId: string
  analysisId: string
  percent: number
  messageKey: string
}

export function RunningBlock({ job }: { job: RunningJob }) {
  const { t } = useTranslation(['common', 'analysis'])
  return (
    <div className={styles.runningBlock}>
      <div className={styles.spinner} />
      <div className="flex-1">
        <div>
          {t(`analysis:${job.analysisId}.title`, { defaultValue: job.analysisId })} —{' '}
          {t(job.messageKey, { defaultValue: '...' })}
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${String(job.percent)}%` }} />
        </div>
      </div>
      <button
        className={styles.navActionBtn}
        onClick={() => {
          void window.api.analysis.cancel(job.jobId)
        }}
        title={t('common.cancel')}
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}
