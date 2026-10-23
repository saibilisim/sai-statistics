// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * account-security.test.ts — 'server' provider hesap katmanının güvenlik
 * kuralları (2026-08-15, e-posta doğrulama turu).
 *
 * Buradaki testler client tarafını korur; sunucu (sai-ai-server) aynı kuralları
 * bağımsız uygular ve ASIL sınır odur. Yine de bu kuralların sessizce
 * gevşetilmesi (ör. kayıt şemasının tekrar login şemasına eşitlenmesi, ya da
 * ham sunucu metninin doğrudan UI'a sızması) regresyon olarak yakalanmalı.
 */
import { describe, it, expect } from 'vitest'
import {
  AI_PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  AiAccountStatusSchema,
  AiAccountAuthResultSchema
} from '@shared/ai-types'
import {
  AiAccountRegisterRequestSchema,
  AiAccountLoginRequestSchema,
  AiAccountResendVerificationRequestSchema,
  AiAccountDeleteRequestSchema
} from '@shared/ipc-schemas'
import {
  authErrorFromResponse,
  authErrorFromException,
  authErrorDetail
} from '../../electron/ipc/ai-bridge/auth-errors'

const STRONG_PASSWORD = 'Kirmizi7Kalem'

describe('şifre politikası (yalnız kayıt)', () => {
  it('güçlü şifreyi kabul eder', () => {
    expect(checkPasswordPolicy(STRONG_PASSWORD, 'ayse@example.com')).toEqual([])
  })

  it('asgari uzunluğun altını reddeder', () => {
    expect(checkPasswordPolicy('Ab3xY9z', 'ayse@example.com')).toContain('tooShort')
    expect('Ab3xY9z'.length).toBeLessThan(AI_PASSWORD_MIN_LENGTH)
  })

  it('yaygın şifreleri (büyük/küçük harf farkı gözetmeden) reddeder', () => {
    expect(checkPasswordPolicy('Password123', 'ayse@example.com')).toContain('common')
  })

  it('e-postanın yerel kısmını içeren şifreyi reddeder', () => {
    expect(checkPasswordPolicy('ayse12345678', 'ayse@example.com')).toContain('containsEmail')
  })

  it('2 karakterlik yerel kısmı içerme kuralına takılmaz (rastgele eşleşme)', () => {
    expect(checkPasswordPolicy(STRONG_PASSWORD, 'al@example.com')).toEqual([])
  })

  it('tek karakter sınıfı / az çeşitlilik içeren uzun şifreyi reddeder', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaa', 'ayse@example.com')).toContain('noVariety')
    expect(checkPasswordPolicy('abcdefghijkl', 'ayse@example.com')).toContain('noVariety')
  })
})

describe('kayıt ve giriş şemaları ayrıdır', () => {
  it('kayıt zayıf şifreyi reddeder', () => {
    const result = AiAccountRegisterRequestSchema.safeParse({
      email: 'ayse@example.com',
      password: 'password123'
    })
    expect(result.success).toBe(false)
  })

  it('kayıt güçlü şifreyi kabul eder', () => {
    expect(
      AiAccountRegisterRequestSchema.safeParse({
        email: 'ayse@example.com',
        password: STRONG_PASSWORD
      }).success
    ).toBe(true)
  })

  // Politika yalnız yeni parolalar içindir: eski hesapların 8 karakterlik
  // şifresi hâlâ giriş yapabilmeli, aksi hâlde kullanıcı kendi hesabından kilitlenir.
  it('giriş, kayıt politikasını geçmeyen eski şifreyi kabul eder', () => {
    expect(
      AiAccountLoginRequestSchema.safeParse({
        email: 'ayse@example.com',
        password: 'eski1234'
      }).success
    ).toBe(true)
  })

  it('geçersiz e-posta biçimini her iki şemada da reddeder', () => {
    expect(
      AiAccountLoginRequestSchema.safeParse({ email: 'ayse', password: STRONG_PASSWORD }).success
    ).toBe(false)
    expect(
      AiAccountRegisterRequestSchema.safeParse({ email: 'ayse@', password: STRONG_PASSWORD })
        .success
    ).toBe(false)
  })

  it('e-postayı biçim kontrolünden ÖNCE trim eder', () => {
    const result = AiAccountResendVerificationRequestSchema.safeParse({
      email: '  ayse@example.com  '
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.email).toBe('ayse@example.com')
  })
})

describe("hata normalizasyonu (ham sunucu metni UI'a sızmaz)", () => {
  it('sunucunun kendi kodunu HTTP durumundan öncelikli sayar', () => {
    expect(authErrorFromResponse(400, 'weak_password')).toBe('weak_password')
    expect(authErrorFromResponse(403, 'email_not_verified')).toBe('email_not_verified')
  })

  it('kod yoksa HTTP durumundan çıkarır', () => {
    expect(authErrorFromResponse(401)).toBe('invalid_credentials')
    expect(authErrorFromResponse(403)).toBe('email_not_verified')
    expect(authErrorFromResponse(429)).toBe('rate_limited')
    expect(authErrorFromResponse(503)).toBe('server_error')
  })

  it('tanımadığı kodu enum dışına taşırmaz', () => {
    expect(authErrorFromResponse(400, 'some_new_server_code')).toBe('unknown')
  })

  it('tam auth hata kodlarını (kilit/çakışma/token) eşler', () => {
    expect(authErrorFromResponse(423)).toBe('account_locked')
    expect(authErrorFromResponse(409)).toBe('email_taken')
    expect(authErrorFromResponse(400, 'wrong_password')).toBe('wrong_password')
    expect(authErrorFromResponse(400, 'invalid_or_expired_token')).toBe('invalid_or_expired_token')
    expect(authErrorFromResponse(400, 'no_password_set')).toBe('no_password_set')
    expect(authErrorFromResponse(400, 'same_email')).toBe('same_email')
  })

  it('ağ istisnasını tek koda indirger ve ayrıntıyı kırpar', () => {
    expect(authErrorFromException()).toBe('network')
    expect(authErrorDetail(new Error('x'.repeat(500)))).toHaveLength(200)
    expect(authErrorDetail(undefined)).toBeUndefined()
  })
})

describe('IPC sonuç şemaları doğrulama alanlarını taşır', () => {
  it('kayıt yanıtı oturumsuz "doğrulama bekliyor" durumunu ifade edebilir', () => {
    const parsed = AiAccountAuthResultSchema.safeParse({ ok: true, pendingVerification: true })
    expect(parsed.success && parsed.data.pendingVerification).toBe(true)
  })

  it('hesap durumu emailVerified alanını taşır ve alan yoksa undefined kalır', () => {
    const withFlag = AiAccountStatusSchema.parse({ loggedIn: true, emailVerified: false })
    expect(withFlag.emailVerified).toBe(false)
    const legacy = AiAccountStatusSchema.parse({ loggedIn: true })
    expect(legacy.emailVerified).toBeUndefined()
  })

  it('enum dışı bir hata kodunu reddeder', () => {
    expect(AiAccountAuthResultSchema.safeParse({ ok: false, error: 'HTTP 429' }).success).toBe(
      false
    )
  })

  it('change-email için pendingEmail alanını taşır', () => {
    const parsed = AiAccountAuthResultSchema.safeParse({
      ok: true,
      pendingEmail: 'yeni@example.com'
    })
    expect(parsed.success && parsed.data.pendingEmail).toBe('yeni@example.com')
  })

  it('tam auth hata kodlarını enum içinde kabul eder', () => {
    for (const code of [
      'account_locked',
      'wrong_password',
      'invalid_or_expired_token',
      'no_password_set',
      'same_email',
      'email_taken'
    ]) {
      expect(AiAccountAuthResultSchema.safeParse({ ok: false, error: code }).success).toBe(true)
    }
  })
})

describe('hesap silme kanıtı', () => {
  it('boş gövde ve boş parola reddedilir', () => {
    expect(AiAccountDeleteRequestSchema.safeParse({}).success).toBe(false)
    expect(AiAccountDeleteRequestSchema.safeParse({ password: '' }).success).toBe(false)
    expect(AiAccountDeleteRequestSchema.safeParse({ googleReauth: false }).success).toBe(false)
  })

  it('parola veya Google yeniden doğrulaması kabul edilir', () => {
    expect(AiAccountDeleteRequestSchema.safeParse({ password: 'x' }).success).toBe(true)
    expect(AiAccountDeleteRequestSchema.safeParse({ googleReauth: true }).success).toBe(true)
  })
})
