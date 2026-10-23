// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type analysisMessages from '@/i18n/locales/en/analysis.json'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Variable } from '@shared/data-types'
import type { MultinomialSettings } from '@shared/multinomial-types'
import { validMultinomialSettings, validMultinomialTerms } from '@/lib/multinomial-settings'
import {
  CheckOption,
  OptionSection,
  SubDialogFooter
} from '../../components/Dialogs/AnalysisDialogShell'
import { NewVariablesPanel, type NewVarSlot } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '@/lib/new-var-names'
import styles from './MultinomialPanels.module.css'

type ExtraKey = keyof typeof analysisMessages.multinom.extra

const MULTINOMIAL_SAVE_SLOTS: NewVarSlot[] = [
  {
    key: 'estimatedProbabilities',
    labelKey: 'analysis:multinom.extra.estimatedProbabilities',
    defaultName: 'est',
    perCoefficient: true,
    stemHintKey: 'analysis:multinom.extra.probabilityStemHint'
  },
  {
    key: 'predictedGroup',
    labelKey: 'analysis:multinom.extra.predictedCategory',
    defaultName: 'pgr'
  },
  {
    key: 'probability',
    labelKey: 'analysis:multinom.extra.predictedProbability',
    defaultName: 'pre'
  },
  {
    key: 'actualProbability',
    labelKey: 'analysis:multinom.extra.actualProbability',
    defaultName: 'acp'
  }
]
export type MultinomialPanelKind =
  | 'reference'
  | 'save'
  | 'model'
  | 'options'
  | 'criteria'
  | 'statistics'

export function MultinomialPanel({
  kind,
  value,
  onChange,
  onClose,
  assignments,
  variables,
  newVars,
  onNewVars
}: {
  kind: MultinomialPanelKind
  value: MultinomialSettings
  onChange: (value: MultinomialSettings) => void
  onClose: () => void
  assignments: Record<string, Variable[]>
  variables: Variable[]
  newVars: NewVarSelection
  onNewVars: (value: NewVarSelection) => void
}) {
  const { t } = useTranslation(['analysis', 'common'])
  const tr = (key: ExtraKey): string => t(`analysis:multinom.extra.${key}`)
  const [local, setLocal] = useState(() => structuredClone(value))
  const [saved, setSaved] = useState(newVars)
  const [selected, setSelected] = useState<string[]>([])
  const [termMode, setTermMode] = useState('interaction')
  const [error, setError] = useState('')
  const predictors = [...(assignments.factors ?? []), ...(assignments.covariates ?? [])]
  const patch = <K extends keyof MultinomialSettings>(
    section: K,
    values: Partial<MultinomialSettings[K]>
  ) => {
    setLocal(s => ({ ...s, [section]: { ...s[section], ...values } }))
  }
  const number = (
    key: ExtraKey,
    val: number | null,
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
        value={val === null || Number.isNaN(val) ? '' : val}
        onChange={e => {
          change(e.target.valueAsNumber)
        }}
      />
    </label>
  )
  const choose = (
    key: ExtraKey,
    val: string,
    opts: ExtraKey[],
    change: (v: string) => void,
    disabled = false
  ) => (
    <label className={styles.row}>
      <span>{tr(key)}</span>
      <select
        aria-label={tr(key)}
        disabled={disabled}
        value={val}
        onChange={e => {
          change(e.target.value)
        }}
      >
        {opts.map(opt => (
          <option key={opt} value={opt}>
            {tr(opt)}
          </option>
        ))}
      </select>
    </label>
  )
  const check = (key: ExtraKey, val: boolean, change: (v: boolean) => void) => (
    <CheckOption checked={val} onChange={change}>
      {tr(key)}
    </CheckOption>
  )
  const addTerms = (target: 'forced' | 'stepped') => {
    let terms: string[][] = []
    const combine = (items: string[], n: number): string[][] =>
      n === 0
        ? [[]]
        : items.flatMap((id, i) => combine(items.slice(i + 1), n - 1).map(rest => [id, ...rest]))
    if (termMode === 'main') terms = selected.map(id => [id])
    else if (termMode === 'factorial') terms = selected.flatMap((_, i) => combine(selected, i + 1))
    else if (termMode === 'interaction') terms = selected.length ? [selected] : []
    else terms = combine(selected, Number(termMode))
    const seen = new Set(
      [...local.model.forced, ...local.model.stepped].map(term => [...term].sort().join(':'))
    )
    patch('model', {
      [target]: [
        ...local.model[target],
        ...terms.filter(term => !seen.has([...term].sort().join(':')))
      ]
    })
  }
  const termLabel = (term: string[]) =>
    term.map(id => predictors.find(v => v.colId === id)?.name ?? id).join(' × ')
  const stepwise = local.model.mode === 'custom' && local.model.stepped.length > 0
  const { model: m, options: o, criteria: c, statistics: st, reference: r } = local
  const dependentLabels = assignments.dependent?.[0]?.valueLabels ?? {}
  const valid =
    validMultinomialSettings(local) &&
    validMultinomialTerms(
      m,
      predictors.map(v => v.colId)
    ) &&
    (kind !== 'save' ||
      Object.keys(
        cleanNewVarSelection(
          saved,
          variables.map(v => v.name),
          ['estimatedProbabilities']
        )
      ).length === Object.keys(saved).length)
  return (
    <div className={styles.panel}>
      {kind === 'reference' && (
        <>
          <OptionSection title={tr('reference')} grid={false}>
            {(['first', 'last', 'custom'] as const).map(category => (
              <label className={styles.row} key={category}>
                <input
                  type="radio"
                  name="multinomial-reference"
                  checked={r.category === category}
                  onChange={() => {
                    patch('reference', { category })
                  }}
                />
                {tr(
                  `ref${category === 'first' ? 'First' : category === 'last' ? 'Last' : 'Custom'}`
                )}
              </label>
            ))}
            <label className={styles.row}>
              <span>{tr('refValue')}</span>
              <input
                list="multinomial-reference-values"
                disabled={r.category !== 'custom'}
                value={r.customValue}
                onChange={e => {
                  patch('reference', { customValue: e.target.value })
                }}
              />
              <datalist id="multinomial-reference-values">
                {Object.entries(dependentLabels).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </datalist>
            </label>
          </OptionSection>
          <OptionSection title={tr('categoryOrder')} grid={false}>
            {(['ascending', 'descending'] as const).map(order => (
              <label className={styles.row} key={order}>
                <input
                  type="radio"
                  name="multinomial-order"
                  checked={r.order === order}
                  onChange={() => {
                    patch('reference', { order })
                  }}
                />
                {tr(order)}
              </label>
            ))}
          </OptionSection>
        </>
      )}
      {kind === 'save' && (
        <>
          <NewVariablesPanel
            hintKey="analysis:multinom.extra.savedVariablesHint"
            slots={MULTINOMIAL_SAVE_SLOTS}
            value={saved}
            onChange={setSaved}
            existingNames={variables.map(v => v.name)}
          />
          <OptionSection title={tr('exportXml')} grid={false}>
            <div className={styles.row}>
              <input
                className={styles.path}
                aria-label={tr('exportXml')}
                value={local.exportModel.path}
                readOnly
              />
              <button
                type="button"
                onClick={() => {
                  void window.api.file
                    .chooseModelExportPath()
                    .then(path => {
                      if (path) patch('exportModel', { path })
                    })
                    .catch((err: unknown) => {
                      setError(String(err))
                    })
                }}
              >
                {tr('browse')}
              </button>
              <button
                type="button"
                disabled={!local.exportModel.path}
                onClick={() => {
                  patch('exportModel', { path: '' })
                }}
              >
                {t('common:common.clear')}
              </button>
            </div>
            {check('includeCovariance', local.exportModel.covariance, covariance => {
              patch('exportModel', { covariance })
            })}
          </OptionSection>
        </>
      )}
      {kind === 'model' && (
        <>
          <OptionSection title={tr('specifyModel')} grid={false}>
            <div className={styles.row}>
              {(['main', 'factorial', 'custom'] as const).map(mode => (
                <label key={mode}>
                  <input
                    type="radio"
                    name="multinomial-model"
                    checked={m.mode === mode}
                    onChange={() => {
                      patch('model', { mode })
                    }}
                  />
                  {tr(mode)}
                </label>
              ))}
            </div>
            <fieldset disabled={m.mode !== 'custom'}>
              <div className={styles.terms}>
                <div>
                  <label>
                    {tr('predictors')}
                    <select
                      className={styles.list}
                      multiple
                      value={selected}
                      onChange={e => {
                        setSelected(Array.from(e.target.selectedOptions, opt => opt.value))
                      }}
                    >
                      {predictors.map(v => (
                        <option key={v.colId} value={v.colId}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {choose(
                    'buildTerms',
                    termMode,
                    ['interaction', 'main', 'factorial', '2', '3', '4', '5'],
                    setTermMode
                  )}
                  <button
                    type="button"
                    disabled={!selected.length || (termMode === 'factorial' && selected.length > 8)}
                    onClick={() => {
                      addTerms('forced')
                    }}
                  >
                    {tr('addForced')}
                  </button>
                  <button
                    type="button"
                    disabled={!selected.length || (termMode === 'factorial' && selected.length > 8)}
                    onClick={() => {
                      addTerms('stepped')
                    }}
                  >
                    {tr('addStepped')}
                  </button>
                </div>
                <div>
                  {(['forced', 'stepped'] as const).map(target => (
                    <div key={target}>
                      <strong>{tr(target)}</strong>
                      <ul>
                        {m[target].map((term, i) => (
                          <li key={term.join(':')}>
                            {termLabel(term)}{' '}
                            <button
                              type="button"
                              aria-label={`${tr('remove')} ${termLabel(term)}`}
                              onClick={() => {
                                patch('model', {
                                  [target]: m[target].filter((_, idx) => idx !== i)
                                })
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
              {choose(
                'stepMethod',
                m.method,
                ['forward', 'backward', 'forwardStepwise', 'backwardStepwise'],
                method => {
                  patch('model', { method: method as typeof m.method })
                }
              )}
            </fieldset>
            {check('intercept', m.intercept, intercept => {
              patch('model', { intercept })
            })}
          </OptionSection>
        </>
      )}
      {kind === 'options' && (
        <>
          <OptionSection title={tr('dispersion')} grid={false}>
            {choose('scale', o.scale, ['none', 'deviance', 'pearson', 'fixed'], scale => {
              patch('options', { scale: scale as typeof o.scale })
            })}
            {number(
              'scaleValue',
              o.scaleValue,
              scaleValue => {
                patch('options', { scaleValue })
              },
              0.000001,
              undefined,
              'any',
              o.scale !== 'fixed'
            )}
          </OptionSection>
          <OptionSection title={tr('stepOptions')} grid={false}>
            <fieldset disabled={!stepwise}>
              {number(
                'entryProbability',
                o.entryProbability,
                entryProbability => {
                  patch('options', { entryProbability })
                },
                0,
                1
              )}
              {choose('entryTest', o.entryTest, ['lr', 'score'], entryTest => {
                patch('options', { entryTest: entryTest as typeof o.entryTest })
              })}
              {number(
                'removalProbability',
                o.removalProbability,
                removalProbability => {
                  patch('options', { removalProbability })
                },
                0,
                1
              )}
              {choose('removalTest', o.removalTest, ['lr', 'wald'], removalTest => {
                patch('options', { removalTest: removalTest as typeof o.removalTest })
              })}
              {number(
                'minEffects',
                o.minEffects,
                minEffects => {
                  patch('options', { minEffects })
                },
                0,
                undefined,
                1
              )}
              {number(
                'maxEffects',
                o.maxEffects,
                maxEffects => {
                  patch('options', { maxEffects: Number.isNaN(maxEffects) ? null : maxEffects })
                },
                0,
                undefined,
                1
              )}
              <p className={styles.hint}>{tr('maxEffectsHint')}</p>
              {check('constrainHierarchy', o.hierarchy !== 'none', on => {
                patch('options', { hierarchy: on ? 'all' : 'none' })
              })}
              {(['all', 'factors', 'containment'] as const).map(hierarchy => (
                <label className={styles.row} key={hierarchy}>
                  <input
                    type="radio"
                    name="multinomial-hierarchy"
                    disabled={o.hierarchy === 'none'}
                    checked={o.hierarchy === hierarchy}
                    onChange={() => {
                      patch('options', { hierarchy })
                    }}
                  />
                  {tr(`hierarchy_${hierarchy}`)}
                </label>
              ))}
            </fieldset>
          </OptionSection>
        </>
      )}
      {kind === 'criteria' && (
        <OptionSection title={tr('iterations')} grid={false}>
          {number(
            'maxIterations',
            c.maxIterations,
            maxIterations => {
              patch('criteria', { maxIterations })
            },
            1,
            undefined,
            1
          )}
          {number(
            'maxStepHalving',
            c.maxStepHalving,
            maxStepHalving => {
              patch('criteria', { maxStepHalving })
            },
            1,
            undefined,
            1
          )}
          {number('logLikelihood', c.logLikelihood, logLikelihood => {
            patch('criteria', { logLikelihood })
          })}
          {number('parameter', c.parameter, parameter => {
            patch('criteria', { parameter })
          })}
          {check('printHistory', c.printHistory, printHistory => {
            patch('criteria', { printHistory })
          })}
          {number(
            'historyEvery',
            c.historyEvery,
            historyEvery => {
              patch('criteria', { historyEvery })
            },
            1,
            undefined,
            1,
            !c.printHistory
          )}
          {check('checkSeparation', c.checkSeparation, checkSeparation => {
            patch('criteria', { checkSeparation })
          })}
          {number(
            'separationStart',
            c.separationStart,
            separationStart => {
              patch('criteria', { separationStart })
            },
            0,
            undefined,
            1,
            !c.checkSeparation
          )}
          {number(
            'delta',
            c.delta,
            delta => {
              patch('criteria', { delta })
            },
            0,
            0.999999
          )}
          {number(
            'singularity',
            c.singularity,
            singularity => {
              patch('criteria', { singularity })
            },
            1e-15,
            0.999999
          )}
        </OptionSection>
      )}
      {kind === 'statistics' && (
        <>
          {check('caseSummary', st.caseSummary, caseSummary => {
            patch('statistics', { caseSummary })
          })}
          <OptionSection title={tr('model')} grid={false}>
            <div className={styles.grid}>
              {(
                [
                  'pseudoR2',
                  'stepSummary',
                  'modelFit',
                  'informationCriteria',
                  'cellProbabilities',
                  'classification',
                  'goodnessOfFit',
                  'monotonicity'
                ] as const
              ).map(key => (
                <div key={key}>
                  {check(key, st[key], v => {
                    patch('statistics', { [key]: v })
                  })}
                </div>
              ))}
            </div>
          </OptionSection>
          <OptionSection title={tr('parameters')} grid={false}>
            <div className={styles.grid}>
              {(['estimates', 'likelihoodRatio', 'correlations', 'covariances'] as const).map(
                key => (
                  <div key={key}>
                    {check(key, st[key], v => {
                      patch('statistics', { [key]: v })
                    })}
                  </div>
                )
              )}
            </div>
            {number(
              'ciLevel',
              st.ciLevel,
              ciLevel => {
                patch('statistics', { ciLevel })
              },
              0,
              99.999
            )}
          </OptionSection>
          <OptionSection title={tr('subpopulations')} grid={false}>
            {(['predictors', 'custom'] as const).map(subpopulationMode => (
              <label className={styles.row} key={subpopulationMode}>
                <input
                  type="radio"
                  name="multinomial-subpopulation"
                  checked={st.subpopulationMode === subpopulationMode}
                  onChange={() => {
                    patch('statistics', { subpopulationMode })
                  }}
                />
                {tr(`subpopulation_${subpopulationMode}`)}
              </label>
            ))}
            <select
              className={styles.list}
              multiple
              aria-label={tr('subpopulations')}
              disabled={st.subpopulationMode !== 'custom'}
              value={st.subpopulations}
              onChange={e => {
                patch('statistics', {
                  subpopulations: Array.from(e.target.selectedOptions, opt => opt.value)
                })
              }}
            >
              {variables
                .filter(v => v.colId !== assignments.dependent?.[0]?.colId)
                .map(v => (
                  <option key={v.colId} value={v.colId}>
                    {v.name}
                  </option>
                ))}
            </select>
          </OptionSection>
        </>
      )}
      {(!valid || error) && (
        <p className={styles.error} role="alert">
          {error || tr('invalid')}
        </p>
      )}
      <div className={styles.footer}>
        <SubDialogFooter
          continueDisabled={!valid}
          onContinue={() => {
            onChange(local)
            if (kind === 'save') onNewVars(saved)
            onClose()
          }}
          onCancel={onClose}
        />
      </div>
    </div>
  )
}
