// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SPSS's Options sub-dialog for Binomial, One-Sample K-S and Runs:
 * Statistics (Descriptive, Quartiles) and Missing Values (test-by-test vs
 * listwise), with Continue/Cancel so Cancel discards.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckOption,
  OptionSection,
  SubDialogFooter
} from '../../components/Dialogs/AnalysisDialogShell'
import { MissingValuesSection } from '../_shared/MissingValuesSection'
import type { NparOneSampleOptions } from './npar-options'

export function NparOneSampleOptionsContent({
  value,
  onChange,
  onClose
}: {
  value: NparOneSampleOptions
  onChange: (v: NparOneSampleOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  return (
    <>
      <OptionSection titleKey="analysis:nparKW.statisticsSection">
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            setLocal(prev => ({ ...prev, descriptives: v }))
          }}
        >
          {t('analysis:nparOneSample.descriptives')}
        </CheckOption>
        <CheckOption
          checked={local.quartiles}
          onChange={v => {
            setLocal(prev => ({ ...prev, quartiles: v }))
          }}
        >
          {t('analysis:nparOneSample.quartiles')}
        </CheckOption>
      </OptionSection>
      <MissingValuesSection
        value={local.missing}
        onChange={v => {
          setLocal(prev => ({ ...prev, missing: v }))
        }}
      />
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
