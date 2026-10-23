// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useUIStore } from '../../store/ui-store'
import { useDatasetStore } from '../../store/dataset-store'
import { useSettingsStore } from '../../store/settings-store'
import { useGridBridgeStore } from '../../store/grid-bridge-store'
import { useStatusNoticeStore } from '../../store/status-notice-store'
import { useUpdateInfo } from '../../lib/use-update-info'
import styles from './StatusBar.module.css'

/** AIPanel'in kullandığı aynı desen (use-app-effects.ts dinler) — Preferences'ı
 *  belirli bir sekmede açtırır. StatusBar'daki güncelleme segmentinin tek
 *  görevi artık bu: indirme/kurulum kararını doğrudan burada almak yerine
 *  kullanıcıyı "Güncelle"/"Bir daha gösterme" seçeneklerinin olduğu
 *  Preferences ▸ Güncelleme sekmesine yönlendirmek. */
function openUpdatePreferences(): void {
  window.dispatchEvent(new CustomEvent('sai:open-preferences', { detail: { category: 'update' } }))
}

export function StatusBar() {
  const { t } = useTranslation(['common', 'menu', 'analysis', 'dialogs'])
  const { status, latestVersion, percent } = useUpdateInfo()
  const dismissedVersion = useSettingsStore(s => s.settings.update.dismissedVersion)
  const {
    rStatus,
    isProcessing,
    processingMessageKey,
    processingParams,
    showStatusBar,
    showColumnFilterIcons,
    activeTab
  } = useUIStore(
    useShallow(s => ({
      activeTab: s.activeTab,
      rStatus: s.rStatus,
      isProcessing: s.isProcessing,
      processingMessageKey: s.processingMessageKey,
      processingParams: s.processingParams,
      showStatusBar: s.showStatusBar,
      showColumnFilterIcons: s.showColumnFilterIcons
    }))
  )
  const { rowCount, variables, weightVariable, splitVariable, filterActive } = useDatasetStore(
    useShallow(s => ({
      rowCount: s.rowCount,
      variables: s.variables,
      weightVariable: s.weightVariable,
      splitVariable: s.splitVariable,
      filterActive: s.filterActive
    }))
  )
  const selectedCellCount = useGridBridgeStore(s => s.selectedCellCount)
  const { noticeKey, noticeTone } = useStatusNoticeStore(
    useShallow(s => ({ noticeKey: s.messageKey, noticeTone: s.tone }))
  )

  if (!showStatusBar) return null

  const rStatusKey = {
    starting: 'status.rStarting',
    ready: 'status.rConnected',
    'not-found': 'status.rNotFound',
    error: 'status.rError'
  }[rStatus]

  const isFilterActive = filterActive || showColumnFilterIcons

  const weightVarName = weightVariable
    ? (variables.find(v => v.colId === weightVariable || v.name === weightVariable)?.name ??
      weightVariable)
    : null

  const splitVarName = splitVariable
    ? (variables.find(v => v.colId === splitVariable || v.name === splitVariable)?.name ??
      splitVariable)
    : null

  return (
    <div className={styles.statusbar} role="status" aria-live="polite">
      <span
        className={`${styles.segment ?? ''} ${!isProcessing && noticeKey ? (styles[noticeTone] ?? '') : ''}`}
      >
        {isProcessing
          ? t((processingMessageKey || 'status.processing') as never, processingParams)
          : noticeKey
            ? t(noticeKey as never)
            : t('status.ready')}
      </span>
      <span className={styles.divider} />
      <span className={styles.segment}>{t('status.cases', { count: rowCount })}</span>
      <span className={styles.divider} />
      <span className={styles.segment}>{t('status.variables', { count: variables.length })}</span>
      {activeTab === 'data' && selectedCellCount > 1 && (
        <>
          <span className={styles.divider} />
          <span className={styles.segment}>
            {t('status.selectedCells', { count: selectedCellCount.toLocaleString() })}
          </span>
        </>
      )}
      <span className={styles.divider} />
      <span className={`${styles.segment ?? ''} ${isFilterActive ? (styles.active ?? '') : ''}`}>
        {isFilterActive ? t('status.filterOn') : t('status.filterOff')}
      </span>
      <span className={styles.divider} />
      <span
        className={`${styles.segment ?? ''} ${weightVarName ? (styles.active ?? '') : ''}`}
        title={weightVarName ? t('dialog.weightCases.scopeNote') : undefined}
      >
        {weightVarName ? t('status.weightOn', { var: weightVarName }) : t('status.weightOff')}
      </span>
      <span className={styles.divider} />
      <span
        className={`${styles.segment ?? ''} ${splitVarName ? (styles.active ?? '') : ''}`}
        title={splitVarName ? t('dialog.splitFile.scopeNote') : undefined}
      >
        {splitVarName ? t('status.splitOn', { var: splitVarName }) : t('status.splitOff')}
      </span>
      <span className={styles.spacer} />
      {status === 'downloaded' && latestVersion ? (
        <>
          <button
            type="button"
            className={`${styles.segment ?? ''} ${styles.updateAvailable ?? ''}`}
            title={t('status.updateReadyRestartHint')}
            onClick={openUpdatePreferences}
          >
            {t('status.updateReadyRestart', { version: latestVersion })}
          </button>
          <span className={styles.divider} />
        </>
      ) : status === 'downloading' && percent !== null ? (
        <>
          <span
            className={`${styles.segment ?? ''} ${styles.updateAvailable ?? ''} ${styles.downloading ?? ''}`}
            title={t('status.updateDownloadingHint')}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            {t('status.updateDownloading', { percent })}
            <span className={styles.progressTrack}>
              <span
                className={styles.progressFill}
                style={{ '--progress': `${String(percent)}%` } as CSSProperties}
              />
            </span>
          </span>
          <span className={styles.divider} />
        </>
      ) : (
        status === 'available' &&
        latestVersion &&
        // Preferences ▸ Güncelleme'de "Bu sürüm için bir daha gösterme"
        // işaretlenmişse (settings.update.dismissedVersion) bu sürüm için
        // sessiz kal — yeni bir sürüm çıkınca değer eşleşmeyeceği için
        // bildirim otomatik geri döner.
        dismissedVersion !== latestVersion && (
          <>
            <button
              type="button"
              className={`${styles.segment ?? ''} ${styles.updateAvailable ?? ''}`}
              title={t('status.updateAvailableHint')}
              onClick={openUpdatePreferences}
            >
              {t('status.updateAvailable', { version: latestVersion })}
            </button>
            <span className={styles.divider} />
          </>
        )
      )}
      <span className={`${styles.segment ?? ''} ${styles.rStatus ?? ''} ${styles[rStatus] ?? ''}`}>
        {t(rStatusKey as never)}
      </span>
    </div>
  )
}
