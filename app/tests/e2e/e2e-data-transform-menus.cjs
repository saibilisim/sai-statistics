// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Functional e2e for EVERY item in the Data and Transform menus — not just
 * "the dialog opens" (e2e-menu-coverage does that), but: open it the way the
 * native menu does (webContents.send), drive the real dialog UI, press OK,
 * then verify the result
 *   (a) in DuckDB (window.api.data.getAll — the source of truth), and
 *   (b) in the Data View grid where the operation changes visible cells —
 *       catches "DB updated but the grid still shows the old values".
 *
 * Each case starts from a fresh import of the same small fixture, so cases
 * are independent. Self-contained: writes its own fixtures to app/tmp/.
 *
 * Usage: node tests/e2e/run-e2e.cjs data-transform-menus   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const TMP = path.join(__dirname, '..', '..', 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const FX_A = path.join(TMP, 'sai-dt-a.csv')
const FX_B = path.join(TMP, 'sai-dt-b.csv')
const FX_C = path.join(TMP, 'sai-dt-c.csv')
// x has a missing value in row 4, y in row 2; grp has a duplicate group of 3.
fs.writeFileSync(
  FX_A,
  'id,grp,x,y,s\n1,1,10,5,a\n2,1,20,,b\n3,2,30,7,a\n4,2,,8,c\n5,1,20,9,b\n6,3,50,1,a\n'
)
fs.writeFileSync(FX_B, 'id,grp,x,z\n7,3,70,1\n8,1,80,2\n')
fs.writeFileSync(FX_C, 'id,w\n1,100\n3,300\n6,600\n9,900\n')

const near = (a, b) =>
  (a === null && b === null) ||
  (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6)
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]) || v === b[i])

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  // Native dialogs: "unsaved changes?" → Discard; file pickers → the path
  // the current case put in global.__nextOpenPath.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [globalThis.__nextOpenPath]
    })
  })

  const results = []
  const record = (name, pass, detail) => {
    results.push({ name, pass: !!pass, detail })
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`)
  }

  const load = async () => {
    await win.evaluate(async fp => {
      const r = await window.api.file.import({ filePath: fp })
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      s.setDataset(
        r.dataset.id,
        r.dataset.name,
        r.dataset.filePath,
        r.variables,
        r.dataset.rowCount,
        r.styles
      )
      s.setModified(false)
      s.setWeight(null)
      s.setSplit(null)
      window.__SAI_TEST__.useUIStore.getState().setActiveTab('data')
    }, FX_A)
    await win.waitForTimeout(900)
  }
  const menu = async ch => {
    await app.evaluate(({ BrowserWindow }, c) => {
      BrowserWindow.getAllWindows()[0].webContents.send(c)
    }, ch)
    await win.waitForTimeout(500)
  }
  const dlg = () => win.locator('[role="dialog"]').last()
  const ok = async () => {
    await dlg()
      .locator('button', { hasText: /^Tamam$/ })
      .click()
    await win.waitForTimeout(1200)
  }
  const dialogOpen = async () => (await win.locator('[role="dialog"]').count()) > 0
  const dialogError = async () =>
    dlg()
      .locator('div[style*="color-error"]')
      .innerText()
      .catch(() => '')
  const option = name =>
    dlg().locator('li[role="option"]', { has: win.locator(`span:text-is("${name}")`) })
  // DuckDB snapshot: { names, cols: {name: [values...]}, rowCount }
  const db = () =>
    win.evaluate(async () => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      const all = await window.api.data.getAll({ datasetId: s.datasetId })
      const cols = {}
      s.variables.forEach((v, i) => {
        cols[v.name] = all.rows.map(r => r[i])
      })
      return {
        names: s.variables.map(v => v.name),
        cols,
        rowCount: all.rows.length,
        modified: s.isModified
      }
    })
  // Visible grid text for a variable, row by row.
  const grid = name =>
    win.evaluate(n => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      const v = s.variables.find(vv => vv.name === n)
      if (!v) return null
      const out = []
      document.querySelectorAll('.ag-center-cols-container .ag-row').forEach(row => {
        const idx = Number(row.getAttribute('row-index'))
        const cell = row.querySelector(`.ag-cell[col-id="${v.colId}"]`)
        out[idx] = cell ? cell.textContent.trim() : undefined
      })
      return out
    }, name)
  const gridNums = async name =>
    ((await grid(name)) ?? []).map(t =>
      t === '' || t === undefined ? null : Number(t.replace(',', '.'))
    )
  // Options render the variable NAME as text but carry the colId as value.
  const colIdOf = name =>
    win.evaluate(
      n => window.__SAI_TEST__.useDatasetStore.getState().variables.find(v => v.name === n)?.colId,
      name
    )
  const selectByLabel = async (i, name) =>
    dlg()
      .locator('select')
      .nth(i)
      .selectOption(await colIdOf(name))
  const radio = text => dlg().locator('label', { hasText: text }).locator('input[type="radio"]')

  const run = async (name, fn) => {
    try {
      await load()
      await fn()
    } catch (e) {
      record(name, false, { exception: String(e.message ?? e).slice(0, 300) })
    }
    // Close anything left open so the next case starts clean.
    while (await dialogOpen()) {
      await win.keyboard.press('Escape')
      await win.waitForTimeout(200)
      if (await dialogOpen()) {
        await dlg()
          .locator('button', { hasText: /^İptal$/ })
          .click()
          .catch(() => {})
        await win.waitForTimeout(200)
      }
      break
    }
  }

  // ═══ DATA MENU ═══════════════════════════════════════════════════════════
  await run('Data > Sort Cases (grp asc, x desc)', async () => {
    await menu('menu:data:sort-cases')
    await option('grp').click()
    await option('x').click()
    await dlg().locator('button', { hasText: 'Artan' }).nth(1).click() // x → Azalan
    await ok()
    const d = await db()
    const g = await gridNums('id')
    // grp1: x 20,20,10 → ids {2,5},1 ; grp2: x 30 → 3, then NULL (4) ; grp3: 6
    const ids = d.cols.id
    const pass =
      !(await dialogOpen()) &&
      new Set(ids.slice(0, 2)).size === 2 &&
      ids.slice(0, 2).every(i => i === 2 || i === 5) &&
      ids[2] === 1 &&
      ids[3] === 3 &&
      ids[4] === 4 &&
      ids[5] === 6 &&
      eqArr(g, ids) &&
      d.modified
    record('Data > Sort Cases', pass, { dbIds: ids, gridIds: g, modified: d.modified })
  })

  await run('Data > Sort Variables (name asc)', async () => {
    await menu('menu:data:sort-variables')
    await ok()
    const d = await db()
    const headers = await win.evaluate(() =>
      [...document.querySelectorAll('.ag-header-cell[col-id]')]
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        .map(
          h =>
            window.__SAI_TEST__.useDatasetStore
              .getState()
              .variables.find(v => v.colId === h.getAttribute('col-id'))?.name
        )
        .filter(Boolean)
    )
    const want = ['grp', 'id', 's', 'x', 'y']
    const pass =
      eqArr(d.names, want) &&
      eqArr(
        headers.filter(h => want.includes(h)),
        want
      ) &&
      eqArr(d.cols.id, [1, 2, 3, 4, 5, 6])
    record('Data > Sort Variables', pass, { names: d.names, headers })
  })

  await run('Data > Identify Duplicate Cases (grp)', async () => {
    await menu('menu:data:identify-duplicates')
    await option('grp').click()
    await ok()
    const d = await db()
    const pf = d.cols.PrimaryFirst
    const ms = d.cols.MatchSequence
    const gPf = await gridNums('PrimaryFirst')
    const pass =
      eqArr(pf ?? [], [1, 0, 1, 0, 0, 1]) &&
      eqArr(ms ?? [], [1, 2, 1, 2, 3, 0]) && // unduplicated case (grp 3) → 0, as in SPSS
      eqArr(gPf, pf ?? []) &&
      d.modified
    record('Data > Identify Duplicates', pass, {
      PrimaryFirst: pf,
      MatchSequence: ms,
      grid: gPf,
      modified: d.modified
    })
  })

  await run('Data > Select Cases', async () => {
    await menu('menu:data:select-cases')
    const on = await win.evaluate(
      () => window.__SAI_TEST__.useUIStore.getState().showColumnFilterIcons
    )
    record('Data > Select Cases', on === true, { showColumnFilterIcons: on })
    await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setColumnFilterIcons(false))
  })

  await run('Data > Weight Cases (y)', async () => {
    await menu('menu:data:weight-cases')
    await option('y').click()
    await ok()
    const st = await win.evaluate(() => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      return { weight: s.variables.find(v => v.colId === s.weightVariable)?.name ?? null }
    })
    record('Data > Weight Cases', st.weight === 'y', st)
  })

  await run('Data > Split File (grp)', async () => {
    await menu('menu:data:split-file')
    await radio('Gruplara göre karşılaştır').check()
    await option('grp').click()
    await ok()
    const st = await win.evaluate(() => {
      const s = window.__SAI_TEST__.useDatasetStore.getState()
      return { split: s.variables.find(v => v.colId === s.splitVariable)?.name ?? null }
    })
    record('Data > Split File', st.split === 'grp', st)
  })

  await run('Data > Aggregate (grp → mean x)', async () => {
    await menu('menu:data:aggregate')
    await option('grp').click()
    await dlg().locator('button', { hasText: 'Satır Ekle' }).click()
    await selectByLabel(0, 'x')
    await ok()
    const d = await db()
    const byGrp = Object.fromEntries(d.cols.grp.map((g, i) => [g, d.cols.x_mean?.[i]]))
    const pass =
      d.rowCount === 3 && near(byGrp[1], 50 / 3) && near(byGrp[2], 30) && near(byGrp[3], 50)
    record('Data > Aggregate', pass, { names: d.names, byGrp, rows: d.rowCount })
  })

  await run('Data > Transpose (name var = id)', async () => {
    await menu('menu:data:transpose')
    await selectByLabel(0, 'id')
    await ok()
    const d = await db()
    // numeric vars grp,x,y (id is the name var, s is a string → skipped)
    record('Data > Transpose', d.rowCount >= 3 && d.names.length >= 6, {
      names: d.names,
      rows: d.rowCount,
      cols: d.cols
    })
  })

  await run('Data > Restructure (x,y → long)', async () => {
    await menu('menu:data:restructure')
    const addBtn = (v, txt) =>
      dlg()
        .locator('li', { has: win.locator(`span:text-is("${v}")`) })
        .locator('button', { hasText: txt })
    await addBtn('id', 'Kimlik olarak ekle').click()
    await addBtn('x', 'Değer olarak ekle').click()
    await addBtn('y', 'Değer olarak ekle').click()
    await ok()
    const d = await db()
    const pairs = d.cols.id.map((id, i) => `${id}:${d.cols.index[i]}:${d.cols.value[i]}`)
    const pass =
      d.rowCount === 12 &&
      pairs.includes('1:1:10') &&
      pairs.includes('1:2:5') &&
      pairs.includes('2:2:null')
    record('Data > Restructure', pass, {
      names: d.names,
      rows: d.rowCount,
      sample: pairs.slice(0, 4)
    })
  })

  await run('Data > Define Variable Properties (grp)', async () => {
    await menu('menu:data:define-var-props')
    await option('grp').click()
    await ok() // scan
    const rows = dlg().locator('div', { has: win.locator('input[type="checkbox"]') })
    const labelInputs = dlg().locator('input[placeholder="(isteğe bağlı)"]')
    await labelInputs.nth(0).fill('Bir')
    await dlg().locator('input[type="checkbox"]').nth(2).check() // value 3 → missing
    await ok()
    void rows
    const v = await win.evaluate(() =>
      window.__SAI_TEST__.useDatasetStore.getState().variables.find(vv => vv.name === 'grp')
    )
    const missingCellCount = await win.evaluate(colId => {
      return [...document.querySelectorAll(`.ag-cell[col-id="${colId}"]`)].filter(c =>
        c.className.includes('missingCell')
      ).length
    }, v.colId)
    const pass =
      v.valueLabels['1'] === 'Bir' &&
      v.missing?.type === 'discrete' &&
      v.missing.discrete.length === 1 &&
      v.missing.discrete[0] === 3 &&
      missingCellCount === 1
    record('Data > Define Variable Properties', pass, {
      labels: v.valueLabels,
      missing: v.missing,
      measure: v.measure,
      missingCellCount
    })
  })

  await run('Data > Merge > Add Cases', async () => {
    await app.evaluate((_, p) => {
      globalThis.__nextOpenPath = p
    }, FX_B)
    await menu('menu:data:merge-add-cases')
    await dlg().locator('button', { hasText: 'Gözat...' }).click()
    await win.waitForTimeout(1200)
    await ok()
    const d = await db()
    const pass =
      d.rowCount === 8 &&
      eqArr(d.cols.id, [1, 2, 3, 4, 5, 6, 7, 8]) &&
      near(d.cols.x[6], 70) &&
      d.cols.z?.[0] === null &&
      near(d.cols.z?.[7], 2) &&
      d.cols.y[7] === null
    record('Data > Merge Add Cases', pass, {
      names: d.names,
      rows: d.rowCount,
      id: d.cols.id,
      z: d.cols.z
    })
  })

  await run('Data > Merge > Add Variables (key id)', async () => {
    await app.evaluate((_, p) => {
      globalThis.__nextOpenPath = p
    }, FX_C)
    await menu('menu:data:merge-add-variables')
    await dlg().locator('button', { hasText: 'Gözat...' }).click()
    await win.waitForTimeout(1200)
    await ok()
    const d = await db()
    const pass =
      d.rowCount === 6 &&
      eqArr(d.cols.id, [1, 2, 3, 4, 5, 6]) &&
      eqArr(d.cols.w ?? [], [100, null, 300, null, null, 600])
    record('Data > Merge Add Variables', pass, {
      names: d.names,
      rows: d.rowCount,
      id: d.cols.id,
      w: d.cols.w
    })
  })

  // ═══ TRANSFORM MENU ══════════════════════════════════════════════════════
  await run('Transform > Compute Variable (k = x * 2)', async () => {
    await menu('menu:transform:compute')
    await dlg().locator('#cv-target').fill('k')
    await dlg().locator('textarea').fill('x * 2')
    await ok()
    const d = await db()
    const g = await gridNums('k')
    const want = [20, 40, 60, null, 40, 100]
    const pass = eqArr(d.cols.k ?? [], want) && eqArr(g, want) && d.modified
    record('Transform > Compute', pass, { db: d.cols.k, grid: g, modified: d.modified })
  })

  await run('Transform > Recode into Same (grp 1→10)', async () => {
    await menu('menu:transform:recode-same')
    await selectByLabel(0, 'grp')
    await radio('Sayısal').check()
    await dlg().locator('input[placeholder="eski..."]').fill('1')
    await dlg().locator('input[placeholder="yeni..."]').fill('10')
    await ok()
    const d = await db()
    const g = await gridNums('grp')
    const want = [10, 10, 2, 2, 10, 3]
    const pass = !(await dialogOpen()) && eqArr(d.cols.grp, want) && eqArr(g, want) && d.modified
    record('Transform > Recode Same', pass, {
      db: d.cols.grp,
      grid: g,
      modified: d.modified,
      err: await dialogError()
    })
  })

  await run('Transform > Recode into Different (s: a→A, else X)', async () => {
    await menu('menu:transform:recode-different')
    await selectByLabel(0, 's')
    await dlg().locator('input[placeholder="yeni_degisken_adi"]').fill('s2')
    await dlg().locator('input[placeholder="eski..."]').fill('a')
    await dlg().locator('input[placeholder="yeni..."]').fill('A')
    await radio('Şu değeri ata:').check()
    await dlg().locator('input[placeholder="değer girin..."]').fill('X')
    await ok()
    const d = await db()
    const g = await grid('s2')
    const want = ['A', 'X', 'A', 'X', 'X', 'A']
    const pass = eqArr(d.cols.s2 ?? [], want) && eqArr(g ?? [], want) && d.modified
    record('Transform > Recode Different', pass, { db: d.cols.s2, grid: g, modified: d.modified })
  })

  await run('Transform > Automatic Recode (s → s_n)', async () => {
    await menu('menu:transform:auto-recode')
    await selectByLabel(0, 's')
    await dlg().locator('input[placeholder="yeni_degisken_adi"]').fill('s_n')
    await ok()
    const d = await db()
    const v = await win.evaluate(() =>
      window.__SAI_TEST__.useDatasetStore.getState().variables.find(vv => vv.name === 's_n')
    )
    const want = [1, 2, 1, 3, 2, 1]
    const pass =
      eqArr(d.cols.s_n ?? [], want) &&
      v?.valueLabels?.['1'] === 'a' &&
      v?.valueLabels?.['3'] === 'c' &&
      d.modified
    record('Transform > Auto Recode', pass, {
      db: d.cols.s_n,
      labels: v?.valueLabels,
      modified: d.modified
    })
  })

  await run('Transform > Count Values (value 1 in grp,y)', async () => {
    await menu('menu:transform:count-values')
    await option('grp').click()
    await option('y').click()
    await dlg().locator('input[placeholder="örn. 1 veya evet"]').fill('1')
    await dlg().locator('input[placeholder="sayim"]').fill('cnt')
    await ok()
    const d = await db()
    const g = await gridNums('cnt')
    const want = [1, 1, 0, 0, 1, 1]
    const pass = eqArr(d.cols.cnt ?? [], want) && eqArr(g, want) && d.modified
    record('Transform > Count Values', pass, { db: d.cols.cnt, grid: g, modified: d.modified })
  })

  await run('Transform > Rank Cases (x asc)', async () => {
    await menu('menu:transform:rank-cases')
    await selectByLabel(0, 'x')
    await dlg().locator('input[placeholder="rank_degisken"]').fill('rx')
    await ok()
    const d = await db()
    // x = 10,20,30,NULL,20,50 → standard RANK (ties get the lower rank, gap after)
    const want = [1, 2, 4, null, 2, 5]
    const pass = eqArr(d.cols.rx ?? [], want) && d.modified
    record('Transform > Rank Cases', pass, { db: d.cols.rx, modified: d.modified })
  })

  await run('Transform > Visual Binning (x, 2 equal-width bins)', async () => {
    await menu('menu:transform:visual-binning')
    await selectByLabel(0, 'x')
    await dlg().locator('input').nth(0).fill('xb')
    await dlg().locator('input[type="number"]').fill('2')
    await ok()
    const d = await db()
    // lo 10, hi 50 → cut 30 (upper endpoint included): 10,20,30,20 → 1 ; 50 → 2
    const want = [1, 1, 1, null, 1, 2]
    const pass = eqArr(d.cols.xb ?? [], want) && d.modified
    record('Transform > Visual Binning', pass, {
      db: d.cols.xb,
      names: d.names,
      modified: d.modified,
      err: await dialogError()
    })
  })

  await run('Transform > Shift Values (x lag 1)', async () => {
    await menu('menu:transform:shift-values')
    await selectByLabel(0, 'x')
    await dlg().locator('input').nth(0).fill('xlag')
    await ok()
    const d = await db()
    const want = [null, 10, 20, 30, null, 20]
    const pass = eqArr(d.cols.xlag ?? [], want) && d.modified
    record('Transform > Shift Values', pass, { db: d.cols.xlag, modified: d.modified })
  })

  await run('Transform > Shift Values after Sort Cases (lag follows new order)', async () => {
    await menu('menu:data:sort-cases')
    await option('x').click()
    await ok()
    await menu('menu:transform:shift-values')
    await selectByLabel(0, 'x')
    await dlg().locator('input').nth(0).fill('xlag')
    await ok()
    const d = await db()
    // each row's lag must be the x of the row displayed right above it
    const want = d.cols.x.map((_, i) => (i === 0 ? null : d.cols.x[i - 1]))
    record('Transform > Shift after Sort', eqArr(d.cols.xlag ?? [], want), {
      x: d.cols.x,
      xlag: d.cols.xlag
    })
  })

  await run('Transform > Replace Missing Values (x, mean)', async () => {
    await menu('menu:transform:replace-missing')
    await selectByLabel(0, 'x')
    await ok()
    const d = await db()
    const g = await gridNums('x')
    const want = [10, 20, 30, 26, 20, 50]
    const pass = eqArr(d.cols.x, want) && eqArr(g, want) && d.modified
    record('Transform > Replace Missing', pass, { db: d.cols.x, grid: g, modified: d.modified })
  })

  // ═══ VIEW > Focus Cell (toggled from the menu while a cell is focused) ═══
  await run('View > Focus Cell', async () => {
    const colId = await win.evaluate(
      () => window.__SAI_TEST__.useDatasetStore.getState().variables[2].colId
    )
    await win.locator(`.ag-row[row-index="2"] .ag-cell[col-id="${colId}"]`).first().click()
    await win.waitForTimeout(200)
    await menu('menu:view:focus-cell')
    await win.waitForTimeout(300)
    const count = () => win.locator('[class*="focusCross"]').count()
    const onImmediately = await count()
    // move → cross follows
    await win.keyboard.press('ArrowDown')
    await win.waitForTimeout(250)
    // Tinted cells per row: the focused row is fully tinted, every other row
    // only in the focused column (1 cell).
    const perRow = await win.evaluate(() => {
      const counts = {}
      document.querySelectorAll('.ag-center-cols-container [class*="focusCross"]').forEach(c => {
        const r = c.closest('.ag-row')?.getAttribute('row-index')
        counts[r] = (counts[r] ?? 0) + 1
      })
      return counts
    })
    await menu('menu:view:focus-cell')
    await win.waitForTimeout(300)
    const offAfter = await count()
    const pass = onImmediately > 0 && perRow['3'] > 1 && perRow['2'] === 1 && offAfter === 0
    record('View > Focus Cell', pass, { onImmediately, perRow, offAfter })
  })

  const failed = results.filter(r => !r.pass)
  console.log(
    'RESULT:' + JSON.stringify({ total: results.length, failed: failed.map(f => f.name), errors })
  )
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })
  await app.close()
  process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
