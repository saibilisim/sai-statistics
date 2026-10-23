// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-errors.ts — AI hatalarını AiErrorCode'a çözümler (renderer tarafı).
 *
 * Öncelik Main'in stream-chunk'ta gönderdiği yapılandırılmış `errorCode`'dadır.
 * Yedek: `ai:interpret` gibi yalnız hata *mesajı* taşıyan yollar (IPC invoke
 * reddi yalnız string serileştirir) için ham metinden "Provider HTTP <status>"
 * ayrıştırması. Bilerek i18n'e (dolayısıyla `t()`'e) DOKUNMAZ — bu saf bir
 * store/mantık modülü; gerçek yerelleştirme yalnız React bileşenlerinde
 * `useTranslation()` ile yapılır (i18next kaynakları Suspense'le yükleniyor,
 * store'dan doğrudan `i18n.t()` çağırmak yükleme-öncesi ham anahtar dönme
 * riski taşırdı).
 */

import type { AiErrorCode } from '@shared/ai-types'

const KNOWN_CODES: readonly string[] = [
  'auth',
  'payment',
  'rate-limit',
  'network',
  'timeout',
  'not-signed-in',
  'provider-off',
  'consent-required',
  'unknown'
]

export function resolveAiErrorCode(
  errorCode: string | undefined,
  message: string | null
): AiErrorCode | null {
  if (errorCode && KNOWN_CODES.includes(errorCode)) return errorCode as AiErrorCode
  if (!message) return null

  const http = /Provider HTTP (\d{3})/.exec(message)
  if (http) {
    const status = Number(http[1])
    if (status === 401 || status === 403) return 'auth'
    if (status === 402) return 'payment'
    if (status === 429) return 'rate-limit'
    return 'unknown'
  }
  if (/Not signed in to a SAI account/.test(message)) return 'not-signed-in'
  if (/provider is disabled/.test(message)) return 'provider-off'
  if (/consent has not been granted/.test(message)) return 'consent-required'
  // Zaman aşımı 'network'ten ÖNCE denenir: eski Main sürümleri timeout'u da
  // "Provider request failed: …timeout" metniyle gönderiyor.
  if (/timed out|timeout/i.test(message)) return 'timeout'
  if (/Provider request failed/.test(message)) return 'network'
  return 'unknown'
}

// AiErrorCode (hyphenated, wire format) → ai.error.* i18n anahtarı (camelCase).
// Yerelleştirme burada YAPILMAZ (yukarıdaki not) — yalnız anahtar eşlemesi;
// `t(`ai.error.${ERROR_I18N_KEY[code]}`)` çağrısı ChatMessageList'te (React).
export const ERROR_I18N_KEY = {
  auth: 'auth',
  payment: 'payment',
  'rate-limit': 'rateLimit',
  network: 'network',
  timeout: 'timeout',
  'not-signed-in': 'notSignedIn',
  'provider-off': 'providerOff',
  'consent-required': 'consentRequired',
  unknown: 'unknown'
} as const satisfies Record<AiErrorCode, string>

// Ayarlar diyaloğunu açmanın anlamlı olduğu hata sınıfları — provider/anahtar/
// onay yapılandırmasıyla ilgili; rate-limit/network/unknown geçicidir, ayar
// değişikliği gerektirmez.
const SETTINGS_ACTIONABLE_CODES: ReadonlySet<AiErrorCode> = new Set([
  'auth',
  'payment',
  'not-signed-in',
  'provider-off',
  'consent-required'
])

export function isSettingsActionable(code: AiErrorCode | null): boolean {
  return code !== null && SETTINGS_ACTIONABLE_CODES.has(code)
}
