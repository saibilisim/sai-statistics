// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Mann-Whitney U, Kruskal-Wallis, Wilcoxon Signed-Rank, Friedman. Asserts
 * Ranks + Test Statistics tables resolve, no raw key leaks, alignment, and that
 * a tiny p renders "<.001". Mann-Whitney also carries its optional Descriptive
 * Statistics / Effect Size tables and the grouped box plot. */
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
      mk('nparMW', [
        {
          titleKey: 'output.npar.ranksTitle',
          columns: [
            'output.col.variable',
            'output.col.group',
            'output.col.n',
            'output.col.meanRank',
            'output.col.sumRanks'
          ],
          rows: [
            ['Y', 'G = A', 20, 14.3, 286],
            ['', 'G = B', 20, 26.7, 534],
            ['', 'output.col.total', 40, '', '']
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.npar.testStatsTitle',
          columns: [
            'output.col.variable',
            'output.col.mannWhitneyU',
            'output.col.wilcoxonW',
            'output.col.z',
            'output.col.asympSig'
          ],
          rows: [['Y', 76, 286, -3.354, 0.000796]],
          footnoteKey: 'output.npar.groupingFootnote:G'
        },
        // The optional blocks the 2-Independent-Samples dialog turns on by
        // default. Their column/footnote keys are assembled in R, so the
        // unit suite cannot see them — a missing locale entry only shows up
        // here, as a raw key in rawKeyLeaks.
        {
          titleKey: 'output.npar.descriptivesTitle',
          columns: [
            'output.col.variable',
            'output.col.group',
            'output.col.n',
            'output.col.mean',
            'output.col.sd',
            'output.col.min',
            'output.col.p25',
            'output.col.median',
            'output.col.p75',
            'output.col.max',
            'output.col.iqr'
          ],
          rows: [
            ['Y', 'G = A', 20, 48.5, 9.2, 31.4, 42.1, 47.9, 55.3, 66.8, 13.2],
            ['', 'G = B', 20, 61.2, 8.4, 45.1, 55.7, 60.8, 67.4, 78.2, 11.7],
            ['', 'output.col.total', 40, 54.85, 10.8, 31.4, 46.9, 54.2, 62.6, 78.2, 15.7]
          ],
          footnoteKey: 'output.npar.groupingFootnote:G'
        },
        {
          titleKey: 'output.npar.effectSizeTitle',
          columns: [
            'output.col.variable',
            'output.npar.effectR',
            'output.npar.rankBiserial',
            'output.npar.hodgesLehmann',
            'output.col.ciLower95',
            'output.col.ciUpper95'
          ],
          rows: [['Y', 0.53, -0.62, -12.4, -19.1, -5.2]],
          footnoteKey: 'output.npar.effectSizeFootnote:A|B'
        }
      ])
    )
    // Box plot from precomputed five-number summaries (no raw point array).
    store.addBlock({
      id: 'nparMWBox',
      analysisId: 'nparMW',
      titleKey: 'analysis.nparMW.title',
      timestamp: new Date().toISOString(),
      datasetName: 'e2e',
      result: {
        success: true,
        tables: [],
        plots: [
          {
            titleKey: 'output.npar.boxTitle:Y',
            type: 'plotly',
            data: {
              data: [
                {
                  type: 'box',
                  name: 'A',
                  x: ['A'],
                  q1: [42.1],
                  median: [47.9],
                  q3: [55.3],
                  lowerfence: [31.4],
                  upperfence: [66.8],
                  mean: [48.5],
                  boxmean: true,
                  showlegend: false
                },
                {
                  type: 'box',
                  name: 'B',
                  x: ['B'],
                  q1: [55.7],
                  median: [60.8],
                  q3: [67.4],
                  lowerfence: [45.1],
                  upperfence: [78.2],
                  mean: [61.2],
                  boxmean: true,
                  showlegend: false
                }
              ],
              layout: { margin: { t: 40, r: 20, b: 40, l: 60 } }
            }
          }
        ],
        warnings: [],
        notes: []
      }
    })
    store.addBlock(
      mk('nparKW', [
        {
          titleKey: 'output.npar.ranksTitle',
          columns: [
            'output.col.variable',
            'output.col.group',
            'output.col.n',
            'output.col.meanRank'
          ],
          rows: [
            ['Y', 'G3 = A', 17, 21.41],
            ['', 'G3 = B', 11, 23.91],
            ['', 'output.col.total', 40, '']
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.npar.testStatsTitle',
          columns: [
            'output.col.variable',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.asympSig'
          ],
          rows: [['Y', 2.752, 2, 0.252633]],
          footnoteKey: 'output.npar.factorFootnote:G3'
        }
      ])
    )
    store.addBlock(
      mk('nparWilcoxon', [
        {
          titleKey: 'output.npar.ranksTitle',
          columns: [
            'output.col.variable',
            'output.col.group',
            'output.col.n',
            'output.col.meanRank',
            'output.col.sumRanks'
          ],
          rows: [
            ['Post - Pre', 'output.col.negRanks', 16, 18.69, 299],
            ['', 'output.col.posRanks', 24, 21.71, 521],
            ['', 'output.col.ties', 0, '', '']
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.npar.testStatsTitle',
          columns: ['output.col.variable', 'output.col.z', 'output.col.asympSig'],
          rows: [['Post - Pre', -1.492, 0.135703]],
          footnoteKey: 'output.npar.wilcoxonFootnote'
        }
      ])
    )
    store.addBlock(
      mk('nparFriedman', [
        {
          titleKey: 'output.npar.ranksTitle',
          columns: ['output.col.variable', 'output.col.meanRank'],
          rows: [
            ['Q1', 1.48],
            ['Q2', 2.35],
            ['Q3', 2.17]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.npar.testStatsTitle',
          columns: ['output.col.n', 'output.col.chiSquare', 'output.col.df', 'output.col.asympSig'],
          rows: [[40, 17.15, 2, 0.000189]],
          footnoteKey: 'output.npar.friedmanFootnote'
        }
      ])
    )
    store.addBlock(
      mk('nparChiSq', [
        {
          titleKey: 'output.nparChiSq.freqTitle:C',
          columns: [
            'output.col.category',
            'output.col.observedN',
            'output.col.expectedN',
            'output.col.residual'
          ],
          rows: [
            ['a', 11, 12.5, -1.5],
            ['b', 15, 12.5, 2.5],
            ['output.col.total', 50, '', '']
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.npar.testStatsTitle',
          columns: [
            'output.col.variable',
            'output.col.chiSquare',
            'output.col.df',
            'output.col.asympSig'
          ],
          rows: [['C', 0.88, 3, 0.830251]],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk('nparBinomial', [
        {
          titleKey: 'output.nparBinomial.title',
          columns: [
            'output.col.variable',
            'output.col.category',
            'output.col.n',
            'output.col.observedProp',
            'output.col.testProp',
            'output.col.exactSig'
          ],
          rows: [
            ['D', 'N', 10, 0.2, 0.5, 0.000024],
            ['', 'Y', 40, 0.8, '', ''],
            ['', 'output.col.total', 50, 1, '', '']
          ],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk('nparRuns', [
        {
          titleKey: 'output.nparRuns.title',
          columns: [
            'output.col.variable',
            'output.col.testValue',
            'output.col.casesLt',
            'output.col.casesGe',
            'output.col.total',
            'output.col.numRuns',
            'output.col.z',
            'output.col.asympSig'
          ],
          rows: [['X', 99.179, 25, 25, 50, 24, -0.572, 0.567628]],
          footnoteKey: null
        }
      ])
    )
    store.addBlock(
      mk('nparKS', [
        {
          titleKey: 'output.nparKS.title',
          columns: [
            'output.col.variable',
            'output.col.n',
            'output.col.mean',
            'output.col.stdDeviation',
            'output.col.absDiff',
            'output.col.posDiff',
            'output.col.negDiff',
            'output.col.ksZ',
            'output.col.asympSig'
          ],
          rows: [['X', 50, 100.2681, 15.5986, 0.063, 0.05, -0.063, 0.449, 0.987737]],
          footnoteKey: 'output.nparKS.footnote'
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
      td => td.textContent.trim() === 'Ties' || td.textContent.trim() === 'Bağlar'
    )
    const num = tds.find(td => td.textContent.trim() === '40')
    const alignOf = el => (el ? getComputedStyle(el).textAlign : 'none')
    return {
      tables: document.querySelectorAll('[class*="outputTable"]').length,
      hasRanks: has('Ranks') || has('Sıralar'),
      hasTestStats: has('Test Statistics') || has('Test İstatistikleri'),
      hasMWU: has('Mann-Whitney U'),
      hasChiSquare: has('Chi-Square') || has('Ki-Kare'),
      hasNegRanks: has('Negative Ranks') || has('Negatif Sıralar'),
      hasGroupingFootnote: has('Grouping Variable: G') || has('Gruplama Değişkeni: G'),
      hasWilcoxonFootnote: has('Wilcoxon Signed Ranks Test') || has('Wilcoxon İşaretli'),
      hasObservedN: has('Observed N') || has('Gözlenen N'),
      hasBinomial: has('Binomial Test') || has('Binom Testi'),
      hasExactSig: has('Exact Sig.') || has('Kesin Anl.'),
      hasRuns: has('Number of Runs') || has('Dizi Sayısı'),
      hasKS: has('Kolmogorov-Smirnov Z'),
      hasDescriptives: has('Descriptive Statistics') || has('Betimsel İstatistikler'),
      hasIqr: has('IQR') || has('ÇAA'),
      hasEffectSize: has('Effect Size') || has('Etki Büyüklüğü'),
      hasHodgesLehmann: has('Hodges-Lehmann'),
      hasBoxTitle: has('Distribution by Group') || has('Gruplara Göre Dağılım'),
      hasPLt001: has('<.001'),
      labelAlign: alignOf(txt),
      numAlign: alignOf(num),
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../e2e-nonparametric.png', fullPage: true })

  const pass =
    info.tables === 15 &&
    info.hasRanks &&
    info.hasTestStats &&
    info.hasMWU &&
    info.hasChiSquare &&
    info.hasNegRanks &&
    info.hasGroupingFootnote &&
    info.hasWilcoxonFootnote &&
    info.hasObservedN &&
    info.hasBinomial &&
    info.hasExactSig &&
    info.hasRuns &&
    info.hasKS &&
    info.hasDescriptives &&
    info.hasIqr &&
    info.hasEffectSize &&
    info.hasHodgesLehmann &&
    info.hasBoxTitle &&
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
