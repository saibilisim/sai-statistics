// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * useMenuCommands — the native-menu / Dialog Recall command dispatcher.
 * The big `menu:*` switch and its `ensureCanReplaceDataset` guard were moved
 * verbatim out of App.tsx (pure relocation, no behavior change). The switch
 * only ever called dialog-open setters and store/IPC APIs, so it takes the
 * memoized setter bundle from useDialogState as its single argument.
 */

import { useCallback } from 'react'
import { useSettingsStore } from '../store/settings-store'
import { useUIStore } from '../store/ui-store'
import { useDatasetStore } from '../store/dataset-store'
import { useStatusNoticeStore } from '../store/status-notice-store'
import { useChatStore, loadPersistedChat } from '../store/chat-store'
import { saveCurrentDataset, ensureCanReplaceDataset, importDataset } from './file-actions'
import { exportOutputHtml, exportOutputPdf, loadOutputDocument } from './output-export'
import i18nInstance from '../i18n'
import type { SupportedLanguage } from '@shared/languages'
import type { DialogActions } from './use-dialog-state'

export type MenuCommandDispatcher = (channel: string, ...args: unknown[]) => void

/** A failed file action must be visible to the user, not only in devtools
 *  (corrupt file, a workbook locked by Excel, an unreadable format …). */
function notifyFailure(messageKey: string): void {
  useStatusNoticeStore.getState().show(messageKey, 'error', 5000)
}

export function useMenuCommands(actions: DialogActions): MenuCommandDispatcher {
  // Dialog Recall (SPSS-style): the same callback is registered for native
  // menu commands and exposed via lib/menu-dispatch.ts, so a Ribbon "recent
  // analyses" click can dispatch the exact same channel a real native-menu
  // click would send, without a fake IPC round trip.
  // Body is unchanged from before the extraction — this is a pure relocation,
  // not a behavior change. `actions` is a stable memoized setter bundle
  // (useState setters never change identity), so the callback identity is
  // stable exactly as the original empty-deps version was.
  return useCallback(
    (channel: string, ...args: unknown[]) => {
      const {
        setShowPreferencesDialog,
        setPreferencesCategory,
        setShowAboutDialog,
        setShowReportIssueDialog,
        setShowWeightDialog,
        setShowOutputExportDialog,
        setShowSplitDialog,
        setShowSortCasesDialog,
        setShowSortVariablesDialog,
        setShowIdentifyDuplicatesDialog,
        setShowAggregateDialog,
        setShowTransposeDialog,
        setShowMergeAddCasesDialog,
        setShowMergeAddVariablesDialog,
        setShowRestructureDialog,
        setShowDefineVarPropsDialog,
        setShowComputeDialog,
        setShowRecodeSameDialog,
        setShowRecodeDiffDialog,
        setShowAutoRecodeDialog,
        setShowCountValuesDialog,
        setShowRankCasesDialog,
        setShowVisualBinningDialog,
        setShowShiftValuesDialog,
        setShowReplaceMissingDialog,
        setShowDescriptivesDialog,
        setShowFrequenciesDialog,
        setShowExploreDialog,
        setShowCrosstabsDialog,
        setShowOneSampleTTestDialog,
        setShowIndependentTTestDialog,
        setShowPairedTTestDialog,
        setShowOneWayAnovaDialog,
        setShowProportionsOneDialog,
        setShowProportionsIndepDialog,
        setShowProportionsPairedDialog,
        setChartDialogType,
        setShowCaseSummariesDialog,
        setShowOlapCubesDialog,
        setShowReportSummariesDialog,
        setShowReportColumnsDialog,
        setShowCorrelationDialog,
        setShowPartialCorrDialog,
        setShowRegressionDialog,
        setShowLogisticDialog,
        setShowCurveDialog,
        setShowNpar2IndepDialog,
        setShowNparKIndepDialog,
        setShowNpar2RelDialog,
        setShowNparKRelDialog,
        setShowNparChiSqDialog,
        setShowNparBinomialDialog,
        setShowNparRunsDialog,
        setShowNparKSDialog,
        setShowRocDialog,
        setShowRocAnalysisDialog,
        setShowKMDialog,
        setShowCoxDialog,
        setShowReliabilityDialog,
        setShowMeansDialog,
        setShowGlmUniDialog,
        setShowGlmMultiDialog,
        setShowGlmRepDialog,
        setShowFactorDialog,
        setShowKMeansDialog,
        setShowHierDialog,
        setShowDiscriminantDialog,
        setShowKnnDialog,
        setShowTreeDialog,
        setShowMultinomDialog,
        setShowOrdinalDialog,
        setShowProbitDialog,
        setShowDistancesDialog,
        setShowGenlinDialog,
        setShowMixedDialog,
        setShowGeeDialog,
        setShowMdsDialog,
        setShowLifeTablesDialog,
        setShowRatioDialog,
        setShowMultipleResponseDialog,
        setShowMissingValuesDialog,
        setShowPowerDialog,
        setShowGlmmDialog,
        setShowMiDialog,
        setShowBayesIndTDialog,
        setShowBayesOneSampleTDialog,
        setShowBayesPairedTDialog,
        setShowBayesAnovaDialog,
        setShowBayesRegressionDialog,
        setShowBayesCorrelationDialog
      } = actions
      switch (channel) {
        case 'menu:file:new': {
          void (async () => {
            if (!(await ensureCanReplaceDataset())) return
            const result = await window.api.file.new()
            useDatasetStore
              .getState()
              .setDataset(
                result.dataset.id,
                result.dataset.name,
                result.dataset.filePath,
                result.variables,
                result.dataset.rowCount,
                result.styles
              )
            useChatStore.getState().clearChat()
          })().catch((err: unknown) => {
            console.error('Failed to create new file:', err)
            notifyFailure('status.openFailed')
          })
          break
        }
        case 'menu:file:open': {
          void (async () => {
            if (!(await ensureCanReplaceDataset(true))) return
            const filePath = typeof args[0] === 'string' ? args[0] : undefined
            const result = await window.api.file.open(filePath)
            if (result) {
              useDatasetStore
                .getState()
                .setDataset(
                  result.dataset.id,
                  result.dataset.name,
                  result.dataset.filePath,
                  result.variables,
                  result.dataset.rowCount,
                  result.styles
                )
              loadPersistedChat(result.chatHistory ?? [])
              // .sdf is the project: its embedded Output replaces the tab
              // (legacy files without output.json → empty Output).
              loadOutputDocument(result.outputDocument ?? null)
              if (result.dataset.filePath) {
                useSettingsStore.getState().addRecentFile(result.dataset.filePath)
              }
            }
          })().catch((err: unknown) => {
            console.error('Failed to open file:', err)
            notifyFailure('status.openFailed')
          })
          break
        }
        case 'menu:file:save': {
          void saveCurrentDataset().catch((err: unknown) => {
            console.error('Failed to save file:', err)
          })
          break
        }
        case 'menu:file:save-output': {
          void exportOutputHtml(i18nInstance.t).catch((err: unknown) => {
            console.error('Failed to export output:', err)
            notifyFailure('status.exportFailed')
          })
          break
        }
        case 'menu:file:export-output-pdf': {
          void exportOutputPdf(i18nInstance.t).catch((err: unknown) => {
            console.error('Failed to export output as PDF:', err)
            notifyFailure('status.exportFailed')
          })
          break
        }
        case 'menu:file:export-output': {
          setShowOutputExportDialog(true)
          break
        }
        case 'menu:file:clear-recent': {
          useSettingsStore.getState().clearRecentFiles()
          break
        }
        case 'menu:file:save-as': {
          void saveCurrentDataset(true).catch((err: unknown) => {
            console.error('Failed to save file as:', err)
          })
          break
        }
        case 'menu:file:import:csv':
        case 'menu:file:import:excel':
        case 'menu:file:import:spss':
        case 'menu:file:import:stata':
        case 'menu:file:import:sas': {
          const typeMap: Record<string, 'csv' | 'excel' | 'spss' | 'stata' | 'sas'> = {
            'menu:file:import:csv': 'csv',
            'menu:file:import:excel': 'excel',
            'menu:file:import:spss': 'spss',
            'menu:file:import:stata': 'stata',
            'menu:file:import:sas': 'sas'
          }
          const fileType = typeMap[channel]
          void (async () => {
            await importDataset({ fileType })
          })().catch((err: unknown) => {
            console.error(`Failed to import ${fileType ?? 'file'}:`, err)
            notifyFailure('status.importFailed')
          })
          break
        }
        case 'menu:file:export:csv':
        case 'menu:file:export:excel':
        case 'menu:file:export:spss': {
          const datasetId = useDatasetStore.getState().datasetId
          if (datasetId) {
            if (channel === 'menu:file:export:csv') {
              void window.api.file
                .exportCsv({ datasetId })
                .then(filePath => {
                  if (filePath) {
                    console.log('Successfully exported CSV to:', filePath)
                  }
                })
                .catch((err: unknown) => {
                  console.error('Failed to export CSV:', err)
                  notifyFailure('status.exportFailed')
                })
            } else if (channel === 'menu:file:export:excel') {
              void window.api.file
                .exportXlsx({ datasetId })
                .then(filePath => {
                  if (filePath) {
                    console.log('Successfully exported Excel to:', filePath)
                  }
                })
                .catch((err: unknown) => {
                  console.error('Failed to export Excel:', err)
                  notifyFailure('status.exportFailed')
                })
            } else {
              void window.api.file.exportSav({ datasetId }).catch((err: unknown) => {
                console.error('Failed to export SPSS:', err)
                notifyFailure('status.exportFailed')
              })
            }
          }
          break
        }
        case 'menu:view:tab': {
          const tab = args[0] as 'data' | 'variable' | 'output' | 'normality' | 'terminal'
          useUIStore.getState().setActiveTab(tab)
          break
        }
        case 'menu:theme': {
          const theme = args[0] as 'light' | 'dark' | 'high-contrast' | 'system'
          useSettingsStore.getState().setTheme(theme)
          break
        }
        case 'menu:language': {
          const lang = args[0] as SupportedLanguage
          useSettingsStore.getState().setLanguage(lang)
          break
        }
        case 'menu:view:value-labels': {
          useUIStore.getState().toggleValueLabels()
          break
        }
        case 'menu:view:grid-lines': {
          useUIStore.getState().toggleGridLines()
          break
        }
        case 'menu:view:focus-cell': {
          useUIStore.getState().toggleFocusCellHighlight()
          break
        }
        case 'menu:preferences': {
          setPreferencesCategory(undefined)
          setShowPreferencesDialog(true)
          break
        }
        case 'menu:edit:toggle-shortcuts': {
          // Yardım ▸ Klavye Kısayolları: ayrı bir overlay yok — kısayol listesi
          // ve düzenleme UI'ı Tercihler'in "shortcuts" kategorisinde yaşıyor.
          setPreferencesCategory('shortcuts')
          setShowPreferencesDialog(true)
          break
        }
        case 'menu:about': {
          setShowAboutDialog(true)
          break
        }
        case 'menu:help:report-issue': {
          setShowReportIssueDialog(true)
          break
        }
        case 'menu:data:sort-cases': {
          setShowSortCasesDialog(true)
          break
        }
        case 'menu:data:sort-variables': {
          setShowSortVariablesDialog(true)
          break
        }
        case 'menu:data:identify-duplicates': {
          setShowIdentifyDuplicatesDialog(true)
          break
        }
        case 'menu:data:aggregate': {
          // Aggregate/Transpose open the RESULT as the new active dataset —
          // same "this replaces what's open" semantics as File > Open/Import.
          void (async () => {
            if (!(await ensureCanReplaceDataset())) return
            setShowAggregateDialog(true)
          })()
          break
        }
        case 'menu:data:transpose': {
          void (async () => {
            if (!(await ensureCanReplaceDataset())) return
            setShowTransposeDialog(true)
          })()
          break
        }
        case 'menu:data:merge-add-cases': {
          void (async () => {
            if (!(await ensureCanReplaceDataset())) return
            setShowMergeAddCasesDialog(true)
          })()
          break
        }
        case 'menu:data:merge-add-variables': {
          void (async () => {
            if (!(await ensureCanReplaceDataset())) return
            setShowMergeAddVariablesDialog(true)
          })()
          break
        }
        case 'menu:data:restructure': {
          void (async () => {
            if (!(await ensureCanReplaceDataset())) return
            setShowRestructureDialog(true)
          })()
          break
        }
        case 'menu:data:define-var-props': {
          // Mutates the active dataset's variable metadata (Variable View
          // fields) — no dataset replacement, so no ensureCanReplaceDataset guard.
          setShowDefineVarPropsDialog(true)
          break
        }
        case 'menu:data:select-cases': {
          // SPSS-familiar menu entry — no separate dialog: it's the same
          // filtering system as the column-header filter icons, just
          // switched on from the menu.
          useUIStore.getState().setActiveTab('data')
          useUIStore.getState().setColumnFilterIcons(true)
          break
        }
        case 'menu:data:weight-cases': {
          setShowWeightDialog(true)
          break
        }
        case 'menu:data:split-file': {
          setShowSplitDialog(true)
          break
        }
        case 'menu:transform:compute': {
          setShowComputeDialog(true)
          break
        }
        case 'menu:transform:recode-same': {
          setShowRecodeSameDialog(true)
          break
        }
        case 'menu:transform:recode-different': {
          setShowRecodeDiffDialog(true)
          break
        }
        case 'menu:transform:auto-recode': {
          setShowAutoRecodeDialog(true)
          break
        }
        case 'menu:transform:count-values': {
          setShowCountValuesDialog(true)
          break
        }
        case 'menu:transform:rank-cases': {
          setShowRankCasesDialog(true)
          break
        }
        case 'menu:transform:visual-binning': {
          setShowVisualBinningDialog(true)
          break
        }
        case 'menu:transform:shift-values': {
          setShowShiftValuesDialog(true)
          break
        }
        case 'menu:analyze:case-summaries': {
          setShowCaseSummariesDialog(true)
          break
        }
        case 'menu:analyze:olap-cubes': {
          setShowOlapCubesDialog(true)
          break
        }
        case 'menu:analyze:report-summaries': {
          setShowReportSummariesDialog(true)
          break
        }
        case 'menu:analyze:report-columns': {
          setShowReportColumnsDialog(true)
          break
        }
        case 'menu:graphs:scatter': {
          setChartDialogType('scatter')
          break
        }
        case 'menu:graphs:bar': {
          setChartDialogType('bar')
          break
        }
        case 'menu:graphs:line': {
          setChartDialogType('line')
          break
        }
        case 'menu:graphs:histogram': {
          setChartDialogType('histogram')
          break
        }
        case 'menu:graphs:boxplot': {
          setChartDialogType('boxplot')
          break
        }
        case 'menu:graphs:pp': {
          setChartDialogType('pp')
          break
        }
        case 'menu:graphs:qq': {
          setChartDialogType('qq')
          break
        }
        case 'menu:transform:replace-missing': {
          setShowReplaceMissingDialog(true)
          break
        }
        case 'menu:analyze:descriptives': {
          setShowDescriptivesDialog(true)
          break
        }
        case 'menu:analyze:frequencies': {
          setShowFrequenciesDialog(true)
          break
        }
        case 'menu:analyze:explore': {
          setShowExploreDialog(true)
          break
        }
        case 'menu:analyze:crosstabs': {
          setShowCrosstabsDialog(true)
          break
        }
        case 'menu:analyze:onesample-ttest': {
          setShowOneSampleTTestDialog(true)
          break
        }
        case 'menu:analyze:independent-ttest': {
          setShowIndependentTTestDialog(true)
          break
        }
        case 'menu:analyze:paired-ttest': {
          setShowPairedTTestDialog(true)
          break
        }
        case 'menu:analyze:oneway-anova': {
          setShowOneWayAnovaDialog(true)
          break
        }
        case 'menu:analyze:proportions-one': {
          setShowProportionsOneDialog(true)
          break
        }
        case 'menu:analyze:proportions-independent': {
          setShowProportionsIndepDialog(true)
          break
        }
        case 'menu:analyze:proportions-paired': {
          setShowProportionsPairedDialog(true)
          break
        }
        case 'menu:analyze:correlate-bivariate': {
          setShowCorrelationDialog(true)
          break
        }
        case 'menu:analyze:correlate-partial': {
          setShowPartialCorrDialog(true)
          break
        }
        case 'menu:analyze:regression-linear': {
          setShowRegressionDialog(true)
          break
        }
        case 'menu:analyze:regression-logistic': {
          setShowLogisticDialog(true)
          break
        }
        case 'menu:analyze:regression-curve': {
          setShowCurveDialog(true)
          break
        }
        case 'menu:analyze:npar-2indep': {
          setShowNpar2IndepDialog(true)
          break
        }
        case 'menu:analyze:npar-kindep': {
          setShowNparKIndepDialog(true)
          break
        }
        case 'menu:analyze:npar-2related': {
          setShowNpar2RelDialog(true)
          break
        }
        case 'menu:analyze:npar-krelated': {
          setShowNparKRelDialog(true)
          break
        }
        case 'menu:analyze:npar-chisquare': {
          setShowNparChiSqDialog(true)
          break
        }
        case 'menu:analyze:npar-binomial': {
          setShowNparBinomialDialog(true)
          break
        }
        case 'menu:analyze:npar-runs': {
          setShowNparRunsDialog(true)
          break
        }
        case 'menu:analyze:npar-ks': {
          setShowNparKSDialog(true)
          break
        }
        case 'menu:analyze:roc': {
          setShowRocDialog(true)
          break
        }
        case 'menu:analyze:roc-analysis': {
          setShowRocAnalysisDialog(true)
          break
        }
        case 'menu:analyze:survival-km': {
          setShowKMDialog(true)
          break
        }
        case 'menu:analyze:survival-cox': {
          setShowCoxDialog(true)
          break
        }
        case 'menu:analyze:reliability': {
          setShowReliabilityDialog(true)
          break
        }
        case 'menu:analyze:means': {
          setShowMeansDialog(true)
          break
        }
        case 'menu:analyze:glm-univariate': {
          setShowGlmUniDialog(true)
          break
        }
        case 'menu:analyze:glm-multivariate': {
          setShowGlmMultiDialog(true)
          break
        }
        case 'menu:analyze:glm-repeated': {
          setShowGlmRepDialog(true)
          break
        }
        case 'menu:analyze:factor': {
          setShowFactorDialog(true)
          break
        }
        case 'menu:analyze:kmeans': {
          setShowKMeansDialog(true)
          break
        }
        case 'menu:analyze:hierarchical': {
          setShowHierDialog(true)
          break
        }
        case 'menu:analyze:discriminant': {
          setShowDiscriminantDialog(true)
          break
        }
        case 'menu:analyze:knn': {
          setShowKnnDialog(true)
          break
        }
        case 'menu:analyze:tree': {
          setShowTreeDialog(true)
          break
        }
        case 'menu:analyze:regression-multinomial': {
          setShowMultinomDialog(true)
          break
        }
        case 'menu:analyze:regression-ordinal': {
          setShowOrdinalDialog(true)
          break
        }
        case 'menu:analyze:regression-probit': {
          setShowProbitDialog(true)
          break
        }
        case 'menu:analyze:distances': {
          setShowDistancesDialog(true)
          break
        }
        case 'menu:analyze:genlin': {
          setShowGenlinDialog(true)
          break
        }
        case 'menu:analyze:mixed-models': {
          setShowMixedDialog(true)
          break
        }
        case 'menu:analyze:gee': {
          setShowGeeDialog(true)
          break
        }
        case 'menu:analyze:mds': {
          setShowMdsDialog(true)
          break
        }
        case 'menu:analyze:life-tables': {
          setShowLifeTablesDialog(true)
          break
        }
        case 'menu:analyze:ratio': {
          setShowRatioDialog(true)
          break
        }
        case 'menu:analyze:multiple-response': {
          setShowMultipleResponseDialog(true)
          break
        }
        case 'menu:analyze:missing-values': {
          setShowMissingValuesDialog(true)
          break
        }
        case 'menu:analyze:power': {
          setShowPowerDialog(true)
          break
        }
        case 'menu:analyze:glmm': {
          setShowGlmmDialog(true)
          break
        }
        case 'menu:analyze:mi': {
          setShowMiDialog(true)
          break
        }
        case 'menu:analyze:bayes-ttest-independent': {
          setShowBayesIndTDialog(true)
          break
        }
        case 'menu:analyze:bayes-ttest-onesample': {
          setShowBayesOneSampleTDialog(true)
          break
        }
        case 'menu:analyze:bayes-ttest-paired': {
          setShowBayesPairedTDialog(true)
          break
        }
        case 'menu:analyze:bayes-anova': {
          setShowBayesAnovaDialog(true)
          break
        }
        case 'menu:analyze:bayes-regression': {
          setShowBayesRegressionDialog(true)
          break
        }
        case 'menu:analyze:bayes-correlation': {
          setShowBayesCorrelationDialog(true)
          break
        }
        default:
          break
      }
    },
    [actions]
  )
}
