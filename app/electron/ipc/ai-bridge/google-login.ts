// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * google-login.ts — 'server' provider: Google ile giriş (RFC 8252 sistem
 * tarayıcısı + loopback redirect).
 */

import { shell } from 'electron'
import http from 'node:http'
import { randomBytes, createHash } from 'crypto'
import { AI_SERVER_BASE_URL, AI_GOOGLE_CLIENT_ID } from '../../../shared/ai-types'
import type { AiAccountAuthResult } from '../../../shared/ai-types'
import { saveSessionTokens, ensureFreshAccessToken, markDeleteReauth } from './credentials'
import { authErrorFromResponse, authErrorFromException, authErrorDetail } from './auth-errors'

// Electron BrowserWindow içine Google'ın kendi login sayfası gömülmez — Google
// bunu "embedded user-agent" olarak reddediyor/uyarıyor. Bunun yerine: PKCE
// çifti üret → OS'in varsayılan tarayıcısında consent ekranını aç → 127.0.0.1
// üzerinde geçici bir HTTP sunucusu `code`'u yakalar → `code`+`codeVerifier`
// server/'a (auth.ts /auth/google) gönderilir; client_secret'la asıl kod
// değişimi orada, Main'in HİÇ görmediği bir sırla yapılır (§9 "R'a giden
// girdiler" kuralının OAuth analoğu: gizli materyal client'a hiç gömülmez).

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_LOGIN_TIMEOUT_MS = 5 * 60_000

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function googleCallbackHtml(ok: boolean): string {
  // Yalnız bilgilendirici — kullanıcı bu sekmeyi kapatıp Electron'a döner.
  const message = ok
    ? 'Giriş tamamlandı, bu sekmeyi kapatabilirsiniz. / Signed in — you can close this tab.'
    : 'Giriş başarısız oldu, bu sekmeyi kapatıp tekrar deneyin. / Sign-in failed — close this tab and try again.'
  return `<!doctype html><html><head><meta charset="utf-8"><title>SAI Statistics</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;">${message}</body></html>`
}

async function fetchAccountEmail(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const json = (await res.json()) as { email?: unknown }
    return typeof json.email === 'string' ? json.email.toLowerCase() : null
  } catch {
    return null
  }
}

/** 'login': normal giriş. 'reauth': hesap silme öncesi yeniden doğrulama — gelen
 * oturum MEVCUT hesapla aynı e-postaya ait değilse hiçbir şey saklanmaz. */
export type GoogleFlowMode = 'login' | 'reauth'

async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  mode: GoogleFlowMode,
  expectedEmail: string | null
): Promise<AiAccountAuthResult> {
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier, redirectUri }),
      signal: AbortSignal.timeout(20_000)
    })
    const json = (await res.json().catch(() => ({}))) as {
      token?: string
      refreshToken?: string
      error?: string
    }
    if (!res.ok || !json.token || !json.refreshToken) {
      return {
        ok: false,
        error: authErrorFromResponse(res.status, json.error),
        detail: authErrorDetail(json.error)
      }
    }
    if (mode === 'reauth') {
      const email = await fetchAccountEmail(json.token)
      if (!email || !expectedEmail || email !== expectedEmail) {
        return { ok: false, error: 'google_failed', detail: 'account_mismatch' }
      }
    }
    const saved = saveSessionTokens({ accessToken: json.token, refreshToken: json.refreshToken })
    if (!saved) return { ok: false, error: 'storage_unavailable' }
    if (mode === 'reauth') markDeleteReauth()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: authErrorFromException(), detail: authErrorDetail(err) }
  }
}

/** ai:account:google-login — akışın tamamı burada: loopback sunucu açılır,
 * sistem tarayıcısı yönlendirilir, callback yakalanınca sunucu kapanır ve
 * sonuç (login/register ile aynı AiAccountAuthResult şekli) döner. */
export async function performGoogleLogin(
  mode: GoogleFlowMode = 'login'
): Promise<AiAccountAuthResult> {
  if (!AI_GOOGLE_CLIENT_ID) {
    return { ok: false, error: 'google_failed', detail: 'google_not_configured' }
  }

  let expectedEmail: string | null = null
  if (mode === 'reauth') {
    const current = await ensureFreshAccessToken()
    expectedEmail = current ? await fetchAccountEmail(current) : null
    if (!expectedEmail) return { ok: false, error: 'invalid_credentials' }
  }

  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = base64url(randomBytes(16))

  return new Promise<AiAccountAuthResult>(resolve => {
    let settled = false
    let redirectUri = ''

    const finish = (work: () => Promise<AiAccountAuthResult>): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      server.close()
      void work().then(resolve)
    }

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const returnedState = url.searchParams.get('state')
      // A request without our state is not Google's redirect (e.g. a local
      // process probing the port): ignore it instead of killing the sign-in.
      if (returnedState !== state) {
        res.writeHead(400).end()
        return
      }
      const code = url.searchParams.get('code')
      const errorParam = url.searchParams.get('error')
      const ok = !errorParam && !!code && returnedState === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(googleCallbackHtml(ok))
      finish(async () => {
        // errorParam / state uyuşmazlığı kullanıcıya ham hâliyle GÖSTERİLMEZ
        // (çevrilemeyen Google metni + gereksiz iç ayrıntı) — tek bir
        // 'google_failed' koduna indirgenir, ham hâli yalnız `detail`de kalır.
        if (errorParam) return { ok: false, error: 'google_failed', detail: errorParam }
        if (!code || returnedState !== state) {
          return { ok: false, error: 'google_failed', detail: 'invalid_callback' }
        }
        return exchangeGoogleCode(code, codeVerifier, redirectUri, mode, expectedEmail)
      })
    })

    server.on('error', err => {
      finish(() =>
        Promise.resolve({ ok: false, error: 'google_failed', detail: authErrorDetail(err) })
      )
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      redirectUri = `http://127.0.0.1:${String(port)}/callback`
      const authUrl = new URL(GOOGLE_AUTH_ENDPOINT)
      authUrl.searchParams.set('client_id', AI_GOOGLE_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid email profile')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('access_type', 'online')
      authUrl.searchParams.set('prompt', 'select_account')
      void shell.openExternal(authUrl.toString())
    })

    const timeoutHandle = setTimeout(() => {
      finish(() => Promise.resolve({ ok: false, error: 'google_failed', detail: 'timeout' }))
    }, GOOGLE_LOGIN_TIMEOUT_MS)
  })
}
