// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { effectiveModelId } from '@shared/ai-types'

// Gerçek userData yerine geçici klasör; safeStorage şifrelemesi yerine düz
// metin (test yalnız refresh akışını sınar).
const userData = fs.mkdtempSync(join(os.tmpdir(), 'sai-session-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

const { ensureFreshAccessToken, readSessionTokens, saveSessionTokens, hasSessionToken } =
  await import('../../electron/ipc/ai-bridge/credentials')

/** Süresi dolmuş imzasız JWT — ensureFreshAccessToken'ı refresh'e zorlar. */
const expiredJwt = `x.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.y`

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('ensureFreshAccessToken', () => {
  beforeEach(() => {
    saveSessionTokens({ accessToken: expiredJwt, refreshToken: 'r1' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('eşzamanlı çağrılar tek refresh paylaşır (rotate edilen token ikinci kez gitmez)', async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 10))
      return respond(200, { token: 'a2', refreshToken: 'r2' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const tokens = await Promise.all([
      ensureFreshAccessToken(),
      ensureFreshAccessToken(),
      ensureFreshAccessToken()
    ])
    expect(tokens).toEqual(['a2', 'a2', 'a2'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readSessionTokens()).toEqual({ accessToken: 'a2', refreshToken: 'r2' })
  })

  it('geçici hatada (429/ağ) oturumu silmez', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(429, {}))
    )
    expect(await ensureFreshAccessToken()).toBeNull()
    expect(hasSessionToken()).toBe(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    expect(await ensureFreshAccessToken()).toBeNull()
    expect(hasSessionToken()).toBe(true)
  })

  it('sunucu refresh token’ı reddedince (401) oturumu siler', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(401, { error: 'invalid_refresh_token' }))
    )
    expect(await ensureFreshAccessToken()).toBeNull()
    expect(hasSessionToken()).toBe(false)
  })
})

describe('effectiveModelId', () => {
  const catalog = [{ id: 'a/first' }, { id: 'b/default' }, { id: 'c/saved' }]

  it('katalogdaki kayıtlı modeli korur', () => {
    expect(effectiveModelId('c/saved', catalog, 'b/default')).toBe('c/saved')
  })

  it('emekli id için ilk sıradakine değil sunucu varsayılanına düşer', () => {
    expect(effectiveModelId('x/retired', catalog, 'b/default')).toBe('b/default')
  })

  it('varsayılan da katalogda yoksa ilk modele, katalog yoksa kayıtlı id’ye düşer', () => {
    expect(effectiveModelId('x/retired', catalog, 'y/gone')).toBe('a/first')
    expect(effectiveModelId('x/retired', [], 'b/default')).toBe('x/retired')
    expect(effectiveModelId('', [], 'b/default')).toBe('b/default')
  })
})
