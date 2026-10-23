// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared Bayesian prior-scale selector — used by the Bayesian mode of the
 * reused frequentist dialogs (t tests, ANOVA, regression, correlation).
 *
 * The widths and the rule for sending them to R live in bayes-prior.ts; this
 * file is the control only. It shows the NUMBER beside every preset, because
 * the preset's name means four different widths across the four families, and
 * it offers a custom width, because r = 1 — the default several other packages
 * use — is not reachable from the presets for a regression coefficient.
 */

import { useTranslation } from 'react-i18next'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import {
  PRIOR_SCALE_VALUES,
  isCustomWidthValid,
  type BayesPrior,
  type PriorFamily
} from './bayes-prior'

export {
  bayesRscale,
  defaultBayesPrior,
  PRIOR_SCALE_VALUES,
  type BayesPrior,
  type PriorFamily,
  type PriorPreset
} from './bayes-prior'

export function BayesPriorSection({
  prior,
  setPrior,
  family
}: {
  prior: BayesPrior
  setPrior: (p: BayesPrior) => void
  family: PriorFamily
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const values = PRIOR_SCALE_VALUES[family]
  const customBad = prior.preset === 'custom' && !isCustomWidthValid(prior)

  return (
    <div className={shellStyles.optionSection}>
      <div className={shellStyles.optionSectionTitle}>{t('analysis:bayes.priorScale')}</div>
      <div className={shellStyles.optionGrid}>
        {(['medium', 'wide', 'ultrawide'] as const).map(p => (
          <label key={p} className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={prior.preset === p}
              onChange={() => {
                setPrior({ ...prior, preset: p })
              }}
            />
            {t(`analysis:bayes.prior.${p}`)}
            <span className="text-muted-inline">(r = {values[p].toFixed(3)})</span>
          </label>
        ))}
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            checked={prior.preset === 'custom'}
            onChange={() => {
              setPrior({ ...prior, preset: 'custom' })
            }}
          />
          {t('analysis:bayes.prior.custom')}
          <input
            type="number"
            min="0"
            step="0.001"
            value={prior.custom}
            aria-label={t('analysis:bayes.prior.custom')}
            onChange={e => {
              setPrior({ preset: 'custom', custom: e.target.value })
            }}
            onFocus={() => {
              setPrior({ ...prior, preset: 'custom' })
            }}
            className="numField"
          />
        </label>
      </div>
      {customBad && <div className="text-error-xs">{t('analysis:bayes.prior.customInvalid')}</div>}
    </div>
  )
}
