// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: creating new dataset variables from an analysis (roadmap ★11).
 *
 * This is the one test that exercises the WHOLE chain the feature is made of —
 * dialog params -> R -> AnalysisResult.caseVars -> transform:create-variables
 * -> DuckDB ALTER TABLE -> variable list -> Data View — because every layer in
 * between is where an alignment mistake would hide.
 *
 * What it proves, in order of how badly it would hurt to get wrong:
 *   1. ALIGNMENT. The fixture has holes in the covariate, so a Cox run drops
 *      those cases. The created column must be empty on exactly those rows and
 *      populated on the others. A column that is merely "full of plausible
 *      numbers" is the failure mode this feature can produce silently.
 *   2. It is a real dataset column: it appears in the variable list, holds the
 *      values R computed, and reading the cells back through the data IPC
 *      returns them.
 *   3. It is UNDOABLE and nothing was written to disk — the whole point of not
 *      calling this "Save".
 *   4. Name collisions are refused rather than half-applied.
 *
 * Needs no external fixture: the CSV is written here.
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CSV = path.join(os.tmpdir(), 'sai-newvars.csv')
const N = 60
// Rows whose covariate is blank — Cox drops them listwise, so they must end up
// with an EMPTY cell in every created column.
const HOLES = new Set([2, 11, 40])

function writeFixture() {
  let seed = 20260814
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const lines = ['id,surv,evt,x,grp']
  for (let i = 0; i < N; i++) {
    const xv = rnd() * 2 - 1
    const x = xv.toFixed(4)
    const t = (0.4 + rnd() * 20).toFixed(3)
    const e = rnd() < 0.8 ? 1 : 0
    // A three-level ordered outcome the ordinal/multinomial/tree runs can bite
    // on. It follows x but not perfectly — a deterministic mapping would give
    // polr separation and rpart a single trivial split, which tests nothing.
    const z = xv + (rnd() * 2 - 1) * 0.8
    const g = z < -0.4 ? '1' : z < 0.4 ? '2' : '3'
    lines.push(`${String(i + 1)},${t},${String(e)},${HOLES.has(i) ? '' : x},${g}`)
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

  // Import through the real IPC + store mount, same as the other e2e scripts.
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

  const before = await win.evaluate(() => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    return { names: (ds.variables ?? []).map(v => v.name), modified: Boolean(ds.isModified) }
  })
  check(
    before.names.join(',') === 'id,surv,evt,x,grp',
    `fixture mounted (${before.names.join(',')})`
  )
  check(!before.modified, 'dataset starts unmodified')

  // ── Run Cox asking for two new variables ────────────────────────────────
  const runCox = async createVars => {
    const colOf = await win.evaluate(() => {
      const vs = window.__SAI_TEST__.useDatasetStore.getState().variables ?? []
      return Object.fromEntries(vs.map(v => [v.name, v.colId]))
    })
    const before = await win.evaluate(
      () => window.__SAI_TEST__.useOutputStore.getState().blocks[0]?.id ?? null
    )
    await win.evaluate(
      async ([cols, cv]) => {
        const ds = window.__SAI_TEST__.useDatasetStore.getState()
        await window.api.analysis.run({
          analysisId: 'survivalCox',
          datasetId: ds.datasetId,
          scriptFile: 'survival-cox.R',
          params: {
            timeVar: cols['surv'],
            statusVar: cols['evt'],
            eventValue: '1',
            covariates: [cols['x']],
            varNames: { [cols['x']]: 'x' },
            createVars: cv
          }
        })
      },
      [colOf, createVars]
    )
    const t0 = Date.now()
    for (;;) {
      const b = await win.evaluate(() => {
        const b0 = window.__SAI_TEST__.useOutputStore.getState().blocks[0]
        return b0
          ? {
              id: b0.id,
              running: Boolean(b0.running),
              error: b0.error ?? null,
              analysisId: b0.analysisId,
              result: b0.result
            }
          : null
      })
      if (b && b.id !== before && !b.running) return b
      if (Date.now() - t0 > 90000) return null
      await win.waitForTimeout(400)
    }
  }

  const block = await runCox({ xbeta: 'risk', survival: 'sur' })
  // Not just "a block appeared": a failed run also produces one, and every
  // assertion below would then be quietly testing an empty dataset.
  check(
    Boolean(block) && block.error === null && block.analysisId !== 'error',
    `Cox run produced a SUCCESSFUL output block (${block ? String(block.error ?? block.analysisId) : 'none'})`
  )

  const after = await win.evaluate(() => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    return {
      names: (ds.variables ?? []).map(v => v.name),
      labels: Object.fromEntries((ds.variables ?? []).map(v => [v.name, v.label])),
      roles: Object.fromEntries((ds.variables ?? []).map(v => [v.name, v.role])),
      modified: Boolean(ds.isModified)
    }
  })
  check(
    after.names.includes('risk') && after.names.includes('sur'),
    `columns created (${after.names.join(',')})`
  )
  check(after.modified, 'dataset is marked modified (but NOT saved)')
  // §6: R sends the label as an i18n key; it must arrive as real text.
  check(
    typeof after.labels['risk'] === 'string' &&
      after.labels['risk'] !== '' &&
      !after.labels['risk'].startsWith('output.'),
    `label was translated, not left as a key ("${String(after.labels['risk'])}")`
  )
  check(after.roles['risk'] === 'none', 'created column is not offered as a model input by default')

  // ── The alignment check ─────────────────────────────────────────────────
  const cells = await win.evaluate(async () => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    const slice = await window.api.data.getAll({ datasetId: ds.datasetId })
    const vars = ds.variables ?? []
    const idx = Object.fromEntries(vars.map((v, i) => [v.name, i]))
    return slice.rows.map(r => ({
      x: r[idx['x']],
      risk: r[idx['risk']],
      sur: r[idx['sur']]
    }))
  })

  const isEmpty = v => v === null || v === undefined || v === ''
  const holeRows = [...HOLES]
  const emptyWhereExpected = holeRows.every(i => isEmpty(cells[i].risk) && isEmpty(cells[i].sur))
  const filledElsewhere = cells.every((c, i) => (HOLES.has(i) ? true : !isEmpty(c.risk)))
  check(emptyWhereExpected, `dropped cases have an EMPTY value (rows ${holeRows.join(',')})`)
  check(filledElsewhere, 'every case the model used has a value')
  // The dropped rows are also empty in the SOURCE column — if that were not
  // true the alignment check above would be testing nothing.
  check(
    holeRows.every(i => isEmpty(cells[i].x)),
    'the fixture really does have holes in the covariate'
  )
  // Survival is a probability; a mis-joined column would show this immediately.
  const surs = cells.filter((c, i) => !HOLES.has(i)).map(c => Number(c.sur))
  check(
    surs.every(v => v >= 0 && v <= 1),
    `every S(t) is a probability (min ${String(Math.min(...surs))}, max ${String(Math.max(...surs))})`
  )
  // XBeta must vary WITH the covariate — the single strongest signal that the
  // values landed on the right rows rather than being shuffled.
  const pairs = cells.filter((c, i) => !HOLES.has(i)).map(c => [Number(c.x), Number(c.risk)])
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length
  const cov = pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0)
  const sx = Math.sqrt(pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0))
  const sy = Math.sqrt(pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0))
  const r = cov / (sx * sy)
  check(Math.abs(r) > 0.999, `XBeta is collinear with its covariate (|r| = ${r.toFixed(6)})`)

  // ── Undoable, like any other transform ──────────────────────────────────
  const undone = await win.evaluate(async () => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    const res = await window.api.data.undo({ datasetId: ds.datasetId })
    return (res.variables ?? []).map(v => v.name)
  })
  check(
    !undone.includes('risk') && !undone.includes('sur'),
    `Ctrl+Z removes the created columns (${undone.join(',')})`
  )
  await win.evaluate(async () => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    const res = await window.api.data.redo({ datasetId: ds.datasetId })
    ds.setVariables(res.variables)
  })

  // ── A colliding name is refused, and refused WHOLE ───────────────────────
  const block2 = await runCox({ xbeta: 'risk', survival: 'sur2' })
  const names2 = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => v.name)
  )
  const warned = (block2?.result?.warnings ?? []).some(w => String(w).startsWith('output.newVars.'))
  check(warned, 'a colliding name produces a visible warning')
  check(
    !names2.includes('sur2'),
    `the batch is rejected as a whole, not half-applied (${names2.join(',')})`
  )

  // ── Every other wired analysis, through the same one write path ─────────
  // Cox above proves the chain in depth. These prove BREADTH: each analysis
  // declares its own slots, and the point of the shared handler is that none
  // of them needs write code of its own. A per-analysis regression would show
  // up here as a missing column rather than as a wrong number.
  const runAnalysis = async (analysisId, scriptFile, buildParams) => {
    const colOf = await win.evaluate(() => {
      const vs = window.__SAI_TEST__.useDatasetStore.getState().variables ?? []
      return Object.fromEntries(vs.map(v => [v.name, v.colId]))
    })
    const prev = await win.evaluate(
      () => window.__SAI_TEST__.useOutputStore.getState().blocks[0]?.id ?? null
    )
    await win.evaluate(
      async ([id, file, params]) => {
        const ds = window.__SAI_TEST__.useDatasetStore.getState()
        await window.api.analysis.run({
          analysisId: id,
          datasetId: ds.datasetId,
          scriptFile: file,
          params
        })
      },
      [analysisId, scriptFile, buildParams(colOf)]
    )
    const t0 = Date.now()
    for (;;) {
      const b = await win.evaluate(() => {
        const b0 = window.__SAI_TEST__.useOutputStore.getState().blocks[0]
        return b0
          ? { id: b0.id, running: Boolean(b0.running), error: b0.error ?? null, aid: b0.analysisId }
          : null
      })
      if (b && b.id !== prev && !b.running) return b
      if (Date.now() - t0 > 90000) return null
      await win.waitForTimeout(400)
    }
  }

  const breadth = [
    {
      id: 'regression',
      file: 'regression-linear.R',
      wants: ['reg_pre', 'reg_res', 'reg_coo'],
      params: c => ({
        dependent: c['surv'],
        independents: [c['x']],
        varNames: { [c['surv']]: 'surv', [c['x']]: 'x' },
        createVars: { predicted: 'reg_pre', residual: 'reg_res', cooks: 'reg_coo' }
      })
    },
    {
      id: 'logistic',
      file: 'regression-logistic.R',
      wants: ['log_p', 'log_grp'],
      params: c => ({
        dependent: c['evt'],
        covariates: [c['x']],
        varNames: { [c['evt']]: 'evt', [c['x']]: 'x' },
        createVars: { probability: 'log_p', predictedGroup: 'log_grp' }
      })
    },
    {
      id: 'kmeans',
      file: 'kmeans.R',
      wants: ['cl', 'cl_d'],
      params: c => ({
        variables: [c['x'], c['surv']],
        varNames: { [c['x']]: 'x', [c['surv']]: 'surv' },
        clusters: 2,
        createVars: { cluster: 'cl', distance: 'cl_d' }
      })
    },
    {
      // Was NOT in this list on the first pass, and that is exactly why adding
      // __row_idx to its model frame — where `lda(.g ~ .)` turned the row
      // number into a predictor — got through to the reference suite instead
      // of being caught here.
      id: 'discriminant',
      file: 'discriminant.R',
      wants: ['dis_pred', 'dis1'],
      params: c => ({
        groupVar: c['evt'],
        independents: [c['x'], c['surv']],
        varNames: { [c['x']]: 'x', [c['surv']]: 'surv' },
        createVars: { predictedGroup: 'dis_pred', score1: 'dis1' }
      })
    },
    {
      id: 'factor',
      file: 'factor.R',
      wants: ['fac1'],
      params: c => ({
        variables: [c['x'], c['surv'], c['evt']],
        varNames: { [c['x']]: 'x', [c['surv']]: 'surv', [c['evt']]: 'evt' },
        options: { rotation: 'none' },
        createVars: { score1: 'fac1' }
      })
    },
    // The four scripts that had to give up `y ~ .` before they could carry the
    // row index. If one of them ever gets the dot formula back, __row_idx
    // becomes a predictor and the run either errors or silently fits the wrong
    // model — either way the column below goes missing.
    {
      id: 'ordinal',
      file: 'regression-ordinal.R',
      wants: ['ord_grp', 'ord_p'],
      params: c => ({
        dependent: c['grp'],
        covariates: [c['x']],
        varNames: { [c['grp']]: 'grp', [c['x']]: 'x' },
        createVars: { predictedGroup: 'ord_grp', probability: 'ord_p' }
      })
    },
    {
      id: 'multinom',
      file: 'regression-multinomial.R',
      wants: ['mn_grp', 'mn_p'],
      params: c => ({
        dependent: c['grp'],
        covariates: [c['x']],
        varNames: { [c['grp']]: 'grp', [c['x']]: 'x' },
        createVars: { predictedGroup: 'mn_grp', probability: 'mn_p' }
      })
    },
    {
      id: 'probit',
      file: 'regression-probit.R',
      // SPSS-style GROUPED dose-response probit (responseFreq / totalObserved,
      // no predicted group). evt (0/1) as successes over grp (1–3) as trials
      // keeps freq <= total on every row — this test exercises the shared
      // new-variable write path, not the probit estimates themselves.
      wants: ['pb_p', 'pb_exp', 'pb_res'],
      params: c => ({
        responseFreq: c['evt'],
        totalObserved: c['grp'],
        covariates: [c['x']],
        varNames: { [c['evt']]: 'evt', [c['grp']]: 'grp', [c['x']]: 'x' },
        createVars: { probability: 'pb_p', expected: 'pb_exp', residual: 'pb_res' }
      })
    },
    {
      id: 'tree',
      file: 'tree.R',
      wants: ['tr_grp', 'tr_p', 'tr_node'],
      params: c => ({
        groupVar: c['grp'],
        independents: [c['x'], c['surv']],
        varNames: { [c['x']]: 'x', [c['surv']]: 'surv' },
        options: { minCases: 5, maxDepth: 3 },
        createVars: { predictedGroup: 'tr_grp', probability: 'tr_p', node: 'tr_node' }
      })
    },
    {
      // Membership is written only when a cut is actually chosen — `clusters`
      // below is what makes this produce a column at all.
      id: 'hier',
      file: 'hierarchical.R',
      wants: ['hc'],
      params: c => ({
        variables: [c['x'], c['surv']],
        varNames: { [c['x']]: 'x', [c['surv']]: 'surv' },
        method: 'ward.D2',
        clusters: 3,
        createVars: { cluster: 'hc' }
      })
    },
    {
      // The per-coefficient slots: one typed name becomes N columns. Getting
      // the count wrong is the plausible failure — the intercept counts for
      // DfBeta (3 columns for 2 predictors) but not for partial residuals (2).
      id: 'regression-stems',
      file: 'regression-linear.R',
      wants: ['dfb1', 'dfb2', 'dfb3', 'prt1', 'prt2'],
      params: c => ({
        dependent: c['surv'],
        independents: [c['x'], c['evt']],
        varNames: { [c['surv']]: 'surv', [c['x']]: 'x', [c['evt']]: 'evt' },
        createVars: { dfbeta: 'dfb', partial: 'prt' }
      })
    }
  ]

  for (const a of breadth) {
    const b = await runAnalysis(a.id, a.file, a.params)
    const names = await win.evaluate(() =>
      (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => v.name)
    )
    const missing = a.wants.filter(w => !names.includes(w))
    check(
      Boolean(b) && b.error === null && missing.length === 0,
      `${a.id}: created ${a.wants.join(', ')} through the shared write path` +
        (missing.length ? ` — MISSING ${missing.join(', ')}` : '')
    )
  }

  // A stem must stop at the number of coefficients. An off-by-one that wrote a
  // fourth DfBeta would still pass the "wants" list above.
  const allNames = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => v.name)
  )
  check(
    !allNames.includes('dfb4') && !allNames.includes('prt3'),
    `stems stop at the coefficient count (${allNames.filter(n => /^(dfb|prt)\d/.test(n)).join(',')})`
  )
  const ordVar = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).find(v => v.name === 'ord_grp')
  )
  check(
    ordVar?.measure === 'ordinal',
    `an ordinal model's predicted category stays ordinal (${String(ordVar?.measure)})`
  )

  // The cluster column must be usable as a grouping variable straight away —
  // that is the entire reason for writing it back rather than printing it.
  const clusterVar = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).find(v => v.name === 'cl')
  )
  check(
    clusterVar?.measure === 'nominal',
    `cluster membership is nominal, ready to group by (${String(clusterVar?.measure)})`
  )
  const groupVar = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).find(v => v.name === 'log_grp')
  )
  check(
    groupVar?.type === 'string',
    `predicted group came back as a label, not a code (${String(groupVar?.type)})`
  )

  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ') || 'none'})`)

  await app.close()
  if (fails.length) {
    console.error('\nFAILED:\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('\nPASSED: analysis output became real, aligned, undoable dataset columns')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
