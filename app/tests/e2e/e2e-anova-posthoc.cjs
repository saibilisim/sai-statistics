// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: One-Way ANOVA deepening — Homogeneity (Levene), Robust (Welch), Post Hoc
 * (Tukey/Bonferroni). Asserts all labels resolve, alignment, no raw key leaks. */
const { _electron } = require('@playwright/test')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  await win.evaluate(async () => {
    const T = window.__SAI_TEST__
    T.useOutputStore.getState().addBlock({
      id: 'anova',
      analysisId: 'anova',
      titleKey: 'analysis.anova.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.anova.homogTitle:Y',
            columns: [
              'output.col.leveneStatistic',
              'output.col.df1',
              'output.col.df2',
              'output.col.sig'
            ],
            rows: [[1.259, 2, 57, 0.291698]],
            footnoteKey: null
          },
          {
            titleKey: 'output.anova.robustTitle:Y',
            columns: [
              'output.col.method',
              'output.col.statistic',
              'output.col.df1',
              'output.col.df2',
              'output.col.sig'
            ],
            rows: [['output.col.welch', 31.543, 2, 37.42, 0]],
            footnoteKey: null
          },
          {
            titleKey: 'output.anova.postHocTitle:Y',
            columns: [
              'output.col.method',
              'output.col.groupI',
              'output.col.groupJ',
              'output.col.meanDiff',
              'output.col.stdError',
              'output.col.sig',
              'output.col.ciLower95',
              'output.col.ciUpper95'
            ],
            rows: [
              ['output.col.tukeyHSD', 'A', 'B', -1.7207, 0.2917, 0.000001, -2.4226, -1.0189],
              ['', 'A', 'C', 0.5269, 0.2917, 0.176606, -0.175, 1.2287],
              ['output.col.bonferroni', 'A', 'B', -1.7207, 0.2917, 0.000001, -2.4401, -1.0013],
              ['output.col.hochbergGT2', 'A', 'B', -1.7207, 0.2917, 0.000042, -2.4801, -0.9613]
            ],
            footnoteKey: null
          },
          {
            // Homogeneous Subsets: the {{p0}}/{{p1}} title, "Subset N" columns
            // and a Sig. row with mixed null/numeric cells (a group can be
            // missing from a subset column) all go through translateOutputKey
            // — checked below for raw key leaks and correct label text.
            titleKey: 'output.anova.homogSubsetsTitle:Y|output.col.tukeyHSD',
            columns: ['group', 'output.col.n', 'output.anova.subsetN:1', 'output.anova.subsetN:2'],
            rows: [
              ['C', 20, 16.167, null],
              ['A', 20, 19.882, null],
              ['B', 20, null, 47.911],
              ['output.anova.sigRow', null, 0.694, 1]
            ],
            footnoteKey: 'output.anova.harmonicMeanFootnote:56.086'
          }
        ]
      }
    })
    T.useOutputStore.getState().addBlock({
      id: 'ttest1',
      analysisId: 'ttest1',
      titleKey: 'analysis.ttest1.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.ttest1.effectTitle',
            columns: [
              'output.col.variable',
              '',
              'output.col.standardizer',
              'output.col.pointEstimate',
              'output.col.ciLower95',
              'output.col.ciUpper95'
            ],
            rows: [
              ['S', 'output.col.cohensD', 1.773, 0.668, 0.324, 1.011],
              ['', 'output.col.hedgesG', 1.808, 0.655, 0.311, 0.998]
            ],
            footnoteKey: 'output.ttest.effectFootnote'
          }
        ]
      }
    })
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(800)
  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(td => td.textContent.trim() === 'Tukey HSD')
    const num = tds.find(td => td.textContent.trim() === '31.543')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasHomog: has('Homogeneity of Variances') || has('Varyansların Homojenliği'),
      hasLevene: has('Levene'),
      hasRobust: has('Robust Tests') || has('Robust Testleri'),
      hasWelch: has('Welch'),
      hasMultiComp: has('Multiple Comparisons') || has('Çoklu Karşılaştırmalar'),
      hasTukey: has('Tukey HSD'),
      hasBonf: has('Bonferroni'),
      hasHochberg: has('Hochberg'),
      hasGroupI: has('(I) Group') || has('(I) Grup'),
      hasEffect: has('Effect Sizes') || has('Etki Büyüklükleri'),
      hasCohensD: has("Cohen's d"),
      hasHedges: has('Hedges'),
      hasPLt001: has('<.001'),
      hasHomogSubsets: has('Homogeneous Subsets') || has('Homojen Alt Kümeler'),
      hasSubset1: has('Subset 1') || has('Alt Küme 1'),
      hasSubset2: has('Subset 2') || has('Alt Küme 2'),
      hasSigRow: has('Sig.') || has('Anlm.'),
      hasHarmonicMean: has('56.086') || has('56,086'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 5 &&
    info.hasHomog &&
    info.hasLevene &&
    info.hasRobust &&
    info.hasWelch &&
    info.hasMultiComp &&
    info.hasTukey &&
    info.hasBonf &&
    info.hasHochberg &&
    info.hasGroupI &&
    info.hasEffect &&
    info.hasCohensD &&
    info.hasHedges &&
    info.hasPLt001 &&
    info.hasHomogSubsets &&
    info.hasSubset1 &&
    info.hasSubset2 &&
    info.hasSigRow &&
    info.hasHarmonicMean &&
    info.labelAlign === 'left' &&
    info.numAlign === 'right' &&
    info.rawKeyLeaks.length === 0
  // Analiz sonuçları Output'u kirletir (outputDirty) — headless'ta kapanış
  // guard'ının native dialogu sonsuza dek bekler. Otomatik "kaydetme/dışa
  // aktarma yok" (1) seçilir (e2e-value-labels.cjs ile aynı desen).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED')
    process.exit(1)
  }
  console.log('E2E PASSED')
}
main().catch(err => {
  console.error(err)
  process.exit(1)
})
