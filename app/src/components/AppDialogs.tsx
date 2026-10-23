// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AppDialogs — every dialog the App root can open (menu commands, Dialog
 * Recall, first-run setup, preferences/about). Extracted verbatim from
 * App.tsx's render output as a pure relocation: same conditional-render
 * expressions, same props, same onClose handlers — the state simply arrives
 * via the useDialogState bundle instead of component-scope locals.
 */

import { WeightCasesDialog } from './Dialogs/WeightCasesDialog'
import { OutputExportDialog } from './Dialogs/OutputExportDialog'
import { PreferencesDialog } from './Dialogs/PreferencesDialog'
import { AboutDialog } from './Dialogs/AboutDialog'
import { ReportIssueDialog } from './Dialogs/ReportIssueDialog'
import { SetupWelcomeDialog } from './Dialogs/SetupWelcomeDialog'
import { WelcomeGate } from './Dialogs/WelcomeDialog'
import { SplitFileDialog } from './Dialogs/SplitFileDialog'
import { SortCasesDialog } from './Dialogs/SortCasesDialog'
import { SortVariablesDialog } from './Dialogs/SortVariablesDialog'
import { IdentifyDuplicatesDialog } from './Dialogs/IdentifyDuplicatesDialog'
import { AggregateDialog } from './Dialogs/AggregateDialog'
import { TransposeDialog } from './Dialogs/TransposeDialog'
import { MergeAddCasesDialog } from './Dialogs/MergeAddCasesDialog'
import { MergeAddVariablesDialog } from './Dialogs/MergeAddVariablesDialog'
import { RestructureDialog } from './Dialogs/RestructureDialog'
import { DefineVariablePropertiesDialog } from './Dialogs/DefineVariablePropertiesDialog'
import { RecodeDialog } from './Dialogs/RecodeDialog'
import { ComputeVariableDialog } from './Dialogs/ComputeVariableDialog'
import { AutoRecodeDialog } from './Dialogs/AutoRecodeDialog'
import { CountValuesDialog } from './Dialogs/CountValuesDialog'
import { RankCasesDialog } from './Dialogs/RankCasesDialog'
import { VisualBinningDialog } from './Dialogs/VisualBinningDialog'
import { ShiftValuesDialog } from './Dialogs/ShiftValuesDialog'
import { ReplaceMissingDialog } from './Dialogs/ReplaceMissingDialog'
import { DescriptivesDialog } from '../analyses/descriptives/DescriptivesDialog'
import { FrequenciesDialog } from '../analyses/frequencies/FrequenciesDialog'
import { ExploreDialog } from '../analyses/explore/ExploreDialog'
import { CrosstabsDialog } from '../analyses/crosstabs/CrosstabsDialog'
import { OneSampleTTestDialog } from '../analyses/compare-means/OneSampleTTestDialog'
import { IndependentTTestDialog } from '../analyses/compare-means/IndependentTTestDialog'
import { PairedTTestDialog } from '../analyses/compare-means/PairedTTestDialog'
import { OneWayAnovaDialog } from '../analyses/compare-means/OneWayAnovaDialog'
import { ProportionsDialog } from '../analyses/compare-means/ProportionsDialog'
import { ChartDialog } from '../analyses/_shared/ChartDialog'
import { CaseSummariesDialog } from '../analyses/_shared/CaseSummariesDialog'
import { OlapCubesDialog } from '../analyses/olap-cubes/OlapCubesDialog'
import { ReportSummariesDialog } from '../analyses/report-summaries/ReportSummariesDialog'
import { ReportSummariesColumnsDialog } from '../analyses/report-summaries/ReportSummariesColumnsDialog'
import { MeansDialog } from '../analyses/compare-means/MeansDialog'
import { UnivariateDialog } from '../analyses/glm/UnivariateDialog'
import { MultivariateDialog } from '../analyses/glm/MultivariateDialog'
import { RepeatedMeasuresDialog } from '../analyses/glm/RepeatedMeasuresDialog'
import { FactorDialog } from '../analyses/dimension/FactorDialog'
import { KMeansDialog } from '../analyses/classify/KMeansDialog'
import { HierarchicalDialog } from '../analyses/classify/HierarchicalDialog'
import { DiscriminantDialog } from '../analyses/classify/DiscriminantDialog'
import { KnnDialog } from '../analyses/classify/KnnDialog'
import { TreeDialog } from '../analyses/classify/TreeDialog'
import { MultinomialDialog } from '../analyses/regression/MultinomialDialog'
import { OrdinalDialog } from '../analyses/regression/OrdinalDialog'
import { ProbitDialog } from '../analyses/regression/ProbitDialog'
import { GeneralizedLinearDialog } from '../analyses/genlin/GeneralizedLinearDialog'
import { MixedModelsDialog } from '../analyses/mixed-models/MixedModelsDialog'
import { GeeDialog } from '../analyses/gee/GeeDialog'
import { MdsDialog } from '../analyses/mds/MdsDialog'
import { LifeTablesDialog } from '../analyses/survival/LifeTablesDialog'
import { RatioDialog } from '../analyses/ratio/RatioDialog'
import { MultipleResponseDialog } from '../analyses/multiple-response/MultipleResponseDialog'
import { MissingValuesDialog } from '../analyses/missing-values/MissingValuesDialog'
import { PowerDialog } from '../analyses/power/PowerDialog'
import { GlmmDialog } from '../analyses/mixed-models/GlmmDialog'
import { MultipleImputationDialog } from '../analyses/missing-values/MultipleImputationDialog'
import { BivariateCorrelationDialog } from '../analyses/correlate/BivariateCorrelationDialog'
import { PartialCorrelationDialog } from '../analyses/correlate/PartialCorrelationDialog'
import { DistancesDialog } from '../analyses/correlate/DistancesDialog'
import { LinearRegressionDialog } from '../analyses/regression/LinearRegressionDialog'
import { BinaryLogisticDialog } from '../analyses/regression/BinaryLogisticDialog'
import { CurveEstimationDialog } from '../analyses/regression/CurveEstimationDialog'
import { TwoIndependentSamplesDialog } from '../analyses/nonparametric/TwoIndependentSamplesDialog'
import { KIndependentSamplesDialog } from '../analyses/nonparametric/KIndependentSamplesDialog'
import { TwoRelatedSamplesDialog } from '../analyses/nonparametric/TwoRelatedSamplesDialog'
import { KRelatedSamplesDialog } from '../analyses/nonparametric/KRelatedSamplesDialog'
import { ChiSquareTestDialog } from '../analyses/nonparametric/ChiSquareTestDialog'
import { BinomialTestDialog } from '../analyses/nonparametric/BinomialTestDialog'
import { RunsTestDialog } from '../analyses/nonparametric/RunsTestDialog'
import { OneSampleKSDialog } from '../analyses/nonparametric/OneSampleKSDialog'
import { RocCurveDialog } from '../analyses/roc/RocCurveDialog'
import { RocAnalysisDialog } from '../analyses/roc/RocAnalysisDialog'
import { KaplanMeierDialog } from '../analyses/survival/KaplanMeierDialog'
import { CoxRegressionDialog } from '../analyses/survival/CoxRegressionDialog'
import { ReliabilityDialog } from '../analyses/scale/ReliabilityDialog'
import type { DialogState } from '../lib/use-dialog-state'

export function AppDialogs({ state }: { state: DialogState }) {
  const {
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
    showBayesCorrelationDialog
  } = state
  const {
    setShowPreferencesDialog,
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
  } = state.actions
  return (
    <>
      {/* Start-up chooser waits behind the R setup guidance, never on top of it. */}
      <WelcomeGate blocked={setupResult !== null} />
      {setupResult && (
        <SetupWelcomeDialog
          rFound={setupResult.rFound}
          missingRequired={setupResult.missingRequired}
          onRecheck={() => {
            void window.api.rPackages
              .checkRequiredSetup()
              .then(result => {
                setSetupResult(!result.rFound || result.missingRequired.length > 0 ? result : null)
              })
              .catch((err: unknown) => {
                console.error('checkRequiredSetup failed:', err)
              })
          }}
          onClose={() => {
            setSetupResult(null)
          }}
        />
      )}
      {showPreferencesDialog && (
        <PreferencesDialog
          initialCategory={preferencesCategory}
          onClose={() => {
            setShowPreferencesDialog(false)
          }}
        />
      )}
      {showAboutDialog && (
        <AboutDialog
          onClose={() => {
            setShowAboutDialog(false)
          }}
        />
      )}
      {showReportIssueDialog && (
        <ReportIssueDialog
          onClose={() => {
            setShowReportIssueDialog(false)
          }}
        />
      )}
      {showWeightDialog && (
        <WeightCasesDialog
          onClose={() => {
            setShowWeightDialog(false)
          }}
        />
      )}
      {showOutputExportDialog && (
        <OutputExportDialog
          onClose={() => {
            setShowOutputExportDialog(false)
          }}
        />
      )}
      {showSortCasesDialog && (
        <SortCasesDialog
          onClose={() => {
            setShowSortCasesDialog(false)
          }}
        />
      )}
      {showSortVariablesDialog && (
        <SortVariablesDialog
          onClose={() => {
            setShowSortVariablesDialog(false)
          }}
        />
      )}
      {showIdentifyDuplicatesDialog && (
        <IdentifyDuplicatesDialog
          onClose={() => {
            setShowIdentifyDuplicatesDialog(false)
          }}
        />
      )}
      {showAggregateDialog && (
        <AggregateDialog
          onClose={() => {
            setShowAggregateDialog(false)
          }}
        />
      )}
      {showTransposeDialog && (
        <TransposeDialog
          onClose={() => {
            setShowTransposeDialog(false)
          }}
        />
      )}
      {showMergeAddCasesDialog && (
        <MergeAddCasesDialog
          onClose={() => {
            setShowMergeAddCasesDialog(false)
          }}
        />
      )}
      {showMergeAddVariablesDialog && (
        <MergeAddVariablesDialog
          onClose={() => {
            setShowMergeAddVariablesDialog(false)
          }}
        />
      )}
      {showRestructureDialog && (
        <RestructureDialog
          onClose={() => {
            setShowRestructureDialog(false)
          }}
        />
      )}
      {showDefineVarPropsDialog && (
        <DefineVariablePropertiesDialog
          onClose={() => {
            setShowDefineVarPropsDialog(false)
          }}
        />
      )}
      {showSplitDialog && (
        <SplitFileDialog
          onClose={() => {
            setShowSplitDialog(false)
          }}
        />
      )}
      {showComputeDialog && (
        <ComputeVariableDialog
          onClose={() => {
            setShowComputeDialog(false)
          }}
        />
      )}
      {showRecodeSameDialog && (
        <RecodeDialog
          mode="same"
          onClose={() => {
            setShowRecodeSameDialog(false)
          }}
        />
      )}
      {showRecodeDiffDialog && (
        <RecodeDialog
          mode="different"
          onClose={() => {
            setShowRecodeDiffDialog(false)
          }}
        />
      )}
      {showAutoRecodeDialog && (
        <AutoRecodeDialog
          onClose={() => {
            setShowAutoRecodeDialog(false)
          }}
        />
      )}
      {showCountValuesDialog && (
        <CountValuesDialog
          onClose={() => {
            setShowCountValuesDialog(false)
          }}
        />
      )}
      {showRankCasesDialog && (
        <RankCasesDialog
          onClose={() => {
            setShowRankCasesDialog(false)
          }}
        />
      )}
      {showVisualBinningDialog && (
        <VisualBinningDialog
          onClose={() => {
            setShowVisualBinningDialog(false)
          }}
        />
      )}
      {showShiftValuesDialog && (
        <ShiftValuesDialog
          onClose={() => {
            setShowShiftValuesDialog(false)
          }}
        />
      )}
      {showCaseSummariesDialog && (
        <CaseSummariesDialog
          onClose={() => {
            setShowCaseSummariesDialog(false)
          }}
        />
      )}
      {showOlapCubesDialog && (
        <OlapCubesDialog
          onClose={() => {
            setShowOlapCubesDialog(false)
          }}
        />
      )}
      {showReportSummariesDialog && (
        <ReportSummariesDialog
          onClose={() => {
            setShowReportSummariesDialog(false)
          }}
        />
      )}
      {showReportColumnsDialog && (
        <ReportSummariesColumnsDialog
          onClose={() => {
            setShowReportColumnsDialog(false)
          }}
        />
      )}
      {chartDialogType && (
        <ChartDialog
          chartType={chartDialogType}
          onClose={() => {
            setChartDialogType(null)
          }}
        />
      )}
      {showReplaceMissingDialog && (
        <ReplaceMissingDialog
          onClose={() => {
            setShowReplaceMissingDialog(false)
          }}
        />
      )}
      {showDescriptivesDialog && (
        <DescriptivesDialog
          onClose={() => {
            setShowDescriptivesDialog(false)
          }}
        />
      )}
      {showFrequenciesDialog && (
        <FrequenciesDialog
          onClose={() => {
            setShowFrequenciesDialog(false)
          }}
        />
      )}
      {showExploreDialog && (
        <ExploreDialog
          onClose={() => {
            setShowExploreDialog(false)
          }}
        />
      )}
      {showCrosstabsDialog && (
        <CrosstabsDialog
          onClose={() => {
            setShowCrosstabsDialog(false)
          }}
        />
      )}
      {showOneSampleTTestDialog && (
        <OneSampleTTestDialog
          onClose={() => {
            setShowOneSampleTTestDialog(false)
          }}
        />
      )}
      {showIndependentTTestDialog && (
        <IndependentTTestDialog
          onClose={() => {
            setShowIndependentTTestDialog(false)
          }}
        />
      )}
      {showPairedTTestDialog && (
        <PairedTTestDialog
          onClose={() => {
            setShowPairedTTestDialog(false)
          }}
        />
      )}
      {showOneWayAnovaDialog && (
        <OneWayAnovaDialog
          onClose={() => {
            setShowOneWayAnovaDialog(false)
          }}
        />
      )}
      {showProportionsOneDialog && (
        <ProportionsDialog
          design="one"
          onClose={() => {
            setShowProportionsOneDialog(false)
          }}
        />
      )}
      {showProportionsIndepDialog && (
        <ProportionsDialog
          design="independent"
          onClose={() => {
            setShowProportionsIndepDialog(false)
          }}
        />
      )}
      {showProportionsPairedDialog && (
        <ProportionsDialog
          design="paired"
          onClose={() => {
            setShowProportionsPairedDialog(false)
          }}
        />
      )}
      {showCorrelationDialog && (
        <BivariateCorrelationDialog
          onClose={() => {
            setShowCorrelationDialog(false)
          }}
        />
      )}
      {showPartialCorrDialog && (
        <PartialCorrelationDialog
          onClose={() => {
            setShowPartialCorrDialog(false)
          }}
        />
      )}
      {showRegressionDialog && (
        <LinearRegressionDialog
          onClose={() => {
            setShowRegressionDialog(false)
          }}
        />
      )}
      {showLogisticDialog && (
        <BinaryLogisticDialog
          onClose={() => {
            setShowLogisticDialog(false)
          }}
        />
      )}
      {showCurveDialog && (
        <CurveEstimationDialog
          onClose={() => {
            setShowCurveDialog(false)
          }}
        />
      )}
      {showNpar2IndepDialog && (
        <TwoIndependentSamplesDialog
          onClose={() => {
            setShowNpar2IndepDialog(false)
          }}
        />
      )}
      {showNparKIndepDialog && (
        <KIndependentSamplesDialog
          onClose={() => {
            setShowNparKIndepDialog(false)
          }}
        />
      )}
      {showNpar2RelDialog && (
        <TwoRelatedSamplesDialog
          onClose={() => {
            setShowNpar2RelDialog(false)
          }}
        />
      )}
      {showNparKRelDialog && (
        <KRelatedSamplesDialog
          onClose={() => {
            setShowNparKRelDialog(false)
          }}
        />
      )}
      {showNparChiSqDialog && (
        <ChiSquareTestDialog
          onClose={() => {
            setShowNparChiSqDialog(false)
          }}
        />
      )}
      {showNparBinomialDialog && (
        <BinomialTestDialog
          onClose={() => {
            setShowNparBinomialDialog(false)
          }}
        />
      )}
      {showNparRunsDialog && (
        <RunsTestDialog
          onClose={() => {
            setShowNparRunsDialog(false)
          }}
        />
      )}
      {showNparKSDialog && (
        <OneSampleKSDialog
          onClose={() => {
            setShowNparKSDialog(false)
          }}
        />
      )}
      {showRocDialog && (
        <RocCurveDialog
          onClose={() => {
            setShowRocDialog(false)
          }}
        />
      )}
      {showRocAnalysisDialog && (
        <RocAnalysisDialog
          onClose={() => {
            setShowRocAnalysisDialog(false)
          }}
        />
      )}
      {showKMDialog && (
        <KaplanMeierDialog
          onClose={() => {
            setShowKMDialog(false)
          }}
        />
      )}
      {showCoxDialog && (
        <CoxRegressionDialog
          onClose={() => {
            setShowCoxDialog(false)
          }}
        />
      )}
      {showReliabilityDialog && (
        <ReliabilityDialog
          onClose={() => {
            setShowReliabilityDialog(false)
          }}
        />
      )}
      {showMeansDialog && (
        <MeansDialog
          onClose={() => {
            setShowMeansDialog(false)
          }}
        />
      )}
      {showGlmUniDialog && (
        <UnivariateDialog
          onClose={() => {
            setShowGlmUniDialog(false)
          }}
        />
      )}
      {showGlmMultiDialog && (
        <MultivariateDialog
          onClose={() => {
            setShowGlmMultiDialog(false)
          }}
        />
      )}
      {showGlmRepDialog && (
        <RepeatedMeasuresDialog
          onClose={() => {
            setShowGlmRepDialog(false)
          }}
        />
      )}
      {showFactorDialog && (
        <FactorDialog
          onClose={() => {
            setShowFactorDialog(false)
          }}
        />
      )}
      {showKMeansDialog && (
        <KMeansDialog
          onClose={() => {
            setShowKMeansDialog(false)
          }}
        />
      )}
      {showHierDialog && (
        <HierarchicalDialog
          onClose={() => {
            setShowHierDialog(false)
          }}
        />
      )}
      {showDiscriminantDialog && (
        <DiscriminantDialog
          onClose={() => {
            setShowDiscriminantDialog(false)
          }}
        />
      )}
      {showKnnDialog && (
        <KnnDialog
          onClose={() => {
            setShowKnnDialog(false)
          }}
        />
      )}
      {showTreeDialog && (
        <TreeDialog
          onClose={() => {
            setShowTreeDialog(false)
          }}
        />
      )}
      {showMultinomDialog && (
        <MultinomialDialog
          onClose={() => {
            setShowMultinomDialog(false)
          }}
        />
      )}
      {showOrdinalDialog && (
        <OrdinalDialog
          onClose={() => {
            setShowOrdinalDialog(false)
          }}
        />
      )}
      {showProbitDialog && (
        <ProbitDialog
          onClose={() => {
            setShowProbitDialog(false)
          }}
        />
      )}
      {showDistancesDialog && (
        <DistancesDialog
          onClose={() => {
            setShowDistancesDialog(false)
          }}
        />
      )}
      {showGenlinDialog && (
        <GeneralizedLinearDialog
          onClose={() => {
            setShowGenlinDialog(false)
          }}
        />
      )}
      {showMixedDialog && (
        <MixedModelsDialog
          onClose={() => {
            setShowMixedDialog(false)
          }}
        />
      )}
      {showGeeDialog && (
        <GeeDialog
          onClose={() => {
            setShowGeeDialog(false)
          }}
        />
      )}
      {showMdsDialog && (
        <MdsDialog
          onClose={() => {
            setShowMdsDialog(false)
          }}
        />
      )}
      {showLifeTablesDialog && (
        <LifeTablesDialog
          onClose={() => {
            setShowLifeTablesDialog(false)
          }}
        />
      )}
      {showRatioDialog && (
        <RatioDialog
          onClose={() => {
            setShowRatioDialog(false)
          }}
        />
      )}
      {showMultipleResponseDialog && (
        <MultipleResponseDialog
          onClose={() => {
            setShowMultipleResponseDialog(false)
          }}
        />
      )}
      {showMissingValuesDialog && (
        <MissingValuesDialog
          onClose={() => {
            setShowMissingValuesDialog(false)
          }}
        />
      )}
      {showPowerDialog && (
        <PowerDialog
          onClose={() => {
            setShowPowerDialog(false)
          }}
        />
      )}
      {showGlmmDialog && (
        <GlmmDialog
          onClose={() => {
            setShowGlmmDialog(false)
          }}
        />
      )}
      {showMiDialog && (
        <MultipleImputationDialog
          onClose={() => {
            setShowMiDialog(false)
          }}
        />
      )}
      {showBayesIndTDialog && (
        <IndependentTTestDialog
          bayesian
          onClose={() => {
            setShowBayesIndTDialog(false)
          }}
        />
      )}
      {showBayesOneSampleTDialog && (
        <OneSampleTTestDialog
          bayesian
          onClose={() => {
            setShowBayesOneSampleTDialog(false)
          }}
        />
      )}
      {showBayesPairedTDialog && (
        <PairedTTestDialog
          bayesian
          onClose={() => {
            setShowBayesPairedTDialog(false)
          }}
        />
      )}
      {showBayesAnovaDialog && (
        <OneWayAnovaDialog
          bayesian
          onClose={() => {
            setShowBayesAnovaDialog(false)
          }}
        />
      )}
      {showBayesRegressionDialog && (
        <LinearRegressionDialog
          bayesian
          onClose={() => {
            setShowBayesRegressionDialog(false)
          }}
        />
      )}
      {showBayesCorrelationDialog && (
        <BivariateCorrelationDialog
          bayesian
          onClose={() => {
            setShowBayesCorrelationDialog(false)
          }}
        />
      )}
    </>
  )
}
