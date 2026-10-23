// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Diagnostic: injects an output block whose plots use the exact Plotly spec
 * shape frequencies.R emits ({ data:[traces], layout:{} }), switches to the
 * Output tab, and asserts Plotly actually rendered an SVG into the DOM. */
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
    const bar = {
      data: [{ type: 'bar', x: ['a', 'b', 'c'], y: [3, 7, 2], marker: { color: '#3b6ea5' } }],
      layout: { title: { text: 'Bar' }, xaxis: { type: 'category' } }
    }
    const hist = {
      data: [
        {
          type: 'histogram',
          x: [1, 2, 2, 3, 3, 3, 4, 4, 5],
          opacity: 0.85,
          marker: { color: '#3b6ea5' }
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: [1, 2, 3, 4, 5],
          y: [1, 2, 3, 2, 1],
          line: { color: '#c62828' },
          name: 'Normal'
        }
      ],
      layout: { title: { text: 'Hist' } }
    }
    T.useOutputStore.getState().addBlock({
      id: 'plot-diag',
      analysisId: 'frequencies',
      titleKey: 'Plot Diagnostic',
      timestamp: new Date().toISOString(),
      datasetName: 'diag',
      result: {
        success: true,
        tables: [],
        plots: [
          { titleKey: 'output.frequencies.chartTitle:VarA', type: 'plotly', data: bar },
          { titleKey: 'output.frequencies.chartTitle:VarB', type: 'plotly', data: hist }
        ],
        warnings: [],
        notes: []
      }
    })
    T.useUIStore.getState().setActiveTab('output')
  })

  // Plotly loads dynamically; give it time to render.
  await win.waitForTimeout(2500)

  const info = await win.evaluate(() => {
    const svgs = document.querySelectorAll('.js-plotly-plot, .plotly, svg.main-svg')
    const bars = document.querySelectorAll('.plotly .bars path, .trace.bars path')
    return {
      plotlyRoots: document.querySelectorAll('.js-plotly-plot').length,
      mainSvgs: document.querySelectorAll('svg.main-svg').length,
      anyPlotlyMatch: svgs.length,
      barPaths: bars.length
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await win.screenshot({ path: __dirname + '/../../diag-output-plot.png' })
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
