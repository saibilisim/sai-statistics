// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the 2026-11 scale / survey analyses and Design of Experiments, end to
 * end through real R runs —
 *   1. every new Scale-menu dialog and both DoE dialogs open from the menu;
 *   2. Create Design (RCBD) builds a new dataset with the randomized plan;
 *   3. on a synthetic survey dataset: Reliability (Guttman + ICC + ANOVA),
 *      Item Analysis, Likert Item Descriptives (+ chart), Scale Scores Report
 *      (saving a score as a new variable), Harman, Test-Retest and Lawshe run
 *      and render; a DoE dataset gets the RCBD analysis with letter groups.
 * No raw output.* key may leak into the DOM.
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SURVEY = path.join(os.tmpdir(), 'sai-scale-survey.csv')
const DOE = path.join(os.tmpdir(), 'sai-doe-rcbd.csv')

function writeFixtures() {
  let seed = 7
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const lik = v => (v < -1.2 ? 1 : v < -0.4 ? 2 : v < 0.4 ? 3 : v < 1.2 ? 4 : 5)
  const lines = ['a1,a2,a3,b1,b2,b3,t1,t2,e1,e2,e3']
  for (let r = 0; r < 200; r++) {
    const f1 = norm()
    const f2 = 0.4 * f1 + norm()
    const it = [f1, f1, -f1, f2, f2, f2].map(f => lik(f + 0.7 * norm()))
    const t1 = 50 + 10 * f1
    const t2 = t1 + 1 + 4 * norm()
    // Lawshe ratings: first 12 rows are the "experts" (1 = essential).
    const e = r < 12 ? [r < 11 ? 1 : 2, r < 9 ? 1 : 3, r < 5 ? 1 : 2] : ['', '', '']
    lines.push([...it, t1.toFixed(1), t2.toFixed(1), ...e].join(','))
  }
  fs.writeFileSync(SURVEY, lines.join('\n') + '\n')
  const d = ['blk,trt,y']
  for (let b = 1; b <= 4; b++)
    for (let t = 1; t <= 4; t++)
      d.push([b, t, (10 + 1.5 * t + 0.6 * b + norm()).toFixed(2)].join(','))
  fs.writeFileSync(DOE, d.join('\n') + '\n')
}

async function main() {
  writeFixtures()
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })
  const fails = []
  const check = (cond, msg) => {
    if (!cond) fails.push(msg)
    else console.log('   ok  ' + msg)
  }
  const send = ch =>
    app.evaluate(({ BrowserWindow }, c) => {
      BrowserWindow.getAllWindows()[0].webContents.send(c)
    }, ch)
  const load = async file => {
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
    }, file)
    await win.waitForTimeout(800)
    return win.evaluate(() =>
      Object.fromEntries(
        (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => [v.name, v.colId])
      )
    )
  }
  const run = async (analysisId, scriptFile, params) => {
    const before = await win.evaluate(() =>
      window.__SAI_TEST__.useOutputStore.getState().blocks.map(b => b.id)
    )
    await win.evaluate(
      async ([a, s, p]) => {
        const ds = window.__SAI_TEST__.useDatasetStore.getState()
        await window.api.analysis.run({
          analysisId: a,
          datasetId: ds.datasetId,
          scriptFile: s,
          params: p
        })
      },
      [analysisId, scriptFile, params]
    )
    const t0 = Date.now()
    for (;;) {
      const b = await win.evaluate(ids => {
        const f = window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.find(x => !ids.includes(x.id))
        return f && !f.running ? { error: f.error ?? null, result: f.result } : null
      }, before)
      if (b) return b
      if (Date.now() - t0 > 180000) return null
      await win.waitForTimeout(400)
    }
  }
  const ok = (b, name) =>
    check(b && !b.error && b.result?.success, `${name} succeeded (${b?.error ?? ''})`)
  const has = (b, key) => (b?.result?.tables ?? []).some(t => t.titleKey.startsWith(key))

  // ── 1. Dialogs open from the menu ────────────────────────────────────────
  await load(SURVEY)
  const dialogs = [
    ['menu:analyze:item-analysis', /Item Analysis|Madde Analizi/],
    ['menu:analyze:likert-items', /Likert Item Descriptives|Likert Madde Betimlemesi/],
    ['menu:analyze:scale-report', /Scale Scores Report|Ölçek Puanı Raporu/],
    ['menu:analyze:harman', /Harman/],
    ['menu:analyze:test-retest', /Test-Retest|Test-Tekrar Test/],
    ['menu:analyze:lawshe', /Lawshe/],
    ['menu:analyze:doe-analyze', /Analyze Design|Tasarımı Analiz Et/],
    ['menu:analyze:reliability', /Reliability|Güvenilirlik|Güvenirlik/]
  ]
  for (const [ch, re] of dialogs) {
    await send(ch)
    await win.waitForTimeout(500)
    const title = await win.evaluate(
      () => document.querySelector('[role="dialog"]')?.textContent ?? ''
    )
    check(re.test(title), `${ch} opens its dialog`)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(300)
  }

  // ── 2. Create Design → new dataset ───────────────────────────────────────
  await send('menu:analyze:doe-create')
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-doe-create.png') })
  await win
    .locator('[role="dialog"] button', { hasText: /^(OK|Tamam)$/ })
    .last()
    .click()
  await win.waitForTimeout(1500)
  const created = await win.evaluate(() => {
    const s = window.__SAI_TEST__.useDatasetStore.getState()
    return { names: (s.variables ?? []).map(v => v.name), rows: s.rowCount }
  })
  check(
    ['Plot', 'Block', 'Treatment', 'Response'].every(n => created.names.includes(n)) &&
      created.rows === 16,
    `RCBD design dataset created (${created.names.join(',')}; ${String(created.rows)} rows)`
  )

  // ── 3. Analyses on the survey data ───────────────────────────────────────
  const c = await load(SURVEY)
  const items = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']
  const ids = items.map(n => c[n])
  const names = Object.fromEntries(items.map(n => [c[n], n]))
  const rel = await run('reliability', 'reliability.R', {
    variables: ids,
    varNames: names,
    options: {
      interItemCorr: false,
      model: 'guttman',
      anova: 'f',
      tukey: true,
      icc: { enabled: true, model: 'mixed', type: 'consistency', ci: 95, testValue: 0 }
    }
  })
  ok(rel, 'Reliability (Guttman, ANOVA, ICC)')
  check(
    has(rel, 'output.reliability.guttmanTitle') && has(rel, 'output.reliability.iccTitle'),
    'Guttman + ICC tables'
  )
  const ia = await run('itemAnalysis', 'item-analysis.R', { variables: ids, varNames: names })
  ok(ia, 'Item Analysis')
  check(has(ia, 'output.itemAnalysis.ulTitle'), '27% upper-lower table')
  const lk = await run('likert', 'likert-items.R', {
    variables: ids,
    varNames: names,
    reverseItems: [c.a3],
    valueLabels: {},
    options: { scaleMin: 1, scaleMax: 5, chart: true }
  })
  ok(lk, 'Likert Item Descriptives')
  check((lk?.result?.plots ?? []).length === 1, 'diverging chart')
  const sr = await run('scaleReport', 'scale-report.R', {
    variables: ids,
    varNames: names,
    valueLabels: {},
    subscales: [
      { name: 'A', items: [c.a1, c.a2, c.a3] },
      { name: 'B', items: [c.b1, c.b2, c.b3] }
    ],
    reverseItems: [c.a3],
    createVars: { score1: 'A_score' },
    options: { score: 'mean', criterion: 1.5 }
  })
  ok(sr, 'Scale Scores Report')
  check(has(sr, 'output.scale.corrTitle'), 'APA correlation table')
  await win.waitForTimeout(800)
  const newVar = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).some(v => v.name === 'A_score')
  )
  check(newVar, 'A_score saved as a new variable')
  const hm = await run('harman', 'harman.R', { variables: ids, varNames: names })
  ok(hm, "Harman's test")
  const rt = await run('retest', 'test-retest.R', {
    first: [c.t1],
    second: [c.t2],
    varNames: { [c.t1]: 't1', [c.t2]: 't2' }
  })
  ok(rt, 'Test-Retest')
  const lw = await run('lawshe', 'lawshe.R', {
    variables: [c.e1, c.e2, c.e3],
    varNames: { [c.e1]: 'e1', [c.e2]: 'e2', [c.e3]: 'e3' },
    options: { essential: 1 }
  })
  ok(lw, 'Lawshe CVR')

  // ── 4. DoE analysis ──────────────────────────────────────────────────────
  const d = await load(DOE)
  const doe = await run('doe', 'doe-analysis.R', {
    response: d.y,
    design: 'rcbd',
    treatment: d.trt,
    block: d.blk,
    varNames: { [d.y]: 'y', [d.trt]: 'trt', [d.blk]: 'blk' },
    valueLabels: {},
    options: { comparison: 'tukey', alpha: 0.05 }
  })
  ok(doe, 'RCBD analysis')
  check(has(doe, 'output.doe.meansTitle'), 'letter-group table')

  // ── Rendered output ──────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(2500)
  const dom = await win.evaluate(() => {
    const text = document.querySelector('[class*="content"]')?.textContent ?? ''
    return {
      leaks: (text.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10),
      plots: document.querySelectorAll('.js-plotly-plot').length
    }
  })
  check(dom.leaks.length === 0, `no raw keys in output (${dom.leaks.join(', ')})`)
  check(dom.plots >= 1, `plots rendered (${String(dom.plots)})`)
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-scale-doe.png') })

  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ')})`)
  await app.close()
  if (fails.length) {
    console.log('\nFAIL:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
