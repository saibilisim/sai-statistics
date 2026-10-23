// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Partial Correlations, Binary Logistic Regression and Curve Estimation.
 * Also verifies the centralized SPSS-style formatting: tiny p-values render as
 * "<.001" and other significances drop the leading zero (".499"), while regular
 * statistics keep it. Asserts no raw key leaks and label/number alignment. */
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
    const store = T.useOutputStore.getState()
    const mk = (id, tables) => ({
      id,
      analysisId: id,
      titleKey: 'analysis.' + id + '.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: { success: true, tables, plots: [], warnings: [], notes: [] }
    })

    store.addBlock(
      mk('partialCorr', [
        {
          titleKey: 'output.partialCorr.title',
          columns: ['', '', 'X1', 'X2'],
          rows: [
            ['X1', 'output.col.pearsonCorr', 1, 0.077188],
            ['', 'output.col.sigTwoTailed', '', 0.498952],
            ['', 'output.col.df', 0, 77],
            ['X2', 'output.col.pearsonCorr', 0.077188, 1],
            ['', 'output.col.sigTwoTailed', 0.498952, ''],
            ['', 'output.col.df', 77, 0]
          ],
          footnoteKey: 'output.partialCorr.controlFootnote:Ctrl'
        }
      ])
    )

    store.addBlock(
      mk('logistic', [
        {
          titleKey: 'output.logistic.modelSummaryTitle',
          columns: ['output.col.neg2LL', 'output.col.coxSnell', 'output.col.nagelkerke'],
          rows: [[90.623656, 0.221976, 0.296215]],
          footnoteKey: null
        },
        {
          titleKey: 'output.logistic.equationTitle',
          columns: [
            'output.col.model',
            'output.col.b',
            'output.col.stdError',
            'output.col.wald',
            'output.col.df',
            'output.col.sig',
            'output.col.expB'
          ],
          rows: [
            ['X1', 1.052833, 0.277116, 14.434296, 1, 0.000145, 2.865758],
            ['output.col.constant', -0.042426, 0.255515, 0.02757, 1, 0.868124, 0.958461]
          ],
          footnoteKey: 'output.logistic.depFootnote:Grp (1 = 1)'
        }
      ])
    )

    store.addBlock(
      mk('curve', [
        {
          titleKey: 'output.curve.title:Pos',
          columns: [
            'output.col.model',
            'output.col.rSquare',
            'output.col.f',
            'output.col.df1',
            'output.col.df2',
            'output.col.sig',
            'output.col.constant',
            'output.col.b1',
            'output.col.b2',
            'output.col.b3'
          ],
          rows: [
            ['output.col.mLinear', 0.779508, 275.753947, 1, 78, 0, -8.894619, 0.560748, null, null],
            [
              'output.col.mQuadratic',
              0.961182,
              953.305198,
              2,
              77,
              0,
              5.61792,
              -0.501145,
              0.01311,
              null
            ]
          ],
          footnoteKey: 'output.curve.indepFootnote:T'
        }
      ])
    )
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(800)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(
      td => td.textContent.trim() === '(Constant)' || td.textContent.trim() === '(Sabit)'
    )
    const num = tds.find(td => td.textContent.trim() === '90.624')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasPartialTitle: has('Partial Correlations') || has('Kısmi Korelasyonlar'),
      hasControlFootnote: has('Control Variables: Ctrl') || has('Kontrol Değişkenleri: Ctrl'),
      hasEquation: has('Variables in the Equation') || has('Denklemdeki Değişkenler'),
      hasExpB: has('Exp(B)'),
      hasCoxSnell: has('Cox & Snell'),
      hasCurve: has('Curve Estimation') || has('Eğri Tahmini'),
      hasLinearModel: has('Linear') || has('Doğrusal'),
      hasQuadraticModel: has('Quadratic') || has('Karesel'),
      // formatting: tiny p → "<.001"; moderate sig → leading zero dropped ".499"
      hasPLt001: has('<.001'),
      hasLeadingZeroDropped: has('.499'),
      // a regular statistic keeps its leading zero
      hasRegularDecimal: has('0.078') || has('0.222'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({
    path: __dirname + '/../../e2e-correlate-regression-extra.png',
    fullPage: true
  })

  const pass =
    info.tables === 4 &&
    info.hasPartialTitle &&
    info.hasControlFootnote &&
    info.hasEquation &&
    info.hasExpB &&
    info.hasCoxSnell &&
    info.hasCurve &&
    info.hasLinearModel &&
    info.hasQuadraticModel &&
    info.hasPLt001 &&
    info.hasLeadingZeroDropped &&
    info.hasRegularDecimal &&
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
    console.error('E2E FAILED — see assertions above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
