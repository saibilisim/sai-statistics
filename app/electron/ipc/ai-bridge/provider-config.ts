// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * provider-config.ts — provider çözümleme (server / off), consent/config
 * guard'ları, hata indirgeme ve reachability ping'i.
 */

import { AI_SERVER_BASE_URL, AI_SERVER_DEFAULT_MODEL } from '../../../shared/ai-types'
import type { AiProviderConfig, AiErrorCode } from '../../../shared/ai-types'
import { getSettings } from '../settings-handler'
import { AiProviderError, AiTimeoutError } from '../../ai/ai-provider'
import { ensureFreshAccessToken } from './credentials'
import log from 'electron-log'
import { fetchAppConfig, fetchModelCatalog } from './app-config'

/**
 * Aktif ayarlardan provider config'i üretir. `null` = istek yapılamaz
 * (provider 'off' ya da SAI hesabı oturumu yok).
 */
async function resolveProviderConfig(): Promise<AiProviderConfig | null> {
  const ai = getSettings().ai
  if (ai.provider === 'off') return null
  // apiKey alanı = /auth/login'den alınan oturum access token'ı, Authorization:
  // Bearer olarak gider (server/src/routes/ai.ts bunu JWT olarak doğrular).
  // ensureFreshAccessToken süresi dolmuşsa/dolmak üzereyse önce sessizce
  // /auth/refresh ile yeniler. Model kullanıcı seçimi (ai.model,
  // PreferencesDialog'daki canlı model dropdown'ı, ai:models → GET /v1/models) —
  // client kataloğu bilmiyor (2026-08-05'te sabit AI_SERVER_MODEL_CATALOG
  // kaldırıldı), id'yi olduğu gibi iletir; sunucu MODEL_CATALOG'a karşı
  // doğrular, bilinmeyen id'yi 400 unknown_model ile reddeder
  // (toAiError → 'unknown').
  const accessToken = await ensureFreshAccessToken()
  if (!accessToken) return null
  // Varsayılan model sunucudan canlı gelir (GET /app/config, 60 sn cache);
  // sunucuya ulaşılamazsa gömülü fallback sabite düşülür.
  const model = await resolveServerModel(ai.model)
  return {
    baseUrl: `${AI_SERVER_BASE_URL}/v1`,
    apiKey: accessToken,
    model
  }
}

/**
 * settings.ai.model'i sunucunun güncel kataloğuna karşı doğrular. Sunucu bir
 * modeli kataloğundan çıkarınca (deepseek-v4-flash-0731 → v4.1-flash,
 * 2026-10-11) o id'yi kayıtlı tutan her kullanıcı her istekte 400
 * unknown_model alıyordu — ilk-kurulum tohumu da o sabitti. Katalogda yoksa
 * sunucunun varsayılanına düşülür; katalog alınamazsa (çevrimdışı) kayıtlı id
 * olduğu gibi gider. Ayar dosyası değiştirilmez: kullanıcı Tercihler'de yeni
 * bir model seçene kadar her istekte sessizce düzeltilir.
 */
async function resolveServerModel(saved: string): Promise<string> {
  const fallback = (await fetchAppConfig())?.defaultModelId || AI_SERVER_DEFAULT_MODEL
  if (!saved) return fallback
  const catalog = await fetchModelCatalog()
  if (catalog.length === 0 || catalog.some(m => m.id === saved)) return saved
  log.warn(`[ai] model "${saved}" is no longer offered — using "${fallback}"`)
  return fallback
}

/** Yapılandırma kaynaklı hatalar — `code` renderer'da yerelleştirilir. */
export class AiConfigError extends Error {
  constructor(
    public readonly code: 'not-signed-in' | 'provider-off' | 'consent-required',
    message: string
  ) {
    super(message)
    this.name = 'AiConfigError'
  }
}

/**
 * Denetim bulgusu #1 (ai-entegrasyon-denetim-2026-07-27.md): "zorunlu
 * ilk-aktivasyon onayı" önceden yalnız Renderer'daki chat-store.ensureConsent()
 * ile uygulanıyordu — gerçek veri-egress sınırı olan Main'de hiç kontrol
 * edilmiyordu. Bu, mevcut tek çağıran yol (chat-store/ai-block-actions) için
 * fonksiyonel bir değişiklik yaratmaz (onay zaten verilmeden çağrılmıyorlar);
 * savunma derinliği olarak trust-boundary'nin kendisinde de garanti eklenir.
 */
function requireConsent(): void {
  if (!getSettings().ai.consentGiven) {
    throw new AiConfigError(
      'consent-required',
      'AI data-sharing consent has not been granted (settings.ai.consentGiven = false)'
    )
  }
}

export async function requireProviderConfig(): Promise<AiProviderConfig> {
  requireConsent()
  const ai = getSettings().ai
  if (ai.provider === 'off') {
    throw new AiConfigError('provider-off', 'AI provider is disabled (settings.ai.provider = off)')
  }
  const config = await resolveProviderConfig()
  if (!config) {
    throw new AiConfigError('not-signed-in', 'Not signed in to a SAI account (no session)')
  }
  return config
}

/**
 * Yakalanan hatayı (message, AiErrorCode) çiftine indirger. Ham sağlayıcı metni
 * `error` alanında korunur (tanı için); `errorCode` renderer'ın yerelleştirilmiş
 * mesaj seçimi içindir.
 */
export function toAiError(err: unknown): { message: string; code: AiErrorCode } {
  if (err instanceof AiConfigError) {
    return { message: err.message, code: err.code }
  }
  // AiProviderError'dan ÖNCE: timeout onun alt sınıfı. Yavaş model "ağ
  // hatası" olarak raporlanmamalı (kullanıcıyı internet/endpoint aramaya
  // yönlendiriyordu, 2026-08-14).
  if (err instanceof AiTimeoutError) {
    return { message: err.message, code: 'timeout' }
  }
  if (err instanceof AiProviderError) {
    if (err.status === 401 || err.status === 403) return { message: err.message, code: 'auth' }
    if (err.status === 402) return { message: err.message, code: 'payment' }
    if (err.status === 429) return { message: err.message, code: 'rate-limit' }
    // status yok = fetch katmanında başarısızlık (DNS/timeout/TLS)
    if (err.status === undefined) return { message: err.message, code: 'network' }
    return { message: err.message, code: 'unknown' }
  }
  return { message: err instanceof Error ? err.message : String(err), code: 'unknown' }
}

// ─── Reachability ping (ai:get-setup) ────────────────────────────────────────
// Ucuz tutulur: kısa timeout'lu tek GET, sonuç kısa süre cache'lenir.

const REACHABILITY_TTL_MS = 60_000
const REACHABILITY_TIMEOUT_MS = 3_000
let reachabilityCache: { baseUrl: string; reachable: boolean; at: number } | null = null

export async function checkReachable(baseUrl: string): Promise<boolean> {
  const now = Date.now()
  if (
    reachabilityCache &&
    reachabilityCache.baseUrl === baseUrl &&
    now - reachabilityCache.at < REACHABILITY_TTL_MS
  ) {
    return reachabilityCache.reachable
  }
  let reachable = false
  try {
    const res = await fetch(baseUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS)
    })
    // 401/404 bile endpoint'in ayakta olduğunun kanıtı — 5xx ve ağ hatası değil.
    reachable = res.status < 500
  } catch {
    reachable = false
  }
  reachabilityCache = { baseUrl, reachable, at: now }
  return reachable
}
