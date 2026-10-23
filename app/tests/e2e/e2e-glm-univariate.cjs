// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: GLM Univariate — Tests of Between-Subjects Effects (Type III). Asserts
 * source labels, factor term labels, R-squared footnote resolve; alignment;
 * no raw key leaks. */
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
      id: 'glmUni',
      analysisId: 'glmUni',
      titleKey: 'analysis.glmUni.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        plots: [],
        warnings: [],
        notes: [],
        tables: [
          {
            titleKey: 'output.glmUni.title:Y',
            columns: [
              'output.col.source',
              'output.col.typeIIISS',
              'output.col.df',
              'output.col.meanSq',
              'output.col.f',
              'output.col.sig'
            ],
            rows: [
              ['output.col.correctedModel', 27.716, 5, 5.543, 7.487, 0.000042],
              ['output.col.intercept', 466.342, 1, 466.342, 629.863, 0],
              ['F1', 13.187, 1, 13.187, 17.81, 0.000128],
              ['F2', 11.535, 2, 5.768, 7.79, 0.001326],
              ['F1 * F2', 2.994, 2, 1.497, 2.022, 0.145088],
              ['output.col.error', 31.096, 42, 0.74, null, null],
              ['output.col.totalUncorrected', 525.154, 48, null, null, null],
              ['output.col.correctedTotal', 58.812, 47, null, null, null]
            ],
            footnoteKey: 'output.glmUni.rsqFootnote:0.471'
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
        td.textContent.trim() === 'Corrected Model' || td.textContent.trim() === 'Düzeltilmiş Model'
    )
    const num = tds.find(td => td.textContent.trim() === '27.716')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasTitle: has('Tests of Between-Subjects Effects') || has('Denekler Arası Etkiler'),
      hasCorrModel: has('Corrected Model') || has('Düzeltilmiş Model'),
      hasIntercept: has('Intercept') || has('Sabit Terim'),
      hasTerm: has('F1 * F2'),
      hasTypeIII: has('Type III') || has('Tip III'),
      hasRsq: has('R Squared = 0.471') || has('R Kare = 0.471'),
      hasPLt001: has('<.001'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 1 &&
    info.hasTitle &&
    info.hasCorrModel &&
    info.hasIntercept &&
    info.hasTerm &&
    info.hasTypeIII &&
    info.hasRsq &&
    info.hasPLt001 &&
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
