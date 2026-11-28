// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the "r table" (critical r) footnotes reach the Output.
 *
 * Runs Bivariate Correlations (Pearson, score/income/age) and Reliability
 * Analysis (q1–q5) from the real menu channels against the real R engine and
 * checks that the Pearson table and the Item-Total Statistics table carry
 * their r-table footnote, rendered in the UI language with the tail word
 * translated and no raw output.* key left in the page. The critical values
 * themselves are checked in tests/r-validation/test-r-table-footnote-2026-11.R.
 *
 * Data: tests/spss-parity/data.csv.
 * Run: node tests/e2e/run-e2e.cjs e2e-r-table-footnote   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const path = require('node:path')
const { makeT, createDriver } = require('./lib/ui-dialog-driver.cjs')

const APP_DIR = path.join(__dirname, '..', '..')
const CSV = path.join(APP_DIR, 'tests', 'spss-parity', 'data.csv')

const SCENARIOS = [
  {
    id: 'pearson-r-table',
    channel: 'menu:analyze:correlate-bivariate',
    vars: [
      ['score', 0],
      ['income', 0],
      ['age', 0]
    ],
    table: 'output.correlate.title:Pearson',
    footnote: /^output\.correlate\.rTableFootnote(Range)?:/,
    textKey: 'analysis:output.correlate.rTableFootnote'
  },
  {
    id: 'reliability-r-table',
    channel: 'menu:analyze:reliability',
    vars: [
      ['q1', 0],
      ['q2', 0],
      ['q3', 0],
      ['q4', 0],
      ['q5', 0]
    ],
    table: 'output.reliability.itemTotalTitle',
    footnote: /^output\.reliability\.rTableFootnote:/,
    textKey: 'analysis:output.reliability.rTableFootnote'
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
      console.log('(no dialog)')
      continue
    }
    await clickMainButton(t('common:common.reset'))
    await win.waitForTimeout(200)
    await applySelections(scn)
    const prev = await lastBlockId()
    if (!(await clickMainButton(t('common:common.ok')))) {
      fails.push(`${scn.id}: OK button not found`)
      continue
    }
    const block = await waitForBlock(prev, 90000)
    if (!block || block.error) {
      fails.push(`${scn.id}: no result (${JSON.stringify(block?.error ?? null)})`)
      continue
    }
    const fk = await win.evaluate(
      key =>
        window.__SAI_TEST__.useOutputStore
          .getState()
          .blocks[0]?.result?.tables?.find(tb => tb.titleKey === key)?.footnoteKey ?? null,
      scn.table
    )
    if (!fk || !scn.footnote.test(fk)) fails.push(`${scn.id}: footnote key is ${fk}`)
    console.log(fk)
  }

  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('output'))
  await win.waitForTimeout(1000)
  const text = await win.evaluate(
    () => document.querySelector('[class*="content"]')?.textContent ?? ''
  )
  for (const scn of SCENARIOS) {
    // The translated sentence up to its first parameter must be on the page.
    const lead = t(scn.textKey).split('{{')[0]
    if (!text.includes(lead)) fails.push(`${scn.id}: footnote text not rendered ("${lead}")`)
  }
  if (!text.includes(t('analysis:output.correlate.tailTwo')))
    fails.push('tail word (two-tailed) not rendered')
  const leaks = (text.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
  if (leaks.length) fails.push(`raw key leaks: ${leaks.join(', ')}`)
  if (pageErrors.length) fails.push(`page errors: ${pageErrors.join(' | ')}`)

  await win.screenshot({ path: path.join(APP_DIR, 'e2e-r-table-footnote.png'), fullPage: true })
  await app.close()
  if (fails.length) {
    console.error('E2E FAILED\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('E2E PASSED')
}
main().catch(err => {
  console.error(err)
  process.exit(1)
})
