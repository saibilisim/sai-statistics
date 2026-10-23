// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared "Bootstrap..." panel — SPSS's Bootstrap sub-dialog (IBM_SPSS_
 * Bootstrapping.pdf): number of samples, seed, confidence level, CI type
 * (Percentile / BCa). Reused across every bootstrap-enabled dialog (see
 * roadmap.md Konu Yol Haritaları §E, eski BOOT1).
 */

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SubDialogFooter } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'

export interface BootstrapOptions {
  enabled: boolean
  samples: number
  seed: string
  ciLevel: number
  ciType: 'percentile' | 'bca'
}

export const defaultBootstrapOptions: BootstrapOptions = {
  enabled: false,
  samples: 1000,
  seed: '',
  ciLevel: 95,
  ciType: 'bca'
}

/** Converts dialog state to the params.options.bootstrap shape _bootstrap.R's
 *  sai_bootstrap() reads. Returns undefined when disabled (no key sent). */
export function buildBootstrapParams(opt: BootstrapOptions): Record<string, unknown> | undefined {
  if (!opt.enabled) return undefined
  return {
    enabled: true,
    samples: opt.samples,
    ciLevel: opt.ciLevel,
    ciType: opt.ciType === 'bca' ? 'bca' : 'perc',
    ...(opt.seed.trim() !== '' ? { seed: Number(opt.seed) } : {})
  }
}

export function BootstrapSection({
  value,
  onChange,
  onClose
}: {
  value: BootstrapOptions
  onChange: (v: BootstrapOptions) => void
  onClose?: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const enableDescId = useId()
  const percentileDescId = useId()
  const bcaDescId = useId()

  const [local, setLocal] = useState(value)
  const current = onClose ? local : value
  const setCurrent = (v: BootstrapOptions) => {
    if (onClose) {
      setLocal(v)
    } else {
      onChange(v)
    }
  }

  return (
    <>
      <div className={shellStyles.optionSection}>
        <label
          className={shellStyles.checkRow}
          title={t('analysis:common.bootstrap.enableTooltip')}
        >
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={e => {
              setCurrent({ ...current, enabled: e.target.checked })
            }}
            aria-describedby={enableDescId}
          />
          {t('analysis:common.bootstrap.enable')}
          <span id={enableDescId} hidden>
            {t('analysis:common.bootstrap.enableTooltip')}
          </span>
        </label>
        {current.enabled && (
          <div className={shellStyles.optionGrid}>
            <label className={shellStyles.checkRow}>
              {t('analysis:common.bootstrap.samples')}
              <input
                type="number"
                min={1}
                step={1}
                value={current.samples}
                onChange={e => {
                  setCurrent({ ...current, samples: Math.max(1, Number(e.target.value) || 1000) })
                }}
                className="numField"
              />
            </label>
            <label className={shellStyles.checkRow}>
              {t('analysis:common.bootstrap.seed')}
              <input
                type="number"
                step={1}
                value={current.seed}
                placeholder={t('analysis:common.bootstrap.seedPlaceholder')}
                onChange={e => {
                  setCurrent({ ...current, seed: e.target.value })
                }}
                className="numField"
              />
            </label>
            <label className={shellStyles.checkRow}>
              {t('analysis:common.bootstrap.ciLevel')}
              <input
                type="number"
                min={50.1}
                max={99.9}
                step="any"
                value={current.ciLevel}
                onChange={e => {
                  setCurrent({ ...current, ciLevel: Number(e.target.value) || 95 })
                }}
                className="numField--sm"
              />
            </label>
            <div className={shellStyles.optionSectionTitle}>
              {t('analysis:common.bootstrap.ciType')}
            </div>
            <label
              className={shellStyles.checkRow}
              title={t('analysis:common.bootstrap.percentileTooltip')}
            >
              <input
                type="radio"
                checked={current.ciType === 'percentile'}
                onChange={() => {
                  setCurrent({ ...current, ciType: 'percentile' })
                }}
                aria-describedby={percentileDescId}
              />
              {t('analysis:common.bootstrap.percentile')}
              <span id={percentileDescId} hidden>
                {t('analysis:common.bootstrap.percentileTooltip')}
              </span>
            </label>
            <label
              className={shellStyles.checkRow}
              title={t('analysis:common.bootstrap.bcaTooltip')}
            >
              <input
                type="radio"
                checked={current.ciType === 'bca'}
                onChange={() => {
                  setCurrent({ ...current, ciType: 'bca' })
                }}
                aria-describedby={bcaDescId}
              />
              {t('analysis:common.bootstrap.bca')}
              <span id={bcaDescId} hidden>
                {t('analysis:common.bootstrap.bcaTooltip')}
              </span>
            </label>
          </div>
        )}
      </div>

      {onClose && (
        <SubDialogFooter
          onContinue={() => {
            onChange(local)
            onClose()
          }}
          onCancel={onClose}
        />
      )}
    </>
  )
}
