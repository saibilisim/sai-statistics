// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: every analysis dialog's "Paste Syntax", run for real.
 *
 * For each dialog (the shared driver's scenarios plus the dialogs it has none
 * for) this script
 *   1. opens the dialog through the real menu channel, presses Reset, makes the
 *      scenario's selections and clicks "Paste Syntax";
 *   2. runs the pasted text from the Terminal's Run button, exactly as a user
 *      would, and collects the Output block(s) it produced;
 *   3. reopens the dialog, makes the SAME selections and clicks OK;
 *   4. requires the two outputs to be identical: same tables, cell for cell,
 *      same warnings, same number of charts.
 * A pasted command that drops one of the dialog's options (a sub-dialog tick,
 * a text field, a reference category) shows up here as a table that differs
 * from the OK run's. The params each path sent are also diffed, as a hint.
 *
 * Data: tests/spss-parity/data.csv (the file the scenarios were written for).
 * SAI_E2E_SCENARIO=<id substring>[,…] runs only matching scenarios.
 * Run: node tests/e2e/run-e2e.cjs e2e-paste-syntax   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')
const { SCENARIOS, makeT, createDriver } = require('./lib/ui-dialog-driver.cjs')

const APP_DIR = path.join(__dirname, '..', '..')
const CSV = path.join(APP_DIR, 'tests', 'spss-parity', 'data.csv')
const OUT = path.join(APP_DIR, 'tmp', 'paste-syntax-report.json')

// Dialogs the shared scenarios don't open.
const EXTRA = [
  {
    id: 'proportions-independent-disease-grp2',
    channel: 'menu:analyze:proportions-independent',
    vars: [
      ['disease', 0],
      ['grp2', 1]
    ],
    texts: ['1']
  },
  {
    id: 'proportions-paired-d1-d2',
    channel: 'menu:analyze:proportions-paired',
    vars: [
      ['d1', 0],
      ['d2', 1]
    ],
    texts: ['1']
  },
  {
    id: 'chart-scatter-score-income',
    channel: 'menu:graphs:scatter',
    vars: [
      ['score', 0],
      ['income', 1]
    ]
  },
  { id: 'chart-bar-grp3', channel: 'menu:graphs:bar', vars: [['grp3', 0]] },
  {
    id: 'chart-line-score-grp2',
    channel: 'menu:graphs:line',
    vars: [
      ['score', 0],
      ['grp2', 1]
    ]
  },
  {
    id: 'chart-boxplot-score-grp3',
    channel: 'menu:graphs:boxplot',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ]
  },
  { id: 'chart-pp-score', channel: 'menu:graphs:pp', vars: [['score', 0]] },
  { id: 'chart-qq-score', channel: 'menu:graphs:qq', vars: [['score', 0]] },
  {
    id: 'bayes-ttest-ind-score',
    channel: 'menu:analyze:bayes-ttest-independent',
    vars: [
      ['score', 0],
      ['grp2', 1]
    ],
    texts: ['1', '2']
  },
  {
    id: 'bayes-ttest1-score',
    channel: 'menu:analyze:bayes-ttest-onesample',
    vars: [['score', 0]],
    texts: ['50']
  },
  {
    id: 'bayes-ttest-paired-pre-post',
    channel: 'menu:analyze:bayes-ttest-paired',
    vars: [
      ['pre', 0],
      ['post', 1]
    ]
  },
  {
    id: 'bayes-anova-score-grp3',
    channel: 'menu:analyze:bayes-anova',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ]
  },
  {
    id: 'bayes-regression-income',
    channel: 'menu:analyze:bayes-regression',
    vars: [
      ['income', 0],
      ['score', 1],
      ['age', 1]
    ]
  },
  {
    id: 'bayes-correlation-score-income-age',
    channel: 'menu:analyze:bayes-correlation',
    vars: [
      ['score', 0],
      ['income', 0],
      ['age', 0]
    ]
  }
]

// Non-default options on the dialogs whose paste was fixed alongside this
// test: each must survive Paste → Run just as it does OK.
EXTRA.push(
  {
    id: 'x-report-rows-cases-stats',
    channel: 'menu:analyze:report-summaries',
    vars: [
      ['score', 0],
      ['grp3', 1]
    ],
    subs: [
      {
        button: 'analysis:shell.btnStatistics',
        check: ['analysis:col.max', 'analysis:col.variance']
      },
      { button: 'analysis:shell.btnOptions', check: ['analysis:reportSummaries.displayCases'] }
    ]
  },
  {
    id: 'x-roc-analysis-display',
    channel: 'menu:analyze:roc-analysis',
    vars: [
      ['score', 0],
      ['disease', 1]
    ],
    texts: ['1'],
    subs: [
      {
        button: 'analysis:shell.btnDisplay',
        check: ['analysis:rocAnalysis.modelQuality', 'analysis:roc.coordinates'],
        uncheck: ['analysis:rocAnalysis.prCurve', 'analysis:roc.diagonal']
      }
    ]
  },
  {
    id: 'x-multinomial-ref-descending',
    channel: 'menu:analyze:regression-multinomial',
    vars: [
      ['grp3', 0],
      ['score', 2],
      ['age', 2]
    ],
    subs: [
      { button: 'analysis:multinom.extra.reference', check: ['analysis:multinom.extra.descending'] }
    ]
  },
  { id: 'x-chart-line-nogroup', channel: 'menu:graphs:line', vars: [['score', 0]] },
  // The two chart Options with a GRAPH keyword (PCT, HISTOGRAM(NORMAL)).
  {
    id: 'x-chart-bar-percent',
    channel: 'menu:graphs:bar',
    vars: [['grp3', 0]],
    subs: [{ button: 'analysis:shell.btnOptions', check: ['analysis:chart.barRepresentPercent'] }]
  },
  {
    id: 'x-chart-histogram-normal',
    channel: 'menu:graphs:histogram',
    vars: [['score', 0]],
    subs: [{ button: 'analysis:shell.btnOptions', check: ['analysis:chart.histogramNormalCurve'] }]
  },
  {
    id: 'x-bayes-anova-wide',
    channel: 'menu:analyze:bayes-anova',
    vars: [
      ['score', 0],
      ['income', 0],
      ['grp3', 1]
    ],
    subs: [{ button: 'analysis:shell.btnPriors', check: ['analysis:bayes.prior.wide'] }]
  }
)

/** Params keys whose difference is cosmetic, not a dropped option. */
const COSMETIC = new Set(['summary', 'syntax', 'columnFilters', 'datasetId'])

function diffParams(a, b, prefix = '', out = []) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const k of keys) {
    if (!prefix && COSMETIC.has(k)) continue
    const x = a?.[k]
    const y = b?.[k]
    const p = prefix ? `${prefix}.${k}` : k
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x))
      diffParams(x, y, p, out)
    else if (JSON.stringify(x) !== JSON.stringify(y))
      out.push(`${p}: dialog=${JSON.stringify(x)} syntax=${JSON.stringify(y)}`)
  }
  return out
}

/** Plotly figures carry generated uids; compare the traces without them. */
const plotShape = p => {
  if (p?.type !== 'plotly') return JSON.stringify(p?.data ?? null)
  const fig = typeof p.data === 'string' ? JSON.parse(p.data) : p.data
  const data = (fig?.data ?? []).map(tr => {
    const { uid: _uid, ...rest } = tr
    return rest
  })
  return `${p.titleKey}|${JSON.stringify(data)}`
}

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
    window.__SAI_SYNTAX_RUNS__ = []
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

  const blockCount = () =>
    win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().blocks.length)
  const syntaxRuns = () => win.evaluate(() => window.__SAI_SYNTAX_RUNS__.length)
  // Newest first in the store: the k newest blocks, oldest of them first.
  const newestBlocks = k =>
    win.evaluate(
      n =>
        window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.slice(0, n)
          .reverse()
          .map(b => ({
            analysisId: b.analysisId,
            error: b.error ?? null,
            success: b.result?.success ?? null,
            tables: b.result?.tables ?? [],
            warnings: b.result?.warnings ?? [],
            plots: b.result?.plots ?? []
          })),
      k
    )

  /** Terminal ▸ Run, then wait until it settles and every queued job landed. */
  const runTerminal = async () => {
    const blocks0 = await blockCount()
    const runs0 = await syntaxRuns()
    const clicked = await win.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /^(Çalıştır|Run)( \(Ctrl\+Enter\))?$/.test((b.textContent || '').trim())
      )
      btn?.click()
      return Boolean(btn)
    })
    if (!clicked) return { clicked, blocks: [], queued: 0, log: '' }
    const end = Date.now() + 180000
    let st
    for (;;) {
      await win.waitForTimeout(400)
      st = await win.evaluate(() => ({
        running: Array.from(document.querySelectorAll('button')).some(b =>
          /Çalışıyor|Running/.test(b.textContent || '')
        ),
        n: window.__SAI_TEST__.useOutputStore.getState().blocks.length,
        q: window.__SAI_SYNTAX_RUNS__.length
      }))
      if (!st.running && st.n - blocks0 >= st.q - runs0) break
      if (Date.now() > end) break
    }
    // The syntax log pane, for the report when nothing was queued.
    const log = await win.evaluate(() =>
      Array.from(document.querySelectorAll('[class*="log"] *'))
        .map(e => e.textContent || '')
        .filter(s => s.length < 300)
        .slice(-6)
        .join(' | ')
    )
    return {
      clicked,
      queued: st.q - runs0,
      requests: await win.evaluate(k => window.__SAI_SYNTAX_RUNS__.slice(k), runs0),
      blocks: await newestBlocks(st.n - blocks0),
      log
    }
  }

  const report = []
  for (const scn of selected) {
    process.stdout.write(`== ${scn.id} `)
    const entry = { id: scn.id, channel: scn.channel, status: 'ok', problems: [] }
    report.push(entry)
    const problem = msg => {
      entry.problems.push(msg)
      entry.status = 'fail'
    }

    // ── 1. Paste ──
    await win.evaluate(() => {
      const ts = window.__SAI_TEST__.useTerminalStore.getState()
      ts.setMode('spss')
      ts.setSource('')
    })
    if (!(await openDialog(scn.channel, scn.id, (scn.vars ?? []).length > 0))) {
      problem('dialog did not open')
      console.log('(no dialog)')
      continue
    }
    await clickMainButton(t('common:common.reset'))
    await win.waitForTimeout(200)
    await applySelections(scn)
    const pasted = await clickMainButton(t('common:common.pasteSyntax'))
    if (!pasted) {
      entry.status = 'no-paste'
      problem('the dialog has no Paste Syntax button')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(400)
      console.log('NO PASTE BUTTON')
      continue
    }
    await win.waitForTimeout(400)
    entry.syntax = await win.evaluate(() =>
      window.__SAI_TEST__.useTerminalStore.getState().source.trim()
    )
    if (!entry.syntax) {
      problem('Paste Syntax left the terminal buffer empty')
      console.log('EMPTY')
      continue
    }

    // ── 2. Run the pasted text from the Terminal ──
    await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal'))
    await win.waitForTimeout(300)
    const viaSyntax = await runTerminal()
    if (!viaSyntax.clicked) problem('Terminal Run button not found')
    else if (!viaSyntax.queued) problem(`the pasted syntax ran no analysis [${viaSyntax.log}]`)
    for (const b of viaSyntax.blocks)
      if (b.error || b.success === false) problem(`syntax run failed: ${String(b.error)}`)

    // ── 3. The same selections, OK ──
    if (!(await openDialog(scn.channel, scn.id, (scn.vars ?? []).length > 0))) {
      problem('dialog did not reopen')
      console.log('(no dialog)')
      continue
    }
    await clickMainButton(t('common:common.reset'))
    await win.waitForTimeout(200)
    await applySelections(scn)
    const runs0 = await win.evaluate(() => window.__SAI_RUNS__.length)
    const prev = await lastBlockId()
    if (!(await clickMainButton(t('common:common.ok')))) {
      problem('OK button not found')
      console.log('(no OK)')
      continue
    }
    const okBlock = await waitForBlock(prev, 180000)
    const [viaOk] = okBlock ? await newestBlocks(1) : [null]
    const okRequest = await win.evaluate(k => window.__SAI_RUNS__[k] ?? null, runs0)
    if (!viaOk) problem('OK produced no output block')
    else if (viaOk.error || viaOk.success === false)
      problem(`OK run failed: ${String(viaOk.error)}`)

    // ── 4. Compare ──
    if (viaOk && viaSyntax.blocks.length) {
      // A paste can expand to several commands; the OK run is one block.
      const synTables = viaSyntax.blocks.flatMap(b => b.tables)
      const synWarnings = viaSyntax.blocks.flatMap(b => b.warnings)
      const synPlots = viaSyntax.blocks.flatMap(b => b.plots)
      if (synTables.length !== viaOk.tables.length)
        problem(`table count: OK ${viaOk.tables.length}, syntax ${synTables.length}`)
      viaOk.tables.forEach((tb, i) => {
        const other = synTables[i]
        if (!other) return
        if (tb.titleKey !== other.titleKey)
          problem(`table ${i + 1}: OK "${tb.titleKey}" vs syntax "${other.titleKey}"`)
        else if (JSON.stringify(tb) !== JSON.stringify(other)) {
          const rows = Math.max(tb.rows?.length ?? 0, other.rows?.length ?? 0)
          let where = 'columns/footnotes'
          for (let r = 0; r < rows; r++)
            if (JSON.stringify(tb.rows?.[r]) !== JSON.stringify(other.rows?.[r])) {
              where = `row ${r + 1}: OK ${JSON.stringify(tb.rows?.[r])} vs syntax ${JSON.stringify(other.rows?.[r])}`
              break
            }
          problem(`table "${tb.titleKey}" differs — ${where.slice(0, 400)}`)
        }
      })
      if (JSON.stringify(synWarnings) !== JSON.stringify(viaOk.warnings))
        problem(
          `warnings: OK ${JSON.stringify(viaOk.warnings)} vs syntax ${JSON.stringify(synWarnings)}`
        )
      if (synPlots.length !== viaOk.plots.length)
        problem(`chart count: OK ${viaOk.plots.length}, syntax ${synPlots.length}`)
      else
        viaOk.plots.forEach((p, i) => {
          if (plotShape(p) !== plotShape(synPlots[i])) problem(`chart ${i + 1} data differs`)
        })
    }
    if (okRequest && viaSyntax.requests?.length === 1) {
      entry.paramDiff = diffParams(okRequest.params, viaSyntax.requests[0].params)
      if (okRequest.scriptFile !== viaSyntax.requests[0].scriptFile)
        problem(`script: OK ${okRequest.scriptFile}, syntax ${viaSyntax.requests[0].scriptFile}`)
    }
    console.log(
      entry.status === 'ok'
        ? `ok (${viaOk?.tables.length ?? 0} tables, ${viaOk?.plots.length ?? 0} charts)`
        : 'FAIL'
    )
    for (const p of entry.problems) console.log(`     - ${p}`)
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  if (pageErrors.length) fails.push(`page errors: ${pageErrors.join(' | ')}`)
  await app.close()

  const bad = report.filter(r => r.status !== 'ok')
  console.log(
    `\n[paste-syntax] ${report.length - bad.length}/${report.length} dialogs: pasted syntax reproduces the OK output`
  )
  for (const r of bad) fails.push(`${r.id}: ${r.problems.join('; ')}`)
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
