// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Diagnostic: injects an output block shaped exactly like explore.R's output
 * (descriptives 2-col table + Tests of Normality table + grouped boxplot),
 * switches to Output, and asserts the i18n keys translate (no raw "output."
 * strings leak) and the boxplot renders via Plotly. No R required. */
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
          titleKey: 'output.explore.descTitle:age (male)',
          columns: ['output.col.statistic', 'output.col.value'],
          rows: [
            ['output.stat.n', 20],
            ['output.stat.mean', 31.4],
            ['output.stat.seMean', 1.7],
            ['output.stat.ciLower', 28.1],
            ['output.stat.ciUpper', 34.7],
            ['output.stat.trimmedMean', 31.2],
            ['output.stat.median', 30],
            ['output.stat.iqr', 8],
            ['output.stat.skewness', 0.31],
            ['output.stat.seSkew', 0.51],
            ['output.stat.kurtosis', -0.2],
            ['output.stat.seKurt', 0.99]
          ],
          footnoteKey: null
        },
        {
          titleKey: 'output.explore.normalityTitle:age',
          columns: [
            'output.col.group',
            'output.normality.col.ksStat',
            'output.normality.col.ksDf',
            'output.normality.col.ksSig',
            'output.normality.col.swStat',
            'output.normality.col.swDf',
            'output.normality.col.swSig'
          ],
          rows: [
            ['male', 0.121, 20, 0.55, 0.972, 20, 0.79],
            ['female', 0.108, 18, 0.63, 0.961, 18, 0.62]
          ],
          footnoteKey: 'output.explore.normalityFootnote'
        }
      ],
      plots: [
        {
          titleKey: 'output.explore.boxplotTitle:age',
          type: 'plotly',
          data: {
            data: [
              {
                type: 'box',
                y: [22, 25, 28, 30, 31, 33, 40],
                name: 'male',
                marker: { color: '#3b6ea5' }
              },
              {
                type: 'box',
                y: [20, 24, 27, 29, 30, 34, 38],
                name: 'female',
                marker: { color: '#3b6ea5' }
              }
            ],
            layout: { title: { text: 'age' }, showlegend: false }
          }
        }
      ],
      warnings: [],
      notes: []
    }
    T.useOutputStore.getState().addBlock({
      id: 'explore-diag',
      analysisId: 'explore',
      titleKey: 'analysis.explore.title',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result
    })
    T.useUIStore.getState().setActiveTab('output')
  })

  await win.waitForTimeout(2500)

  const info = await win.evaluate(() => {
    const bodyText = document.querySelector('[class*="content"]')?.textContent ?? ''
    // Any leaked raw i18n key would still contain "output." or "col." literally.
    const leaks = (bodyText.match(/output\.[a-zA-Z.]+|analysis\.[a-zA-Z.]+/g) || []).slice(0, 8)
    return {
      blockTitleTranslated: bodyText.includes('Explore'),
      hasDescriptivesHeader: bodyText.includes('Descriptives'),
      hasNormalityHeader: bodyText.includes('Normality') || bodyText.includes('Normallik'),
      has95CI: bodyText.includes('95%'),
      hasTrimmed: bodyText.includes('Trimmed') || bodyText.includes('Budanmış'),
      plotlyRoots: document.querySelectorAll('.js-plotly-plot').length,
      boxPaths: document.querySelectorAll('.plotly .boxes path, .trace.boxes path').length,
      rawKeyLeaks: leaks
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../diag-explore-render.png' })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
