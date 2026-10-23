// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: SPSS syntax — complex scripts, end to end with real R and DuckDB.
 *
 * Each block below was a real bug found by the 2026-10-18 stress run:
 *   • `a TO d` ran on a and d only; SUM(a TO d) was #NUM!.
 *   • DO IF / ELSE IF / ELSE / END IF ran every COMPUTE on every case.
 *   • IF (grp = 'A') matched no case (single-quoted strings were #NAME?).
 *   • RECODE (SYSMIS=9) left missing cases missing.
 *   • COUNT read only its first value of its first variable group.
 *   • RENAME VARIABLES (a b = b a) reported a no-op as done.
 *   • SELECT IF (x > 10) AND (y < 3) was a syntax error.
 *   • FREQ / DESC were unknown commands.
 *   • DO REPEAT ran its body once, as if the block weren't there (then it
 *     was skipped whole; since 2026-10-21 it runs as SPSS's macro).
 * Plus what must keep working: sequential semantics (an analysis sees the data
 * as it was at its line), WEIGHT, and the hand-off to the R console both ways
 * (a COMPUTEd variable reaches R after Reload; sai_commit()'s dataset is
 * analysed by syntax).
 *
 * Requires a real Rscript.
 * Run: node tests/e2e/run-e2e.cjs e2e-terminal-syntax-complex   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

const N = 60
function makeCsv() {
  const lines = ['id,age,income,grp,sex,score1,score2,score3,score4,w']
  for (let i = 0; i < N; i++) {
    lines.push(
      [
        i + 1,
        20 + (i % 30),
        i % 7 === 0 ? '' : 1000 + i * 37,
        'ABC'[i % 3],
        i % 2 ? 'F' : 'M',
        i % 5,
        (i % 5) + 1,
        (i % 5) + 2,
        (i % 5) + 3,
        1 + (i % 3)
      ].join(',')
    )
  }
  const file = path.join(os.tmpdir(), 'sai-syntax-complex-e2e.csv')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

// The same rows in JS, to check the transforms against.
const ROWS = Array.from({ length: N }, (_, i) => ({
  id: i + 1,
  age: 20 + (i % 30),
  income: i % 7 === 0 ? null : 1000 + i * 37,
  grp: 'ABC'[i % 3],
  sex: i % 2 ? 'F' : 'M',
  score1: i % 5,
  score2: (i % 5) + 1,
  score3: (i % 5) + 2,
  w: 1 + (i % 3)
}))

async function main() {
  const csvPath = makeCsv()
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => console.log('[pageerror]', err.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
    dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false })
  })

  await win.evaluate(async filePath => {
    const r = await window.api.file.import({ filePath })
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
  }, csvPath)
  await win.evaluate(() => {
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal')
    window.__SAI_TEST__.useTerminalStore.getState().setMode('spss')
  })
  await win.waitForTimeout(800)

  const blockCount = () =>
    win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().blocks.length)

  /** Run syntax through the editor's Run button; waits for `blocks` new Output blocks. */
  const run = async (syntax, blocks = 0) => {
    const before = await blockCount()
    await win.evaluate(s => window.__SAI_TEST__.useTerminalStore.getState().setSource(s), syntax)
    await win.waitForTimeout(150)
    await win.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /^(Çalıştır|Run)( \(Ctrl\+Enter\))?$/.test((b.textContent || '').trim())
      )
      btn.click()
    })
    const end = Date.now() + 60000
    for (;;) {
      await win.waitForTimeout(300)
      const st = await win.evaluate(() => ({
        running: Array.from(document.querySelectorAll('button')).some(b =>
          /Çalışıyor|Running/.test(b.textContent || '')
        ),
        n: window.__SAI_TEST__.useOutputStore.getState().blocks.length
      }))
      if ((!st.running && st.n >= before + blocks) || Date.now() > end) break
    }
    // Newest-first: the blocks this run produced, oldest first.
    return win.evaluate(
      k =>
        window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks.slice(0, k)
          .reverse()
          .map(b => ({ id: b.analysisId, ok: b.result.success, tables: b.result.tables })),
      (await blockCount()) - before
    )
  }
  const data = names =>
    win.evaluate(async names => {
      const ds = window.__SAI_TEST__.useDatasetStore.getState()
      const all = await window.api.data.getAll({ datasetId: ds.datasetId })
      const vn = ds.variables.map(v => v.name)
      const out = {}
      for (const n of names) {
        const i = vn.indexOf(n)
        out[n] = i < 0 ? null : all.rows.map(r => r[i])
      }
      return out
    }, names)
  const varNames = () =>
    win.evaluate(() => window.__SAI_TEST__.useDatasetStore.getState().variables.map(v => v.name))
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const checks = {}

  // ── TO lists ──
  let b = await run('DESCRIPTIVES VARIABLES=score1 TO score4.', 1)
  const descRows = b[0]?.tables[0]?.rows.map(r => r[0]) ?? []
  console.log('TO:', JSON.stringify(descRows))
  checks.toList = same(descRows.slice(0, 4), ['score1', 'score2', 'score3', 'score4'])
  await run('COMPUTE tot = SUM(score1 TO score3).')
  let d = await data(['tot'])
  checks.toInSum = same(
    d.tot,
    ROWS.map(r => r.score1 + r.score2 + r.score3)
  )

  // ── DO IF / ELSE IF / ELSE, string conditions ──
  await run(
    [
      "DO IF (grp = 'A').",
      '  COMPUTE band = 1.',
      "ELSE IF (sex = 'F' AND age > 30).",
      '  COMPUTE band = 2.',
      'ELSE.',
      '  COMPUTE band = 3.',
      'END IF.'
    ].join('\n')
  )
  d = await data(['band'])
  const wantBand = ROWS.map(r => (r.grp === 'A' ? 1 : r.sex === 'F' && r.age > 30 ? 2 : 3))
  checks.doIf = same(d.band, wantBand)

  await run("IF (grp = 'B') bonus = 100.")
  d = await data(['bonus'])
  checks.ifString = same(
    d.bonus,
    ROWS.map(r => (r.grp === 'B' ? 100 : null))
  )

  // ── DO REPEAT runs as a macro (2026-10-21; it used to be skipped whole) ──
  // Writes new variables only, so the checks below still see the fixture.
  await run('DO REPEAT x = r1 r2 / v = score1 score2.\nCOMPUTE x = v * 2.\nEND REPEAT.')
  d = await data(['r1', 'r2'])
  const repeatNames = await varNames()
  checks.repeatRuns =
    !repeatNames.includes('x') &&
    !repeatNames.includes('v') &&
    same(
      d.r1,
      ROWS.map(r => (r.score1 === null ? null : r.score1 * 2))
    ) &&
    same(
      d.r2,
      ROWS.map(r => (r.score2 === null ? null : r.score2 * 2))
    )

  // ── RECODE with SYSMIS ──
  await run('RECODE income (SYSMIS=9) (LO THRU 2000=1) (ELSE=2) INTO incCat.')
  d = await data(['incCat'])
  checks.recodeSysmis = same(
    d.incCat,
    ROWS.map(r => (r.income === null ? 9 : r.income <= 2000 ? 1 : 2))
  )

  // ── COUNT, several groups ──
  await run('COUNT nz = score1 score2 (0 1) score3 (3 THRU 4) income (SYSMIS).')
  d = await data(['nz'])
  checks.count = same(
    d.nz,
    ROWS.map(
      r =>
        [r.score1, r.score2].filter(v => v === 0 || v === 1).length +
        (r.score3 >= 3 && r.score3 <= 4 ? 1 : 0) +
        (r.income === null ? 1 : 0)
    )
  )

  // ── RENAME list form swaps ──
  // [colId of score1, colId of score2]
  const scoreCols = () =>
    win.evaluate(() => {
      const vs = window.__SAI_TEST__.useDatasetStore.getState().variables
      return ['score1', 'score2'].map(n => vs.find(v => v.name === n)?.colId)
    })
  const colsBefore = await scoreCols()
  await run('RENAME VARIABLES (score1 score2 = score2 score1).')
  checks.renameSwap = same(await scoreCols(), [colsBefore[1], colsBefore[0]])
  // Swap back so the names below mean what they did.
  await run('RENAME VARIABLES (score1 score2 = score2 score1).')

  // ── SELECT IF with parenthesised clauses, then FILTER OFF ──
  b = await run('SELECT IF (id > 10) AND (score1 < 3).\nDESCRIPTIVES VARIABLES=id.\nFILTER OFF.', 1)
  const nSel = b[0]?.tables[0]?.rows[0]?.[1]
  const wantSel = ROWS.filter(r => r.id > 10 && r.score1 < 3).length
  console.log('select N:', nSel, 'want', wantSel)
  checks.selectIf = nSel === wantSel
  const filters = await win.evaluate(
    () => window.__SAI_TEST__.useDatasetStore.getState().columnFilters
  )
  checks.filterOff = Object.keys(filters).length === 0

  // ── Abbreviations ──
  b = await run('FREQ VARIABLES=grp.\nDESC VARIABLES=age.', 2)
  checks.abbrev = same(
    b.map(x => x.id),
    ['frequencies', 'descriptives']
  )

  // ── Sequential semantics: each analysis sees the data at its own line ──
  b = await run(
    'COMPUTE age2 = age.\nDESCRIPTIVES VARIABLES=age2.\nRECODE age2 (LO THRU HI=1).\nDESCRIPTIVES VARIABLES=age2.',
    2
  )
  const means = b.map(x => x.tables[0]?.rows[0]?.[2])
  console.log('sequential means:', JSON.stringify(means))
  checks.sequential = means[0] === 34.5 && means[1] === 1

  // ── WEIGHT ──
  b = await run(
    'WEIGHT BY w.\nFREQUENCIES VARIABLES=grp.\nWEIGHT OFF.\nFREQUENCIES VARIABLES=grp.',
    2
  )
  const counts = b.map(x =>
    x.tables
      .find(t => /tableTitle/.test(t.titleKey))
      ?.rows.slice(0, 3)
      .map(r => r[1])
  )
  console.log('weighted/unweighted:', JSON.stringify(counts))
  checks.weight = same(counts, [
    [20, 40, 60],
    [20, 20, 20]
  ])

  // ── Into R: a COMPUTEd variable reaches `data` after Reload ──
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setMode('r'))
  const waitR = async ms => {
    const end = Date.now() + ms
    for (;;) {
      const s = await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().rStatus)
      if (s === 'idle') return true
      if (Date.now() > end) return false
      await win.waitForTimeout(200)
    }
  }
  await waitR(40000)
  const rOut = async code => {
    await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().clearROutput())
    await win.evaluate(c => window.api.terminal.rWrite({ code: c }), code)
    await win.waitForTimeout(300)
    await waitR(15000)
    await win.waitForTimeout(300)
    return win.evaluate(() =>
      window.__SAI_TEST__.useTerminalStore
        .getState()
        .rOutput.map(c => c.text)
        .join('')
    )
  }
  const datasetId = await win.evaluate(
    () => window.__SAI_TEST__.useDatasetStore.getState().datasetId
  )
  await win.evaluate(id => window.api.terminal.rReloadData({ datasetId: id }), datasetId)
  await waitR(15000)
  const fromR = await rOut('cat("BAND", table(data$band), "\\n")')
  console.log('R sees:', fromR.trim())
  const bandCounts = [1, 2, 3].map(k => wantBand.filter(x => x === k).length).join(' ')
  checks.rSeesCompute = fromR.includes(`BAND ${bandCounts}`)

  // ── Back from R: sai_commit()'s dataset is analysed by syntax ──
  await rOut('sai_commit(data.frame(k = c(1, 1, 2, 3, 3, 3)), "from_r")')
  const committed = await win.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      if (window.__SAI_TEST__.useDatasetStore.getState().datasetName === 'from_r') return true
      await new Promise(r => setTimeout(r, 200))
    }
    return false
  })
  checks.committed = committed
  await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setMode('spss'))
  await win.waitForTimeout(500)
  b = await run('FREQUENCIES VARIABLES=k.', 1)
  const kRows = b[0]?.tables
    .find(t => /tableTitle/.test(t.titleKey))
    ?.rows.slice(0, 3)
    .map(r => r[1])
  console.log('k counts:', JSON.stringify(kRows))
  checks.syntaxOnCommitted = same(kRows, [2, 1, 3])

  console.log('checks:', JSON.stringify(checks))
  await app.close()
  if (!Object.values(checks).every(Boolean)) {
    console.error('E2E FAILED — see checks above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
