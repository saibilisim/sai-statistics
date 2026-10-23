// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PackageNeededDialog — shown in place of an analysis dialog when the required
 * optional R package is not yet installed. Offers an on-demand Install button
 * (downloads from CRAN into the user's R library; requires internet). Once the
 * install succeeds the parent dialog re-renders into its normal form.
 */

import { useTranslation } from 'react-i18next'
import { DialogBase } from './DialogBase'
import type { GateStatus } from '../../lib/use-package-gate'
import { cx } from '../../lib/cx'
import styles from './DataDialogs.module.css'

export function PackageNeededDialog({
  titleKey,
  pkg,
  featureKey,
  status,
  onInstall,
  onClose
}: {
  titleKey: string
  pkg: string
  featureKey: string
  status: GateStatus
  onInstall: () => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const installing = status === 'installing'

  // While the availability check is still in flight, show a neutral placeholder
  // rather than flashing the install prompt (which would be wrong if installed).
  if (status === 'checking') {
    return (
      <DialogBase titleKey={titleKey} onOk={onClose} onCancel={onClose} okDisabled>
        <div className={styles.pkgChecking}>{t('analysis:rpkg.status.checking')}</div>
      </DialogBase>
    )
  }

  return (
    <DialogBase titleKey={titleKey} onOk={onClose} onCancel={onClose}>
      <div className={styles.pkgBody}>
        <p>
          {t('analysis:rpkg.required', {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            feature: t(`analysis:${featureKey}` as never),
            pkg
          })}
        </p>
        {status === 'failed' && (
          <p className={styles.errorTextFlush}>{t('analysis:rpkg.failedNote')}</p>
        )}
        <div className={styles.pkgInstallRow}>
          <button
            className={cx(styles.btn, styles.primary)}
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? t('analysis:rpkg.status.installing') : t('analysis:rpkg.installBtn')}
          </button>
          <span className={styles.pkgName}>{pkg}</span>
        </div>
        <p className={styles.pkgNote}>
          ⓘ {t('analysis:rpkg.internetNote')}{' '}
          {t(
            window.api.platform === 'linux'
              ? 'analysis:rpkg.note.linux'
              : 'analysis:rpkg.note.binary'
          )}
        </p>
      </div>
    </DialogBase>
  )
}
