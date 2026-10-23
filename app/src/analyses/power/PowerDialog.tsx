// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Power Analysis dialog — SPSS 27+ Analyze → Power Analysis.
 * Dataset-independent: pure numeric inputs, no variable selection.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from '../../components/Dialogs/DialogBase'
import { useDatasetStore } from '../../store/dataset-store'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'

type Test = 'tOne' | 'tTwo' | 'anova' | 'correlation' | 'chisquare' | 'regression'

const TESTS: Test[] = ['tOne', 'tTwo', 'anova', 'correlation', 'chisquare', 'regression']

export function PowerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const [test, setTest] = useState<Test>('tTwo')
  const [effectSize, setEffectSize] = useState('0.5')
  const [alpha, setAlpha] = useState('0.05')
  const [power, setPower] = useState('0.8')
  const [n, setN] = useState('30')
  const [groups, setGroups] = useState('3')
  const [df, setDf] = useState('1')
  const [predictors, setPredictors] = useState('1')
  const { running, run } = useRunAnalysis()

  const es = parseFloat(effectSize)
  const canOk = Number.isFinite(es) && es > 0 && !running

  const field = (label: string, value: string, setter: (v: string) => void, step = 'any') => (
    <label className="formRow">
      <span className="formRow__label">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={e => {
          setter(e.target.value)
        }}
        className="numField numField--lg numField--flush"
      />
    </label>
  )

  const handleOk = async () => {
    if (!datasetId || !canOk) return
    await run(
      {
        analysisId: 'power',
        datasetId,
        scriptFile: 'power.R',
        params: {
          test,
          effectSize: es,
          alpha: parseFloat(alpha),
          power: parseFloat(power),
          n: parseFloat(n),
          groups: parseFloat(groups),
          df: parseFloat(df),
          predictors: parseFloat(predictors)
        }
      },
      onClose,
      { titleKey: 'analysis:power.title', assignments: {} }
    )
  }

  return (
    <DialogBase
      titleKey="analysis:power.title"
      onOk={() => void handleOk()}
      onCancel={onClose}
      generateSyntax={() =>
        buildSyntax.power(test, {
          effectSize: parseFloat(effectSize),
          alpha: parseFloat(alpha),
          power: parseFloat(power) || null,
          n: parseFloat(n) || null
        })
      }
      okDisabled={!canOk}
    >
      <div className="formPanel">
        <label className="formRow">
          <span className="formRow__label">{t('analysis:power.testType')}</span>
          <select
            value={test}
            onChange={e => {
              setTest(e.target.value as Test)
            }}
            className="numField numField--select numField--flush"
          >
            {TESTS.map(tt => (
              <option key={tt} value={tt}>
                {t(`analysis:power.test.${tt}`)}
              </option>
            ))}
          </select>
        </label>

        {field(t('analysis:power.effectSizeLabel'), effectSize, setEffectSize)}
        {field(t('analysis:power.alphaLabel'), alpha, setAlpha)}
        {field(t('analysis:power.powerLabel'), power, setPower)}
        {field(
          test === 'tTwo' || test === 'anova'
            ? t('analysis:power.nPerGroupLabel')
            : t('analysis:power.nLabel'),
          n,
          setN,
          '1'
        )}
        {test === 'anova' && field(t('analysis:power.groupsLabel'), groups, setGroups, '1')}
        {test === 'chisquare' && field(t('analysis:power.dfLabel'), df, setDf, '1')}
        {test === 'regression' &&
          field(t('analysis:power.predictorsLabel'), predictors, setPredictors, '1')}
      </div>
    </DialogBase>
  )
}
