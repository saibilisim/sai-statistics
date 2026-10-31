// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Descriptives analysis dialog — SPSS-style.
 * Mirrors SPSS: Analyze → Descriptive Statistics → Descriptives
 */

import { useState, useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AnalysisDialogShell,
  CheckOption,
  OptionSection,
  SubDialogFooter,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { buildSyntax } from '../../lib/spss-syntax'
import {
  BootstrapSection,
  buildBootstrapParams,
  defaultBootstrapOptions,
  type BootstrapOptions
} from '../_shared/BootstrapSection'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useRunAnalysis } from '../_shared/useRunAnalysis'

// ─────────────────────────────────────────────────────────────
//  Options state
// ─────────────────────────────────────────────────────────────

interface DescriptivesOptions {
  mean: boolean
  sum: boolean
  sd: boolean
  variance: boolean
  range: boolean
  min: boolean
  max: boolean
  seMean: boolean
  kurtosis: boolean
  skewness: boolean
  displayOrder: 'variable' | 'alpha' | 'meanAsc' | 'meanDesc'
}

const defaultOptions: DescriptivesOptions = {
  mean: true,
  sum: false,
  sd: true,
  variance: false,
  range: false,
  min: true,
  max: true,
  seMean: false,
  kurtosis: false,
  skewness: false,
  displayOrder: 'variable'
}

// ─────────────────────────────────────────────────────────────
//  Options sub-dialog content
// ─────────────────────────────────────────────────────────────

function DescriptivesOptionsContent({
  options,
  onChange,
  onClose
}: {
  options: DescriptivesOptions
  onChange: (opts: DescriptivesOptions) => void
  onClose: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const uid = useId()
  const [local, setLocal] = useState(options)

  const set = (key: keyof DescriptivesOptions, val: boolean | string) => {
    setLocal(prev => ({ ...prev, [key]: val }))
  }

  return (
    <>
      <OptionSection>
        <CheckOption
          checked={local.mean}
          onChange={v => {
            set('mean', v)
          }}
        >
          {t('analysis:descriptives.options.mean')}
        </CheckOption>
        <CheckOption
          checked={local.sum}
          onChange={v => {
            set('sum', v)
          }}
        >
          {t('analysis:descriptives.options.sum')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:descriptives.options.dispersion">
        <CheckOption
          checked={local.sd}
          onChange={v => {
            set('sd', v)
          }}
        >
          {t('analysis:descriptives.options.sd')}
        </CheckOption>
        <CheckOption
          checked={local.min}
          onChange={v => {
            set('min', v)
          }}
        >
          {t('analysis:descriptives.options.min')}
        </CheckOption>
        <CheckOption
          checked={local.variance}
          onChange={v => {
            set('variance', v)
          }}
        >
          {t('analysis:descriptives.options.variance')}
        </CheckOption>
        <CheckOption
          checked={local.max}
          onChange={v => {
            set('max', v)
          }}
        >
          {t('analysis:descriptives.options.max')}
        </CheckOption>
        <CheckOption
          checked={local.range}
          onChange={v => {
            set('range', v)
          }}
        >
          {t('analysis:descriptives.options.range')}
        </CheckOption>
        <CheckOption
          checked={local.seMean}
          onChange={v => {
            set('seMean', v)
          }}
        >
          {t('analysis:descriptives.options.seMean')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <OptionSection titleKey="analysis:descriptives.options.distribution">
        <CheckOption
          checked={local.kurtosis}
          onChange={v => {
            set('kurtosis', v)
          }}
        >
          {t('analysis:descriptives.options.kurtosis')}
        </CheckOption>
        <CheckOption
          checked={local.skewness}
          onChange={v => {
            set('skewness', v)
          }}
        >
          {t('analysis:descriptives.options.skewness')}
        </CheckOption>
      </OptionSection>

      <hr className={shellStyles.separator} />

      <div className={shellStyles.optionSection}>
        <div className={shellStyles.optionSectionTitle}>
          {t('analysis:descriptives.options.displayOrder')}
        </div>
        {(['variable', 'alpha', 'meanAsc', 'meanDesc'] as const).map(order => (
          <label key={order} className={shellStyles.checkRow}>
            <input
              type="radio"
              name={`${uid}-order`}
              checked={local.displayOrder === order}
              onChange={() => {
                set('displayOrder', order)
              }}
            />
            {t(`analysis:descriptives.options.order_${order}`)}
          </label>
        ))}
      </div>

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

// ─────────────────────────────────────────────────────────────
//  Main dialog
// ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void
}

export function DescriptivesDialog({ onClose }: Props) {
  const { t } = useTranslation(['common', 'analysis'])
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)

  const [options, setOptions] = useState<DescriptivesOptions>(defaultOptions)
  const [saveZScores, setSaveZScores] = useState(false)
  const [bootstrap, setBootstrap] = useState<BootstrapOptions>(defaultBootstrapOptions)
  const { running, run } = useRunAnalysis()

  const fieldDefs = [
    {
      key: 'variables',
      labelKey: 'analysis:descriptives.variablesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]

  const sideButtons: SideButtonDef[] = [
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:descriptives.optionsTitle',
      renderContent: ({ onClose: closeSubDialog }) => (
        <DescriptivesOptionsContent
          options={options}
          onChange={setOptions}
          onClose={closeSubDialog}
        />
      )
    },
    {
      key: 'bootstrap',
      labelKey: 'analysis:shell.btnBootstrap',
      titleKey: 'analysis:shell.btnBootstrap',
      renderContent: ({ onClose: closeSub }) => (
        <BootstrapSection value={bootstrap} onChange={setBootstrap} onClose={closeSub} />
      )
    }
  ]

  const canSubmit = (assignments: Record<string, Variable[]>) =>
    (assignments['variables'] ?? []).length > 0 && !running

  const generateRCode = (assignments: Record<string, Variable[]>) => {
    const vars = (assignments['variables'] ?? []).map(v => v.name)
    if (vars.length === 0) return null
    const varStr = vars.map(v => `"${v}"`).join(', ')
    return [
      `descriptives_vars <- c(${varStr})`,
      '',
      'result <- psych::describe(data[, descriptives_vars])',
      'print(result)'
    ].join('\n')
  }

  const handleSubmit = async (assignments: Record<string, Variable[]>) => {
    if (!datasetId) return
    const vars = assignments['variables'] ?? []
    const varNames = Object.fromEntries(vars.map(v => [v.colId, v.name]))
    const bootstrapParams = buildBootstrapParams(bootstrap)

    await run(
      {
        analysisId: 'descriptives',
        datasetId,
        scriptFile: 'descriptives.R',
        params: {
          variables: vars.map(v => v.colId),
          varNames,
          options: {
            mean: options.mean,
            sum: options.sum,
            sd: options.sd,
            variance: options.variance,
            range: options.range,
            min: options.min,
            max: options.max,
            seMean: options.seMean,
            kurtosis: options.kurtosis,
            skewness: options.skewness,
            displayOrder: options.displayOrder,
            ...(bootstrapParams ? { bootstrap: bootstrapParams } : {})
          },
          saveZScores
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:descriptives.title', assignments: assignments }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'descriptives'}
      titleKey="analysis:descriptives.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={assignments => void handleSubmit(assignments)}
      onCancel={onClose}
      generateRCode={generateRCode}
      generateSyntax={a => buildSyntax.descriptives(a['variables'] ?? [], options, saveZScores)}
      extraContent={
        <CheckOption
          checked={saveZScores}
          onChange={v => {
            setSaveZScores(v)
          }}
        >
          {t('analysis:descriptives.saveZScores')}
        </CheckOption>
      }
    />
  )
}
