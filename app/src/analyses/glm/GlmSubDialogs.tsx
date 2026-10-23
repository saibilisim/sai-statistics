// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The GLM sub-dialogs (Model, Post Hoc, EM Means, Options, Contrasts), shared
 * by the Univariate and Multivariate dialogs so both offer the same choices
 * against the same R engine.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckOption,
  OptionSection,
  SubDialogFooter
} from '../../components/Dialogs/AnalysisDialogShell'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import {
  CONTRAST_TYPE_LABEL_KEYS,
  defaultContrastSpec,
  type CiAdjust,
  type ContrastRef,
  type ContrastSpec,
  type ContrastsOptions,
  type ContrastType,
  type EmMeansOptions,
  type GlmOptions,
  type ModelOptions,
  type PostHocOptions,
  type SSType
} from './glm-options'

export function ModelContent({
  value,
  onChange,
  onClose
}: {
  value: ModelOptions
  onChange: (v: ModelOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const types: SSType[] = ['I', 'II', 'III', 'IV']
  return (
    <>
      <OptionSection titleKey="analysis:glmUni.ssType" grid={false}>
        <div className={shellStyles.optionGrid}>
          {types.map(ty => (
            <label key={ty} className={shellStyles.checkRow}>
              <input
                type="radio"
                checked={local.ssType === ty}
                onChange={() => {
                  setLocal(prev => ({ ...prev, ssType: ty }))
                }}
              />
              {t(`analysis:glmUni.ssType${ty}`)}
            </label>
          ))}
        </div>
      </OptionSection>
      <OptionSection>
        <CheckOption
          checked={local.includeIntercept}
          onChange={v => {
            setLocal(prev => ({ ...prev, includeIntercept: v }))
          }}
        >
          {t('analysis:glmUni.includeIntercept')}
        </CheckOption>
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

export function PostHocContent({
  value,
  onChange,
  onClose,
  factorVars
}: {
  value: PostHocOptions
  onChange: (v: PostHocOptions) => void
  onClose: () => void
  factorVars: Variable[]
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const toggleFactor = (colId: string) => {
    setLocal(prev => ({
      ...prev,
      factors: prev.factors.includes(colId)
        ? prev.factors.filter(id => id !== colId)
        : [...prev.factors, colId]
    }))
  }
  const setB = (key: keyof PostHocOptions, v: boolean) => {
    setLocal(prev => ({ ...prev, [key]: v }))
  }
  return (
    <>
      <OptionSection titleKey="analysis:glmUni.postHocFactors">
        {factorVars.length === 0 && (
          <div className={shellStyles.emptyZone}>{t('analysis:glmUni.postHocNoFactors')}</div>
        )}
        {factorVars.map(v => (
          <CheckOption
            key={v.colId}
            checked={local.factors.includes(v.colId)}
            onChange={() => {
              toggleFactor(v.colId)
            }}
          >
            {v.name}
          </CheckOption>
        ))}
      </OptionSection>
      <OptionSection titleKey="analysis:anova.equalVariancesAssumed">
        <CheckOption
          checked={local.lsd}
          onChange={v => {
            setB('lsd', v)
          }}
        >
          {t('analysis:anova.lsd')}
        </CheckOption>
        <CheckOption
          checked={local.bonferroni}
          onChange={v => {
            setB('bonferroni', v)
          }}
        >
          {t('analysis:anova.bonferroni')}
        </CheckOption>
        <CheckOption
          checked={local.sidak}
          onChange={v => {
            setB('sidak', v)
          }}
        >
          {t('analysis:anova.sidak')}
        </CheckOption>
        <CheckOption
          checked={local.scheffe}
          onChange={v => {
            setB('scheffe', v)
          }}
        >
          {t('analysis:anova.scheffe')}
        </CheckOption>
        <CheckOption
          checked={local.tukey}
          onChange={v => {
            setB('tukey', v)
          }}
        >
          {t('analysis:anova.tukey')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:anova.equalVariancesNotAssumed">
        <CheckOption
          checked={local.gamesHowell}
          onChange={v => {
            setB('gamesHowell', v)
          }}
        >
          {t('analysis:anova.gamesHowell')}
        </CheckOption>
        <CheckOption
          checked={local.tamhaneT2}
          onChange={v => {
            setB('tamhaneT2', v)
          }}
        >
          {t('analysis:anova.tamhaneT2')}
        </CheckOption>
        <CheckOption
          checked={local.dunnettT3}
          onChange={v => {
            setB('dunnettT3', v)
          }}
        >
          {t('analysis:anova.dunnettT3')}
        </CheckOption>
        <CheckOption
          checked={local.dunnettC}
          onChange={v => {
            setB('dunnettC', v)
          }}
        >
          {t('analysis:anova.dunnettC')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:shell.btnPostHoc">
        <CheckOption
          checked={local.snk}
          onChange={v => {
            setB('snk', v)
          }}
        >
          {t('analysis:anova.snk')}
        </CheckOption>
        <CheckOption
          checked={local.duncan}
          onChange={v => {
            setB('duncan', v)
          }}
        >
          {t('analysis:anova.duncan')}
        </CheckOption>
        <CheckOption
          checked={local.regwQ}
          onChange={v => {
            setB('regwQ', v)
          }}
        >
          {t('analysis:anova.regwQ')}
        </CheckOption>
        <CheckOption
          checked={local.wallerDuncan}
          onChange={v => {
            setB('wallerDuncan', v)
          }}
        >
          {t('analysis:anova.wallerDuncan')}
        </CheckOption>
        {local.wallerDuncan && (
          <label className={shellStyles.checkRow}>
            {t('analysis:anova.wallerK')}
            <input
              type="number"
              value={local.wallerK}
              step="1"
              min="1"
              onChange={e => {
                setLocal(prev => ({ ...prev, wallerK: e.target.value }))
              }}
              className="numField"
            />
          </label>
        )}
      </OptionSection>
      <OptionSection titleKey="analysis:anova.dunnett">
        <CheckOption
          checked={local.dunnett}
          onChange={v => {
            setB('dunnett', v)
          }}
        >
          {t('analysis:anova.dunnett')}
        </CheckOption>
        {local.dunnett && (
          <label className={shellStyles.checkRow}>
            {t('analysis:anova.dunnettControl')}
            <select
              value={local.dunnettControl}
              onChange={e => {
                setLocal(prev => ({ ...prev, dunnettControl: e.target.value as ContrastRef }))
              }}
              className="numField numField--select"
            >
              <option value="last">{t('analysis:anova.dunnettControlLast')}</option>
              <option value="first">{t('analysis:anova.dunnettControlFirst')}</option>
            </select>
          </label>
        )}
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

export function EmMeansContent({
  value,
  onChange,
  onClose,
  factorVars,
  extraMainTerms = [],
  extraInteractionTerms = []
}: {
  value: EmMeansOptions
  onChange: (v: EmMeansOptions) => void
  onClose: () => void
  factorVars: Variable[]
  /** Terms beyond the between factors — Repeated Measures' within factor
   *  ("WITHIN") and its interactions with each between factor. */
  extraMainTerms?: { term: string; label: string }[]
  extraInteractionTerms?: { term: string; label: string }[]
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const toggleTerm = (term: string) => {
    setLocal(prev => ({
      ...prev,
      terms: prev.terms.includes(term) ? prev.terms.filter(x => x !== term) : [...prev.terms, term]
    }))
  }
  return (
    <>
      <OptionSection titleKey="analysis:glmUni.emMeansDisplay">
        <CheckOption
          checked={local.terms.includes('OVERALL')}
          onChange={() => {
            toggleTerm('OVERALL')
          }}
        >
          {t('analysis:glmUni.emMeansOverall')}
        </CheckOption>
        {extraMainTerms.map(x => (
          <CheckOption
            key={x.term}
            checked={local.terms.includes(x.term)}
            onChange={() => {
              toggleTerm(x.term)
            }}
          >
            {x.label}
          </CheckOption>
        ))}
        {factorVars.map(v => (
          <CheckOption
            key={v.colId}
            checked={local.terms.includes(v.colId)}
            onChange={() => {
              toggleTerm(v.colId)
            }}
          >
            {v.name}
          </CheckOption>
        ))}
      </OptionSection>
      {(factorVars.length >= 2 || extraInteractionTerms.length > 0) && (
        <OptionSection titleKey="analysis:glmUni.emMeansInteractions">
          {extraInteractionTerms.map(x => (
            <CheckOption
              key={x.term}
              checked={local.terms.includes(x.term)}
              onChange={() => {
                toggleTerm(x.term)
              }}
            >
              {x.label}
            </CheckOption>
          ))}
          {factorVars.flatMap((v1, i) =>
            factorVars.slice(i + 1).map(v2 => {
              const term = `${v1.colId}*${v2.colId}`
              return (
                <CheckOption
                  key={term}
                  checked={local.terms.includes(term)}
                  onChange={() => {
                    toggleTerm(term)
                  }}
                >
                  {v1.name} * {v2.name}
                </CheckOption>
              )
            })
          )}
        </OptionSection>
      )}
      <OptionSection>
        <CheckOption
          checked={local.compareMainEffects}
          onChange={v => {
            setLocal(prev => ({ ...prev, compareMainEffects: v }))
          }}
        >
          {t('analysis:glmUni.compareMainEffects')}
        </CheckOption>
      </OptionSection>
      <OptionSection titleKey="analysis:glmUni.ciAdjustment">
        {(['none', 'bonferroni', 'sidak'] as CiAdjust[]).map(adj => (
          <label key={adj} className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={local.ciAdjust === adj}
              onChange={() => {
                setLocal(prev => ({ ...prev, ciAdjust: adj }))
              }}
            />
            {t(
              `analysis:glmUni.ciAdjust${adj === 'none' ? 'None' : adj === 'bonferroni' ? 'Bonferroni' : 'Sidak'}`
            )}
          </label>
        ))}
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

export function OptionsContent({
  value,
  onChange,
  onClose,
  showParamEstimates = true
}: {
  value: GlmOptions
  onChange: (v: GlmOptions) => void
  onClose: () => void
  /** Repeated Measures prints no Parameter Estimates table, so it hides the box. */
  showParamEstimates?: boolean
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const setB = (key: keyof GlmOptions, v: boolean) => {
    setLocal(prev => ({ ...prev, [key]: v }))
  }
  return (
    <>
      <OptionSection>
        <CheckOption
          checked={local.descriptives}
          onChange={v => {
            setB('descriptives', v)
          }}
        >
          {t('analysis:glmUni.optDescriptives')}
        </CheckOption>
        <CheckOption
          checked={local.effectSize}
          onChange={v => {
            setB('effectSize', v)
          }}
        >
          {t('analysis:glmUni.optEffectSize')}
        </CheckOption>
        <CheckOption
          checked={local.power}
          onChange={v => {
            setB('power', v)
          }}
        >
          {t('analysis:glmUni.optPower')}
        </CheckOption>
        {showParamEstimates && (
          <CheckOption
            checked={local.paramEstimates}
            onChange={v => {
              setB('paramEstimates', v)
            }}
          >
            {t('analysis:glmUni.optParamEstimates')}
          </CheckOption>
        )}
        <CheckOption
          checked={local.homogeneity}
          onChange={v => {
            setB('homogeneity', v)
          }}
        >
          {t('analysis:glmUni.optHomogeneity')}
        </CheckOption>
      </OptionSection>
      <OptionSection>
        <label className={shellStyles.checkRow}>
          {t('analysis:anova.sigLevel')}
          <input
            type="number"
            value={local.sigLevel}
            step="any"
            min="0"
            max="1"
            onChange={e => {
              setLocal(prev => ({ ...prev, sigLevel: e.target.value }))
            }}
            className="numField"
          />
        </label>
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

export function ContrastsContent({
  value,
  onChange,
  onClose,
  factorVars
}: {
  value: ContrastsOptions
  onChange: (v: ContrastsOptions) => void
  onClose: () => void
  factorVars: Variable[]
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [local, setLocal] = useState(value)
  const [activeColId, setActiveColId] = useState(factorVars[0]?.colId)
  const active = factorVars.find(v => v.colId === activeColId) ?? factorVars[0]
  const spec = (active && local[active.colId]) || defaultContrastSpec
  const setSpec = (patch: Partial<ContrastSpec>) => {
    if (!active) return
    setLocal(prev => ({ ...prev, [active.colId]: { ...spec, ...patch } }))
  }
  const types: ContrastType[] = [
    'none',
    'deviation',
    'simple',
    'difference',
    'helmert',
    'repeated',
    'polynomial'
  ]
  const showRef = spec.type === 'deviation' || spec.type === 'simple'
  return (
    <>
      <OptionSection titleKey="analysis:glmUni.contrastFactorLabel">
        <select
          value={active?.colId}
          onChange={e => {
            setActiveColId(e.target.value)
          }}
          className="numField numField--full"
        >
          {factorVars.map(v => (
            <option key={v.colId} value={v.colId}>
              {v.name}
            </option>
          ))}
        </select>
      </OptionSection>
      <OptionSection titleKey="analysis:glmUni.contrastType">
        <select
          value={spec.type}
          onChange={e => {
            setSpec({ type: e.target.value as ContrastType })
          }}
          className="numField numField--full"
        >
          {types.map(ty => (
            <option key={ty} value={ty}>
              {t(CONTRAST_TYPE_LABEL_KEYS[ty])}
            </option>
          ))}
        </select>
      </OptionSection>
      {showRef && (
        <OptionSection titleKey="analysis:glmUni.contrastReference">
          <label className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={spec.reference === 'first'}
              onChange={() => {
                setSpec({ reference: 'first' })
              }}
            />
            {t('analysis:anova.dunnettControlFirst')}
          </label>
          <label className={shellStyles.checkRow}>
            <input
              type="radio"
              checked={spec.reference === 'last'}
              onChange={() => {
                setSpec({ reference: 'last' })
              }}
            />
            {t('analysis:anova.dunnettControlLast')}
          </label>
        </OptionSection>
      )}
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
