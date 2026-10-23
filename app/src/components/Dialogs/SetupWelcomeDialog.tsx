// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SetupWelcomeDialog — P0.4 first-run guidance.
 *
 * Shown once per app launch when R can't be found, or when it's found but a
 * package every analysis script needs (jsonlite, arrow) isn't installed.
 * Without this the only signal was a small status-bar dot — a user with no R
 * background had no idea why every analysis silently failed. Dismissible
 * (not a hard blocker): the rest of the app is still usable — Data View,
 * Variable View, and the SPSS syntax editor all work without R.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import styles from './DataDialogs.module.css'

interface Props {
  rFound: boolean
  missingRequired: string[]
  onRecheck: () => void
  onClose: () => void
}

type PkgStatus = 'idle' | 'installing' | 'installed' | 'failed'

export function SetupWelcomeDialog({ rFound, missingRequired, onRecheck, onClose }: Props) {
  const { t } = useTranslation(['dialogs', 'common'])
  const [pkgStatus, setPkgStatus] = useState<Record<string, PkgStatus>>({})

  const install = async (pkg: string) => {
    setPkgStatus(s => ({ ...s, [pkg]: 'installing' }))
    try {
      const res = await window.api.rPackages.install({ package: pkg })
      setPkgStatus(s => ({ ...s, [pkg]: res.success ? 'installed' : 'failed' }))
    } catch (err) {
      console.error('rPackages.install failed:', err)
      setPkgStatus(s => ({ ...s, [pkg]: 'failed' }))
    }
  }

  return (
    <DialogBase titleKey="dialogs:setup.title" onOk={onClose} onCancel={onClose}>
      <div className={styles.setupRoot}>
        {!rFound ? (
          <>
            <p>{t('dialogs:setup.rNotFound')}</p>
            <p>
              <a href="https://cran.r-project.org" target="_blank" rel="noreferrer">
                cran.r-project.org
              </a>
            </p>
            <p className={styles.emptyNote}>{t('dialogs:setup.rNotFoundHint')}</p>
            <button onClick={onRecheck}>{t('dialogs:setup.recheckBtn')}</button>
          </>
        ) : (
          <>
            <p>{t('dialogs:setup.packagesMissing')}</p>
            <ul>
              {missingRequired.map(pkg => {
                const s = pkgStatus[pkg] ?? 'idle'
                return (
                  <li key={pkg} className={styles.pkgRow}>
                    <span>{pkg}</span>
                    <button
                      onClick={() => void install(pkg)}
                      disabled={s === 'installing' || s === 'installed'}
                    >
                      {s === 'installed'
                        ? t('dialogs:setup.installedBtn')
                        : s === 'installing'
                          ? t('dialogs:setup.installingBtn')
                          : t('dialogs:setup.installBtn')}
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className={styles.emptyNote}>{t('dialogs:setup.packagesHint')}</p>
          </>
        )}
      </div>
    </DialogBase>
  )
}
