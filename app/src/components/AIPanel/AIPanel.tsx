// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, AI_PANEL_MIN_WIDTH, AI_PANEL_MAX_WIDTH } from '../../store/ui-store'
import { useSettingsStore } from '../../store/settings-store'
import { useChatStore } from '../../store/chat-store'
import { useAiModelCatalog } from '../../lib/use-ai-model-catalog'
import { usdToSaiTokens, type AiAccountStatus } from '@shared/ai-types'
import { ChatMessageList } from './ChatMessageList'
import { ChatInput } from './ChatInput'
import { SparkleIcon, GearIcon, TrashIcon, XIcon } from './ai-icons'
import styles from './AIPanel.module.css'

function openAiSettings(): void {
  window.dispatchEvent(new CustomEvent('sai:open-preferences', { detail: { category: 'ai' } }))
}

/**
 * AIPanel — AI sohbet paneli, sağ dock (spec §5.1). Tam-görünüm sekme değil;
 * tüm sekmelerle yan yana açık kalır. App.tsx layout kolonuna yerleşir.
 */
export function AIPanel() {
  const { t } = useTranslation(['common'])
  const open = useUIStore(s => s.aiPanelOpen)
  const width = useUIStore(s => s.aiPanelWidth)
  const toggleAiPanel = useUIStore(s => s.toggleAiPanel)
  const setAiPanelWidth = useUIStore(s => s.setAiPanelWidth)
  const provider = useSettingsStore(s => s.settings.ai.provider)
  const model = useSettingsStore(s => s.settings.ai.model)
  const reasoningEffort = useSettingsStore(s => s.settings.ai.reasoningEffort)
  const setSetting = useSettingsStore(s => s.setSetting)
  const messages = useChatStore(s => s.messages)
  const clearChat = useChatStore(s => s.clearChat)
  const modelCatalog = useAiModelCatalog(provider === 'server')

  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  // 'server' provider — AI kullanmak için giriş ZORUNLU (2026-08-04). accountStatus
  // null = henüz sorgulanmadı; loggedIn:false ise input kilitli, "Giriş yap" kartı
  // gösterilir (aynı desen PreferencesDialog'daki refreshAccountStatus ile).
  const [accountStatus, setAccountStatus] = useState<AiAccountStatus | null>(null)

  const refreshAccountStatus = useCallback(() => {
    void window.api.ai.account.status().then(status => {
      setAccountStatus(status)
    })
  }, [])

  // Panel her açıldığında bakiye yeniden sorulur; harcama sonrası tazeleme
  // aşağıdaki aiAccountChanged aboneliğinden gelir (Main her AI çağrısı
  // bitince gönderir — ai-bridge notifyCreditsSpent).
  useEffect(() => {
    if (provider === 'server' && open) refreshAccountStatus()
  }, [provider, open, refreshAccountStatus])

  useEffect(() => {
    const unsub = window.api.on.aiAccountChanged(() => {
      if (provider === 'server') refreshAccountStatus()
    })
    return () => {
      unsub()
    }
  }, [provider, refreshAccountStatus])

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragState.current = { startX: e.clientX, startWidth: width }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [width]
  )
  const onResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return
      // Sol kenar sürükleniyor: imleç sola gittikçe panel genişler.
      const delta = dragState.current.startX - e.clientX
      setAiPanelWidth(dragState.current.startWidth + delta)
    },
    [setAiPanelWidth]
  )
  const onResizeEnd = useCallback(() => {
    dragState.current = null
  }, [])

  if (!open) return null

  const needsLogin = provider === 'server' && accountStatus !== null && !accountStatus.loggedIn
  const inputDisabled = provider === 'off' || needsLogin

  return (
    <aside
      className={styles.panel}
      style={{ width }}
      aria-label={t('ai.panel.title')}
      data-ai-panel-min={AI_PANEL_MIN_WIDTH}
      data-ai-panel-max={AI_PANEL_MAX_WIDTH}
    >
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />

      {/* Üst bar: başlık + eylemler — model/düşünme seçici artık composer'ın
          üstünde (bottomBar, modern sohbet istemcisi düzeni). */}
      <div className={styles.topBar}>
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <span className={styles.aiBadge} aria-hidden="true">
              <SparkleIcon size={12} />
            </span>
            <span className={styles.title}>{t('ai.panel.title')}</span>
          </div>
          <div className={styles.headerActions}>
            {messages.length > 0 && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={clearChat}
                title={t('ai.panel.clearChat')}
                aria-label={t('ai.panel.clearChat')}
              >
                <TrashIcon size={14} />
              </button>
            )}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={openAiSettings}
              title={t('ai.panel.settings')}
              aria-label={t('ai.panel.settings')}
            >
              <GearIcon size={14} />
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={toggleAiPanel}
              aria-label={t('ai.panel.close')}
            >
              <XIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      {provider === 'off' && (
        <div className={styles.notice} role="note">
          {t('ai.panel.providerOff')}
        </div>
      )}

      {needsLogin && (
        <div className={styles.notice} role="note">
          <p>{t('ai.settings.account.loginRequired')}</p>
          <button
            type="button"
            className={styles.errorSettingsBtn}
            onClick={() => {
              void window.api.ai.account.openLoginWindow()
            }}
          >
            {t('ai.settings.account.openLogin')}
          </button>
        </div>
      )}

      <ChatMessageList />

      {provider !== 'off' && !needsLogin && (
        <div className={styles.bottomBar}>
          {modelCatalog.status === 'offline' ? (
            <span className={styles.modelSelect} title={t('ai.models.offlineHint')}>
              {t('ai.models.offline')}
            </span>
          ) : modelCatalog.status === 'ready' ? (
            <select
              className={styles.modelSelect}
              value={
                modelCatalog.models.some(m => m.id === model)
                  ? model
                  : (modelCatalog.models[0]?.id ?? model)
              }
              onChange={e => {
                setSetting('ai', { model: e.target.value })
              }}
            >
              {modelCatalog.models.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          ) : (
            <span className={styles.modelSelect}>{model}</span>
          )}
          <select
            className={styles.reasoningSelect}
            value={reasoningEffort}
            title={t('ai.panel.reasoningHint')}
            aria-label={t('ai.panel.reasoningLabel')}
            onChange={e => {
              setSetting('ai', {
                reasoningEffort: e.target.value as typeof reasoningEffort
              })
            }}
          >
            <option value="off">{t('ai.panel.reasoningOff')}</option>
            <option value="low">{t('ai.panel.reasoningLow')}</option>
            <option value="medium">{t('ai.panel.reasoningMedium')}</option>
            <option value="high">{t('ai.panel.reasoningHigh')}</option>
          </select>
          {accountStatus?.loggedIn && (
            <span className={styles.capabilityTag} title={t('ai.credit.statusHint')}>
              <span className={styles.capabilityDot} aria-hidden="true" />
              {t('ai.credit.balance', {
                amount: usdToSaiTokens(accountStatus.creditBalanceUsd ?? 0).toLocaleString()
              })}
            </span>
          )}
        </div>
      )}

      <ChatInput disabled={inputDisabled} />
    </aside>
  )
}
