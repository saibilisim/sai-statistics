// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * auth-errors.ts — hesap uçlarının (register/login/resend/google) ham hatalarını
 * `AiAccountErrorCode` enum'una indirger.
 *
 * Neden ayrı bir katman: Renderer'a ham sunucu metni ya da `fetch` exception
 * mesajı GİTMEZ. İki gerekçe var —
 *  1. §6 (i18n): kullanıcıya görünen metin anahtar üzerinden gelmeli; "HTTP 429"
 *     ya da "fetch failed" çevrilemeyen, İngilizce sızıntılardır.
 *  2. Bilgi sızıntısı: exception mesajı iç ağ/DNS/sertifika ayrıntısı taşıyabilir.
 * Ham metin yalnız `detail` alanında, destek/log amaçlı taşınır.
 */

import type { AiAccountErrorCode } from '../../../shared/ai-types'

// Sunucunun (sai-ai-server routes/auth.ts) döndürdüğü `error` kodları →
// client enum'u. Listede olmayan kod 'unknown'a düşer ve ham hâli `detail`de kalır.
const SERVER_ERROR_MAP: Record<string, AiAccountErrorCode> = {
  email_not_verified: 'email_not_verified',
  invalid_credentials: 'invalid_credentials',
  weak_password: 'weak_password',
  invalid_email: 'invalid_email',
  rate_limited: 'rate_limited',
  account_locked: 'account_locked',
  wrong_password: 'wrong_password',
  invalid_or_expired_token: 'invalid_or_expired_token',
  no_password_set: 'no_password_set',
  same_email: 'same_email',
  email_taken: 'email_taken'
}

/**
 * HTTP durum kodu + sunucunun gövdedeki `error` alanından hata kodunu çıkarır.
 * Sunucunun kodu her zaman önceliklidir; yoksa duruma göre karar verilir.
 */
export function authErrorFromResponse(status: number, serverError?: string): AiAccountErrorCode {
  const mapped = serverError ? SERVER_ERROR_MAP[serverError] : undefined
  if (mapped) return mapped
  if (status === 401) return 'invalid_credentials'
  if (status === 403) return 'email_not_verified'
  if (status === 409) return 'email_taken'
  if (status === 423) return 'account_locked'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'unknown'
}

/**
 * `fetch` exception'ı (ağ yok / DNS / TLS / AbortSignal.timeout) → 'network'.
 * Her exception ağ kaynaklı sayılır: bu fonksiyon yalnız fetch çağrılarının
 * catch bloğunda kullanılıyor, orada başka bir hata sınıfı beklenmiyor.
 */
export function authErrorFromException(): AiAccountErrorCode {
  return 'network'
}

/** Ham hata metnini `detail` alanına uygun, sınırlı uzunlukta bir dizgeye indirger. */
export function authErrorDetail(value: unknown): string | undefined {
  const text = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  return text ? text.slice(0, 200) : undefined
}
