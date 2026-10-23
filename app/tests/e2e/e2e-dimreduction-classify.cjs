// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Factor Analysis, K-Means, Hierarchical Cluster (+ dendrogram plot),
 * Discriminant. Asserts titles/labels resolve, plot renders, alignment, no raw
 * key leaks. */
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
      result: { success: true, plots, warnings: [], notes: [], tables }
    })

    store.addBlock(
      mk('factor', [
        {
          titleKey: 'output.factor.commTitle',
          columns: ['output.col.variable', 'output.col.initial', 'output.col.extraction'],
          rows: [
            ['V1', 1, 0.871],
            ['V2', 1, 0.91]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.factor.tveTitle',
          columns: [
            'output.col.component',
            'output.col.eigenvalue',
            'output.col.pctVariance',
            'output.col.cumulativePct'
          ],
          rows: [
            [1, 2.685, 67.122, 67.122],
            [2, 1.004, 25.102, 92.224]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.factor.matrixTitle',
          columns: ['output.col.variable', 'output.factor.compHdr:1', 'output.factor.compHdr:2'],
          rows: [['V1', -0.933, 0.023]],
          footnoteKey: 'output.factor.matrixFootnote'
        }
      ])
    )
    store.addBlock(
      mk('kmeans', [
        {
          titleKey: 'output.kmeans.centersTitle',
          columns: [
            'output.col.variable',
            'output.kmeans.clusterHdr:1',
            'output.kmeans.clusterHdr:2'
          ],
          rows: [['V1', -1.32, 1.546]],
          footnoteKey: null
        },
        {
          titleKey: 'output.kmeans.sizesTitle',
          columns: ['output.col.cluster', 'output.col.n'],
          rows: [
            ['output.kmeans.clusterHdr:1', 27],
            ['output.col.total', 90]
          ],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk(
        'hier',
        [
          {
            titleKey: 'output.hier.scheduleTitle',
            columns: [
              'output.col.stage',
              'output.col.cluster1',
              'output.col.cluster2',
              'output.col.coefficient'
            ],
            rows: [
              [1, 8, 63, 0.329],
              [2, 32, 74, 0.352]
            ],
            footnoteKey: null
          }
        ],
        [
          {
            titleKey: 'output.hier.dendroTitle',
            type: 'plotly',
            data: {
              data: [{ type: 'scatter', mode: 'lines', x: [1, 1, 2], y: [0, 0.3, 0.3] }],
              layout: {}
            }
          }
        ]
      )
    )
    store.addBlock(
      mk('discriminant', [
        {
          titleKey: 'output.discriminant.eigTitle',
          columns: [
            'output.col.function',
            'output.col.eigenvalue',
            'output.col.pctVariance',
            'output.col.cumulativePct',
            'output.col.canonicalCorr'
          ],
          rows: [[1, 166.52, 100, 100, 0.997]],
          footnoteKey: null
        },
        {
          titleKey: 'output.discriminant.wilksTitle',
          columns: [
            'output.col.wilksLambda',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.sig'
          ],
          rows: [[0.006, 440.415, 4, 0]],
          footnoteKey: null
        },
        {
          titleKey: 'output.discriminant.classTitle',
          columns: ['output.col.statistic', 'output.col.value'],
          rows: [['output.col.pctCorrect', 93.3]],
          footnoteKey: null
        }
      ])
    )
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(1200)
  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    const has = s => bodyText.includes(s)
    const leaks = (bodyText.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    const tds = Array.from(document.querySelectorAll('[class*="outputTable"] td'))
    const txt = tds.find(td => td.textContent.trim() === 'V1')
    const num = tds.find(td => td.textContent.trim() === '166.52')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      plots: document.querySelectorAll('.js-plotly-plot').length,
      hasComm: has('Communalities') || has('Ortak Faktör'),
      hasTVE: has('Total Variance Explained') || has('Açıklanan Toplam Varyans'),
      hasComponent: has('Component 1') || has('Bileşen 1'),
      hasCenters: has('Final Cluster Centers') || has('Nihai Küme Merkezleri'),
      hasClusterHdr: has('Cluster 1') || has('Küme 1'),
      hasSchedule: has('Agglomeration Schedule') || has('Birleştirme Çizelgesi'),
      hasEig: has('Eigenvalues') || has('Özdeğerler'),
      hasWilks: has("Wilks' Lambda") || has('Wilks Lambda'),
      hasPctCorrect: has('% Correctly') || has('% Doğru'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  const pass =
    info.tables === 9 &&
    info.plots === 1 &&
    info.hasComm &&
    info.hasTVE &&
    info.hasComponent &&
    info.hasCenters &&
    info.hasClusterHdr &&
    info.hasSchedule &&
    info.hasEig &&
    info.hasWilks &&
    info.hasPctCorrect &&
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
