// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GLM Multivariate dialog — SPSS-style (MANOVA / MANCOVA).
 * Analyze → General Linear Model → Multivariate
 *
 * Same sub-dialogs as GLM Univariate (Model, Contrasts, Post Hoc, EM Means,
 * Options — GlmSubDialogs.tsx), against the same engine: glm-multivariate.R
 * runs the multivariate tests and Box's M itself, then hands each dependent to
 * _glm_univariate_core.R with these options. Save is not offered — SPSS's
 * Multivariate Save writes one set of columns per dependent, which the
 * new-variables mechanism here does not model.
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { useDatasetStore } from '../../store/dataset-store'
import type { Variable } from '@shared/data-types'
import { useRunAnalysis } from '../_shared/useRunAnalysis'
import { buildSyntax } from '../../lib/spss-syntax'
import {
  ContrastsContent,
  EmMeansContent,
  ModelContent,
  OptionsContent,
  PostHocContent
} from './GlmSubDialogs'
import {
  defaultEmMeans,
  defaultModel,
  defaultOptions,
  defaultPostHoc,
  glmOptionsPayload,
  type ContrastsOptions
} from './glm-options'

export function MultivariateDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()

  const [model, setModel] = useState(defaultModel)
  const [postHoc, setPostHoc] = useState(defaultPostHoc)
  const [emMeans, setEmMeans] = useState(defaultEmMeans)
  const [options, setOptions] = useState(defaultOptions)
  const [contrasts, setContrasts] = useState<ContrastsOptions>({})

  const fieldDefs = [
    {
      key: 'dependents',
      labelKey: 'analysis:glmMulti.dependentsField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'factors', labelKey: 'analysis:glmMulti.factorsField', single: false },
    {
      key: 'covariates',
      labelKey: 'analysis:glmUni.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependents'] ?? []).length >= 2 &&
    ((a['factors'] ?? []).length > 0 || (a['covariates'] ?? []).length > 0) &&
    !running

  const sideButtons: SideButtonDef[] = [
    {
      key: 'model',
      labelKey: 'analysis:shell.btnModel',
      titleKey: 'analysis:glmMulti.modelTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <ModelContent value={model} onChange={setModel} onClose={closeSub} />
      )
    },
    {
      key: 'contrasts',
      labelKey: 'analysis:shell.btnContrasts',
      titleKey: 'analysis:glmMulti.contrastsTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <ContrastsContent
          value={contrasts}
          onChange={setContrasts}
          onClose={closeSub}
          factorVars={assignments['factors'] ?? []}
        />
      ),
      disabled: a => (a['factors'] ?? []).length === 0
    },
    {
      key: 'posthoc',
      labelKey: 'analysis:shell.btnPostHoc',
      titleKey: 'analysis:glmMulti.postHocTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <PostHocContent
          value={postHoc}
          onChange={setPostHoc}
          onClose={closeSub}
          factorVars={assignments['factors'] ?? []}
        />
      ),
      disabled: a => (a['factors'] ?? []).length === 0
    },
    {
      key: 'emmeans',
      labelKey: 'analysis:shell.btnEmMeans',
      titleKey: 'analysis:glmMulti.emMeansTitleDlg',
      renderContent: ({ onClose: closeSub, assignments }) => (
        <EmMeansContent
          value={emMeans}
          onChange={setEmMeans}
          onClose={closeSub}
          factorVars={assignments['factors'] ?? []}
        />
      )
    },
    {
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:glmMulti.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent value={options} onChange={setOptions} onClose={closeSub} />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const deps = a['dependents'] ?? []
    const facs = a['factors'] ?? []
    const covs = a['covariates'] ?? []
    await run(
      {
        analysisId: 'glmMulti',
        datasetId,
        scriptFile: 'glm-multivariate.R',
        params: {
          dependents: deps.map(v => v.colId),
          dependentNames: Object.fromEntries(deps.map(v => [v.colId, v.name])),
          factors: facs.map(v => v.colId),
          factorNames: Object.fromEntries(facs.map(v => [v.colId, v.name])),
          covariates: covs.map(v => v.colId),
          covariateNames: Object.fromEntries(covs.map(v => [v.colId, v.name])),
          options: glmOptionsPayload({ model, postHoc, emMeans, options, contrasts }, facs)
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:glmMulti.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'glmMulti'}
      titleKey="analysis:glmMulti.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      onReset={() => {
        setModel(defaultModel)
        setPostHoc(defaultPostHoc)
        setEmMeans(defaultEmMeans)
        setOptions(defaultOptions)
        setContrasts({})
      }}
      generateSyntax={a =>
        buildSyntax.glmMultivariate(a['dependents'] ?? [], a['factors'] ?? [], {
          covariates: a['covariates'] ?? [],
          ssType: model.ssType,
          includeIntercept: model.includeIntercept,
          descriptives: options.descriptives,
          effectSize: options.effectSize,
          power: options.power,
          paramEstimates: options.paramEstimates,
          homogeneity: options.homogeneity,
          sigLevel: options.sigLevel
        })
      }
    />
  )
}
