// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { AnalysisDispatchCtx, AnalysisHandler, Statement, SyntaxLogEntry } from './types'
import { parseStatement } from './parsing'
import {
  runCorrelations,
  runCrosstabs,
  runDescriptives,
  runExamine,
  runSummarize,
  runOlapCubes,
  runProximities,
  runMultResponse,
  runTree,
  runFrequencies,
  runMeans,
  runMva,
  runPartialCorr,
  runRatio,
  runReliability
} from './handlers-descriptives'
import {
  runGenlinmixed,
  runGlmFamily,
  runMixed,
  runOneway,
  runTTest
} from './handlers-compare-means'
import {
  runCurvefit,
  runGenlin,
  runLogistic,
  runNomreg,
  runPlum,
  runProbit,
  runRegression
} from './handlers-regression'
import {
  runCluster,
  runDiscriminant,
  runFactor,
  runQuickCluster,
  runRoc
} from './handlers-classify'
import {
  runKnn,
  runAlscal,
  runMultipleImputation,
  runPower,
  runReport,
  runRocAnalysis,
  runGraph,
  runPplot
} from './handlers-extra'
import { runNonparCorr, runNparTests } from './handlers-nonparametric'
import { runCoxreg, runKm, runSurvival } from './handlers-survival'
import {
  runBayesAnova,
  runBayesCorrelation,
  runBayesRegression,
  runBayesTtest
} from './handlers-bayes'
import { runProportions } from './handlers-proportions'

/** Every statistical-analysis command name, longest (most words) first. */
export const ANALYSIS_COMMAND_NAMES = [
  'FREQUENCIES',
  'DESCRIPTIVES',
  'CORRELATIONS',
  'CROSSTABS',
  'EXAMINE',
  'MEANS',
  'T-TEST',
  'ONEWAY',
  'REGRESSION',
  'RATIO STATISTICS',
  'OLAP CUBES',
  'MULT RESPONSE',
  'PROXIMITIES',
  'TREE',
  'SUMMARIZE',
  'PARTIAL CORR',
  'DISCRIMINANT',
  'RELIABILITY',
  'COXREG',
  'KM',
  'LOGISTIC REGRESSION',
  'NOMREG',
  'PLUM',
  'QUICK CLUSTER',
  'NONPAR CORR',
  'FACTOR',
  'CLUSTER',
  'ROC',
  'GENLINMIXED',
  'SURVIVAL',
  'CURVEFIT',
  'ANOVA',
  'UNIANOVA',
  'GLM',
  'MIXED',
  'NPAR TESTS',
  'BAYES TTEST',
  'BAYES ANOVA',
  'BAYES CORRELATION',
  'BAYES REGRESSION',
  'PROPORTIONS',
  'PROBIT',
  'GENLIN',
  'MVA',
  'KNN',
  'ALSCAL',
  'MULTIPLE IMPUTATION',
  'POWER',
  'REPORT',
  'ROC ANALYSIS',
  'GRAPH',
  'PPLOT'
].sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length)

export const ANALYSIS_HANDLERS: Record<string, AnalysisHandler> = {
  FREQUENCIES: runFrequencies,
  DESCRIPTIVES: runDescriptives,
  CORRELATIONS: runCorrelations,
  MEANS: runMeans,
  CROSSTABS: runCrosstabs,
  EXAMINE: runExamine,
  'T-TEST': runTTest,
  ONEWAY: runOneway,
  REGRESSION: runRegression,
  'RATIO STATISTICS': runRatio,
  SUMMARIZE: runSummarize,
  'OLAP CUBES': runOlapCubes,
  PROXIMITIES: runProximities,
  'MULT RESPONSE': runMultResponse,
  TREE: runTree,
  'PARTIAL CORR': runPartialCorr,
  DISCRIMINANT: runDiscriminant,
  RELIABILITY: runReliability,
  COXREG: runCoxreg,
  KM: runKm,
  'LOGISTIC REGRESSION': runLogistic,
  NOMREG: runNomreg,
  PLUM: runPlum,
  'QUICK CLUSTER': runQuickCluster,
  'NONPAR CORR': runNonparCorr,
  FACTOR: runFactor,
  CLUSTER: runCluster,
  ROC: runRoc,
  GENLINMIXED: runGenlinmixed,
  SURVIVAL: runSurvival,
  CURVEFIT: runCurvefit,
  ANOVA: runGlmFamily,
  UNIANOVA: runGlmFamily,
  GLM: runGlmFamily,
  MIXED: runMixed,
  'NPAR TESTS': runNparTests,
  'BAYES TTEST': runBayesTtest,
  'BAYES ANOVA': runBayesAnova,
  'BAYES CORRELATION': runBayesCorrelation,
  'BAYES REGRESSION': runBayesRegression,
  PROPORTIONS: runProportions,
  PROBIT: runProbit,
  GENLIN: runGenlin,
  MVA: runMva,
  KNN: runKnn,
  ALSCAL: runAlscal,
  'MULTIPLE IMPUTATION': runMultipleImputation,
  POWER: runPower,
  REPORT: runReport,
  'ROC ANALYSIS': runRocAnalysis,
  GRAPH: runGraph,
  PPLOT: runPplot
}

/**
 * Parses one statement and, if it names a statistical-analysis command,
 * runs it and returns its log entries. Returns `null` for anything else
 * (mutation commands, guidance/noop/not-implemented, unknown) so the caller
 * can fall through to its own handling — Renderer's full command table, or
 * Main's "not available via run_syntax" message.
 */
export async function dispatchAnalysisStatement(
  raw: string,
  ctx: AnalysisDispatchCtx
): Promise<{ statement: Statement; log: SyntaxLogEntry[] } | null> {
  const st = parseStatement(raw, ANALYSIS_COMMAND_NAMES)
  const handler = ANALYSIS_HANDLERS[st.command]
  if (!handler) return null
  const log = await handler(st, ctx)
  return { statement: st, log }
}
