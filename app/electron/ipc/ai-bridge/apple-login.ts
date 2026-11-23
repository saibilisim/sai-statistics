// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * apple-login.ts — 'server' provider: Sign in with Apple (system browser +
 * loopback, like google-login.ts).
 *
 * Apple's web flow only returns to an https URL, so the browser goes through
 * our server (server: routes/auth-apple.ts):
 *   1. a loopback server on 127.0.0.1 waits; the browser opens
 *      <server>/auth/apple/start?port&state&code_challenge (PKCE S256);
 *   2. the server sends the user to Apple, verifies Apple's answer and sends
 *      the browser back to http://127.0.0.1:<port>/callback?code&state with a
 *      one-time, two-minute code;
 *   3. Main posts that code with the PKCE verifier to /auth/apple/exchange and
 *      receives our session tokens. The verifier never leaves Main, so another
 *      process listening on the loopback port cannot use a stolen code.
 * Apple's client secret and key live only on the server.
 */

import { shell } from 'electron'
import http from 'node:http'
import { randomBytes, createHash } from 'crypto'
import { AI_SERVER_BASE_URL } from '../../../shared/ai-types'
import type { AiAccountAuthResult } from '../../../shared/ai-types'
import { saveSessionTokens, ensureFreshAccessToken, markDeleteReauth } from './credentials'
import { authErrorFromResponse, authErrorFromException, authErrorDetail } from './auth-errors'
import { fetchAccountEmail, type GoogleFlowMode as AppleFlowMode } from './google-login'

const APPLE_LOGIN_TIMEOUT_MS = 5 * 60_000

function callbackHtml(ok: boolean): string {
  const message = ok
    ? 'Giriş tamamlandı, bu sekmeyi kapatabilirsiniz. / Signed in — you can close this tab.'
    : 'Giriş tamamlanamadı, bu sekmeyi kapatıp tekrar deneyin. / Sign-in failed — close this tab and try again.'
  return `<!doctype html><html><head><meta charset="utf-8"><title>SAI Statistics</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;">${message}</body></html>`
}

async function exchangeAppleCode(
  code: string,
  codeVerifier: string,
  mode: AppleFlowMode,
  expectedEmail: string | null
): Promise<AiAccountAuthResult> {
  try {
    const res = await fetch(`${AI_SERVER_BASE_URL}/auth/apple/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier }),
      signal: AbortSignal.timeout(20_000)
    })
    const json = (await res.json().catch(() => ({}))) as {
      token?: string
      refreshToken?: string
      error?: string
    }
    if (!res.ok || !json.token || !json.refreshToken) {
      // An invalid/expired one-time code is a failed Apple flow, not bad credentials.
      const error =
        res.status === 401 ? 'apple_failed' : authErrorFromResponse(res.status, json.error)
      return { ok: false, error, detail: authErrorDetail(json.error) }
    }
    if (mode === 'reauth') {
      const email = await fetchAccountEmail(json.token)
      if (!email || !expectedEmail || email !== expectedEmail) {
        return { ok: false, error: 'apple_failed', detail: 'account_mismatch' }
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

/** ai:account:apple-login / ai:account:delete-reauth-apple. */
export async function performAppleLogin(
  mode: AppleFlowMode = 'login'
): Promise<AiAccountAuthResult> {
  let expectedEmail: string | null = null
  if (mode === 'reauth') {
    const current = await ensureFreshAccessToken()
    expectedEmail = current ? await fetchAccountEmail(current) : null
    if (!expectedEmail) return { ok: false, error: 'invalid_credentials' }
  }

  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  return new Promise<AiAccountAuthResult>(resolve => {
    let settled = false

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
      // A request without our state is not our server's redirect (e.g. a
      // local process probing the port): ignore it instead of ending sign-in.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400).end()
        return
      }
      const code = url.searchParams.get('code')
      const errorParam = url.searchParams.get('error')
      const ok = !errorParam && !!code
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(callbackHtml(ok))
      finish(async () => {
        if (errorParam) return { ok: false, error: 'apple_failed', detail: errorParam }
        if (!code) return { ok: false, error: 'apple_failed', detail: 'invalid_callback' }
        return exchangeAppleCode(code, codeVerifier, mode, expectedEmail)
      })
    })

    server.on('error', err => {
      finish(() =>
        Promise.resolve({ ok: false, error: 'apple_failed', detail: authErrorDetail(err) })
      )
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const startUrl = new URL(`${AI_SERVER_BASE_URL}/auth/apple/start`)
      startUrl.searchParams.set('port', String(port))
      startUrl.searchParams.set('state', state)
      startUrl.searchParams.set('code_challenge', codeChallenge)
      void shell.openExternal(startUrl.toString())
    })

    const timeoutHandle = setTimeout(() => {
      finish(() => Promise.resolve({ ok: false, error: 'apple_failed', detail: 'timeout' }))
    }, APPLE_LOGIN_TIMEOUT_MS)
  })
}
