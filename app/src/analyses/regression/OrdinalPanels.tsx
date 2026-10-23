// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import { validOrdinalSettings } from '@shared/ordinal-schema'
import { type OrdinalSettings } from '@shared/ordinal-types'
import {
  CheckOption,
  OptionSection,
  SubDialogFooter
} from '@/components/Dialogs/AnalysisDialogShell'
import { NewVariablesPanel } from '@/components/Dialogs/NewVariablesPanel'
import type { NewVarSelection } from '@/lib/new-var-names'
import type analysisLocale from '@/i18n/locales/tr/analysis.json'
import styles from './OrdinalPanels.module.css'
import { ORDINAL_SAVE_SLOTS } from './ordinal-save-slots'

export type OrdinalPanelKind = 'scale' | 'output' | 'options' | 'location'

export function OrdinalPanel({
  kind,
  value,
  onChange,
  onClose,
  assignments,
  existingNames,
  newVars,
  onNewVars
}: {
  kind: OrdinalPanelKind
  value: OrdinalSettings
  onChange: (value: OrdinalSettings) => void
  onClose: () => void
  assignments: Record<string, Variable[]>
  existingNames: string[]
  newVars: NewVarSelection
  onNewVars: (value: NewVarSelection) => void
}) {
  const { t } = useTranslation(['analysis', 'common'])
  const tr = (key: keyof typeof analysisLocale.ordinal.extra) => t(`analysis:ordinal.extra.${key}`)
  const [local, setLocal] = useState(() => structuredClone(value))
  const [saved, setSaved] = useState(newVars)
  const [selected, setSelected] = useState<string[]>([])
  const [termMode, setTermMode] = useState('main')
  const [error, setError] = useState(false)
  const predictors = [...(assignments.factors ?? []), ...(assignments.covariates ?? [])]
  const patch = <K extends keyof OrdinalSettings>(
    section: K,
    values: Partial<OrdinalSettings[K]>
  ) => {
    setLocal(s => ({ ...s, [section]: { ...s[section], ...values } }))
  }
  const number = (
    key: keyof typeof analysisLocale.ordinal.extra,
    val: number,
    change: (v: number) => void,
    min = 0,
    max?: number,
    step: number | 'any' = 'any',
    disabled = false
  ) => (
    <label className={styles.row}>
      <span>{tr(key)}</span>
      <input
        className="numField"
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={Number.isNaN(val) ? '' : val}
        onChange={e => {
          change(e.target.valueAsNumber)
        }}
      />
    </label>
  )
  const target = kind === 'scale' ? 'scale' : 'location'
  const addTerms = () => {
    const combine = (items: string[], n: number): string[][] =>
      n === 0
        ? [[]]
        : items.flatMap((id, i) => combine(items.slice(i + 1), n - 1).map(rest => [id, ...rest]))
    const candidates =
      termMode === 'main'
        ? selected.map(id => [id])
        : termMode === 'interaction'
          ? [selected]
          : termMode === 'factorial'
            ? selected.flatMap((_, i) => combine(selected, i + 1))
            : combine(selected, Number(termMode))
    const seen = new Set(local[target].terms.map(term => [...term].sort().join(':')))
    patch(target, {
      terms: [
        ...local[target].terms,
        ...candidates.filter(term => term.length && !seen.has([...term].sort().join(':')))
      ]
    })
  }
  const { options: o, output: out } = local
  return (
    <div className={styles.panel}>
      {(kind === 'scale' || kind === 'location') && (
        <>
          {kind === 'location' && (
            <OptionSection title={tr('specifyModel')} grid={false}>
              {(['main', 'custom'] as const).map(mode => (
                <label className={styles.row} key={mode}>
                  <input
                    type="radio"
                    name="ordinal-location"
                    checked={local.location.mode === mode}
                    onChange={() => {
                      patch('location', { mode })
                    }}
                  />
                  {tr(mode)}
                </label>
              ))}
            </OptionSection>
          )}
          <fieldset disabled={kind === 'location' && local.location.mode !== 'custom'}>
            <legend>{tr(`${target}Model`)}</legend>
            <div className={styles.terms}>
              <div>
                <label>
                  {tr('predictors')}
                  <select
                    className={styles.list}
                    multiple
                    size={8}
                    value={selected}
                    onChange={e => {
                      setSelected(Array.from(e.target.selectedOptions, opt => opt.value))
                    }}
                  >
                    {predictors.map(v => (
                      <option key={v.colId} value={v.colId}>
                        {v.label || v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.row}>
                  {tr('buildTerms')}
                  <select
                    value={termMode}
                    onChange={e => {
                      setTermMode(e.target.value)
                    }}
                  >
                    {(['main', 'interaction', 'factorial', '2', '3', '4', '5'] as const).map(
                      mode => (
                        <option key={mode} value={mode}>
                          {tr(`term_${mode}`)}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!selected.length || (termMode === 'factorial' && selected.length > 8)}
                  onClick={addTerms}
                >
                  {tr('add')}
                </button>
              </div>
              <ul aria-label={tr(`${target}Model`)}>
                {local[target].terms.map((term, i) => {
                  const label = term
                    .map(id => predictors.find(v => v.colId === id)?.name ?? id)
                    .join(' × ')
                  return (
                    <li key={term.join(':')}>
                      {label}{' '}
                      <button
                        type="button"
                        aria-label={`${tr('remove')} ${label}`}
                        onClick={() => {
                          patch(target, {
                            terms: local[target].terms.filter((_, idx) => idx !== i)
                          })
                        }}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </fieldset>
          <p className={styles.hint}>{tr(kind === 'scale' ? 'scaleHint' : 'locationHint')}</p>
        </>
      )}
      {kind === 'options' && (
        <>
          <OptionSection title={tr('iterations')} grid={false}>
            {number(
              'maxIterations',
              o.maxIterations,
              maxIterations => {
                patch('options', { maxIterations })
              },
              0,
              undefined,
              1
            )}
            {number(
              'maxStepHalving',
              o.maxStepHalving,
              maxStepHalving => {
                patch('options', { maxStepHalving })
              },
              1,
              undefined,
              1
            )}
            {number('logLikelihood', o.logLikelihood, logLikelihood => {
              patch('options', { logLikelihood })
            })}
            {number('parameter', o.parameter, parameter => {
              patch('options', { parameter })
            })}
          </OptionSection>
          {number(
            'ciLevel',
            o.ciLevel,
            ciLevel => {
              patch('options', { ciLevel })
            },
            0,
            99.999
          )}
          {number(
            'delta',
            o.delta,
            delta => {
              patch('options', { delta })
            },
            0,
            0.999
          )}
          {number(
            'singularity',
            o.singularity,
            singularity => {
              patch('options', { singularity })
            },
            Number.MIN_VALUE
          )}
          <label className={styles.row}>
            <span>{tr('link')}</span>
            <select
              value={o.link}
              onChange={e => {
                patch('options', { link: e.target.value as typeof o.link })
              }}
            >
              {(['logit', 'probit', 'cloglog', 'loglog', 'cauchit'] as const).map(link => (
                <option key={link} value={link}>
                  {tr(link)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {kind === 'output' && (
        <>
          <OptionSection title={tr('display')} grid={false}>
            {(
              [
                'history',
                'goodnessOfFit',
                'summary',
                'estimates',
                'correlations',
                'covariances',
                'cellInfo',
                'parallelLines'
              ] as const
            ).map(key => (
              <CheckOption
                key={key}
                checked={out[key]}
                onChange={val => {
                  patch('output', { [key]: val })
                }}
              >
                {tr(key)}
              </CheckOption>
            ))}
            {number(
              'historyEvery',
              out.historyEvery,
              historyEvery => {
                patch('output', { historyEvery })
              },
              1,
              undefined,
              1,
              !out.history
            )}
          </OptionSection>
          <OptionSection title={tr('savedVariables')} grid={false}>
            <NewVariablesPanel
              slots={ORDINAL_SAVE_SLOTS}
              value={saved}
              onChange={setSaved}
              existingNames={existingNames}
            />
          </OptionSection>
          <OptionSection title={tr('logLikelihoodPrint')} grid={false}>
            {[true, false].map(includeConstant => (
              <label className={styles.row} key={String(includeConstant)}>
                <input
                  type="radio"
                  name="ordinal-constant"
                  checked={out.includeConstant === includeConstant}
                  onChange={() => {
                    patch('output', { includeConstant })
                  }}
                />
                {tr(includeConstant ? 'including' : 'excluding')}
              </label>
            ))}
          </OptionSection>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {tr('invalid')}
        </p>
      )}
      <SubDialogFooter
        onContinue={() => {
          if (
            !validOrdinalSettings(
              local,
              predictors.map(v => v.colId)
            )
          ) {
            setError(true)
            return
          }
          onChange(local)
          onNewVars(saved)
          onClose()
        }}
        onCancel={onClose}
      />
    </div>
  )
}
