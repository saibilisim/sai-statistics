// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: variable search — the two places a user looks for a variable by name.
 *
 *  A. Variable View toolbar search: typing JUMPS to matches (never filters —
 *     the row order is the dataset's column order), the counter reads n/total,
 *     the active row carries the "current match" class, and Enter walks the hits.
 *  B. Analysis dialog source list: search + measure filter NARROW the list, the
 *     two compose, Enter in the search box must NOT run the analysis, and Reset
 *     clears both.
 *
 * Selectors use class*="..." because CSS-module names keep their readable stem
 * in front of the build hash.
 *
 * Fixture: tests/spss-parity/data.csv (id, score, income, age, grp2, grp3, …).
 * Run: node tests/e2e/e2e-variable-search.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const APP_DIR = path.join(__dirname, '..', '..')
const CSV = path.join(APP_DIR, 'tests', 'spss-parity', 'data.csv')

/** Resolve 'namespace:a.b.c' against the locale files the app ships. */
function makeT(lang) {
  const read = ns =>
    JSON.parse(
      fs.readFileSync(path.join(APP_DIR, 'src', 'i18n', 'locales', lang, `${ns}.json`), 'utf8')
    )
  const catalogs = { analysis: read('analysis'), common: read('common') }
  return key => {
    const [ns, ...rest] = key.split(':')
    let node = catalogs[ns]
    for (const part of rest.join(':').split('.')) node = node?.[part]
    if (typeof node !== 'string') throw new Error(`label key missing: ${key} (${lang})`)
    return node
  }
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
  const check = (cond, msg) => {
    if (!cond) fails.push(msg)
    else console.log('   ok  ' + msg)
  }

  // Read the language only once settings are loaded from disk — before that
  // the store holds the schema default ('en'), not the profile's language.
  await win.waitForFunction(() => window.__SAI_TEST__?.useSettingsStore.getState().isLoaded)
  const lang = await win.evaluate(
    () => window.__SAI_TEST__.useSettingsStore.getState().settings?.appearance?.language ?? 'tr'
  )
  const t = makeT(lang)

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

  // Pin the measures the dialog filter is asserted against (import inference
  // must not decide this test's expectations).
  const measures = await win.evaluate(async () => {
    const want = { grp2: 'nominal', grp3: 'nominal', grp4: 'scale' }
    for (const [name, measure] of Object.entries(want)) {
      const ds = window.__SAI_TEST__.useDatasetStore.getState()
      const idx = ds.variables.findIndex(v => v.name === name)
      if (idx === -1) continue
      await window.api.variable.update({
        datasetId: ds.datasetId,
        colId: ds.variables[idx].colId,
        updates: { measure }
      })
      window.__SAI_TEST__.useDatasetStore.getState().updateVariable(idx, { measure })
    }
    return Object.fromEntries(
      window.__SAI_TEST__.useDatasetStore.getState().variables.map(v => [v.name, v.measure])
    )
  })
  check(
    measures.grp2 === 'nominal' && measures.grp3 === 'nominal' && measures.grp4 === 'scale',
    'fixture measures pinned (grp2/grp3 nominal, grp4 scale)'
  )

  // ── A. Variable View search ───────────────────────────────────────────────
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('variable'))
  await win.waitForTimeout(1500)

  const searchBox = win.locator('div[class*="searchBox"] input').first()
  check(await searchBox.isVisible(), 'variable view: search box is present')

  const readState = () =>
    win.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.ag-center-cols-container .ag-row'))
      const withClass = c => rows.filter(r => [...r.classList].some(x => x.includes(c)))
      const nameOf = r => r.querySelector('.ag-cell[col-id="name"]')?.textContent?.trim() ?? '?'
      const counter = document.querySelector('[class*="searchCount"]')?.textContent?.trim() ?? null
      return {
        counter,
        matches: withClass('searchMatch').map(nameOf).sort(),
        current: withClass('searchCurrent').map(nameOf),
        rowCount: rows.length
      }
    })

  // "grp" hits grp2, grp3, grp4 → 3 matches, cursor on the first.
  await searchBox.fill('grp')
  await win.waitForTimeout(700)
  const s1 = await readState()
  console.log('   A1 ' + JSON.stringify(s1))
  check(s1.counter === '1/3', `counter reads 1/3 (got ${s1.counter})`)
  check(
    JSON.stringify(s1.matches) === JSON.stringify(['grp2', 'grp3', 'grp4']),
    'all three grp* rows highlighted as matches'
  )
  check(s1.current.length === 1 && s1.current[0] === 'grp2', 'cursor sits on the first hit (grp2)')
  // Rows are never hidden — search jumps, it does not filter.
  check(s1.rowCount > 3, `all rows stay rendered while searching (${s1.rowCount})`)

  await searchBox.press('Enter')
  await win.waitForTimeout(500)
  const s2 = await readState()
  console.log('   A2 ' + JSON.stringify(s2))
  check(s2.counter === '2/3' && s2.current[0] === 'grp3', 'Enter advances to grp3')

  // A miss reports "no match" and highlights nothing.
  await searchBox.fill('zzzz')
  await win.waitForTimeout(500)
  const s3 = await readState()
  check(
    s3.matches.length === 0 && s3.current.length === 0,
    `no-match query highlights nothing (counter "${s3.counter}")`
  )

  await searchBox.fill('')
  await win.waitForTimeout(400)

  // ── B. Analysis dialog source list ────────────────────────────────────────
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('data'))
  await win.waitForTimeout(600)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:analyze:frequencies')
  })
  const t0 = Date.now()
  for (;;) {
    const ready = await win.evaluate(() =>
      Boolean(document.querySelector('[role="dialog"] [role="listbox"]'))
    )
    if (ready) break
    if (Date.now() - t0 > 30000) {
      fails.push('frequencies dialog never appeared')
      break
    }
    await win.waitForTimeout(300)
  }

  const sourceNames = () =>
    win.evaluate(() => {
      const box = document.querySelector('[role="dialog"] [role="listbox"]')
      return Array.from(box?.querySelectorAll('[role="option"]') ?? []).map(el =>
        (el.querySelector('span')?.textContent || '').trim()
      )
    })

  const dialogSearch = win.locator('[role="dialog"] div[class*="searchBox"] input').first()
  const all = await sourceNames()
  check(all.length > 10, `dialog source list starts full (${all.length} variables)`)

  await dialogSearch.fill('grp')
  await win.waitForTimeout(500)
  const filtered = await sourceNames()
  console.log('   B1 ' + JSON.stringify(filtered))
  check(
    filtered.length === 3 && filtered.every(n => n.startsWith('grp')),
    'search narrows the source list to grp2/grp3/grp4'
  )

  // Enter must not submit: filtering is live, the dialog stays open.
  await dialogSearch.press('Enter')
  await win.waitForTimeout(800)
  const stillOpen = await win.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))
  check(stillOpen, 'Enter in the search box does not run the analysis')

  // Measure filter composes with the query: grp4 is scale, grp2/grp3 nominal.
  // The filter is a dropdown (trigger aria-label "<filterMeasure>: <current>"
  // → role="menu" of role="menuitem"s), formerly a chip group.
  const pickMeasure = label =>
    win.evaluate(
      ({ triggerPrefix, label }) => {
        const dialog = document.querySelector('[role="dialog"]')
        const trigger = Array.from(dialog?.querySelectorAll('button') ?? []).find(b =>
          (b.getAttribute('aria-label') || '').startsWith(triggerPrefix)
        )
        trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        return new Promise(resolve =>
          setTimeout(() => {
            const item = Array.from(dialog?.querySelectorAll('[role="menuitem"]') ?? []).find(
              el => (el.textContent || '').trim() === label
            )
            item?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            resolve(Boolean(item))
          }, 200)
        )
      },
      { triggerPrefix: t('analysis:shell.filterMeasure') + ':', label }
    )

  const picked = await pickMeasure(t('analysis:shell.filterNominal'))
  check(picked, 'measure filter dropdown offers the nominal option')
  await win.waitForTimeout(500)
  const nominalOnly = await sourceNames()
  console.log('   B2 ' + JSON.stringify(nominalOnly))
  check(
    nominalOnly.length === 2 && nominalOnly.includes('grp2') && nominalOnly.includes('grp3'),
    'nominal chip + "grp" query leaves only the two nominal grp variables'
  )

  // Filtering everything away says so instead of claiming all are assigned.
  await dialogSearch.fill('score')
  await win.waitForTimeout(500)
  const emptyText = await win.evaluate(() =>
    (document.querySelector('[role="dialog"] [role="listbox"]')?.textContent || '').trim()
  )
  check(
    emptyText === t('analysis:shell.searchNoMatch'),
    `empty list shows the no-match message (got "${emptyText}")`
  )

  // Reset clears search + filter together.
  await win.evaluate(txt => {
    const main = document.querySelectorAll('[role="dialog"]')[0]
    const btn = Array.from(main?.querySelectorAll('button') ?? []).find(
      b => (b.textContent || '').trim() === txt
    )
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, t('common:common.reset'))
  await win.waitForTimeout(600)
  const afterReset = await sourceNames()
  check(afterReset.length === all.length, `Reset restores the full list (${afterReset.length})`)

  check(pageErrors.length === 0, `no page errors (${JSON.stringify(pageErrors)})`)

  await app.close()
  if (fails.length > 0) {
    console.error('E2E FAILED:\n - ' + fails.join('\n - '))
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
