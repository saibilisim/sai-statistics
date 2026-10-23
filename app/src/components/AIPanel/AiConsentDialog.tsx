// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useSettingsStore } from '../../store/settings-store'
import styles from '../Dialogs/DialogBase.module.css'
import local from './AiConsentDialog.module.css'

const SHARED_KEYS = [
  'ai.consent.itemMetadata',
  'ai.consent.itemAggregates',
  'ai.consent.itemResults',
  'ai.consent.itemFilterState'
] as const

function CheckIcon() {
  return (
    <svg className={local.checkIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className={local.shieldIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.5l5 2v4c0 3.2-2.1 5.7-5 7-2.9-1.3-5-3.8-5-7v-4l5-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M5.8 8.2l1.6 1.6 3-3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * AiConsentDialog — zorunlu ilk-aktivasyon veri-paylaşım onayı (spec §4/§6).
 * İlk ai:send (veya Output AI aksiyonu) öncesinde açılır; kabul edilmeden
 * hiçbir veri Main'e/provider'a gönderilmez. Onay settings.ai.consentGiven
 * olarak kalıcılaşır. Chat-store state'iyle sürüldüğü için panel kapalıyken
 * de (Output'tan gelen ensureConsent çağrılarında) çalışır — App.tsx'e
 * global olarak monte edilir.
 */
export function AiConsentDialog() {
  const { t } = useTranslation(['common'])
  const open = useChatStore(s => s.consentDialogOpen)
  const acceptConsent = useChatStore(s => s.acceptConsent)
  const declineConsent = useChatStore(s => s.declineConsent)
  const revokeConsent = useChatStore(s => s.revokeConsent)
  const aiSettings = useSettingsStore(s => s.settings.ai)
  // Tercihler ▸ AI'dan yeniden açıldığında onay zaten verilmiş olabilir:
  // o zaman Kabul/Reddet yerine Geri çek/Kapat.
  const given = aiSettings.consentGiven

  if (!open) return null

  const providerLabel = t('ai.consent.providerServer')

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
    >
      <div className={`${styles.dialog ?? ''} ${local.dialog ?? ''}`}>
        <div className={styles.header}>
          <span id="ai-consent-title" className={styles.title}>
            {t('ai.consent.title')}
          </span>
          <button
            className={styles.closeBtn}
            onClick={declineConsent}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className={`${styles.body ?? ''} ${local.body ?? ''}`}>
          <p className={local.intro}>{t('ai.consent.intro')}</p>

          <section aria-labelledby="ai-consent-shared">
            <h3 id="ai-consent-shared" className={local.sectionLabel}>
              {t('ai.consent.sharedHeading')}
            </h3>
            <ul className={local.list}>
              {SHARED_KEYS.map(key => (
                <li key={key} className={local.item}>
                  <CheckIcon />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </section>

          <p className={local.assurance}>
            <ShieldIcon />
            <span>{t('ai.consent.noRawRows')}</span>
          </p>

          <dl className={local.meta}>
            <dt>{t('ai.consent.providerLabel')}</dt>
            <dd>{providerLabel}</dd>
            <dt>{t('ai.consent.modelLabel')}</dt>
            <dd className={local.model}>{aiSettings.model}</dd>
          </dl>
        </div>

        <div className={styles.footer}>
          <div className={styles.footerLeft} />
          {given ? (
            <div className={styles.footerRight}>
              <button className={styles.btn} onClick={revokeConsent}>
                {t('ai.consent.revoke')}
              </button>
              <button
                className={`${styles.btn ?? ''} ${styles.primary ?? ''}`}
                onClick={declineConsent}
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <div className={styles.footerRight}>
              <button
                className={`${styles.btn ?? ''} ${styles.primary ?? ''}`}
                onClick={acceptConsent}
              >
                {t('ai.consent.accept')}
              </button>
              <button className={styles.btn} onClick={declineConsent}>
                {t('ai.consent.decline')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
