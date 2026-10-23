// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: ROC Curve (AUC table + ROC plot), Kaplan-Meier (case processing, median,
 * log-rank + KM plot), Cox Regression (omnibus + variables in the equation).
 * Asserts titles/labels resolve, plots render, no raw key leaks, alignment. */
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
    const mk = (id, tables, plots = []) => ({
      id,
      analysisId: id,
      titleKey: 'analysis.' + id + '.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: { success: true, tables, plots, warnings: [], notes: [] }
    })

    store.addBlock(
      mk(
        'roc',
        [
          {
            titleKey: 'output.roc.aucTitle:Score',
            columns: [
              'output.col.area',
              'output.col.stdError',
              'output.col.asympSig',
              'output.col.ciLower95',
              'output.col.ciUpper95'
            ],
            rows: [[0.689, 0.072, 0.013911, 0.548, 0.829]],
            footnoteKey: null
          }
        ],
        [
          {
            titleKey: 'output.roc.curveTitle:Score',
            type: 'plotly',
            data: {
              data: [{ type: 'scatter', mode: 'lines', x: [0, 0.5, 1], y: [0, 0.7, 1] }],
              layout: { title: { text: 'Score' } }
            }
          }
        ]
      )
    )

    store.addBlock(
      mk(
        'survivalKM',
        [
          {
            titleKey: 'output.survival.cpsTitle',
            columns: [
              'output.col.group',
              'output.col.nTotal',
              'output.col.nEvents',
              'output.col.nCensored',
              'output.col.pctCensored'
            ],
            rows: [
              ['G = A', 35, 20, 15, 42.9],
              ['output.col.total', 60, 38, 22, 36.7]
            ],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.medianTitle',
            columns: [
              'output.col.group',
              'output.col.medianEst',
              'output.col.ciLower95',
              'output.col.ciUpper95'
            ],
            rows: [['G = A', 11.902, 7.485, '']],
            footnoteKey: null
          },
          {
            titleKey: 'output.survival.logrankTitle',
            columns: [
              'output.col.statistic',
              'output.col.chiSquare',
              'output.col.df',
              'output.col.sig'
            ],
            rows: [['output.col.logRank', 0.518, 1, 0.471576]],
            footnoteKey: null
          }
        ],
        [
          {
            titleKey: 'output.survival.kmPlotTitle',
            type: 'plotly',
            data: {
              data: [{ type: 'scatter', mode: 'lines', x: [0, 5, 10], y: [1, 0.7, 0.4] }],
              layout: {}
            }
          }
        ]
      )
    )

    store.addBlock(
      mk('survivalCox', [
        {
          titleKey: 'output.cox.omnibusTitle',
          columns: ['output.col.neg2LL', 'output.col.chiSquare', 'output.col.df', 'output.col.sig'],
          rows: [[244.868, 1.021, 1, 0.312382]],
          footnoteKey: null
        },
        {
          titleKey: 'output.cox.equationTitle',
          columns: [
            'output.col.model',
            'output.col.b',
            'output.col.stdError',
            'output.col.wald',
            'output.col.df',
            'output.col.sig',
            'output.col.expB',
            'output.col.expBLower',
            'output.col.expBUpper'
          ],
          rows: [['Age', -0.019537, 0.019538, 1, 1, 0.317319, 0.981, 0.944, 1.019]],
          footnoteKey: null
        }
      ])
    )
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(1500)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(td => td.textContent.trim() === 'Age')
    const num = tds.find(td => td.textContent.trim() === '0.981')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      plots: document.querySelectorAll('.js-plotly-plot').length,
      hasAUC: has('Area Under the Curve') || has('Eğri Altında Kalan Alan'),
      hasArea: has('Area') || has('Alan'),
      hasCPS: has('Case Processing Summary') || has('Vaka İşleme Özeti'),
      hasLogRank: has('Log Rank'),
      hasOmnibus: has('Omnibus Tests') || has('Omnibus Testleri'),
      hasExpB: has('Exp(B)'),
      hasEquation: has('Variables in the Equation') || has('Denklemdeki Değişkenler'),
      hasPLt001: has('<.001'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../e2e-roc-survival.png', fullPage: true })

  const pass =
    info.tables === 6 &&
    info.plots === 2 &&
    info.hasAUC &&
    info.hasArea &&
    info.hasCPS &&
    info.hasLogRank &&
    info.hasOmnibus &&
    info.hasExpB &&
    info.hasEquation &&
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
