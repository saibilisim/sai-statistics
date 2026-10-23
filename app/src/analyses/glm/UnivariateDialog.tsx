// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GLM Univariate dialog — SPSS-style (factorial ANOVA / ANCOVA).
 * Analyze → General Linear Model → Univariate
 *
 * Covers this round's scope (see roadmap): Covariate(s), WLS Weight, Model (SS
 * type + include intercept), Options (descriptives, effect size, observed
 * power, parameter estimates, homogeneity), Contrasts, Post Hoc (pairwise +
 * Homogeneous Subsets + Dunnett vs. control), Estimated Marginal Means
 * (main effects, interactions, compare main effects), and Save. Still
 * deferred: Random Factor(s), Build custom terms, Profile Plots, Bootstrap.
 */

import { useState } from 'react'
import {
  AnalysisDialogShell,
  type SideButtonDef
} from '../../components/Dialogs/AnalysisDialogShell'
import { NewVariablesPanel } from '../../components/Dialogs/NewVariablesPanel'
import { cleanNewVarSelection, type NewVarSelection } from '../../lib/new-var-names'
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
  GLM_NEW_VARS,
  defaultEmMeans,
  defaultModel,
  defaultOptions,
  defaultPostHoc,
  glmOptionsPayload,
  type ContrastsOptions
} from './glm-options'

export function UnivariateDialog({ onClose }: { onClose: () => void }) {
  const datasetId = useDatasetStore(s => s.datasetId)
  const columnFilters = useDatasetStore(s => s.columnFilters)
  const { running, run } = useRunAnalysis()

  const [model, setModel] = useState(defaultModel)
  const [postHoc, setPostHoc] = useState(defaultPostHoc)
  const [emMeans, setEmMeans] = useState(defaultEmMeans)
  const [options, setOptions] = useState(defaultOptions)
  const [contrasts, setContrasts] = useState<ContrastsOptions>({})
  const [newVars, setNewVars] = useState<NewVarSelection>({})
  const variables = useDatasetStore(s => s.variables)

  const fieldDefs = [
    {
      key: 'dependent',
      labelKey: 'analysis:glmUni.dependentField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    },
    { key: 'factors', labelKey: 'analysis:glmUni.factorsField', single: false },
    {
      key: 'covariates',
      labelKey: 'analysis:glmUni.covariatesField',
      single: false,
      filter: (v: Variable) => v.type === 'numeric'
    },
    {
      key: 'wlsWeight',
      labelKey: 'analysis:glmUni.wlsWeightField',
      single: true,
      filter: (v: Variable) => v.type === 'numeric'
    }
  ]
  const canSubmit = (a: Record<string, Variable[]>) =>
    (a['dependent'] ?? []).length === 1 &&
    ((a['factors'] ?? []).length > 0 || (a['covariates'] ?? []).length > 0) &&
    !running

  const sideButtons: SideButtonDef[] = [
    {
      key: 'model',
      labelKey: 'analysis:shell.btnModel',
      titleKey: 'analysis:glmUni.modelTitle',
      renderContent: ({ onClose: closeSub }) => (
        <ModelContent value={model} onChange={setModel} onClose={closeSub} />
      )
    },
    {
      key: 'posthoc',
      labelKey: 'analysis:shell.btnPostHoc',
      titleKey: 'analysis:glmUni.postHocTitleDlg',
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
      titleKey: 'analysis:glmUni.emMeansTitleDlg',
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
      key: 'contrasts',
      labelKey: 'analysis:shell.btnContrasts',
      titleKey: 'analysis:glmUni.contrastsTitleDlg',
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
      key: 'options',
      labelKey: 'analysis:shell.btnOptions',
      titleKey: 'analysis:glmUni.optionsTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <OptionsContent value={options} onChange={setOptions} onClose={closeSub} />
      )
    },
    {
      key: 'save',
      labelKey: 'analysis:shell.btnSave',
      titleKey: 'analysis:glmUni.saveTitleDlg',
      renderContent: ({ onClose: closeSub }) => (
        <NewVariablesPanel
          slots={GLM_NEW_VARS}
          value={newVars}
          onChange={setNewVars}
          existingNames={variables.map(v => v.name)}
          onClose={closeSub}
        />
      )
    }
  ]

  const handleSubmit = async (a: Record<string, Variable[]>) => {
    if (!datasetId) return
    const dep = (a['dependent'] ?? [])[0]
    const facs = a['factors'] ?? []
    const covs = a['covariates'] ?? []
    const wls = (a['wlsWeight'] ?? [])[0]
    if (!dep) return

    await run(
      {
        analysisId: 'glmUni',
        datasetId,
        scriptFile: 'glm-univariate.R',
        params: {
          dependent: dep.colId,
          dependentName: dep.name,
          factors: facs.map(v => v.colId),
          factorNames: Object.fromEntries(facs.map(v => [v.colId, v.name])),
          covariates: covs.map(v => v.colId),
          covariateNames: Object.fromEntries(covs.map(v => [v.colId, v.name])),
          ...(wls ? { wlsWeight: wls.colId, wlsWeightName: wls.name } : {}),
          options: glmOptionsPayload({ model, postHoc, emMeans, options, contrasts }, facs),
          createVars: cleanNewVarSelection(
            newVars,
            variables.map(v => v.name)
          )
        },
        columnFilters
      },
      onClose,
      { titleKey: 'analysis:glmUni.title', assignments: a }
    )
  }

  return (
    <AnalysisDialogShell
      analysisId={'glmUni'}
      titleKey="analysis:glmUni.title"
      fieldDefs={fieldDefs}
      sideButtons={sideButtons}
      canSubmit={canSubmit}
      onSubmit={a => void handleSubmit(a)}
      onCancel={onClose}
      generateSyntax={a =>
        buildSyntax.glmUnivariate(a['dependent'] ?? [], a['factors'] ?? [], {
          covariates: a['covariates'] ?? [],
          wlsWeight: (a['wlsWeight'] ?? [])[0],
          ssType: model.ssType,
          includeIntercept: model.includeIntercept,
          descriptives: options.descriptives,
          effectSize: options.effectSize,
          power: options.power,
          paramEstimates: options.paramEstimates,
          homogeneity: options.homogeneity
        })
      }
    />
  )
}
