// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: every Analyze-menu dialog, run for real, checked against Python.
 *
 * For each scenario of the shared dialog driver (tests/e2e/lib/ui-dialog-driver.cjs)
 * this script opens the dialog through the real menu channel, makes the
 * scenario's selections, clicks OK and waits for the Output block. All result
 * tables go to tmp/pyparity-sai.json; tests/py-parity/reference.py then
 * recomputes the same statistics from the same CSV with scipy/statsmodels —
 * an implementation that shares nothing with our R scripts — and compares
 * them cell by cell.
 *
 * The data (tests/py-parity/data.csv, from gen_data.py) is not the SPSS parity
 * file: 200 cases with missing cells and ties, so listwise/pairwise handling
 * and tie corrections are exercised.
 *
 * Needs Rscript and Python 3 with numpy, scipy, pandas and statsmodels.
 * SAI_E2E_SCENARIO=<id substring>[,…] runs only matching scenarios.
 * Run: node tests/e2e/run-e2e.cjs e2e-analysis-pyparity   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { SCENARIOS, makeT, createDriver } = require('./lib/ui-dialog-driver.cjs')

const APP_DIR = path.join(__dirname, '..', '..')
const CSV = path.join(APP_DIR, 'tests', 'py-parity', 'data.csv')
const OUT = path.join(APP_DIR, 'tmp', 'pyparity-sai.json')

// Beyond the shared scenarios: options the SPSS parity run doesn't tick, and
// case weights (Data ▸ Weight Cases, `weight`), which reach every analysis.
const channelOf = id => SCENARIOS.find(s => s.id === id).channel
const EXTRA = [
  {
    id: 'x-multinomial-covariates',
    channel: channelOf('multinomial-grp3-score-age'),
    // fields: Dependent(0), Factors(1), Covariates(2)
    vars: [
      ['grp3', 0],
      ['score', 2],
      ['age', 2]
    ]
  },
  {
    // Reference Category ▸ Descending: the last category in descending order
    // is grp3 = 1, and every category listing runs 3, 2, 1.
    id: 'x-multinomial-ref-descending',
    channel: channelOf('multinomial-grp3-score-age'),
    vars: [
      ['grp3', 0],
      ['score', 2],
      ['age', 2]
    ],
    subs: [
      { button: 'analysis:multinom.extra.reference', check: ['analysis:multinom.extra.descending'] }
    ]
  },
  {
    id: 'x-crosstabs-2x2',
    channel: channelOf('crosstabs-grp3-disease'),
    vars: [
      ['grp2', 0],
      ['disease', 1]
    ],
    subs: [
      {
        button: 'analysis:shell.btnStatistics',
        check: ['analysis:crosstabs.stats.phiCramer', 'analysis:crosstabs.stats.risk']
      },
      { button: 'analysis:shell.btnCells', check: ['analysis:crosstabs.cells.rowPct'] }
    ]
  },
  {
    id: 'x-correlate-pearson-kendall',
    channel: channelOf('correlate-spearman'),
    vars: [
      ['score', 0],
      ['income', 0],
      ['age', 0]
    ],
    mainChecks: ['analysis:correlate.kendall']
  },
  {
    id: 'x-oneway-posthoc',
    channel: channelOf('oneway-score-income-grp3'),
    vars: [
      ['score', 0],
      ['grp3', 1]
    ],
    subs: [
      {
        button: 'analysis:shell.btnPostHoc',
        check: ['analysis:anova.bonferroni', 'analysis:anova.scheffe', 'analysis:anova.gamesHowell']
      },
      { button: 'analysis:shell.btnOptions', check: ['analysis:anova.brownForsythe'] }
    ]
  },
  {
    id: 'x-explore-normality',
    channel: channelOf('explore-score-income-grp3'),
    vars: [
      ['score', 0],
      ['grp2', 1]
    ],
    subs: [{ button: 'analysis:shell.btnPlots', check: ['analysis:explore.plots.normality'] }]
  },
  {
    id: 'x-frequencies-weighted',
    channel: channelOf('frequencies-age'),
    weight: 'wt',
    vars: [['grp3', 0]],
    subs: [
      {
        button: 'analysis:shell.btnStatistics',
        check: ['analysis:frequencies.stats.mean', 'analysis:frequencies.stats.sd']
      }
    ]
  },
  {
    id: 'x-descriptives-weighted',
    channel: channelOf('descriptives-score-income'),
    weight: 'wt',
    vars: [
      ['score', 0],
      ['income', 0]
    ]
  },
  {
    id: 'x-ttest-weighted',
    channel: channelOf('ttest-ind-score-income'),
    weight: 'wt',
    vars: [
      ['score', 0],
      ['grp2', 1]
    ],
    texts: ['1', '2']
  }
]

async function main() {
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: APP_DIR })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
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
  await win.evaluate(() => {
    window.__SAI_RUNS__ = []
  })
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

  const only = (process.env.SAI_E2E_SCENARIO ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const all = [...SCENARIOS, ...EXTRA]
  const selected = only.length ? all.filter(s => only.some(o => s.id.includes(o))) : all

  const setWeight = name =>
    win.evaluate(n => {
      const ds = window.__SAI_TEST__.useDatasetStore.getState()
      ds.setWeight(n ? (ds.variables.find(v => v.name === n)?.colId ?? null) : null)
    }, name)

  const results = []
  for (const scn of selected) {
    process.stdout.write(`== ${scn.id} `)
    await setWeight(scn.weight ?? null)
    await win.waitForTimeout(scn.weight ? 300 : 0)
    if (!(await openDialog(scn.channel, scn.id, (scn.vars ?? []).length > 0))) {
      console.log('(no dialog)')
      continue
    }
    // Dialogs keep the last run's selections for the session (as SPSS's do);
    // a second Explore scenario added grp2 next to the first one's grp3.
    await clickMainButton(t('common:common.reset'))
    await win.waitForTimeout(200)
    await applySelections(scn)
    const before = await win.evaluate(() => window.__SAI_RUNS__.length)
    const prev = await lastBlockId()
    if (!(await clickMainButton(t('common:common.ok')))) {
      fails.push(`${scn.id}: OK button not found`)
      console.log('(no OK)')
      continue
    }
    const block = await waitForBlock(prev, 120000)
    const res = await win.evaluate(idx => {
      const b = window.__SAI_TEST__.useOutputStore.getState().blocks[0]
      return {
        request: window.__SAI_RUNS__[idx] ?? null,
        error: b?.error ?? null,
        success: b?.result?.success ?? null,
        tables: b?.result?.tables ?? [],
        warnings: b?.result?.warnings ?? [],
        notes: b?.result?.notes ?? [],
        plots: (b?.result?.plots ?? []).length
      }
    }, before)
    if (!block) fails.push(`${scn.id}: no output block`)
    else if (res.error || res.success === false)
      fails.push(`${scn.id}: analysis failed (${String(res.error)})`)
    console.log(block ? `${res.tables.length} tables` : 'TIMEOUT')
    results.push({ id: scn.id, channel: scn.channel, ...res })
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  // A partial run (SAI_E2E_SCENARIO) replaces its scenarios in the last full dump.
  let dump = results
  if (only.length && fs.existsSync(OUT)) {
    const ran = new Set(results.map(r => r.id))
    dump = [...JSON.parse(fs.readFileSync(OUT, 'utf8')).filter(r => !ran.has(r.id)), ...results]
  }
  fs.writeFileSync(OUT, JSON.stringify(dump, null, 1))
  if (pageErrors.length) fails.push(`page errors: ${pageErrors.join(' | ')}`)
  await app.close()

  // ── The Python side ──
  const py = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    [path.join(APP_DIR, 'tests', 'py-parity', 'reference.py'), CSV, OUT],
    { stdio: 'inherit' }
  )
  if (py.error) fails.push(`python could not run: ${String(py.error)}`)
  else if (py.status !== 0) fails.push('Python reference comparison found differences (see above)')

  if (fails.length) {
    console.error('\nFAILED:\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('\nE2E PASSED')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
