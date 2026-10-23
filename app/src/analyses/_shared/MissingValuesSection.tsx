// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared "Missing Values" radio group — SPSS's "Exclude cases analysis by
 * analysis" (default) vs "Exclude cases listwise" option, reused across the
 * Compare Means dialog family (t tests, One-Way ANOVA, Means). See
 * roadmap.md Konu Yol Haritaları §C (eski MV1/MV2).
 *
 * `variant="pairwise"` (MV3, spss-parity-findings-2026-07-07 §B3) switches
 * the first option to SPSS Correlate's own wording/value ("Exclude cases
 * pairwise", the default there) instead of "analysis by analysis" — same
 * two-radio shape, different first choice.
 */

import { useTranslation } from 'react-i18next'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'

export type MissingStrategy = 'analysis' | 'listwise' | 'pairwise'

export function MissingValuesSection({
  value,
  onChange,
  variant = 'analysis'
}: {
  value: MissingStrategy
  onChange: (v: MissingStrategy) => void
  variant?: 'analysis' | 'pairwise'
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const firstOption: MissingStrategy = variant
  const firstLabel =
    variant === 'pairwise'
      ? t('analysis:common.excludePairwise')
      : t('analysis:common.excludeAnalysisByAnalysis')
  return (
    <div className={shellStyles.optionSection}>
      <div className={shellStyles.optionSectionTitle}>{t('analysis:common.missingValues')}</div>
      <div className={shellStyles.optionGrid}>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            checked={value === firstOption}
            onChange={() => {
              onChange(firstOption)
            }}
          />
          {firstLabel}
        </label>
        <label className={shellStyles.checkRow}>
          <input
            type="radio"
            checked={value === 'listwise'}
            onChange={() => {
              onChange('listwise')
            }}
          />
          {t('analysis:common.excludeListwise')}
        </label>
      </div>
    </div>
  )
}
