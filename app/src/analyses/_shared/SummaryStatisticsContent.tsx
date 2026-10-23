// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Statistics sub-dialog shared by the three Reports procedures (Case
 * Summaries, Report Summaries in Rows, Report Summaries in Columns).
 *
 * All three offer the same statistic menu — see summary-stats.ts and its R
 * counterpart `sai_summary_stat_defs()` — so they share one component rather
 * than three copies of the same checkbox grid that would then diverge in which
 * statistics they list and in what order.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckOption,
  OptionSection,
  SubDialogFooter
} from '../../components/Dialogs/AnalysisDialogShell'
import { SUMMARY_STAT_GROUPS } from './summary-stats'

/**
 * `stats` is a plain flag map rather than `SummaryStats` so OLAP Cubes can pass
 * the same menu plus its four percentage cells (see OLAP_STAT_GROUPS) without a
 * second copy of this component. `groups` decides which checkboxes appear; the
 * default is the registry's own grouping.
 */
export function SummaryStatisticsContent<S extends Record<string, boolean>>({
  stats,
  onChange,
  onClose,
  groups = SUMMARY_STAT_GROUPS
}: {
  stats: S
  onChange: (s: S) => void
  onClose: () => void
  groups?: { titleKey: string; keys: readonly string[] }[]
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(stats)

  return (
    <>
      {groups.map(group => (
        <OptionSection key={group.titleKey} titleKey={group.titleKey}>
          {group.keys.map(key => (
            <CheckOption
              key={key}
              checked={local[key] ?? false}
              onChange={v => {
                setLocal(prev => ({ ...prev, [key]: v }))
              }}
            >
              {/* A statistic key is only known at runtime, so the template
                  literal does not narrow to i18next's typed key union — tsc
                  needs the widening that eslint reads as redundant. */}
              {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion */}
              {t(`analysis:col.${key}` as never)}
            </CheckOption>
          ))}
        </OptionSection>
      ))}

      <SubDialogFooter
        onContinue={() => {
          onChange(local)
          onClose()
        }}
        onCancel={onClose}
      />
    </>
  )
}
