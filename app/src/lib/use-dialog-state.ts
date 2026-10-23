// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * useDialogState — visibility state for every dialog rendered by the App root.
 * Extracted verbatim from App.tsx (pure relocation, no behavior change).
 *
 * `actions` bundles all setters in a memoized object: useState setters are
 * stable, so the object identity never changes and it can safely serve as a
 * dependency of the menu-command dispatcher hook (use-menu-commands.ts).
 */

import { useMemo, useState } from 'react'
import type { PreferencesCategory } from '../components/Dialogs/PreferencesDialog'
import type { ChartType } from '../analyses/_shared/ChartDialog'
import type { RequiredSetupResult } from '@shared/ipc-contracts'

export function useDialogState() {
  const [showPreferencesDialog, setShowPreferencesDialog] = useState(false)
  const [preferencesCategory, setPreferencesCategory] = useState<PreferencesCategory | undefined>(
    undefined
  )
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [showReportIssueDialog, setShowReportIssueDialog] = useState(false)
  const [setupResult, setSetupResult] = useState<RequiredSetupResult | null>(null)
  const [showWeightDialog, setShowWeightDialog] = useState(false)
  const [showOutputExportDialog, setShowOutputExportDialog] = useState(false)
  const [showSplitDialog, setShowSplitDialog] = useState(false)
  const [showSortCasesDialog, setShowSortCasesDialog] = useState(false)
  const [showSortVariablesDialog, setShowSortVariablesDialog] = useState(false)
  const [showIdentifyDuplicatesDialog, setShowIdentifyDuplicatesDialog] = useState(false)
  const [showAggregateDialog, setShowAggregateDialog] = useState(false)
  const [showTransposeDialog, setShowTransposeDialog] = useState(false)
  const [showMergeAddCasesDialog, setShowMergeAddCasesDialog] = useState(false)
  const [showMergeAddVariablesDialog, setShowMergeAddVariablesDialog] = useState(false)
  const [showRestructureDialog, setShowRestructureDialog] = useState(false)
  const [showDefineVarPropsDialog, setShowDefineVarPropsDialog] = useState(false)
  const [showComputeDialog, setShowComputeDialog] = useState(false)
  const [showRecodeSameDialog, setShowRecodeSameDialog] = useState(false)
  const [showRecodeDiffDialog, setShowRecodeDiffDialog] = useState(false)
  const [showAutoRecodeDialog, setShowAutoRecodeDialog] = useState(false)
  const [showCountValuesDialog, setShowCountValuesDialog] = useState(false)
  const [showRankCasesDialog, setShowRankCasesDialog] = useState(false)
  const [showVisualBinningDialog, setShowVisualBinningDialog] = useState(false)
  const [showShiftValuesDialog, setShowShiftValuesDialog] = useState(false)
  const [showReplaceMissingDialog, setShowReplaceMissingDialog] = useState(false)
  const [showDescriptivesDialog, setShowDescriptivesDialog] = useState(false)
  const [showFrequenciesDialog, setShowFrequenciesDialog] = useState(false)
  const [showExploreDialog, setShowExploreDialog] = useState(false)
  const [showCrosstabsDialog, setShowCrosstabsDialog] = useState(false)
  const [showOneSampleTTestDialog, setShowOneSampleTTestDialog] = useState(false)
  const [showIndependentTTestDialog, setShowIndependentTTestDialog] = useState(false)
  const [showPairedTTestDialog, setShowPairedTTestDialog] = useState(false)
  const [showOneWayAnovaDialog, setShowOneWayAnovaDialog] = useState(false)
  const [showProportionsOneDialog, setShowProportionsOneDialog] = useState(false)
  const [showProportionsIndepDialog, setShowProportionsIndepDialog] = useState(false)
  const [showProportionsPairedDialog, setShowProportionsPairedDialog] = useState(false)
  const [chartDialogType, setChartDialogType] = useState<ChartType | null>(null)
  const [showCaseSummariesDialog, setShowCaseSummariesDialog] = useState(false)
  const [showOlapCubesDialog, setShowOlapCubesDialog] = useState(false)
  const [showReportSummariesDialog, setShowReportSummariesDialog] = useState(false)
  const [showReportColumnsDialog, setShowReportColumnsDialog] = useState(false)
  const [showCorrelationDialog, setShowCorrelationDialog] = useState(false)
  const [showPartialCorrDialog, setShowPartialCorrDialog] = useState(false)
  const [showRegressionDialog, setShowRegressionDialog] = useState(false)
  const [showLogisticDialog, setShowLogisticDialog] = useState(false)
  const [showCurveDialog, setShowCurveDialog] = useState(false)
  const [showNpar2IndepDialog, setShowNpar2IndepDialog] = useState(false)
  const [showNparKIndepDialog, setShowNparKIndepDialog] = useState(false)
  const [showNpar2RelDialog, setShowNpar2RelDialog] = useState(false)
  const [showNparKRelDialog, setShowNparKRelDialog] = useState(false)
  const [showNparChiSqDialog, setShowNparChiSqDialog] = useState(false)
  const [showNparBinomialDialog, setShowNparBinomialDialog] = useState(false)
  const [showNparRunsDialog, setShowNparRunsDialog] = useState(false)
  const [showNparKSDialog, setShowNparKSDialog] = useState(false)
  const [showRocDialog, setShowRocDialog] = useState(false)
  const [showRocAnalysisDialog, setShowRocAnalysisDialog] = useState(false)
  const [showKMDialog, setShowKMDialog] = useState(false)
  const [showCoxDialog, setShowCoxDialog] = useState(false)
  const [showReliabilityDialog, setShowReliabilityDialog] = useState(false)
  const [showMeansDialog, setShowMeansDialog] = useState(false)
  const [showGlmUniDialog, setShowGlmUniDialog] = useState(false)
  const [showGlmMultiDialog, setShowGlmMultiDialog] = useState(false)
  const [showGlmRepDialog, setShowGlmRepDialog] = useState(false)
  const [showFactorDialog, setShowFactorDialog] = useState(false)
  const [showKMeansDialog, setShowKMeansDialog] = useState(false)
  const [showHierDialog, setShowHierDialog] = useState(false)
  const [showDiscriminantDialog, setShowDiscriminantDialog] = useState(false)
  const [showKnnDialog, setShowKnnDialog] = useState(false)
  const [showTreeDialog, setShowTreeDialog] = useState(false)
  const [showMultinomDialog, setShowMultinomDialog] = useState(false)
  const [showOrdinalDialog, setShowOrdinalDialog] = useState(false)
  const [showProbitDialog, setShowProbitDialog] = useState(false)
  const [showDistancesDialog, setShowDistancesDialog] = useState(false)
  const [showGenlinDialog, setShowGenlinDialog] = useState(false)
  const [showMixedDialog, setShowMixedDialog] = useState(false)
  const [showGeeDialog, setShowGeeDialog] = useState(false)
  const [showMdsDialog, setShowMdsDialog] = useState(false)
  const [showLifeTablesDialog, setShowLifeTablesDialog] = useState(false)
  const [showRatioDialog, setShowRatioDialog] = useState(false)
  const [showMultipleResponseDialog, setShowMultipleResponseDialog] = useState(false)
  const [showMissingValuesDialog, setShowMissingValuesDialog] = useState(false)
  const [showPowerDialog, setShowPowerDialog] = useState(false)
  const [showGlmmDialog, setShowGlmmDialog] = useState(false)
  const [showMiDialog, setShowMiDialog] = useState(false)
  const [showBayesIndTDialog, setShowBayesIndTDialog] = useState(false)
  const [showBayesOneSampleTDialog, setShowBayesOneSampleTDialog] = useState(false)
  const [showBayesPairedTDialog, setShowBayesPairedTDialog] = useState(false)
  const [showBayesAnovaDialog, setShowBayesAnovaDialog] = useState(false)
  const [showBayesRegressionDialog, setShowBayesRegressionDialog] = useState(false)
  const [showBayesCorrelationDialog, setShowBayesCorrelationDialog] = useState(false)

  const actions = useMemo(
    () => ({
      setShowPreferencesDialog,
      setPreferencesCategory,
      setShowAboutDialog,
      setShowReportIssueDialog,
      setSetupResult,
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
    }),
    []
  )

  return {
    showPreferencesDialog,
    preferencesCategory,
    showAboutDialog,
    showReportIssueDialog,
    setupResult,
    showWeightDialog,
    showOutputExportDialog,
    showSplitDialog,
    showSortCasesDialog,
    showSortVariablesDialog,
    showIdentifyDuplicatesDialog,
    showAggregateDialog,
    showTransposeDialog,
    showMergeAddCasesDialog,
    showMergeAddVariablesDialog,
    showRestructureDialog,
    showDefineVarPropsDialog,
    showComputeDialog,
    showRecodeSameDialog,
    showRecodeDiffDialog,
    showAutoRecodeDialog,
    showCountValuesDialog,
    showRankCasesDialog,
    showVisualBinningDialog,
    showShiftValuesDialog,
    showReplaceMissingDialog,
    showDescriptivesDialog,
    showFrequenciesDialog,
    showExploreDialog,
    showCrosstabsDialog,
    showOneSampleTTestDialog,
    showIndependentTTestDialog,
    showPairedTTestDialog,
    showOneWayAnovaDialog,
    showProportionsOneDialog,
    showProportionsIndepDialog,
    showProportionsPairedDialog,
    chartDialogType,
    showCaseSummariesDialog,
    showOlapCubesDialog,
    showReportSummariesDialog,
    showReportColumnsDialog,
    showCorrelationDialog,
    showPartialCorrDialog,
    showRegressionDialog,
    showLogisticDialog,
    showCurveDialog,
    showNpar2IndepDialog,
    showNparKIndepDialog,
    showNpar2RelDialog,
    showNparKRelDialog,
    showNparChiSqDialog,
    showNparBinomialDialog,
    showNparRunsDialog,
    showNparKSDialog,
    showRocDialog,
    showRocAnalysisDialog,
    showKMDialog,
    showCoxDialog,
    showReliabilityDialog,
    showMeansDialog,
    showGlmUniDialog,
    showGlmMultiDialog,
    showGlmRepDialog,
    showFactorDialog,
    showKMeansDialog,
    showHierDialog,
    showDiscriminantDialog,
    showKnnDialog,
    showTreeDialog,
    showMultinomDialog,
    showOrdinalDialog,
    showProbitDialog,
    showDistancesDialog,
    showGenlinDialog,
    showMixedDialog,
    showGeeDialog,
    showMdsDialog,
    showLifeTablesDialog,
    showRatioDialog,
    showMultipleResponseDialog,
    showMissingValuesDialog,
    showPowerDialog,
    showGlmmDialog,
    showMiDialog,
    showBayesIndTDialog,
    showBayesOneSampleTDialog,
    showBayesPairedTDialog,
    showBayesAnovaDialog,
    showBayesRegressionDialog,
    showBayesCorrelationDialog,
    actions
  }
}

export type DialogState = ReturnType<typeof useDialogState>
export type DialogActions = DialogState['actions']
