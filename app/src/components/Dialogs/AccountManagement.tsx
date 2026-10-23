// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AI_PASSWORD_MIN_LENGTH, checkPasswordPolicy } from '@shared/ai-types'
import { cx } from '../../lib/cx'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import baseStyles from './DialogBase.module.css'
import dataStyles from './DataDialogs.module.css'
import styles from './PreferencesDialog.module.css'

interface Props {
  /** Oturum açmış hesabın e-postası (şifre politikası "e-posta içerme" kontrolü için). */
  email: string
}

interface DangerZoneProps {
  /** Silme başarılı olunca — yerel oturum düştü; çağıran hesap durumunu tazeler. */
  onLoggedOut: () => void
}

type ActiveForm = 'password' | 'email' | null

/**
 * PreferencesDialog ▸ AI ▸ SAI hesabı — oturum açıkken hesap yönetimi:
 * şifre değiştir, e-posta değiştir. Her biri satır-içi açılan küçük bir form;
 * asıl doğrulama ve e-posta gönderimi sunucuda (routes/auth.ts). Şifre
 * değiştirmede yeni parola politikası (checkPasswordPolicy) burada anında
 * gösterilir; sunucu bağımsız uygular.
 *
 * Hesabı sil — kullanıcı isteğiyle (2026-09-26) buradan ayrılıp en alta,
 * ayrı bir "tehlikeli bölge" olarak taşındı: bkz. `AccountDangerZone` altta —
 * PreferencesDialog bunu AI kartlarının en sonuna (model seçiminden sonra)
 * render eder, böylece kırmızı buton diğer normal eylemlerle aynı satırda
 * göze çarpmaz.
 */
export function AccountManagement({ email }: Props) {
  const { t: rawT } = useTranslation('common')
  const t = (key: string, options?: Record<string, unknown>): string => {
    const r = rawT(key, options as never)
    return typeof r === 'string' ? r : key
  }

  const [active, setActive] = useState<ActiveForm>(null)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [noticeArg, setNoticeArg] = useState<string>('')

  const reset = (): void => {
    setOldPassword('')
    setNewPassword('')
    setConfirm('')
    setNewEmail('')
    setErrorKey(null)
    setBusy(false)
  }

  const open = (form: ActiveForm): void => {
    reset()
    setNoticeKey(null)
    setActive(form)
  }

  const close = (): void => {
    reset()
    setActive(null)
  }

  const [firstViolation] =
    active === 'password' && newPassword.length > 0 ? checkPasswordPolicy(newPassword, email) : []

  const handleChangePassword = (): void => {
    if (busy) return
    if (newPassword !== confirm) {
      setErrorKey('ai.settings.account.passwordMismatch')
      return
    }
    const [violation] = checkPasswordPolicy(newPassword, email)
    if (violation) {
      setErrorKey(`ai.settings.account.policy.${violation}`)
      return
    }
    setBusy(true)
    setErrorKey(null)
    void window.api.ai.account
      .changePassword({ oldPassword, newPassword })
      .then(result => {
        if (result.ok) {
          setNoticeKey('ai.settings.account.manage.passwordChanged')
          setNoticeArg('')
          close()
        } else {
          setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
          setBusy(false)
        }
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
        setBusy(false)
      })
  }

  const handleChangeEmail = (): void => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    void window.api.ai.account
      .changeEmail({ newEmail: newEmail.trim(), password: oldPassword })
      .then(result => {
        if (result.ok) {
          setNoticeKey('ai.settings.account.manage.emailChangeSent')
          setNoticeArg(result.pendingEmail ?? newEmail.trim())
          close()
        } else {
          setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
          setBusy(false)
        }
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
        setBusy(false)
      })
  }

  const passwordInput = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    autoComplete: string,
    describedBy?: string
  ) => (
    <div className={cx(dataStyles.conditionRow, styles.row)}>
      <label className={dataStyles.condLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="password"
        className={dataStyles.condInput}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        value={value}
        onChange={e => {
          onChange(e.target.value)
        }}
      />
    </div>
  )

  return (
    <>
      {noticeKey && (
        <p className={cx(dataStyles.emptyNote, styles.row, styles.accountNotice)}>
          {t(noticeKey, { email: noticeArg })}
        </p>
      )}

      {active === null && (
        <div className={cx(dataStyles.conditionRow, styles.row)}>
          <span className={dataStyles.condLabel} />
          <div className={styles.creditPackRow}>
            <button
              type="button"
              className={dataStyles.btn}
              onClick={() => {
                open('password')
              }}
            >
              {t('ai.settings.account.manage.changePassword')}
            </button>
            <button
              type="button"
              className={dataStyles.btn}
              onClick={() => {
                open('email')
              }}
            >
              {t('ai.settings.account.manage.changeEmail')}
            </button>
          </div>
        </div>
      )}

      {active === 'password' && (
        <div className={styles.accountForm}>
          {passwordInput(
            'acc-old-pw',
            t('ai.settings.account.manage.currentPassword'),
            oldPassword,
            setOldPassword,
            'current-password'
          )}
          {passwordInput(
            'acc-new-pw',
            t('ai.settings.account.manage.newPassword'),
            newPassword,
            setNewPassword,
            'new-password',
            'acc-new-pw-hint'
          )}
          <p
            id="acc-new-pw-hint"
            className={cx(styles.row, styles.pwHint, firstViolation && styles.pwHintWarn)}
          >
            {firstViolation
              ? t(`ai.settings.account.policy.${firstViolation}`, { min: AI_PASSWORD_MIN_LENGTH })
              : t('ai.settings.account.passwordHint', { min: AI_PASSWORD_MIN_LENGTH })}
          </p>
          {passwordInput(
            'acc-confirm-pw',
            t('ai.settings.account.passwordConfirm'),
            confirm,
            setConfirm,
            'new-password'
          )}
          <FormActions
            busy={busy}
            onSave={handleChangePassword}
            onCancel={close}
            saveLabel={t('ai.settings.account.manage.save')}
            cancelLabel={t('ai.settings.account.manage.cancel')}
          />
        </div>
      )}

      {active === 'email' && (
        <div className={styles.accountForm}>
          <div className={cx(dataStyles.conditionRow, styles.row)}>
            <label className={dataStyles.condLabel} htmlFor="acc-new-email">
              {t('ai.settings.account.manage.newEmail')}
            </label>
            <input
              id="acc-new-email"
              type="email"
              className={dataStyles.condInput}
              autoComplete="email"
              value={newEmail}
              onChange={e => {
                setNewEmail(e.target.value)
              }}
            />
          </div>
          {passwordInput(
            'acc-email-pw',
            t('ai.settings.account.manage.currentPassword'),
            oldPassword,
            setOldPassword,
            'current-password'
          )}
          <FormActions
            busy={busy}
            onSave={handleChangeEmail}
            onCancel={close}
            saveLabel={t('ai.settings.account.manage.save')}
            cancelLabel={t('ai.settings.account.manage.cancel')}
          />
        </div>
      )}

      {errorKey && (
        <p className={cx(styles.row, styles.accountError)} role="alert">
          {t(errorKey, { min: AI_PASSWORD_MIN_LENGTH })}
        </p>
      )}
    </>
  )
}

function FormActions({
  busy,
  danger,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel
}: {
  busy: boolean
  danger?: boolean
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  cancelLabel: string
}) {
  return (
    <div className={cx(dataStyles.conditionRow, styles.row)}>
      <span className={dataStyles.condLabel} />
      <div className={styles.creditPackRow}>
        <button
          type="button"
          className={cx(dataStyles.btn, danger && styles.dangerBtn)}
          disabled={busy}
          onClick={onSave}
        >
          {saveLabel}
        </button>
        <button type="button" className={dataStyles.btn} disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * AI ayarları sayfasının en altındaki "tehlikeli bölge": yalnız kırmızı
 * "Hesabı sil" düğmesi (2026-10-11 — satır-içi şifre/Google formu sayfayı çok
 * uzatıyordu). Doğrulama (şifre ya da Google ile yeniden giriş) düğmeyle açılan
 * DeleteAccountDialog'da.
 */
export function AccountDangerZone({ onLoggedOut }: DangerZoneProps) {
  const { t: rawT } = useTranslation('common')
  const t = (key: string, options?: Record<string, unknown>): string => {
    const r = rawT(key, options as never)
    return typeof r === 'string' ? r : key
  }
  const [open, setOpen] = useState(false)

  return (
    <div className={cx(dataStyles.conditionRow, styles.row, styles.dangerZone)}>
      <span className={cx(dataStyles.condLabel, styles.dangerZoneLabel)}>
        {t('ai.settings.account.manage.dangerZone')}
      </span>
      <button
        type="button"
        className={cx(dataStyles.btn, styles.dangerBtn)}
        onClick={() => {
          setOpen(true)
        }}
      >
        {t('ai.settings.account.manage.deleteAccount')}
      </button>
      {open && (
        <DeleteAccountDialog
          onClose={() => {
            setOpen(false)
          }}
          onDeleted={() => {
            setOpen(false)
            onLoggedOut()
          }}
        />
      )}
    </div>
  )
}

interface DeleteAccountDialogProps {
  onClose: () => void
  onDeleted: () => void
}

/**
 * Hesap silme doğrulaması — şifre ya da Google ile yeniden giriş. document.body'ye
 * portal: Tercihler'in DOM'u içinde kalsaydı, onun klavye dinleyicisi (Enter =
 * Tamam, Escape = kapat) bu pencerenin tuşlarını da yakalardı. Enter silme
 * YAPMAZ — geri alınamaz işlem yalnız düğmeyle.
 */
function DeleteAccountDialog({ onClose, onDeleted }: DeleteAccountDialogProps) {
  const { t: rawT } = useTranslation('common')
  const t = (key: string, options?: Record<string, unknown>): string => {
    const r = rawT(key, options as never)
    return typeof r === 'string' ? r : key
  }
  const containerRef = useRef<HTMLDivElement>(null)

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleVerified, setGoogleVerified] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  useDialogKeyboard({
    containerRef,
    onCancel: () => {
      if (!busy) onClose()
    }
  })

  // Google ile bağlı hesap: önce sistem tarayıcısında yeniden Google girişi
  // (Main aynı hesabı doğrular), sonra ayrı bir onay butonu çıkar.
  const handleGoogleVerify = (): void => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    void window.api.ai.account
      .reauthGoogleForDelete()
      .then(result => {
        if (result.ok) {
          setGoogleVerified(true)
        } else {
          setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
        }
        setBusy(false)
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
        setBusy(false)
      })
  }

  const submitDelete = (req: { password: string } | { googleReauth: true }): void => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    void window.api.ai.account
      .deleteAccount(req)
      .then(result => {
        if (result.ok) {
          onDeleted()
        } else {
          setErrorKey(`ai.settings.account.error.${result.error ?? 'unknown'}`)
          setBusy(false)
        }
      })
      .catch(() => {
        setErrorKey('ai.settings.account.error.unknown')
        setBusy(false)
      })
  }

  return createPortal(
    <div className={baseStyles.overlay}>
      <div
        ref={containerRef}
        className={cx(baseStyles.dialog, styles.deleteDialog)}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="acc-delete-title"
        aria-describedby="acc-delete-warning"
      >
        <div className={baseStyles.header}>
          <span id="acc-delete-title" className={baseStyles.title}>
            {t('ai.settings.account.manage.deleteAccount')}
          </span>
          <button
            type="button"
            className={baseStyles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label={t('ai.settings.account.manage.cancel')}
          >
            ×
          </button>
        </div>

        <div className={cx(baseStyles.body, styles.deleteBody)}>
          <p id="acc-delete-warning" className={styles.deleteWarning}>
            {t('ai.settings.account.manage.deleteWarning')}
          </p>

          <div className={styles.deleteMethod}>
            <label className={styles.deleteMethodLabel} htmlFor="acc-delete-pw">
              {t('ai.settings.account.manage.currentPassword')}
            </label>
            <div className={styles.deleteMethodRow}>
              <input
                id="acc-delete-pw"
                type="password"
                className={dataStyles.condInput}
                autoComplete="current-password"
                autoFocus
                data-no-submit
                value={password}
                onChange={e => {
                  setPassword(e.target.value)
                }}
              />
              <button
                type="button"
                className={cx(dataStyles.btn, styles.dangerBtn)}
                disabled={busy || !password}
                onClick={() => {
                  submitDelete({ password })
                }}
              >
                {t('ai.settings.account.manage.deleteAccount')}
              </button>
            </div>
          </div>

          <div className={styles.deleteMethod}>
            <span className={styles.deleteMethodLabel}>
              {t('ai.settings.account.manage.deleteGoogleOr')}
            </span>
            {!googleVerified ? (
              <div className={styles.deleteMethodRow}>
                <button
                  type="button"
                  className={dataStyles.btn}
                  disabled={busy}
                  onClick={handleGoogleVerify}
                >
                  {t('ai.settings.account.manage.deleteGoogleVerify')}
                </button>
              </div>
            ) : (
              <>
                <p className={styles.dangerNote} role="status">
                  {t('ai.settings.account.manage.deleteGoogleVerified')}
                </p>
                <div className={styles.deleteMethodRow}>
                  <button
                    type="button"
                    className={cx(dataStyles.btn, styles.dangerBtn)}
                    disabled={busy}
                    onClick={() => {
                      submitDelete({ googleReauth: true })
                    }}
                  >
                    {t('ai.settings.account.manage.deleteGoogleConfirm')}
                  </button>
                  <button
                    type="button"
                    className={dataStyles.btn}
                    disabled={busy}
                    onClick={() => {
                      setGoogleVerified(false)
                    }}
                  >
                    {t('ai.settings.account.manage.cancel')}
                  </button>
                </div>
              </>
            )}
          </div>

          {errorKey && (
            <p className={styles.accountError} role="alert">
              {t(errorKey)}
            </p>
          )}
        </div>

        <div className={baseStyles.footer}>
          <div className={baseStyles.footerLeft} />
          <div className={baseStyles.footerRight}>
            <button type="button" className={baseStyles.btn} onClick={onClose} disabled={busy}>
              {t('ai.settings.account.manage.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
