// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Confirmatory Factor Analysis, end to end through real lavaan runs —
 *   1. an exploratory Factor Analysis run leaves a pattern matrix in Output;
 *   2. Analyze › Dimension Reduction › Confirmatory Factor Analysis opens the
 *      dialog, "Import from exploratory factor analysis" fills two factor
 *      boxes from it, and OK sends a two-factor model (3 + 3 items);
 *   3. that run (auto estimator → WLSMV for 5-point items) renders fit
 *      indices, loadings, reliability, Fornell-Larcker, HTMT and the SVG
 *      path diagram;
 *   4. a run with a grouping variable adds the measurement invariance table.
 * No raw output.* key may leak into the DOM.
 *
 * Needs no external fixture: a synthetic CSV is written here.
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CSV = path.join(os.tmpdir(), 'sai-cfa.csv')
const N = 400

function writeFixture() {
  let seed = 20261111
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const norm = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
  const likert = v => String(v < -1 ? 1 : v < -0.3 ? 2 : v < 0.3 ? 3 : v < 1 ? 4 : 5)
  const lines = ['a1,a2,a3,b1,b2,b3,grp']
  for (let r = 0; r < N; r++) {
    const f1 = norm()
    const f2 = 0.4 * f1 + 0.9 * norm()
    const items = [f1, f1, f1, f2, f2, f2].map(f => likert(f + norm() * 0.7))
    lines.push([...items, r % 2 === 0 ? 'A' : 'B'].join(','))
  }
  fs.writeFileSync(CSV, lines.join('\n') + '\n')
}

async function main() {
  writeFixture()
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
  await win.waitForTimeout(1000)
  const col = await win.evaluate(() => {
    const vs = window.__SAI_TEST__.useDatasetStore.getState().variables ?? []
    return Object.fromEntries(vs.map(v => [v.name, v.colId]))
  })
  const blockIds = () =>
    win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().blocks.map(b => b.id))
  const waitBlock = async before => {
    const t0 = Date.now()
    for (;;) {
      const b = await win.evaluate(ids => {
        const fresh = window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.find(x => !ids.includes(x.id))
        return fresh && !fresh.running
          ? { analysisId: fresh.analysisId, error: fresh.error ?? null, result: fresh.result }
          : null
      }, before)
      if (b) return b
      if (Date.now() - t0 > 180000) return null
      await win.waitForTimeout(400)
    }
  }
  const run = async (analysisId, scriptFile, params) => {
    const before = await blockIds()
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
    return waitBlock(before)
  }
  const titles = b => (b?.result?.tables ?? []).map(t => t.titleKey.split(':')[0])
  const items = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']

  // ── 1. EFA first ─────────────────────────────────────────────────────────
  const efa = await run('factor', 'factor.R', {
    variables: items.map(n => col[n]),
    varNames: Object.fromEntries(items.map(n => [col[n], n])),
    options: { extraction: 'paf', criterion: 'fixed', nFactors: 2, rotation: 'promax' }
  })
  check(efa && !efa.error && efa.result?.success, `EFA run succeeded (${efa?.error ?? ''})`)

  // ── 2. Dialog: import from EFA, OK ───────────────────────────────────────
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:analyze:cfa')
  })
  await win.waitForTimeout(800)
  const importBtn = win.locator('button', {
    hasText: /^(Import from exploratory factor analysis|Açımlayıcı faktör analizinden aktar)$/
  })
  check((await importBtn.count()) === 1, 'Import from EFA button')
  check(await importBtn.isEnabled(), 'Import button enabled after an EFA run')
  await importBtn.click()
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-cfa-dialog.png') })
  await win.evaluate(() => {
    window.__SAI_RUNS__ = []
  })
  const before = await blockIds()
  await win
    .locator('button', { hasText: /^(OK|Tamam)$/ })
    .last()
    .click()
  const cfa = await waitBlock(before)
  const req = await win.evaluate(() => window.__SAI_RUNS__?.[0] ?? null)
  const factors = req?.params?.factors ?? []
  check(factors.length === 2, `dialog sent two factors (${String(factors.length)})`)
  const sets = factors.map(f => f.items.slice().sort().join(','))
  const want = [
    [col.a1, col.a2, col.a3].sort().join(','),
    [col.b1, col.b2, col.b3].sort().join(',')
  ]
  check(
    want.every(w => sets.includes(w)),
    'imported assignment matches the simulated structure'
  )
  check(cfa?.analysisId === 'cfa', 'CFA block created')
  check(cfa && !cfa.error && cfa.result?.success, `CFA run succeeded (${cfa?.error ?? ''})`)
  const ct = titles(cfa)
  for (const k of [
    'output.cfa.specTitle',
    'output.cfa.summaryTitle',
    'output.cfa.fitTitle',
    'output.cfa.loadingsTitle',
    'output.cfa.reliabilityTitle',
    'output.cfa.fornellTitle',
    'output.cfa.htmtTitle'
  ]) {
    check(ct.includes(k), `CFA table ${k}`)
  }
  check(
    (cfa?.result?.notes ?? []).includes('output.cfa.estimatorAuto:WLSMV'),
    'auto estimator chose WLSMV for 5-point items'
  )
  check((cfa?.result?.plots ?? [])[0]?.type === 'svg', 'SVG path diagram')

  // ── 3. Invariance run ───────────────────────────────────────────────────
  const inv = await run('cfa', 'cfa.R', {
    variables: items.map(n => col[n]),
    varNames: Object.fromEntries(items.map(n => [col[n], n])),
    factors: [
      { name: 'A', items: ['a1', 'a2', 'a3'].map(n => col[n]) },
      { name: 'B', items: ['b1', 'b2', 'b3'].map(n => col[n]) }
    ],
    groupVar: col.grp,
    groupName: 'grp',
    options: { estimator: 'mlr', mi: true }
  })
  check(inv && !inv.error && inv.result?.success, `invariance run succeeded (${inv?.error ?? ''})`)
  const invT = inv?.result?.tables?.find(t => t.titleKey.startsWith('output.cfa.invTitle'))
  check(invT && invT.rows.length === 4, 'invariance table with four steps')
  check(titles(inv).includes('output.cfa.miTitle'), 'modification indices table')

  // ── Rendered output ─────────────────────────────────────────────────────
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('output')
  })
  await win.waitForTimeout(2000)
  const dom = await win.evaluate(() => {
    const text = document.querySelector('[class*="content"]')?.textContent ?? ''
    return {
      leaks: (text.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10),
      fit: /Fit Indices|Uyum İndeksleri/.test(text),
      svg: Array.from(document.querySelectorAll('img')).filter(i =>
        i.getAttribute('src')?.startsWith('data:image/svg+xml')
      ).length
    }
  })
  check(dom.leaks.length === 0, `no raw keys in output (${dom.leaks.join(', ')})`)
  check(dom.fit, 'fit table rendered with a translated title')
  check(dom.svg >= 1, `path diagram rendered (${String(dom.svg)})`)
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'e2e-cfa-output.png') })

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
