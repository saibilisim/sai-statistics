// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Options sub-dialog shared by ROC Curve and ROC Analysis — SPSS gives
 * both procedures the same one: Classification, Test Direction, Parameters
 * for Standard Error of Area, Missing Values. Its state and payload
 * helpers live in roc-options.ts.
 */

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OptionSection, SubDialogFooter } from '../../components/Dialogs/AnalysisDialogShell'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { type RocOptions } from './roc-options'

function Radio<V extends string>({
  name,
  value,
  current,
  onSelect,
  label
}: {
  name: string
  value: V
  current: V
  onSelect: (v: V) => void
  label: string
}) {
  return (
    <label className={shellStyles.checkRow}>
      <input
        type="radio"
        name={name}
        checked={current === value}
        onChange={() => {
          onSelect(value)
        }}
      />
      {label}
    </label>
  )
}

export function RocOptionsContent({
  options,
  onChange,
  onClose
}: {
  options: RocOptions
  onChange: (o: RocOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const id = useId()
  const [local, setLocal] = useState(options)
  const set = <K extends keyof RocOptions>(key: K, val: RocOptions[K]) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection titleKey="analysis:roc.classification" grid={false}>
        <Radio
          name={`${id}-cutoff`}
          value="include"
          current={local.cutoff}
          onSelect={v => {
            set('cutoff', v)
          }}
          label={t('analysis:roc.cutoffInclude')}
        />
        <Radio
          name={`${id}-cutoff`}
          value="exclude"
          current={local.cutoff}
          onSelect={v => {
            set('cutoff', v)
          }}
          label={t('analysis:roc.cutoffExclude')}
        />
      </OptionSection>

      <OptionSection titleKey="analysis:roc.direction" grid={false}>
        <Radio
          name={`${id}-dir`}
          value="larger"
          current={local.direction}
          onSelect={v => {
            set('direction', v)
          }}
          label={t('analysis:roc.directionLarger')}
        />
        <Radio
          name={`${id}-dir`}
          value="smaller"
          current={local.direction}
          onSelect={v => {
            set('direction', v)
          }}
          label={t('analysis:roc.directionSmaller')}
        />
      </OptionSection>

      <OptionSection titleKey="analysis:roc.seParams" grid={false}>
        <label className={shellStyles.checkRow}>
          {t('analysis:roc.distribution')}
          <select
            value={local.distribution}
            onChange={e => {
              set('distribution', e.target.value as RocOptions['distribution'])
            }}
          >
            <option value="free">{t('analysis:roc.distFree')}</option>
            <option value="negexpo">{t('analysis:roc.distNegexpo')}</option>
          </select>
        </label>
        <label className={shellStyles.checkRow}>
          {t('analysis:roc.ciLevel')}
          <input
            type="number"
            value={local.ciLevel}
            step="any"
            min="1"
            max="99.99"
            onChange={e => {
              set('ciLevel', e.target.value)
            }}
            className="numField"
          />
        </label>
      </OptionSection>

      <OptionSection titleKey="analysis:roc.missingTitle" grid={false}>
        <Radio
          name={`${id}-mv`}
          value="exclude"
          current={local.userMissing}
          onSelect={v => {
            set('userMissing', v)
          }}
          label={t('analysis:roc.missingExclude')}
        />
        <Radio
          name={`${id}-mv`}
          value="include"
          current={local.userMissing}
          onSelect={v => {
            set('userMissing', v)
          }}
          label={t('analysis:roc.missingInclude')}
        />
      </OptionSection>

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
