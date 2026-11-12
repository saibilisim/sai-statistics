// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the 2026-11 scale / survey and Design of Experiments dialogs driven the
 * way a user drives them — variables picked in the source list and moved with
 * the arrow buttons, options set in the main panel and in the sub-dialogs, OK
 * clicked. For each run the request the dialog actually sent (window.__SAI_RUNS__)
 * is checked against what was chosen, then the real R result.
 *
 *   Scale:  Reliability (strict model; Statistics: Friedman, Hotelling, ICC
 *           two-way random / absolute / 90%), Likert (reverse item via the
 *           sub-dialog, explicit 1-5 range), Scale Scores Report (two renamed
 *           subscales, reverse item, ±1 criterion, total, save scores), Item
 *           Analysis (25% groups), Harman (+ one-factor CFA), Test-Retest
 *           (two-way random, consistency), Lawshe (Lawshe table).
 *   DoE:    every design type — CRD, RCBD, Latin square, factorial in blocks,
 *           split-plot, 2^3 with replicates and unreplicated 2^4 (Lenth) —
 *           created with Create Design, the response filled in, analysed with
 *           Analyze Design.
 *
 * Labels are looked up in the tr and en locale files, so the test runs in
 * either UI language. No raw output.* key may leak into the DOM.
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const SURVEY = path.join(os.tmpdir(), 'sai-scale-dialogs.csv')

// ── i18n: key → regex matching the tr or en text ───────────────────────────
const LOC = ['tr', 'en'].map(l => ({
  analysis: require(path.join(ROOT, 'src/i18n/locales', l, 'analysis.json')),
  common: require(path.join(ROOT, 'src/i18n/locales', l, 'common.json'))
}))
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function text(loc, key, vars = {}) {
  const [ns, p] = key.split(':')
  let v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), loc[ns])
  if (typeof v !== 'string') throw new Error(`missing i18n ${key}`)
  for (const [k, x] of Object.entries(vars)) v = v.replaceAll(`{{${k}}}`, String(x))
  return v
}
/** Regex for the label in either language; exact unless `loose`. */
const T = (key, vars, loose = false) => {
  const alts = [...new Set(LOC.map(l => esc(text(l, key, vars))))].join('|')
  return new RegExp(loose ? `(${alts})` : `^\\s*(${alts})\\s*$`)
}

function writeSurvey() {
  let seed = 11
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
    const e = r < 12 ? [r < 11 ? 1 : 2, r < 9 ? 1 : 3, r < 5 ? 1 : 2] : ['', '', '']
    lines.push([...it, t1.toFixed(1), t2.toFixed(1), ...e].join(','))
  }
  fs.writeFileSync(SURVEY, lines.join('\n') + '\n')
}

async function main() {
  writeSurvey()
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: ROOT })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1200)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 })
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
  const vars = () =>
    win.evaluate(() =>
      Object.fromEntries(
        (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => [v.name, v.colId])
      )
    )

  // ── dialog helpers ─────────────────────────────────────────────────────────
  const dlg = () => win.locator('[role="dialog"]').first()
  const sub = () => win.locator('[role="dialog"]').last()
  const open = async ch => {
    await send(ch)
    await win.waitForTimeout(700)
  }
  /** Pick `names` in the source list (Ctrl for the rest) and press field `idx`'s arrow. */
  const assign = async (idx, names) => {
    const d = dlg()
    for (const [i, n] of names.entries()) {
      await d
        .locator('[role="listbox"]')
        .first()
        .locator('[role="option"]')
        .filter({ has: win.locator('span', { hasText: new RegExp(`^${esc(n)}$`) }) })
        .click({ modifiers: i ? ['Control'] : [] })
    }
    await d
      .locator('button', { hasText: /^[▶◀]$/ })
      .nth(idx)
      .click()
    await win.waitForTimeout(150)
  }
  const selectIn = (scope, value) => scope.locator(`select:has(option[value="${value}"])`).first()
  const labelled = (scope, re) => scope.locator('label', { hasText: re }).locator('input').first()
  const sideBtn = async key => {
    await dlg()
      .locator('button', { hasText: T(key, {}, true) })
      .first()
      .click()
    await win.waitForTimeout(400)
  }
  const cont = async () => {
    await sub()
      .locator('button', { hasText: T('common:common.continue') })
      .click()
    await win.waitForTimeout(250)
  }
  const blockIds = () =>
    win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().blocks.map(b => b.id))
  /** Click OK; return the request the dialog sent and the finished output block. */
  const ok = async () => {
    await win.evaluate(() => {
      window.__SAI_RUNS__ = []
    })
    const before = await blockIds()
    const btn = dlg()
      .locator('button', { hasText: T('common:common.ok') })
      .last()
    if (!(await btn.isEnabled())) return { req: null, block: null, disabled: true }
    await btn.click()
    const t0 = Date.now()
    for (;;) {
      const b = await win.evaluate(ids => {
        const f = window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.find(x => !ids.includes(x.id))
        return f && !f.running ? { error: f.error ?? null, result: f.result } : null
      }, before)
      if (b) {
        const req = await win.evaluate(() => window.__SAI_RUNS__?.[0] ?? null)
        return { req, block: b }
      }
      if (Date.now() - t0 > 180000) return { req: null, block: null }
      await win.waitForTimeout(400)
    }
  }
  const success = (r, name) =>
    check(
      r.block && !r.block.error && r.block.result?.success,
      `${name}: R run succeeded (${r.disabled ? 'OK disabled' : (r.block?.error ?? '')})`
    )
  const tables = r => (r.block?.result?.tables ?? []).map(t => t.titleKey.split(':')[0])
  const hasT = (r, k) => tables(r).includes(k)
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

  // ── Load the survey ────────────────────────────────────────────────────────
  const loadSurvey = async () => {
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
    }, SURVEY)
    await win.waitForTimeout(900)
    return vars()
  }
  let c = await loadSurvey()
  const items = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']

  // ── Reliability ────────────────────────────────────────────────────────────
  {
    await open('menu:analyze:reliability')
    await assign(0, ['a1', 'a2', 'a3'])
    await selectIn(dlg(), 'strict').selectOption('strict')
    await sideBtn('analysis:shell.btnStatistics')
    const s = sub()
    await s.getByLabel(T('analysis:reliability.anova_friedman')).check()
    await s.getByLabel(T('analysis:reliability.hotellingOption')).check()
    await s.getByLabel(T('analysis:reliability.iccOption')).check()
    await selectIn(s, 'random').selectOption('random')
    await selectIn(s, 'absolute').selectOption('absolute')
    await labelled(s, T('analysis:reliability.iccCi', {}, true)).fill('90')
    await cont()
    const r = await ok()
    const o = r.req?.params?.options ?? {}
    check(
      same(r.req?.params?.variables ?? [], [c.a1, c.a2, c.a3]),
      'Reliability: the three moved items were sent'
    )
    check(o.model === 'strict', `Reliability: model strict sent (${o.model})`)
    check(o.anova === 'friedman' && o.hotelling === true, 'Reliability: Friedman + Hotelling sent')
    check(
      o.icc?.enabled && o.icc.model === 'random' && o.icc.type === 'absolute' && o.icc.ci === 90,
      `Reliability: ICC random/absolute/90 sent (${JSON.stringify(o.icc)})`
    )
    success(r, 'Reliability')
    for (const k of [
      'output.reliability.strictStatsTitle',
      'output.reliability.anovaTitle',
      'output.reliability.hotellingTitle',
      'output.reliability.iccTitle'
    ])
      check(hasT(r, k), `Reliability: ${k}`)
    const icc = r.block?.result?.tables?.find(t => t.titleKey.startsWith('output.reliability.icc'))
    check(JSON.stringify(icc ?? {}).includes('90'), 'Reliability: ICC table carries the 90% CI')
  }

  // ── Likert item descriptives ───────────────────────────────────────────────
  {
    await open('menu:analyze:likert-items')
    await assign(0, items)
    await sideBtn('analysis:scaleShared.btnReverse')
    await sub()
      .getByLabel(/^a3( — .*)?$/)
      .check()
    await cont()
    await dlg().getByLabel(T('analysis:scaleShared.rangeMin')).fill('1')
    await dlg().getByLabel(T('analysis:scaleShared.rangeMax')).fill('5')
    const r = await ok()
    const p = r.req?.params ?? {}
    check(
      same(
        p.variables ?? [],
        items.map(n => c[n])
      ),
      'Likert: six items sent'
    )
    check(same(p.reverseItems ?? [], [c.a3]), 'Likert: a3 reversed via the sub-dialog')
    check(
      p.options?.scaleMin === 1 && p.options?.scaleMax === 5,
      `Likert: range 1-5 sent (${JSON.stringify(p.options)})`
    )
    success(r, 'Likert')
    check(hasT(r, 'output.likert.pctTitle'), 'Likert: percentage table')
    check((r.block?.result?.plots ?? []).length === 1, 'Likert: diverging chart')
  }

  // ── Scale Scores Report ────────────────────────────────────────────────────
  {
    await open('menu:analyze:scale-report')
    const d = dlg()
    await d.locator('button', { hasText: T('analysis:scaleReport.addSubscale') }).click()
    await labelled(d, T('analysis:scaleReport.nameLabel', { n: 1 }, true)).fill('Selfeff')
    await labelled(d, T('analysis:scaleReport.nameLabel', { n: 2 }, true)).fill('Anxiety')
    await assign(0, ['a1', 'a2', 'a3'])
    await assign(1, ['b1', 'b2', 'b3'])
    await sideBtn('analysis:scaleShared.btnReverse')
    await sub()
      .getByLabel(/^a3( — .*)?$/)
      .check()
    await cont()
    await selectIn(d, '2').selectOption('1')
    await d.getByLabel(T('analysis:scaleReport.totalOption')).check()
    await d.getByLabel(T('analysis:scaleReport.saveOption')).check()
    const r = await ok()
    const p = r.req?.params ?? {}
    const subs = p.subscales ?? []
    check(
      subs.length === 2 &&
        subs[0].name === 'Selfeff' &&
        subs[1].name === 'Anxiety' &&
        same(subs[0].items, [c.a1, c.a2, c.a3]) &&
        same(subs[1].items, [c.b1, c.b2, c.b3]),
      `Scale report: renamed subscales with their items (${JSON.stringify(subs.map(s => s.name))})`
    )
    check(same(p.reverseItems ?? [], [c.a3]), 'Scale report: a3 reversed')
    check(
      p.options?.criterion === 1 && p.options?.total === true,
      `Scale report: ±1 criterion + total (${JSON.stringify(p.options)})`
    )
    check(
      p.createVars?.score1 && p.createVars?.score2 && p.createVars?.total,
      `Scale report: three score variables requested (${JSON.stringify(p.createVars)})`
    )
    success(r, 'Scale report')
    for (const k of ['output.scale.descTitle', 'output.scale.corrTitle'])
      check(hasT(r, k), `Scale report: ${k}`)
    await win.waitForTimeout(1000)
    const names = Object.keys(await vars())
    const want = Object.values(p.createVars ?? {})
    check(
      want.length === 3 && want.every(n => names.includes(n)),
      `Scale report: ${want.join(', ')} saved to the dataset`
    )
    c = await vars()
  }

  // ── Item Analysis ──────────────────────────────────────────────────────────
  {
    await open('menu:analyze:item-analysis')
    await assign(0, items)
    await labelled(dlg(), T('analysis:itemAnalysis.groupPercent', {}, true)).fill('25')
    const r = await ok()
    check(
      Number(r.req?.params?.options?.groupPercent) === 25,
      `Item analysis: 25% groups sent (${JSON.stringify(r.req?.params?.options)})`
    )
    success(r, 'Item analysis')
    check(hasT(r, 'output.itemAnalysis.ulTitle'), 'Item analysis: upper-lower table')
    const ul = r.block?.result?.tables?.find(t => t.titleKey.startsWith('output.itemAnalysis.ul'))
    check(JSON.stringify(ul ?? {}).includes('25'), 'Item analysis: table reports the 25% groups')
  }

  // ── Harman ─────────────────────────────────────────────────────────────────
  {
    await open('menu:analyze:harman')
    await assign(0, items)
    const cb = dlg().getByLabel(T('analysis:harman.cfaOption'))
    if (!(await cb.isChecked())) await cb.check()
    const r = await ok()
    check(r.req?.params?.options?.cfa === true, 'Harman: one-factor CFA requested')
    success(r, 'Harman')
    check(
      hasT(r, 'output.harman.varTitle') && hasT(r, 'output.harman.cfaTitle'),
      'Harman: variance + CFA tables'
    )
  }

  // ── Test-Retest ────────────────────────────────────────────────────────────
  {
    await open('menu:analyze:test-retest')
    await assign(0, ['t1'])
    await assign(1, ['t2'])
    await selectIn(dlg(), 'random').selectOption('random')
    await selectIn(dlg(), 'consistency').selectOption('consistency')
    const r = await ok()
    const p = r.req?.params ?? {}
    check(
      same(p.first ?? [], [c.t1]) && same(p.second ?? [], [c.t2]),
      'Test-retest: t1 / t2 in the right boxes'
    )
    check(
      p.options?.iccModel === 'random' && p.options?.iccType === 'consistency',
      `Test-retest: ICC options sent (${JSON.stringify(p.options)})`
    )
    success(r, 'Test-retest')
    check(hasT(r, 'output.retest.relTitle'), 'Test-retest: reliability table')
  }

  // ── Lawshe ─────────────────────────────────────────────────────────────────
  {
    await open('menu:analyze:lawshe')
    await assign(0, ['e1', 'e2', 'e3'])
    await selectIn(dlg(), 'lawshe').selectOption('lawshe')
    const r = await ok()
    const p = r.req?.params ?? {}
    check(
      p.options?.criterion === 'lawshe' && Number(p.options?.essential) === 1,
      `Lawshe: Lawshe table + essential=1 sent (${JSON.stringify(p.options)})`
    )
    success(r, 'Lawshe')
    const it = r.block?.result?.tables?.find(t => t.titleKey.startsWith('output.lawshe.itemTitle'))
    check(it && it.rows.length === 3, 'Lawshe: one row per item')
  }

  // ── DoE: every design, Create → fill → Analyze ─────────────────────────────
  let seedNoise = 99
  const noise = () => {
    seedNoise = (seedNoise * 1103515245 + 12345) & 0x7fffffff
    const u = seedNoise / 0x7fffffff
    seedNoise = (seedNoise * 1103515245 + 12345) & 0x7fffffff
    const v = seedNoise / 0x7fffffff
    return Math.sqrt(-2 * Math.log(u + 1e-12)) * Math.cos(2 * Math.PI * v)
  }
  const createDesign = async ({ design, nFactors, factors = [], reps, blocked }) => {
    await win.evaluate(() => {
      window.__SAI_TEST__.useDatasetStore.setState({ isModified: false })
    })
    await open('menu:analyze:doe-create')
    const d = dlg()
    await d.getByLabel(T('analysis:doe.designLabel')).selectOption(design)
    if (nFactors) await d.getByLabel(T('analysis:doe.nFactors')).fill(String(nFactors))
    for (const [i, f] of factors.entries()) {
      if (f.name) await d.getByLabel(T('analysis:doe.factorName', { n: i + 1 })).fill(f.name)
      if (f.levels) await d.getByLabel(T('analysis:doe.factorLevels', { n: i + 1 })).fill(f.levels)
    }
    if (blocked) await d.getByLabel(T('analysis:doe.blockedOption')).check()
    if (reps != null) {
      const key =
        design === 'rcbd' || design === 'splitplot' || blocked
          ? 'analysis:doe.blocks'
          : 'analysis:doe.replicates'
      await d.getByLabel(T(key)).fill(String(reps))
    }
    await d.getByLabel(T('analysis:doe.seed')).fill('2026')
    const btn = d.locator('button', { hasText: T('common:common.ok') }).last()
    if (!(await btn.isEnabled())) {
      const msg = await d.textContent()
      await win.keyboard.press('Escape')
      return { error: `OK disabled: ${msg?.slice(-120)}` }
    }
    await btn.click()
    await win.waitForTimeout(1500)
    return win.evaluate(async () => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      const all = await window.api.data.getAll({ datasetId: s.datasetId })
      return {
        names: s.variables.map(v => v.name),
        ids: s.variables.map(v => v.colId),
        rows: all.rows,
        labels: Object.fromEntries(s.variables.map(v => [v.name, v.valueLabels ?? {}]))
      }
    })
  }
  /** Fill the Response column from the factor codes (true effects + noise). */
  const fillResponse = async (ds, f) => {
    const ix = n => ds.names.indexOf(n)
    const ri = ix('Response')
    const updates = ds.rows.map((row, i) => ({
      rowIndex: i,
      colId: ds.ids[ri],
      value: Math.round((f(n => Number(row[ix(n)])) + noise()) * 100) / 100
    }))
    await win.evaluate(async u => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      await window.api.data.updateCells({ datasetId: s.datasetId, updates: u })
      s.bumpDataVersion()
    }, updates)
    await win.waitForTimeout(600)
    const filled = await win.evaluate(async () => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      return (await window.api.data.getAll({ datasetId: s.datasetId })).rows
    })
    return filled.every(r => typeof r[ri] === 'number')
  }
  const analyze = async (design, roles, comparison) => {
    await open('menu:analyze:doe-analyze')
    const d = dlg()
    await selectIn(d, 'splitplot').selectOption(design)
    if (comparison) await selectIn(d, 'duncan').selectOption(comparison)
    await win.waitForTimeout(200)
    for (const [i, names] of roles.entries()) await assign(i, names)
    return ok()
  }

  const designs = [
    {
      label: 'CRD',
      spec: { design: 'crd', reps: 4 },
      rows: 16,
      cols: ['Plot', 'Treatment', 'Response'],
      y: v => 10 + 2 * v('Treatment'),
      roles: [['Response'], ['Treatment']],
      comparison: 'tukey'
    },
    {
      label: 'RCBD',
      spec: { design: 'rcbd', reps: 4 },
      rows: 16,
      cols: ['Plot', 'Block', 'Treatment', 'Response'],
      y: v => 10 + 2 * v('Treatment') + v('Block'),
      roles: [['Response'], ['Treatment'], ['Block']],
      comparison: 'duncan'
    },
    {
      label: 'Latin square',
      spec: { design: 'latin' },
      rows: 16,
      cols: ['Plot', 'Row', 'Column', 'Treatment', 'Response'],
      y: v => 10 + 2 * v('Treatment') + 0.5 * v('Row'),
      roles: [['Response'], ['Treatment'], ['Row'], ['Column']],
      comparison: 'lsd'
    },
    {
      label: 'Factorial in blocks',
      spec: {
        design: 'factorial',
        nFactors: 2,
        factors: [
          { name: 'Fert', levels: 'N0, N1, N2' },
          { name: 'Var', levels: 'V1, V2' }
        ],
        reps: 3,
        blocked: true
      },
      rows: 18,
      cols: ['Plot', 'Block', 'Fert', 'Var', 'Response'],
      y: v => 10 + 2 * v('Fert') + 1.5 * v('Var') + 0.3 * v('Block'),
      roles: [['Response'], ['Fert', 'Var'], ['Block']],
      comparison: 'snk'
    },
    {
      label: 'Split-plot',
      spec: {
        design: 'splitplot',
        factors: [
          { name: 'Irr', levels: 'I1, I2, I3' },
          { name: 'Var', levels: 'V1, V2' }
        ],
        reps: 3
      },
      rows: 18,
      cols: ['Plot', 'Block', 'MainPlot', 'Irr', 'Var', 'Response'],
      y: v => 10 + 2 * v('Irr') + 1.5 * v('Var') + 0.5 * v('Block'),
      roles: [['Response'], ['Irr'], ['Var'], ['Block']],
      comparison: 'lsd'
    },
    {
      label: '2^3 replicated',
      spec: {
        design: 'twok',
        nFactors: 3,
        factors: [
          { name: 'A', levels: 'lo, hi' },
          { name: 'B', levels: 'lo, hi' },
          { name: 'C', levels: 'lo, hi' }
        ],
        reps: 2
      },
      rows: 16,
      cols: ['RunOrder', 'StdOrder', 'Replicate', 'A', 'B', 'C', 'Response'],
      y: v => 20 + 3 * v('A') + 2 * v('B') + v('A') * v('B'),
      roles: [['Response'], ['A', 'B', 'C']]
    },
    {
      label: '2^4 unreplicated (Lenth)',
      spec: {
        design: 'twok',
        nFactors: 4,
        factors: [
          { name: 'A', levels: 'lo, hi' },
          { name: 'B', levels: 'lo, hi' },
          { name: 'C', levels: 'lo, hi' },
          { name: 'D', levels: 'lo, hi' }
        ],
        reps: 1
      },
      rows: 16,
      cols: ['RunOrder', 'StdOrder', 'Replicate', 'A', 'B', 'C', 'D', 'Response'],
      y: v => 20 + 4 * v('A') + 3 * v('C') + 2 * v('A') * v('C'),
      roles: [['Response'], ['A', 'B', 'C', 'D']]
    }
  ]

  for (const D of designs) {
    const ds = await createDesign(D.spec)
    if (ds.error) {
      check(false, `${D.label}: ${ds.error}`)
      continue
    }
    check(
      D.cols.every(n => ds.names.includes(n)) && ds.rows.length === D.rows,
      `${D.label}: design created (${ds.names.join(',')}; ${String(ds.rows.length)} rows)`
    )
    const factorName = D.roles[1][0]
    check(
      Object.keys(ds.labels[factorName] ?? {}).length >= 2,
      `${D.label}: ${factorName} carries level labels`
    )
    check(await fillResponse(ds, D.y), `${D.label}: response filled`)
    const r = await analyze(D.spec.design, D.roles, D.comparison)
    const p = r.req?.params ?? {}
    check(p.design === D.spec.design, `${D.label}: design sent (${p.design})`)
    if (D.comparison)
      check(
        p.options?.comparison === D.comparison,
        `${D.label}: ${D.comparison} comparison sent (${p.options?.comparison})`
      )
    success(r, D.label)
    if (D.spec.design === 'twok') {
      check(hasT(r, 'output.doe.effectsTitle'), `${D.label}: effects table`)
      check((r.block?.result?.plots ?? []).length >= 1, `${D.label}: Pareto chart`)
      // The true model: A and C (2^4) / A and B (2^3) dominate.
      const eff = r.block?.result?.tables?.find(t => t.titleKey.startsWith('output.doe.effects'))
      check(eff && JSON.stringify(eff).includes('"A"'), `${D.label}: effect rows named by factor`)
    } else {
      check(hasT(r, 'output.doe.anovaTitle'), `${D.label}: ANOVA table`)
      check(hasT(r, 'output.doe.meansTitle'), `${D.label}: letter-group table`)
      const means = r.block?.result?.tables?.find(t => t.titleKey.startsWith('output.doe.means'))
      const firstLabel = Object.values(ds.labels[factorName] ?? {})[0]
      check(
        !!firstLabel && JSON.stringify(means ?? {}).includes(String(firstLabel)),
        `${D.label}: means shown with level labels (${String(firstLabel)})`
      )
    }
  }

  // ── Rendered output ────────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(2500)
  const dom = await win.evaluate(() => {
    const t = document.querySelector('[class*="content"]')?.textContent ?? ''
    return (t.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
  })
  check(dom.length === 0, `no raw keys in output (${dom.join(', ')})`)
  await win.screenshot({ path: path.join(ROOT, 'e2e-scale-doe-dialogs.png') })

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
