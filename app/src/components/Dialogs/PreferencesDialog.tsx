// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import {
  acceleratorFromKeyboardEvent,
  formatAcceleratorForDisplay
} from '../../lib/accelerator-from-key'
import { cx } from '../../lib/cx'
import { useSettingsStore } from '../../store/settings-store'
import { useChatStore } from '../../store/chat-store'
import type { AppSettings } from '@shared/settings-types'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@shared/languages'
import { SHORTCUT_DEFS, resolveShortcuts } from '@shared/shortcuts'
import {
  modelCostTier,
  modelSpeedTier,
  usdToSaiTokens,
  type AiModelTier,
  type AiServerModel
} from '@shared/ai-types'
import { BoltIcon, DollarIcon, SparkleIcon } from '../AIPanel/ai-icons'
import { useAiModelCatalog } from '../../lib/use-ai-model-catalog'
import { useAiAppConfig } from '../../lib/use-ai-app-config'
import { useUpdateInfo } from '../../lib/use-update-info'
import { AccountManagement, AccountDangerZone } from './AccountManagement'

import type { AiSetupInfo, AiAccountStatus, AiCreditPack } from '@shared/ai-types'
import dataStyles from './DataDialogs.module.css'
import styles from './PreferencesDialog.module.css'

type SetupCheck =
  | { state: 'checking' }
  | { state: 'done'; info: AiSetupInfo }
  | { state: 'error' }
  | null

export type PreferencesCategory =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'dataImport'
  | 'output'
  | 'r'
  | 'ai'
  | 'update'
  | 'shortcuts'

const CATEGORIES: { id: PreferencesCategory; icon: string }[] = [
  { id: 'general', icon: '⚙' },
  { id: 'appearance', icon: '☀' },
  { id: 'editor', icon: '⌗' },
  { id: 'dataImport', icon: '⇩' },
  { id: 'output', icon: '▤' },
  { id: 'r', icon: '▶' },
  { id: 'ai', icon: '✦' },
  { id: 'update', icon: '⟳' },
  { id: 'shortcuts', icon: '⌘' }
]

interface Props {
  onClose: () => void
  /** Menü/Ctrl+, çağrısı 'general'a düşer; AI panelindeki dişli ve hata
   * bannerindeki "Ayarları Aç" düğmesi buradan doğrudan 'ai' sekmesini açar. */
  initialCategory?: PreferencesCategory
}

/**
 * P1.1 — Edit ▸ Preferences / Utilities ▸ Settings previously sent
 * 'menu:preferences' to nothing (no case in App.tsx): a menu item that did
 * nothing on click. Theme/language/font size already had a working path via
 * the native menu's own submenus; this dialog is the single place that also
 * covers editor/output formatting and the R console opt-out (CLAUDE.md §9
 * rule 1 — the setting existed in settings.json but had no UI).
 *
 * Restructured (2026-07-30) into a left-sidebar category layout (own shell,
 * not DialogBase — needs more width/height than any other dialog in the
 * app) once the single long scrolling page grew unwieldy; Keyboard Shortcuts
 * was added as a genuinely new category (not just a re-shuffle) since
 * shared/shortcuts.ts's accelerators had never been user-editable before.
 */
export function PreferencesDialog({ onClose, initialCategory }: Props) {
  const { t, i18n } = useTranslation(['dialogs', 'common'])
  // ai.* anahtarları 6 dilde common.json'da mevcut; ancak bu diyalog
  // 'dialogs' namespace'i ağırlıklı olduğundan ve tiplenmiş t() yalnızca
  // useTranslation'a verilen namespace birleşimini kabul ettiğinden,
  // ai.* çözümlemesi için i18n.t doğrudan çağrılır.
  const ta = (key: string, options?: Record<string, unknown>): string => {
    const result = i18n.t(key, options as never)
    return typeof result === 'string' ? result : key
  }
  const settings = useSettingsStore(s => s.settings)
  const setSetting = useSettingsStore(s => s.setSetting)
  const consentGiven = useSettingsStore(s => s.settings.ai.consentGiven)
  const openConsentReview = useChatStore(s => s.openConsentReview)
  const resetAllShortcuts = useSettingsStore(s => s.resetAllShortcuts)

  const [category, setCategory] = useState<PreferencesCategory>(initialCategory ?? 'general')

  const [appearance, setAppearance] = useState(settings.appearance)
  const [editor, setEditor] = useState(settings.editor)
  const [dataImport, setDataImport] = useState(settings.dataImport)
  const [output, setOutput] = useState(settings.output)
  const [r, setR] = useState(settings.r)
  const [ai, setAi] = useState(settings.ai)
  const [startup, setStartup] = useState(settings.startup)

  // Preferences ▸ Update — kısayollar/AI anahtarı gibi anında persist edilir
  // (OK'ye bağlı değil); StatusBar'ın "yeni sürüm" segmentine tıklanınca
  // buraya düşülür (bkz. StatusBar.tsx openUpdatePreferences).
  const updateInfo = useUpdateInfo()
  const handleUpdateDownload = (): void => {
    if (settings.update.dismissedVersion) setSetting('update', { dismissedVersion: null })
    updateInfo.download()
  }
  const handleDismissVersionToggle = (checked: boolean): void => {
    setSetting('update', { dismissedVersion: checked ? updateInfo.latestVersion : null })
  }

  const dialogRef = useRef<HTMLDivElement>(null)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [shortcutFilter, setShortcutFilter] = useState('')

  const resolvedShortcuts = useMemo(
    () => resolveShortcuts(settings.shortcuts),
    [settings.shortcuts]
  )

  const conflicts = useMemo(() => {
    const byAccelerator = new Map<string, string[]>()
    for (const def of SHORTCUT_DEFS) {
      const accel = resolvedShortcuts[def.id]
      if (!accel) continue
      byAccelerator.set(accel, [...(byAccelerator.get(accel) ?? []), def.id])
    }
    const conflictIds = new Set<string>()
    for (const ids of byAccelerator.values()) {
      if (ids.length > 1) ids.forEach(id => conflictIds.add(id))
    }
    return conflictIds
  }, [resolvedShortcuts])

  const filteredShortcutDefs = useMemo(() => {
    const q = shortcutFilter.trim().toLowerCase()
    if (!q) return SHORTCUT_DEFS
    return SHORTCUT_DEFS.filter(def => ta(def.menuKey).toLowerCase().includes(q))
    // `ta` is a plain closure over `i18n` (stable ref) recreated every render —
    // depending on `i18n.language` alone already covers what actually varies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcutFilter, i18n.language])

  useDialogKeyboard({
    containerRef: dialogRef,
    onCancel: onClose,
    // Kayıt (recording) modundayken Enter/Esc/Tab tuş kombinasyonun bir
    // parçası olabilir — global dialog kısayolları devreye girmesin diye
    // hook bu sırada tamamen duraklatılır (onKeyDownCapture kaydı kendi
    // başına yönetiyor).
    paused: recordingId !== null
  })

  // AI bölümü — F4 (ai-entegrasyon-fizibilitesi.md §4.1/§8).
  const [setupCheck, setSetupCheck] = useState<SetupCheck>(null)

  // 'server' provider — SAI hesabı (bizim kotamız). accountStatus null =
  // henüz sorgulanmadı; loggedIn:false = oturum yok, giriş penceresi açılabilir.
  // Kimlik girişi formu artık burada değil — ayrı bir pencerede (LoginWindow,
  // main.ts openLoginWindow, 2026-08-02); bu diyalog yalnız durumu gösterir.
  const [accountStatus, setAccountStatus] = useState<AiAccountStatus | null>(null)

  const refreshAccountStatus = () => {
    void window.api.ai.account.status().then(status => {
      setAccountStatus(status)
    })
  }

  useEffect(() => {
    if (ai.provider === 'server') refreshAccountStatus()
  }, [ai.provider])

  // Giriş penceresi kapanınca (başarılı login/register sonrası kendi kendine
  // kapanır) main bunu push eder — Preferences açıksa durumu tazele.
  useEffect(() => {
    const unsub = window.api.on.aiAccountChanged(() => {
      if (ai.provider === 'server') refreshAccountStatus()
    })
    return () => {
      unsub()
    }
  }, [ai.provider])

  const handleOpenLoginWindow = () => {
    void window.api.ai.account.openLoginWindow()
  }

  const handleAccountLogout = () => {
    void window.api.ai.account.logout().then(() => {
      setAccountStatus({ loggedIn: false })
    })
  }

  // Canlı model kataloğu (server/src/routes/models.ts GET /v1/models) —
  // sabit AI_SERVER_MODEL_CATALOG'un yerini aldı (2026-08-05).
  const modelCatalog = useAiModelCatalog(ai.provider === 'server')
  const serverModels = modelCatalog.status === 'ready' ? modelCatalog.models : []

  // Sunucudan yönetilen konfigürasyon (server/src/routes/config.ts GET
  // /app/config): varsayılan model.
  const appConfig = useAiAppConfig()

  // Kredi paketleri ($10/$20/$50) — free kota bitmiş/kredisiz kullanıcı için
  // satın alma düğmeleri (server/src/routes/billing.ts GET /billing/packs).
  const [creditPacks, setCreditPacks] = useState<AiCreditPack[]>([])
  const [pendingCheckoutVariant, setPendingCheckoutVariant] = useState<string | null>(null)

  useEffect(() => {
    if (ai.provider === 'server' && accountStatus?.loggedIn) {
      void window.api.ai.account.packs().then(setCreditPacks)
    }
  }, [ai.provider, accountStatus?.loggedIn])

  const handleBuyCredits = (variantId: string) => {
    setPendingCheckoutVariant(variantId)
    void window.api.ai.account.checkout({ variantId }).finally(() => {
      setPendingCheckoutVariant(null)
    })
  }

  const handleCheckSetup = () => {
    // ai:get-setup Main'deki KALICI ayarları okur — diyalogda henüz OK ile
    // kaydedilmemiş seçimlerle tutarlı sonuç için önce ai bölümünü persist et.
    persistAiSection()
    setSetupCheck({ state: 'checking' })
    void window.api.ai
      .getSetup()
      .then(info => {
        setSetupCheck({ state: 'done', info })
      })
      .catch(() => {
        setSetupCheck({ state: 'error' })
      })
  }

  const persistAiSection = () => {
    // consentGiven bu diyaloğun yerel kopyasında değil, onay diyaloğunda değişir
    // (aşağıdaki "Veri paylaşımı" satırı) — açılıştaki eski değerle ezme.
    const toPersist = { ...ai, consentGiven: useSettingsStore.getState().settings.ai.consentGiven }
    // Kayıtlı model, sunucu kataloğu değiştiği için artık listede olmayabilir
    // (destek talebi 2026-08-24: "unknown_model" 400'ü). Model dropdown'u bu
    // durumda ekranda ilk geçerli modeli GÖSTERİR ama kullanıcı seçimi elle
    // değiştirmedikçe (onChange tetiklenmedikçe) `ai.model` state'i eskisi
    // kalır — Kaydet'e basılınca o geçersiz id sunucuya gider. Persist anında
    // aynı düzeltmeyi burada uygula ki görünen değerle kayıt edilen değer hep
    // tutarlı olsun.
    if (
      toPersist.provider === 'server' &&
      modelCatalog.status === 'ready' &&
      !serverModels.some(m => m.id === toPersist.model)
    ) {
      const fallback =
        (appConfig?.defaultModelId && serverModels.some(m => m.id === appConfig.defaultModelId)
          ? appConfig.defaultModelId
          : undefined) ?? serverModels[0]?.id
      if (fallback) toPersist.model = fallback
    }
    setSetting('ai', toPersist)
  }

  const handleOk = () => {
    setSetting('appearance', appearance)
    setSetting('editor', editor)
    setSetting('dataImport', dataImport)
    setSetting('output', output)
    setSetting('r', r)
    setSetting('startup', startup)
    persistAiSection()
    onClose()
  }

  // Kısayollar, AI anahtarı gibi anında (OK'ye basmadan) uygulanır —
  // kategoriler arası gezinirken kayıp riski olmasın diye.
  const handleShortcutRecorded = (id: string, accelerator: string) => {
    setSetting('shortcuts', { [id]: accelerator })
    setRecordingId(null)
  }

  const handleShortcutReset = (id: string) => {
    setSetting('shortcuts', { [id]: '' })
  }

  const startRecording = (id: string) => {
    setRecordingId(id)
  }

  const handleRecordKeyDown = (id: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecordingId(null)
      return
    }
    const accelerator = acceleratorFromKeyboardEvent(e)
    if (accelerator) handleShortcutRecorded(id, accelerator)
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="prefs-title">
      <div className={styles.dialog} ref={dialogRef}>
        <div className={styles.header}>
          <span id="prefs-title" className={styles.title}>
            {t('dialogs:preferences.title')}
          </span>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('common:common.close')}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sidebar}>
            {CATEGORIES.map(c => (
              <button
                key={c.id}
                type="button"
                className={cx(styles.navItem, category === c.id && styles.active)}
                onClick={() => {
                  setCategory(c.id)
                }}
              >
                <span className={styles.navIcon}>{c.icon}</span>
                {t(`dialogs:preferences.categories.${c.id}`)}
              </button>
            ))}
          </div>

          <div className={styles.content}>
            {category === 'general' && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.categories.general')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>{t('dialogs:preferences.language')}</span>
                  <select
                    className={dataStyles.condSelect}
                    value={appearance.language}
                    onChange={e => {
                      setAppearance(a => ({
                        ...a,
                        language: e.target.value as AppSettings['appearance']['language']
                      }))
                    }}
                  >
                    {SUPPORTED_LANGUAGES.map(lang => (
                      <option key={lang} value={lang}>
                        {LANGUAGE_LABELS[lang]}
                      </option>
                    ))}
                  </select>
                </div>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={startup.showWelcome}
                    onChange={e => {
                      setStartup(s => ({ ...s, showWelcome: e.target.checked }))
                    }}
                  />
                  {t('dialogs:preferences.showWelcome')}
                </label>
              </>
            )}

            {category === 'appearance' && (
              <>
                <h2 className={styles.pageTitle}>
                  {t('dialogs:preferences.categories.appearance')}
                </h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>{t('dialogs:preferences.theme')}</span>
                  <select
                    className={dataStyles.condSelect}
                    value={appearance.theme}
                    onChange={e => {
                      setAppearance(a => ({
                        ...a,
                        theme: e.target.value as AppSettings['appearance']['theme']
                      }))
                    }}
                  >
                    <option value="system">{t('dialogs:preferences.themeSystem')}</option>
                    <option value="light">{t('dialogs:preferences.themeLight')}</option>
                    <option value="dark">{t('dialogs:preferences.themeDark')}</option>
                    <option value="high-contrast">
                      {t('dialogs:preferences.themeHighContrast')}
                    </option>
                  </select>
                </div>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>{t('dialogs:preferences.fontSize')}</span>
                  <input
                    className={dataStyles.condInput}
                    type="number"
                    min={10}
                    max={20}
                    value={appearance.fontSize}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (!Number.isNaN(v)) setAppearance(a => ({ ...a, fontSize: v }))
                    }}
                  />
                </div>
              </>
            )}

            {category === 'editor' && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.editor')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.decimalSeparator')}
                  </span>
                  <select
                    className={dataStyles.condSelect}
                    value={editor.decimalSeparator}
                    onChange={e => {
                      setEditor(s => ({
                        ...s,
                        decimalSeparator: e.target
                          .value as AppSettings['editor']['decimalSeparator']
                      }))
                    }}
                  >
                    <option value="comma">{t('dialogs:preferences.decimalSeparatorComma')}</option>
                    <option value="dot">{t('dialogs:preferences.decimalSeparatorDot')}</option>
                  </select>
                </div>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.missingValue')}
                  </span>
                  <input
                    className={dataStyles.condInput}
                    type="number"
                    value={editor.missingValue}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (!Number.isNaN(v)) setEditor(s => ({ ...s, missingValue: v }))
                    }}
                  />
                </div>
              </>
            )}

            {category === 'dataImport' && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.dataImportSection')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.categoricalMaxDistinct')}
                  </span>
                  <input
                    className={dataStyles.condInput}
                    type="number"
                    min={0}
                    max={1000}
                    value={dataImport.categoricalMaxDistinct}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (!Number.isNaN(v)) {
                        setDataImport(s => ({ ...s, categoricalMaxDistinct: v }))
                      }
                    }}
                  />
                </div>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.categoricalMaxDistinctHint')}
                </p>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={dataImport.detectDecimalComma}
                    onChange={e => {
                      setDataImport(s => ({ ...s, detectDecimalComma: e.target.checked }))
                    }}
                  />
                  {t('dialogs:preferences.detectDecimalComma')}
                </label>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.detectDecimalCommaHint')}
                </p>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={dataImport.readStatLabels}
                    onChange={e => {
                      setDataImport(s => ({ ...s, readStatLabels: e.target.checked }))
                    }}
                  />
                  {t('dialogs:preferences.readStatLabels')}
                </label>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.readStatLabelsHint')}
                </p>
              </>
            )}

            {category === 'output' && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.output')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.significanceLevel')}
                  </span>
                  <input
                    className={dataStyles.condInput}
                    type="number"
                    step={0.01}
                    min={0}
                    max={1}
                    value={output.significanceLevel}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (!Number.isNaN(v)) setOutput(s => ({ ...s, significanceLevel: v }))
                    }}
                  />
                </div>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.tableStyle')}
                  </span>
                  <select
                    className={dataStyles.condSelect}
                    value={output.tableStyle}
                    onChange={e => {
                      setOutput(s => ({
                        ...s,
                        tableStyle: e.target.value as AppSettings['output']['tableStyle']
                      }))
                    }}
                  >
                    <option value="academic">{t('dialogs:preferences.tableStyleAcademic')}</option>
                    <option value="compact">{t('dialogs:preferences.tableStyleCompact')}</option>
                    <option value="apa">{t('dialogs:preferences.tableStyleApa')}</option>
                  </select>
                </div>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.decimalSeparator')}
                  </span>
                  <select
                    className={dataStyles.condSelect}
                    value={output.decimalSeparator}
                    onChange={e => {
                      setOutput(s => ({
                        ...s,
                        decimalSeparator: e.target
                          .value as AppSettings['output']['decimalSeparator']
                      }))
                    }}
                  >
                    <option value="dot">{t('dialogs:preferences.decimalSeparatorDot')}</option>
                    <option value="comma">{t('dialogs:preferences.decimalSeparatorComma')}</option>
                  </select>
                </div>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={output.dropLeadingZero}
                    onChange={e => {
                      setOutput(s => ({ ...s, dropLeadingZero: e.target.checked }))
                    }}
                  />
                  {t('dialogs:preferences.dropLeadingZero')}
                </label>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.dropLeadingZeroHint')}
                </p>
              </>
            )}

            {category === 'r' && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.rSection')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.timeoutSeconds')}
                  </span>
                  <input
                    className={dataStyles.condInput}
                    type="number"
                    min={10}
                    max={3600}
                    value={r.timeout}
                    onChange={e => {
                      const v = Number(e.target.value)
                      if (!Number.isNaN(v)) setR(s => ({ ...s, timeout: v }))
                    }}
                  />
                </div>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={r.consoleEnabled}
                    onChange={e => {
                      setR(s => ({ ...s, consoleEnabled: e.target.checked }))
                    }}
                  />
                  {t('dialogs:preferences.consoleEnabled')}
                </label>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.consoleEnabledHint')}
                </p>
              </>
            )}

            {category === 'ai' && (
              <>
                <h2 className={styles.pageTitle}>{ta('ai.settings.section')}</h2>

                {/* Sağlayıcı — düz <select> yerine plan-kartı seçici (modern AI
                    ürünlerinin ayar sayfalarına yakın): her seçenek kendi tek
                    satır açıklamasını taşır, seçili olan accent kenarlıkla belirir. */}
                <div
                  className={cx(styles.aiProviderGrid, styles.row)}
                  role="radiogroup"
                  aria-label={ta('ai.settings.provider')}
                >
                  {(['server', 'off'] as const).map(p => (
                    <label key={p} className={styles.aiProviderCard}>
                      <input
                        type="radio"
                        name="ai-provider"
                        checked={ai.provider === p}
                        onChange={() => {
                          setAi(s => ({ ...s, provider: p }))
                          setSetupCheck(null)
                        }}
                      />
                      <span className={styles.aiProviderCardTitle}>
                        {ta(
                          p === 'server' ? 'ai.settings.providerServer' : 'ai.settings.providerOff'
                        )}
                      </span>
                      <span className={styles.aiProviderCardHint}>
                        {ta(`ai.settings.providerHint.${p}`)}
                      </span>
                    </label>
                  ))}
                </div>

                {ai.provider === 'server' &&
                  (accountStatus?.loggedIn ? (
                    <>
                      <div className={cx(styles.aiCard, styles.row)}>
                        <span className={styles.aiCardTitle}>
                          {ta('ai.settings.account.email')}
                        </span>
                        <div className={styles.aiEmailRow}>
                          <span className={styles.aiEmail}>
                            <span className={styles.aiVerifiedDot} aria-hidden="true" />
                            {accountStatus.email}
                          </span>
                          <button
                            type="button"
                            className={dataStyles.btn}
                            onClick={handleAccountLogout}
                          >
                            {ta('ai.settings.account.logout')}
                          </button>
                        </div>
                        {/* Yalnız açıkça `false` ise uyarılır — alan yoksa (eski
                            sunucu sürümü) `undefined` gelir ve "doğrulanmadı"
                            gibi gösterilmez. */}
                        {accountStatus.emailVerified === false && (
                          <p className={cx(dataStyles.emptyNote, styles.unverifiedNote)}>
                            {ta('ai.settings.account.unverifiedWarning')}
                          </p>
                        )}
                        <AccountManagement email={accountStatus.email ?? ''} />
                      </div>

                      <div className={cx(styles.aiCard, styles.row)}>
                        <span className={styles.aiCardTitle}>{ta('ai.credit.statusHint')}</span>
                        <div className={styles.aiBalanceRow}>
                          <span className={styles.aiBalanceValue}>
                            {ta('ai.credit.balanceAmount', {
                              amount: usdToSaiTokens(
                                accountStatus.creditBalanceUsd ?? 0
                              ).toLocaleString()
                            })}
                          </span>
                        </div>
                        {creditPacks.length > 0 && (
                          <div className={styles.creditPackRow}>
                            {creditPacks.map(pack => (
                              <button
                                key={pack.variantId}
                                type="button"
                                className={dataStyles.btn}
                                disabled={pendingCheckoutVariant !== null}
                                onClick={() => {
                                  handleBuyCredits(pack.variantId)
                                }}
                              >
                                {pendingCheckoutVariant === pack.variantId
                                  ? ta('ai.credit.opening')
                                  : ta('ai.credit.buyPack', {
                                      amount: pack.usd,
                                      tokens: pack.credits.toLocaleString()
                                    })}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className={cx(styles.aiCard, styles.row)}>
                        <span className={styles.aiCardTitle}>{ta('ai.settings.model')}</span>
                        {modelCatalog.status === 'offline' ? (
                          <p className={dataStyles.emptyNote}>{ta('ai.models.offline')}</p>
                        ) : (
                          <div className={styles.aiModelGrid}>
                            {serverModels.map(preset => (
                              <label key={preset.id} className={styles.aiModelCard}>
                                <input
                                  type="radio"
                                  name="ai-model"
                                  checked={
                                    (serverModels.some(m => m.id === ai.model)
                                      ? ai.model
                                      : serverModels[0]?.id) === preset.id
                                  }
                                  onChange={() => {
                                    setAi(s => ({ ...s, model: preset.id }))
                                  }}
                                />
                                <span className={styles.aiModelName}>{preset.label}</span>
                                <ModelStats model={preset} ta={ta} />
                              </label>
                            ))}
                          </div>
                        )}
                        {modelCatalog.status !== 'offline' && (
                          <p className={styles.aiModelAttribution}>
                            {ta('ai.models.attribution')}{' '}
                            <a
                              href="https://artificialanalysis.ai/"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Artificial Analysis
                            </a>
                          </p>
                        )}
                      </div>

                      <div className={cx(styles.aiCard, styles.row)}>
                        <AccountDangerZone
                          onLoggedOut={() => {
                            setAccountStatus({ loggedIn: false })
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className={cx(styles.aiCard, styles.row)}>
                      <button
                        type="button"
                        className={cx(styles.btn, styles.primary)}
                        onClick={handleOpenLoginWindow}
                      >
                        {ta('ai.settings.account.openLogin')}
                      </button>
                    </div>
                  ))}

                {ai.provider === 'off' && (
                  <p className={cx(dataStyles.limitationNote, styles.row)}>
                    {ta('ai.settings.offNote')}
                  </p>
                )}

                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={styles.aiStatusPill}>
                    {setupCheck?.state === 'done' && (
                      <span
                        className={cx(
                          styles.aiStatusDot,
                          setupCheck.info.reachable && styles.reachable
                        )}
                        aria-hidden="true"
                      />
                    )}
                    {setupCheck?.state === 'done'
                      ? `${setupCheck.info.reachable ? ta('ai.settings.setupReachable') : ta('ai.settings.setupUnreachable')} — ${ta('ai.settings.setupModel', { model: setupCheck.info.model })} — ${setupCheck.info.hasKey ? ta('ai.settings.keySaved') : ta('ai.settings.noKey')}`
                      : setupCheck?.state === 'error'
                        ? ta('ai.settings.setupError')
                        : ''}
                  </span>
                  <button
                    type="button"
                    className={dataStyles.btn}
                    onClick={handleCheckSetup}
                    disabled={setupCheck?.state === 'checking' || ai.provider === 'off'}
                  >
                    {setupCheck?.state === 'checking'
                      ? ta('ai.settings.setupChecking')
                      : ta('ai.settings.checkSetup')}
                  </button>
                </div>

                {/* İlk AI kullanımındaki veri paylaşım onayı — burada yeniden
                    görüntülenir, verilir ya da geri çekilir. */}
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>{ta('ai.settings.consent.label')}</span>
                  <span>
                    {consentGiven
                      ? ta('ai.settings.consent.given')
                      : ta('ai.settings.consent.notGiven')}
                  </span>
                  <button type="button" className={dataStyles.btn} onClick={openConsentReview}>
                    {ta('ai.settings.consent.review')}
                  </button>
                </div>
              </>
            )}

            {category === 'update' && updateInfo.externallyManaged && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.updateSection')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.updateCurrentVersion')}
                  </span>
                  <span>{updateInfo.currentVersion ?? '—'}</span>
                </div>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.updateManagedByFlathub')}
                </p>
              </>
            )}

            {category === 'update' && !updateInfo.externallyManaged && (
              <>
                <h2 className={styles.pageTitle}>{t('dialogs:preferences.updateSection')}</h2>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.updateCurrentVersion')}
                  </span>
                  <span>{updateInfo.currentVersion ?? '—'}</span>
                </div>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <span className={dataStyles.condLabel}>
                    {t('dialogs:preferences.updateLatestVersion')}
                  </span>
                  <span>{updateInfo.latestVersion ?? '—'}</span>
                </div>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {updateInfo.status === 'checking'
                    ? t('dialogs:preferences.updateStatusChecking')
                    : updateInfo.status === 'not-available'
                      ? t('dialogs:preferences.updateStatusUpToDate')
                      : updateInfo.status === 'available'
                        ? t('dialogs:preferences.updateStatusAvailable')
                        : updateInfo.status === 'downloading'
                          ? t('dialogs:preferences.updateStatusDownloading', {
                              percent: updateInfo.percent ?? 0
                            })
                          : updateInfo.status === 'downloaded'
                            ? t('dialogs:preferences.updateStatusDownloaded')
                            : updateInfo.status === 'error'
                              ? t('dialogs:preferences.updateStatusError')
                              : ''}
                </p>
                <div className={cx(dataStyles.conditionRow, styles.row)}>
                  <button
                    type="button"
                    className={dataStyles.btn}
                    onClick={updateInfo.checkNow}
                    disabled={
                      updateInfo.status === 'checking' || updateInfo.status === 'downloading'
                    }
                  >
                    {t('dialogs:preferences.updateCheckButton')}
                  </button>
                  {updateInfo.usesNativeUpdater ? (
                    updateInfo.status === 'downloaded' ? (
                      <button
                        type="button"
                        className={cx(styles.btn, styles.primary)}
                        onClick={updateInfo.restart}
                      >
                        {t('dialogs:preferences.updateActionRestart')}
                      </button>
                    ) : updateInfo.status === 'available' ? (
                      <button
                        type="button"
                        className={cx(styles.btn, styles.primary)}
                        onClick={handleUpdateDownload}
                      >
                        {t('dialogs:preferences.updateActionDownload')}
                      </button>
                    ) : updateInfo.status === 'error' ? (
                      // Kurulamayan güncelleme (ör. imza denetimi, 2026-10-11)
                      // kullanıcıyı çıkmazda bırakmasın: elle kurulum yolu.
                      <button
                        type="button"
                        className={cx(styles.btn, styles.primary)}
                        onClick={updateInfo.openDownloadPage}
                      >
                        {t('dialogs:preferences.updateActionOpenPage')}
                      </button>
                    ) : null
                  ) : (
                    updateInfo.latestVersion && (
                      <button
                        type="button"
                        className={cx(styles.btn, styles.primary)}
                        onClick={updateInfo.openDownloadPage}
                      >
                        {t('dialogs:preferences.updateActionOpenPage')}
                      </button>
                    )
                  )}
                </div>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={settings.update.autoCheck}
                    onChange={e => {
                      setSetting('update', { autoCheck: e.target.checked })
                    }}
                  />
                  {t('dialogs:preferences.updateAutoCheck')}
                </label>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.updateAutoCheckHint')}
                </p>
                <label className={cx(dataStyles.radioRow, styles.row)}>
                  <input
                    type="checkbox"
                    checked={
                      updateInfo.latestVersion !== null &&
                      settings.update.dismissedVersion === updateInfo.latestVersion
                    }
                    disabled={!updateInfo.latestVersion}
                    onChange={e => {
                      handleDismissVersionToggle(e.target.checked)
                    }}
                  />
                  {t('dialogs:preferences.updateDontShowAgain')}
                </label>
                <p className={cx(dataStyles.emptyNote, styles.row)}>
                  {t('dialogs:preferences.updateDontShowAgainHint')}
                </p>
              </>
            )}

            {category === 'shortcuts' && (
              <>
                <h2 className={styles.pageTitle}>
                  {t('dialogs:preferences.categories.shortcuts')}
                </h2>
                <input
                  className={styles.shortcutSearch}
                  type="text"
                  placeholder={t('dialogs:preferences.shortcuts.searchPlaceholder')}
                  value={shortcutFilter}
                  onChange={e => {
                    setShortcutFilter(e.target.value)
                  }}
                />
                {filteredShortcutDefs.map(def => {
                  const accel = resolvedShortcuts[def.id] ?? ''
                  const isDefault = accel === def.default
                  const isConflict = conflicts.has(def.id)
                  const isRecording = recordingId === def.id
                  return (
                    <div key={def.id} className={styles.shortcutRow}>
                      <span className={styles.shortcutLabel}>{ta(def.menuKey)}</span>
                      <input
                        className={cx(
                          styles.shortcutInput,
                          isRecording && styles.recording,
                          isConflict && !isRecording && styles.conflict
                        )}
                        readOnly
                        value={
                          isRecording
                            ? t('dialogs:preferences.shortcuts.pressKeys')
                            : formatAcceleratorForDisplay(accel, window.api.platform) || '—'
                        }
                        onFocus={() => {
                          startRecording(def.id)
                        }}
                        onBlur={() => {
                          if (recordingId === def.id) setRecordingId(null)
                        }}
                        onKeyDown={handleRecordKeyDown(def.id)}
                      />
                      <button
                        type="button"
                        className={styles.shortcutResetBtn}
                        onClick={() => {
                          handleShortcutReset(def.id)
                        }}
                        disabled={isDefault}
                        aria-label={t('common:common.reset')}
                        title={t('common:common.reset')}
                      >
                        ↺
                      </button>
                    </div>
                  )
                })}
                {conflicts.size > 0 && (
                  <p className={styles.conflictNote}>
                    {t('dialogs:preferences.shortcuts.conflictWarning')}
                  </p>
                )}
                <div className="mt-md">
                  <button type="button" className={styles.btn} onClick={resetAllShortcuts}>
                    {t('dialogs:preferences.shortcuts.resetAll')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.footerLeft} />
          <div className={styles.footerRight}>
            <button className={cx(styles.btn, styles.primary)} onClick={handleOk}>
              {t('common:common.ok')}
            </button>
            <button className={styles.btn} onClick={onClose}>
              {t('common:common.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const TIER_BOXES: readonly AiModelTier[] = [1, 2, 3, 4]

type TaFn = (key: string, options?: Record<string, unknown>) => string

/** 4'lük kutu ölçeği; seviye bilinmiyorsa (hız henüz ölçülmedi) "—". */
function TierBoxes({ tier, label, ta }: { tier: AiModelTier | null; label: string; ta: TaFn }) {
  if (tier === null)
    return <span className={styles.aiModelStatValue}>{ta('ai.models.unknown')}</span>
  const aria = ta('ai.models.levelOf', { label, level: tier })
  return (
    <span className={styles.aiModelTierBoxes} role="img" aria-label={aria} title={aria}>
      {TIER_BOXES.map(n => (
        <span key={n} className={cx(styles.aiModelTierBox, n <= tier && styles.aiModelTierBoxOn)} />
      ))}
    </span>
  )
}

/** Model kartı gövdesi: zeka (Artificial Analysis puanı), maliyet ve hız
 * (4'lük kutu) — bkz. shared/ai-types.ts modelCostTier/modelSpeedTier. */
function ModelStats({ model, ta }: { model: AiServerModel; ta: TaFn }) {
  const intelligence = ta('ai.models.intelligence')
  const cost = ta('ai.models.cost')
  const speed = ta('ai.models.speed')
  return (
    <span className={styles.aiModelStats}>
      <SparkleIcon size={12} aria-hidden="true" />
      <span>{intelligence}</span>
      <span className={styles.aiModelStatValue} title={ta('ai.models.intelligenceHint')}>
        {model.intelligenceIndex != null
          ? Math.round(model.intelligenceIndex).toString()
          : ta('ai.models.unknown')}
      </span>
      <DollarIcon size={12} aria-hidden="true" />
      <span>{cost}</span>
      <TierBoxes tier={modelCostTier(model)} label={cost} ta={ta} />
      <BoltIcon size={12} aria-hidden="true" />
      <span>{speed}</span>
      <TierBoxes tier={modelSpeedTier(model.speedTps)} label={speed} ta={ta} />
    </span>
  )
}
