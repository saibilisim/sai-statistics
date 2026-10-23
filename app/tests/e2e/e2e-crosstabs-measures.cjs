// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Crosstabs Kappa (agreement), McNemar (chi-square table), Risk Estimate
 * (odds ratio + cohort RRs). Asserts labels resolve, alignment, no key leaks. */
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
      id: 'crosstabs',
      analysisId: 'crosstabs',
      titleKey: 'analysis.crosstabs.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.crosstabs.chiSqTitle:R1 × R2',
            columns: [
              'output.col.statistic',
              'output.col.value',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [
              ['output.col.pearsonChiSq', 46.26, 1, 0],
              ['output.col.mcnemar', null, null, 0.8036],
              ['output.col.nValidCases', 100, null, null]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.crosstabs.symTitle:R1 × R2',
            columns: ['', '', 'output.col.value', 'output.col.approxSig'],
            rows: [
              ['output.col.agreement', 'output.col.kappa', 0.6796, 0],
              ['', 'output.col.nValidCases', 100, null]
            ],
            footnoteKey: 'output.crosstabs.measuresFootnote'
          },
          {
            titleKey: 'output.crosstabs.riskTitle:R1 × R2',
            columns: ['', 'output.col.value', 'output.col.ciLower95', 'output.col.ciUpper95'],
            rows: [
              ['output.col.oddsRatio', 27.937, 9.52, 81.982],
              ['output.crosstabs.cohort:0', 5.948, 2.951, 11.986],
              ['output.col.nValidCases', 100, null, null]
            ],
            footnoteKey: null
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
    const txt = tds.find(
      td =>
        td.textContent.trim() === 'Odds Ratio' || td.textContent.trim() === 'Olabilirlik Oranı (OR)'
    )
    const num = tds.find(td => td.textContent.trim() === '27.937')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasMcnemar: has('McNemar'),
      hasKappa: has('Kappa'),
      hasAgreement: has('Measure of Agreement') || has('Uyum Ölçüsü'),
      hasRisk: has('Risk Estimate') || has('Risk Tahmini'),
      hasOdds: has('Odds Ratio') || has('Olabilirlik Oranı'),
      hasCohort: has('For cohort') || has('Kohort için'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 3 &&
    info.hasMcnemar &&
    info.hasKappa &&
    info.hasAgreement &&
    info.hasRisk &&
    info.hasOdds &&
    info.hasCohort &&
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
