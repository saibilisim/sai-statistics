// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared "p-value method" panel — SPSS's Exact Tests module (IBM_SPSS_Exact_
 * Tests.pdf): Asymptotic (default) vs Monte Carlo, with sample count and
 * seed. See spss-parity-analysis.md §3.4.
 */

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SubDialogFooter } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'

export interface PMethodOptions {
  // 'exact' is only offered by dialogs that pass allowExact (rank tests via
  // the coin package — CLAUDE.md §11); Crosstabs handles exact via Fisher and
  // never sets it.
  method: 'asymptotic' | 'montecarlo' | 'exact'
  samples: number
  seed: string
}

export const defaultPMethodOptions: PMethodOptions = {
  method: 'asymptotic',
  samples: 10000,
  seed: ''
}

/** The params.options.pMethod payload — also what the syntax generators read
 *  to write NPAR TESTS' /METHOD clause (buildSyntax). */
export interface PMethodParams {
  method: 'montecarlo' | 'exact'
  samples: number
  seed?: number
}

/** Converts dialog state to the params.options.pMethod shape the R helpers
 *  (sai_monte_carlo_chisq / sai_coin_pvalue) read. Returns undefined for the
 *  default (asymptotic) case — no key sent, same convention as
 *  buildBootstrapParams. */
export function buildPMethodParams(opt: PMethodOptions): PMethodParams | undefined {
  if (opt.method === 'asymptotic') return undefined
  return {
    method: opt.method,
    // samples is irrelevant for exact but harmless to include; the R side
    // ignores it in the exact branch.
    samples: opt.samples,
    ...(opt.seed.trim() !== '' ? { seed: Number(opt.seed) } : {})
  }
}

export function PMethodSection({
  value,
  onChange,
  onClose,
  allowExact = false,
  allowMonteCarlo = true
}: {
  value: PMethodOptions
  onChange: (v: PMethodOptions) => void
  onClose?: () => void
  allowExact?: boolean
  /** False for a test whose R script has no Monte Carlo path (Runs: the
   *  exact distribution comes from randtests, which has no simulation). */
  allowMonteCarlo?: boolean
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const asymptoticDescId = useId()
  const montecarloDescId = useId()
  const exactDescId = useId()

  const [local, setLocal] = useState(value)
  const current = onClose ? local : value
  const setCurrent = (v: PMethodOptions) => {
    if (onClose) {
      setLocal(v)
    } else {
      onChange(v)
    }
  }

  return (
    <>
      <div className={shellStyles.optionSection}>
        <div className={shellStyles.optionSectionTitle}>{t('analysis:common.pMethod.title')}</div>
        <div className={shellStyles.optionGrid}>
          <label
            className={shellStyles.checkRow}
            title={t('analysis:common.pMethod.asymptoticTooltip')}
          >
            <input
              type="radio"
              checked={current.method === 'asymptotic'}
              onChange={() => {
                setCurrent({ ...current, method: 'asymptotic' })
              }}
              aria-describedby={asymptoticDescId}
            />
            {t('analysis:common.pMethod.asymptotic')}
            <span id={asymptoticDescId} hidden>
              {t('analysis:common.pMethod.asymptoticTooltip')}
            </span>
          </label>
          {allowMonteCarlo && (
            <label
              className={shellStyles.checkRow}
              title={t('analysis:common.pMethod.montecarloTooltip')}
            >
              <input
                type="radio"
                checked={current.method === 'montecarlo'}
                onChange={() => {
                  setCurrent({ ...current, method: 'montecarlo' })
                }}
                aria-describedby={montecarloDescId}
              />
              {t('analysis:common.pMethod.montecarlo')}
              <span id={montecarloDescId} hidden>
                {t('analysis:common.pMethod.montecarloTooltip')}
              </span>
            </label>
          )}
          {allowExact && (
            <label
              className={shellStyles.checkRow}
              title={t('analysis:common.pMethod.exactTooltip')}
            >
              <input
                type="radio"
                checked={current.method === 'exact'}
                onChange={() => {
                  setCurrent({ ...current, method: 'exact' })
                }}
                aria-describedby={exactDescId}
              />
              {t('analysis:common.pMethod.exact')}
              <span id={exactDescId} hidden>
                {t('analysis:common.pMethod.exactTooltip')}
              </span>
            </label>
          )}
          {current.method === 'montecarlo' && (
            <>
              <label className={shellStyles.checkRow}>
                {t('analysis:common.pMethod.samples')}
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={current.samples}
                  onChange={e => {
                    setCurrent({
                      ...current,
                      samples: Math.max(1, Number(e.target.value) || 10000)
                    })
                  }}
                  className="numField numField--lg"
                />
              </label>
              <label className={shellStyles.checkRow}>
                {t('analysis:common.pMethod.seed')}
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
            </>
          )}
        </div>
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
