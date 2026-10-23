// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '../store/settings-store'
import { ThemeProvider } from '../theme/ThemeProvider'
import { cx } from '../lib/cx'
import { AI_GOOGLE_CLIENT_ID, AI_PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '@shared/ai-types'
import { BrandMark, GoogleIcon } from './LoginIcons'
import styles from './LoginWindow.module.css'

/**
 * Ayrı, küçük giriş penceresi (main.ts openLoginWindow) — 'server' AI provider
 * için hesap girişi/oluşturma. Tasarım app tema token'larıyla (§7) yapılır;
 * pencere kendi paletini icat etmez, light/dark/high-contrast'a uyar.
 *
 * Görünümler (öncelik sırası): başarı → doğrulama-bekliyor → sıfırlama-gönderildi
 * → form (login/register/forgot). E-posta doğrulama (2026-08-15): kayıt oturum
 * açmaz; sunucu `verificationRequired` dönünce 'doğrula' ekranına geçilir.
 * "Şifremi unuttum" (tam auth): e-posta alınır, sunucu enumeration-dirençli
 * yanıt verir, kullanıcı gelen kutusundaki bağlantıdan (tarayıcıda) sıfırlar.
 * Buradaki tüm kontroller yalnız ANINDA GERİ BİLDİRİM; gerçek sınır sunucudadır.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_COOLDOWN_SECONDS = 60
// Yasal metinler sitede (tek kaynak); bağlantılar main.ts'teki
// setWindowOpenHandler ile varsayılan tarayıcıda açılır.
const LEGAL_URLS = {
  license: 'https://saistatistics.com/license',
  privacy: 'https://saistatistics.com/privacy'
} as const

type Mode = 'login' | 'register' | 'forgot'

export function LoginWindow() {
  const { i18n } = useTranslation()
  const t = (key: string, options?: Record<string, unknown>): string => {
    const result = i18n.t(key, options as never)
    return typeof result === 'string' ? result : key
  }
  const settings = useSettingsStore(s => s.settings)
  const loadSettings = useSettingsStore(s => s.loadSettings)

  useEffect(() => {
    void window.api.settings.get().then(loadSettings)
  }, [loadSettings])

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendNotice, setResendNotice] = useState(false)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setTimeout(() => {
      setResendCooldown(s => s - 1)
    }, 1000)
    return () => {
      clearTimeout(timer)
    }
  }, [resendCooldown])

  const resetFeedback = (): void => {
    setErrorKey(null)
    setResendNotice(false)
  }

  const goToMode = (next: Mode): void => {
    setMode(next)
    setForgotSent(false)
    setPassword('')
    setPasswordConfirm('')
    resetFeedback()
  }

  const validateForm = (trimmedEmail: string): string | null => {
    if (!EMAIL_PATTERN.test(trimmedEmail)) return 'ai.settings.account.error.invalid_email'
    if (mode === 'forgot') return null
    if (mode === 'login') {
      return password.length === 0 ? 'ai.settings.account.validationError' : null
    }
    if (password !== passwordConfirm) return 'ai.settings.account.passwordMismatch'
    const [firstViolation] = checkPasswordPolicy(password, trimmedEmail)
    if (firstViolation) return `ai.settings.account.policy.${firstViolation}`
    return termsAccepted ? null : 'ai.settings.account.terms.required'
  }

  // "{license}" / "{privacy}" yer tutucularını sitedeki yasal metinlere
  // bağlantıya çevirir (cümle yapısı dile göre değiştiği için metin tek parça).
  const renderLegalText = (key: string): React.ReactNode[] =>
    t(key)
      .split(/(\{license\}|\{privacy\})/)
      .map((part, i) =>
        part === '{license}' || part === '{privacy}' ? (
          <a
            key={i}
            className={styles.termsLink}
            href={part === '{license}' ? LEGAL_URLS.license : LEGAL_URLS.privacy}
            target="_blank"
            rel="noreferrer"
          >
            {t(
              part === '{license}'
                ? 'ai.settings.account.terms.license'
                : 'ai.settings.account.terms.privacy'
            )}
          </a>
        ) : (
          part
        )
      )

  const handleSubmit = (): void => {
    if (busy) return
    const trimmedEmail = email.trim()
    const validationKey = validateForm(trimmedEmail)
    if (validationKey) {
      setErrorKey(validationKey)
      return
    }
    setBusy(true)
    resetFeedback()

    if (mode === 'forgot') {
      void window.api.ai.account
        .forgotPassword({ email: trimmedEmail })
        .then(result => {
          // Enumeration-dirençli: hesap olsa da olmasa da aynı ekran gösterilir.
          if (result.ok) setForgotSent(true)
          else setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
        })
        .catch(() => {
          setErrorKey('ai.settings.account.error.unknown')
        })
        .finally(() => {
          setBusy(false)
        })
      return
    }

    const call = mode === 'login' ? window.api.ai.account.login : window.api.ai.account.register
    void call({ email: trimmedEmail, password })
      .then(result => {
        if (result.ok && result.pendingVerification) {
          setPendingEmail(trimmedEmail)
          setPassword('')
          setPasswordConfirm('')
          setResendCooldown(RESEND_COOLDOWN_SECONDS)
          return
        }
        if (result.ok) {
          setSuccess(true)
          setTimeout(() => {
            window.close()
          }, 900)
          return
        }
        if (result.error === 'email_not_verified') {
          setPendingEmail(trimmedEmail)
          setPassword('')
          return
        }
        setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const handleGoogleLogin = (): void => {
    if (googleBusy) return
    setGoogleBusy(true)
    resetFeedback()
    void window.api.ai.account
      .googleLogin()
      .then(result => {
        if (result.ok) {
          setSuccess(true)
          setTimeout(() => {
            window.close()
          }, 900)
        } else {
          setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
        }
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
      })
      .finally(() => {
        setGoogleBusy(false)
      })
  }

  const handleResend = useCallback((): void => {
    if (!pendingEmail || resendCooldown > 0 || busy) return
    setBusy(true)
    resetFeedback()
    void window.api.ai.account
      .resendVerification({ email: pendingEmail })
      .then(result => {
        if (result.ok) {
          setResendNotice(true)
          setResendCooldown(RESEND_COOLDOWN_SECONDS)
        } else {
          setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
        }
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
      })
      .finally(() => {
        setBusy(false)
      })
  }, [pendingEmail, resendCooldown, busy])

  const handleBackToLogin = (): void => {
    setPendingEmail(null)
    goToMode('login')
  }

  const [firstPasswordViolation] =
    mode === 'register' && password.length > 0 ? checkPasswordPolicy(password, email.trim()) : []

  const subtitleKey =
    mode === 'login'
      ? 'ai.settings.account.subtitleLogin'
      : mode === 'register'
        ? 'ai.settings.account.subtitleRegister'
        : 'ai.settings.account.subtitleForgot'

  const renderBrand = () => (
    <header className={styles.brand}>
      <span className={styles.brandMark}>
        <BrandMark />
      </span>
      <div className={styles.brandText}>
        <span className={styles.brandName}>{t('ai.settings.account.brandName')}</span>
        <span className={styles.brandSub}>{t(subtitleKey)}</span>
      </div>
    </header>
  )

  return (
    <ThemeProvider theme={settings.appearance.theme}>
      <div className={styles.page}>
        <div className={styles.card}>
          {renderBrand()}

          {success ? (
            <p className={styles.success} role="status">
              {t('ai.settings.account.success')}
            </p>
          ) : pendingEmail ? (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>{t('ai.settings.account.verifyTitle')}</h2>
              <p className={styles.panelText}>
                {t('ai.settings.account.verifySent', { email: pendingEmail })}
              </p>
              <p className={styles.panelHint}>{t('ai.settings.account.verifyNotArrived')}</p>

              <button
                type="button"
                className={styles.submit}
                onClick={handleResend}
                disabled={busy || resendCooldown > 0}
              >
                {resendCooldown > 0
                  ? t('ai.settings.account.resendCooldown', { seconds: resendCooldown })
                  : t('ai.settings.account.resend')}
              </button>

              {resendNotice && (
                <p className={styles.success}>{t('ai.settings.account.resendSent')}</p>
              )}
              {errorKey && (
                <p className={styles.error} role="alert">
                  {t(errorKey)}
                </p>
              )}

              <div className={styles.switchRow}>
                <button type="button" className={styles.switchLink} onClick={handleBackToLogin}>
                  {t('ai.settings.account.backToLogin')}
                </button>
              </div>
            </div>
          ) : forgotSent ? (
            <div className={styles.panel}>
              <h2 className={styles.panelTitle}>{t('ai.settings.account.forgotSentTitle')}</h2>
              <p className={styles.panelText}>
                {t('ai.settings.account.forgotSent', { email: email.trim() })}
              </p>
              <p className={styles.panelHint}>{t('ai.settings.account.verifyNotArrived')}</p>
              <div className={styles.switchRow}>
                <button type="button" className={styles.switchLink} onClick={handleBackToLogin}>
                  {t('ai.settings.account.backToLogin')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label htmlFor="login-email">{t('ai.settings.account.email')}</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSubmit()
                  }}
                  autoFocus
                />
              </div>

              {mode !== 'forgot' && (
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="login-password">{t('ai.settings.account.password')}</label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        className={styles.inlineLink}
                        onClick={() => {
                          goToMode('forgot')
                        }}
                      >
                        {t('ai.settings.account.forgotLink')}
                      </button>
                    )}
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    aria-describedby={mode === 'register' ? 'login-password-hint' : undefined}
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSubmit()
                    }}
                  />
                  {mode === 'register' && (
                    <p
                      id="login-password-hint"
                      className={cx(styles.hint, firstPasswordViolation && styles.hintWarn)}
                    >
                      {firstPasswordViolation
                        ? t(`ai.settings.account.policy.${firstPasswordViolation}`, {
                            min: AI_PASSWORD_MIN_LENGTH
                          })
                        : t('ai.settings.account.passwordHint', { min: AI_PASSWORD_MIN_LENGTH })}
                    </p>
                  )}
                </div>
              )}

              {mode === 'register' && (
                <div className={styles.field}>
                  <label htmlFor="login-password-confirm">
                    {t('ai.settings.account.passwordConfirm')}
                  </label>
                  <input
                    id="login-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={passwordConfirm}
                    onChange={e => {
                      setPasswordConfirm(e.target.value)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSubmit()
                    }}
                  />
                </div>
              )}

              {mode === 'register' && (
                <label className={styles.terms}>
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={e => {
                      setTermsAccepted(e.target.checked)
                    }}
                  />
                  <span>{renderLegalText('ai.settings.account.terms.text')}</span>
                </label>
              )}

              <button
                type="button"
                className={styles.submit}
                onClick={handleSubmit}
                disabled={busy}
              >
                {mode === 'login'
                  ? t('ai.settings.account.login')
                  : mode === 'register'
                    ? t('ai.settings.account.register')
                    : t('ai.settings.account.sendResetLink')}
              </button>

              {mode === 'forgot' ? (
                <div className={styles.switchRow}>
                  <button
                    type="button"
                    className={styles.switchLink}
                    onClick={() => {
                      goToMode('login')
                    }}
                  >
                    {t('ai.settings.account.backToLogin')}
                  </button>
                </div>
              ) : (
                <>
                  <div className={styles.divider}>{t('ai.settings.account.orDivider')}</div>

                  {AI_GOOGLE_CLIENT_ID ? (
                    <button
                      type="button"
                      className={styles.googleBtn}
                      disabled={googleBusy}
                      onClick={handleGoogleLogin}
                    >
                      <GoogleIcon />
                      {googleBusy
                        ? t('ai.settings.account.googleWaiting')
                        : t('ai.settings.account.googleLogin')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.googleBtn}
                      disabled
                      title={t('ai.settings.account.googleComingSoon')}
                    >
                      <GoogleIcon />
                      {t('ai.settings.account.googleLogin')}
                      <span className={styles.googleBadge}>
                        {t('ai.settings.account.googleComingSoon')}
                      </span>
                    </button>
                  )}

                  {/* Google ile giriş ilk kullanımda hesap da açar — onay kutusu
                      yerine bu akışta kabul, düğmeye basılarak verilir. */}
                  {AI_GOOGLE_CLIENT_ID && (
                    <p className={styles.termsNote}>
                      {renderLegalText('ai.settings.account.terms.googleNote')}
                    </p>
                  )}

                  <div className={styles.switchRow}>
                    <button
                      type="button"
                      className={styles.switchLink}
                      onClick={() => {
                        goToMode(mode === 'login' ? 'register' : 'login')
                      }}
                    >
                      {mode === 'login'
                        ? t('ai.settings.account.switchToRegister')
                        : t('ai.settings.account.switchToLogin')}
                    </button>
                  </div>
                </>
              )}

              {errorKey && (
                <p className={styles.error} role="alert">
                  {t(errorKey, { min: AI_PASSWORD_MIN_LENGTH })}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </ThemeProvider>
  )
}
