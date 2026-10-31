// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * credentials.ts — ai-bridge kimlik saklama: 'server' provider oturum
 * token'ları (safeStorage, §6.1) ve access-token yenileme.
 */

import { app, safeStorage } from 'electron'
import { join } from 'path'
import fs from 'fs'
import log from 'electron-log'
import { AI_SERVER_BASE_URL } from '../../../shared/ai-types'

// ─── safeStorage kimlik saklama (§6.1) ───────────────────────────────────────

/**
 * 2026-10-16: BYOK (kendi API anahtarı) özelliği kaldırıldı. Eski sürümlerde
 * (yalnız test kullanıcıları) kaydedilmiş şifreli anahtar dosyasını diskten
 * siler; her açılışta çağrılır, dosya yoksa sessizce geçer.
 */
export function purgeLegacyApiKey(): void {
  const legacy = join(app.getPath('userData'), 'ai-credentials.bin')
  try {
    fs.unlinkSync(legacy)
    log.info('[ai-bridge] removed legacy ai-credentials.bin (BYOK removed)')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[ai-bridge] failed to remove legacy ai-credentials.bin', err)
    }
  }
}

// ─── 'server' provider: oturum token'ı saklama ──────────────────────────────────────────────────────────
// §6.1 deseni: safeStorage, write-only (geri okuma yok — yalnız Main içi
// kullanım).

function sessionPath(): string {
  return join(app.getPath('userData'), 'ai-session.bin')
}

export function hasSessionToken(): boolean {
  try {
    return fs.statSync(sessionPath()).size > 0
  } catch {
    return false
  }
}

// 2026-08-02: access token artık kısa ömürlü (server/src/config.ts
// JWT_ACCESS_TTL, varsayılan 15dk — önceden süresizdi, sızarsa kalıcı erişim
// riskiydi). Dosyada artık tek bir token yerine {accessToken, refreshToken}
// JSON'u şifrelenir; refresh token uzun ömürlü (30gün, server'da yalnız
// hash'i tutulur) ve süresi dolmak üzere olan access token'ı sessizce
// yenilemek için kullanılır (bkz. ensureFreshAccessToken).
export interface StoredSession {
  accessToken: string
  refreshToken: string
}

// Hesap silme için "yakın zamanlı Google doğrulaması" — YALNIZ Main set eder
// (performGoogleLogin('reauth') başarıdan sonra), tek kullanımlık ve kısa ömürlü.
// Yeni oturum yazılınca/silinince sıfırlanır (hesap değişimi kullanılamaz).
const DELETE_REAUTH_TTL_MS = 5 * 60_000
let deleteReauthExpiresAt = 0

export function markDeleteReauth(): void {
  deleteReauthExpiresAt = Date.now() + DELETE_REAUTH_TTL_MS
}

export function consumeDeleteReauth(): boolean {
  const ok = Date.now() < deleteReauthExpiresAt
  deleteReauthExpiresAt = 0
  return ok
}

export function saveSessionTokens(tokens: StoredSession): boolean {
  deleteReauthExpiresAt = 0
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[ai-bridge] safeStorage encryption unavailable; refusing to store session token')
    return false
  }
  try {
    fs.writeFileSync(sessionPath(), safeStorage.encryptString(JSON.stringify(tokens)), {
      mode: 0o600
    })
    return true
  } catch (err) {
    log.warn('[ai-bridge] failed to write ai-session.bin', err)
    return false
  }
}

export function readSessionTokens(): StoredSession | null {
  if (!hasSessionToken()) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const raw = safeStorage.decryptString(fs.readFileSync(sessionPath()))
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
      return null
    }
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
  } catch (err) {
    log.warn('[ai-bridge] failed to decrypt ai-session.bin', err)
    return null
  }
}

export function deleteSessionToken(): boolean {
  deleteReauthExpiresAt = 0
  try {
    fs.unlinkSync(sessionPath())
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true
    log.warn('[ai-bridge] failed to delete ai-session.bin', err)
    return false
  }
}

/** JWT'nin imzasını doğrulamadan yalnız `exp` claim'ini okur — client-side
 * karar yalnız "ne zaman proaktif yenileyelim" içindir, güvenlik sınırı
 * sunucudadır (her istek sunucuda app.authenticate ile doğrulanır). */
function decodeJwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number }
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

// Access token süresi dolmadan bu kadar önce proaktif yenile — istek round-trip
// süresini kapsayacak kadar cömert bir pay.
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000

// Sunucu refresh token'ı her kullanımda rotate eder (server auth.ts
// /auth/refresh): aynı token'la gelen ikinci istek 401 alır. Panel açılırken
// hesap durumu, kredi ve sohbet isteği aynı anda ensureFreshAccessToken
// çağırabiliyordu — süresi dolmuş access token'la ikisi de refresh atıyor,
// ikincisi 401 alıp oturumu siliyordu (kullanıcı "kendiliğinden çıkış
// yaptı" görüyordu). Uçuştaki tek refresh paylaşılır.
let refreshInFlight: Promise<StoredSession | 'rejected' | null> | null = null

/** Yeni token çifti; 'rejected' = sunucu refresh token'ı kesin reddetti
 * (süresi dolmuş/iptal); null = geçici hata (ağ, 5xx, 429) — oturum durur. */
async function refreshAccessToken(
  refreshToken: string
): Promise<StoredSession | 'rejected' | null> {
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(15_000)
    })
    const json = (await res.json().catch(() => ({}))) as {
      token?: string
      refreshToken?: string
    }
    if (res.status === 400 || res.status === 401) {
      log.warn(`[ai-bridge] refresh token rejected (${String(res.status)}) — signing out`)
      return 'rejected'
    }
    if (!res.ok || !json.token || !json.refreshToken) {
      log.warn(`[ai-bridge] refresh failed (${String(res.status)}) — keeping the session`)
      return null
    }
    const tokens: StoredSession = { accessToken: json.token, refreshToken: json.refreshToken }
    saveSessionTokens(tokens)
    return tokens
  } catch (err) {
    log.warn('[ai-bridge] refresh token request failed', err)
    return null
  }
}

/** Geçerli bir access token döner; süresi dolmuşsa/dolmak üzereyse önce
 * sessizce /auth/refresh ile yeniler. Yerel oturum yalnız sunucu refresh
 * token'ı kesin reddederse temizlenir — kullanıcı tekrar login olmalı. Geçici
 * bir hatada null döner ama oturum kalır, sonraki istek yeniden dener. */
export async function ensureFreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return tokenOf(await refreshInFlight)
  const stored = readSessionTokens()
  if (!stored) return null
  const exp = decodeJwtExpiryMs(stored.accessToken)
  const stillFresh = exp !== null && exp - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS
  if (stillFresh) return stored.accessToken
  refreshInFlight = refreshAccessToken(stored.refreshToken)
  try {
    const refreshed = await refreshInFlight
    if (refreshed === 'rejected') deleteSessionToken()
    return tokenOf(refreshed)
  } finally {
    refreshInFlight = null
  }
}

function tokenOf(result: StoredSession | 'rejected' | null): string | null {
  return result && result !== 'rejected' ? result.accessToken : null
}
