// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the Graphs dialogs' Options sub-dialogs change the chart that is drawn.
 *
 * Until 2026-10-19 chart.R read only the boxplot's options: every other
 * Options choice was sent and silently ignored. For each chart this script
 * opens the dialog from the real menu channel, ticks options in the Options
 * sub-dialog, clicks OK and checks the Plotly figure the Output block holds
 * (the traces, not pixels) against what the option means — the R side is
 * validated against independent formulas in tests/r-validation/test-chart.R.
 *
 * Data: tests/spss-parity/data.csv.
 * Run: node tests/e2e/run-e2e.cjs e2e-chart-options   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const path = require('node:path')
const { makeT, createDriver } = require('./lib/ui-dialog-driver.cjs')

const APP_DIR = path.join(__dirname, '..', '..')
const CSV = path.join(APP_DIR, 'tests', 'spss-parity', 'data.csv')
const OPTIONS = 'analysis:shell.btnOptions'

const SCENARIOS = [
  {
    id: 'scatter-fit-line',
    channel: 'menu:graphs:scatter',
    vars: [
      ['score', 0],
      ['income', 1]
    ],
    subs: [{ button: OPTIONS, check: ['analysis:chart.fitLineLinear'] }],
    verify: fig => {
      const line = fig.data[1]
      return line?.mode === 'lines' && /R² = 0\.\d{3}/.test(line.name ?? '')
        ? null
        : `expected a fit-line trace, got ${fig.data.length} trace(s)`
    }
  },
  {
    id: 'bar-percent-asc-values',
    channel: 'menu:graphs:bar',
    vars: [['grp3', 0]],
    subs: [
      {
        button: OPTIONS,
        check: [
          'analysis:chart.barRepresentPercent',
          'analysis:chart.barSortCountAsc',
          'analysis:chart.barShowValues'
        ]
      }
    ],
    verify: fig => {
      const y = fig.data[0].y.map(Number)
      const sum = y.reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 100) > 1e-6) return `percent bars should sum to 100, got ${sum}`
      if (y.some((v, i) => i && v < y[i - 1])) return `bars not ascending: ${y.join(', ')}`
      if (!Array.isArray(fig.data[0].text)) return 'no value labels on the bars'
      return fig.layout.yaxis.title.text === 'Percent' ? null : 'y axis is not Percent'
    }
  },
  {
    id: 'line-markers-value-desc',
    channel: 'menu:graphs:line',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ],
    subs: [
      {
        button: OPTIONS,
        check: ['analysis:chart.lineStyleMarkersOnly', 'analysis:chart.lineSortValueDesc']
      }
    ],
    verify: fig => {
      const tr = fig.data[0]
      const y = tr.y.map(Number)
      if (tr.mode !== 'markers') return `mode ${tr.mode}, expected markers`
      return y.some((v, i) => i && v > y[i - 1]) ? `means not descending: ${y.join(', ')}` : null
    }
  },
  {
    id: 'histogram-normal-custom-bins',
    channel: 'menu:graphs:histogram',
    vars: [['score', 0]],
    subs: [
      {
        button: OPTIONS,
        check: ['analysis:chart.histogramNormalCurve', 'analysis:chart.histogramBinsCustom']
      }
    ],
    verify: fig => {
      const bars = fig.data[0]
      const xs = bars.x.map(Number).filter(Number.isFinite)
      const width = (Math.max(...xs) - Math.min(...xs)) / 10 // the custom field's default
      if (Math.abs(Number(bars.xbins.size) - width) > 1e-9)
        return `bin width ${bars.xbins.size}, expected range/10 = ${width}`
      return fig.data[1]?.mode === 'lines' ? null : 'no normal curve trace'
    }
  },
  {
    id: 'pp-detrended',
    channel: 'menu:graphs:pp',
    vars: [['score', 0]],
    subs: [{ button: OPTIONS, check: ['analysis:chart.ppqqDetrend'] }],
    verify: fig => {
      const ref = fig.data[1].y.map(Number)
      return ref.every(v => v === 0) && fig.layout.yaxis.title.text === 'Deviation from Normal'
        ? null
        : 'not the detrended P-P (zero reference line, deviation axis)'
    }
  },
  {
    id: 'qq-detrended',
    channel: 'menu:graphs:qq',
    vars: [['score', 0]],
    subs: [{ button: OPTIONS, check: ['analysis:chart.ppqqDetrend'] }],
    verify: fig => {
      const ref = fig.data[1].y.map(Number)
      return ref.every(v => v === 0) && fig.layout.yaxis.title.text === 'Deviation from Normal'
        ? null
        : 'not the detrended Q-Q (zero reference line, deviation axis)'
    }
  },
  {
    // The one chart whose options already worked — kept as the control.
    id: 'boxplot-horizontal',
    channel: 'menu:graphs:boxplot',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ],
    subs: [{ button: OPTIONS, check: ['analysis:chart.orientationHorizontal'] }],
    verify: fig => (fig.data[0].orientation === 'h' ? null : 'boxplot is not horizontal')
  }
]

async function main() {
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: APP_DIR })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  // The close-time "save changes?" prompt would otherwise block app.close().
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })
  const fails = []
  await win.evaluate(async f => {
    const r = await window.api.file.import({ filePath: f })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        r.dataset.id,
        r.dataset.name,
        r.dataset.filePath,
        r.variables,
        r.dataset.rowCount,
        r.styles
      )
  }, CSV)
  await win.waitForTimeout(1200)
  await win.waitForFunction(() => window.__SAI_TEST__?.useSettingsStore.getState().isLoaded)
  const lang = await win.evaluate(
    () => window.__SAI_TEST__.useSettingsStore.getState().settings?.appearance?.language ?? 'tr'
  )
  const t = makeT(lang)
  const { openDialog, clickMainButton, applySelections, lastBlockId, waitForBlock } = createDriver({
    app,
    win,
    t,
    fails
  })

  for (const scn of SCENARIOS) {
    process.stdout.write(`== ${scn.id} `)
    if (!(await openDialog(scn.channel, scn.id, true))) {
      fails.push(`${scn.id}: dialog did not open`)
      console.log('(no dialog)')
      continue
    }
    await clickMainButton(t('common:common.reset'))
    await win.waitForTimeout(200)
    await applySelections(scn)
    const prev = await lastBlockId()
    if (!(await clickMainButton(t('common:common.ok')))) {
      fails.push(`${scn.id}: OK button not found`)
      console.log('(no OK)')
      continue
    }
    const block = await waitForBlock(prev, 60000)
    const fig = await win.evaluate(() => {
      const b = window.__SAI_TEST__.useOutputStore.getState().blocks[0]
      const p = b?.result?.plots?.[0]
      if (!p) return null
      return typeof p.data === 'string' ? JSON.parse(p.data) : p.data
    })
    const problem = !block ? 'no output block' : !fig ? 'no chart in the output' : scn.verify(fig)
    if (problem) fails.push(`${scn.id}: ${problem}`)
    console.log(problem ? `FAIL — ${problem}` : 'ok')
  }

  if (pageErrors.length) fails.push(`page errors: ${pageErrors.join(' | ')}`)
  await app.close()
  if (fails.length) {
    console.error('\nFAILED:\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log(`\nE2E PASSED: ${SCENARIOS.length} chart Options sub-dialogs change the chart`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
