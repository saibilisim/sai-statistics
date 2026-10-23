// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: injects a result mirroring the *new* crosstabs.R output — one combined
 * SPSS-style crosstab (stacked Count / Expected / %-row / residual sub-rows),
 * a Chi-Square Tests table with a Fisher's Exact Test row + expected-count
 * footnote, and Symmetric / Directional measures tables (Phi, Cramer's V,
 * Gamma, tau-b, Somers' d, Eta) plus an i18n warning. Asserts every label
 * resolves and no raw output.* / col.* keys leak into the DOM. */
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
    const result = {
      success: true,
      tables: [
        {
          titleKey: 'output.crosstabs.crosstabTitle:sikayet × Cinsiyet',
          columns: ['sikayet', '', '0', '1', 'output.col.total'],
          rows: [
            ['0', 'output.crosstabs.cellCount', 38, 10, 48],
            ['', 'output.crosstabs.cellExpected', 36.8, 11.2, 48],
            ['', 'output.crosstabs.cellRowPct', 79.2, 20.8, 100],
            ['', 'output.crosstabs.cellResid', 1.2, -1.2, ''],
            ['', 'output.crosstabs.cellStdResid', 0.2, -0.4, ''],
            ['', 'output.crosstabs.cellAdjResid', 0.5, -0.5, ''],
            ['output.col.total', 'output.crosstabs.cellCount', 112, 34, 146]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.crosstabs.chiSqTitle:sikayet × Cinsiyet',
          columns: ['output.col.statistic', 'output.col.value', 'output.col.df', 'output.col.sig'],
          rows: [
            ['output.col.pearsonChiSq', 4.174083, 5, 0.524634],
            ['output.col.likelihoodRatio', 4.306712, 5, 0.506153],
            ['output.col.fisherExact', null, null, 0.525086],
            ['output.col.nValidCases', 146, null, null]
          ],
          footnoteKey: 'output.crosstabs.chiSqFootnote:6|75|0.24'
        },
        {
          titleKey: 'output.crosstabs.symTitle:sikayet × Cinsiyet',
          columns: ['', '', 'output.col.value', 'output.col.approxSig'],
          rows: [
            ['output.col.nominal', 'output.col.phi', 0.169085, 0.524634],
            ['output.col.nominal', 'output.col.cramersV', 0.169085, 0.524634],
            ['output.col.nominal', 'output.col.contingency', 0.166718, 0.524634],
            ['output.col.ordinal', 'output.col.kendallTaub', 0.085632, 0.242936],
            ['output.col.ordinal', 'output.col.gamma', 0.132924, 0.242936],
            ['output.col.ordinal', 'output.col.spearman', 0.09697, 0.244273],
            ['output.col.interval', 'output.col.pearsonR', 0.093651, 0.260873],
            ['', 'output.col.nValidCases', 146, null]
          ],
          footnoteKey: 'output.crosstabs.measuresFootnote'
        },
        {
          titleKey: 'output.crosstabs.dirTitle:sikayet × Cinsiyet',
          columns: ['', '', 'output.col.value', 'output.col.approxSig'],
          rows: [
            ['output.col.somersd', 'output.col.symmetric', 0.082867, 0.242936],
            ['output.col.somersd', 'output.crosstabs.dependent:sikayet', 0.110795, 0.242936],
            ['output.col.eta', 'output.crosstabs.dependent:Cinsiyet', 0.169085, null],
            ['', 'output.col.nValidCases', 146, null]
          ],
          footnoteKey: 'output.crosstabs.measuresFootnote'
        }
      ],
      plots: [],
      warnings: ['output.crosstabs.warnOrdinalOrder'],
      notes: []
    }
    T.useOutputStore.getState().addBlock({
      id: 'xtab-stats-e2e',
      analysisId: 'crosstabs',
      titleKey: 'analysis.crosstabs.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result
    })
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(800)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const has = s => bodyText.includes(s)
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      // combined crosstab — stacked measure labels (EN or TR)
      hasCount: has('Count') || has('Sayım'),
      hasExpected: has('Expected Count') || has('Beklenen Sayım'),
      hasResidual: has('Residual') || has('Artık'),
      // chi-square additions
      hasFisher: has("Fisher's Exact Test") || has('Fisher Kesin Testi'),
      footnoteExpectedLt5:
        (has('expected count less than 5') || has("5'ten küçük beklenen")) &&
        has('75') &&
        has('0.24'),
      // symmetric measures
      hasPhi: has('Phi'),
      hasCramers: has("Cramer's V"),
      hasGamma: has('Gamma'),
      hasTaub: has("Kendall's tau-b"),
      // directional
      hasSomers: has("Somers' d"),
      hasEta: has('Eta'),
      hasDependent: has('Dependent') || has('Bağımlı'),
      // warning translates
      hasWarning: has('alphabetically') || has('alfabetik'),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../e2e-crosstabs-stats.png', fullPage: true })

  const pass =
    info.tables === 4 &&
    info.hasCount &&
    info.hasExpected &&
    info.hasResidual &&
    info.hasFisher &&
    info.footnoteExpectedLt5 &&
    info.hasPhi &&
    info.hasCramers &&
    info.hasGamma &&
    info.hasTaub &&
    info.hasSomers &&
    info.hasEta &&
    info.hasDependent &&
    info.hasWarning &&
    info.rawKeyLeaks.length === 0

  // Analiz sonuçları Output'u kirletir (outputDirty) — headless'ta kapanış
  // guard'ının native dialogu sonsuza dek bekler. Otomatik "kaydetme/dışa
  // aktarma yok" (1) seçilir (e2e-value-labels.cjs ile aynı desen).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  if (!pass) {
    console.error('E2E FAILED — see assertions above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
