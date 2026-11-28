// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: Linear Regression ▸ Statistics ▸ "Classical assumption tests".
 *
 * Opens the dialog from the real menu channel, assigns income ~ score + age,
 * ticks the option in the Statistics sub-dialog, runs it against the real R
 * engine and checks the Output: the assumption table is there with every test
 * row (normality ×2, VIF ×2, Glejser ×2, Breusch-Pagan, Durbin-Watson,
 * Breusch-Godfrey), its labels and decisions resolve in the UI language and no
 * raw output.* key leaks into the page. The statistics themselves are checked
 * against lmtest/car/nortest in
 * tests/r-validation/test-regression-assumptions-2026-11.R.
 *
 * Data: tests/spss-parity/data.csv.
 * Run: node tests/e2e/run-e2e.cjs e2e-regression-assumptions   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const path = require('node:path')
const { makeT, createDriver } = require('./lib/ui-dialog-driver.cjs')

const APP_DIR = path.join(__dirname, '..', '..')
const CSV = path.join(APP_DIR, 'tests', 'spss-parity', 'data.csv')
const TITLE_KEY = 'output.regression.assume.title'

const SCENARIO = {
  id: 'regression-assumptions',
  channel: 'menu:analyze:regression-linear',
  vars: [
    ['income', 0],
    ['score', 1],
    ['age', 1]
  ],
  subs: [{ button: 'analysis:shell.btnStatistics', check: ['analysis:regression.assumptions'] }]
}

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

  if (await openDialog(SCENARIO.channel, SCENARIO.id, true)) {
    await clickMainButton(t('common:common.reset'))
    await win.waitForTimeout(200)
    await applySelections(SCENARIO)
    const prev = await lastBlockId()
    if (!(await clickMainButton(t('common:common.ok')))) fails.push('OK button not found')
    const block = await waitForBlock(prev, 90000)
    if (!block) fails.push('no output block')
    else if (block.error) fails.push(`analysis error: ${JSON.stringify(block.error)}`)
  } else {
    fails.push('dialog did not open')
  }

  const table = await win.evaluate(
    key =>
      window.__SAI_TEST__.useOutputStore
        .getState()
        .blocks[0]?.result?.tables?.find(tb => tb.titleKey === key) ?? null,
    TITLE_KEY
  )
  if (!table) {
    fails.push('assumption table missing from the result')
  } else {
    const tests = table.rows.map(r => String(r[1]))
    const expect = [
      'output.regression.assume.ks',
      'output.regression.assume.sw',
      'output.regression.assume.vif:score',
      'output.regression.assume.vif:age',
      'output.regression.assume.glejser:score',
      'output.regression.assume.glejser:age',
      'output.regression.assume.bp',
      'output.regression.assume.dw',
      'output.regression.assume.bg'
    ]
    for (const k of expect) if (!tests.includes(k)) fails.push(`row missing: ${k}`)
    console.log(`rows: ${tests.length}`)
  }

  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('output'))
  await win.waitForTimeout(1000)
  const dom = await win.evaluate(() => {
    const text = document.querySelector('[class*="content"]')?.textContent ?? ''
    return {
      text,
      leaks: (text.match(/\b(output|analysis)\.[a-zA-Z][a-zA-Z.]+/g) || []).slice(0, 10)
    }
  })
  const must = [
    t('analysis:output.regression.assume.title'),
    t('analysis:output.regression.assume.normality'),
    t('analysis:output.regression.assume.bp'),
    t('analysis:output.regression.assume.vif').replace('{{name}}', 'score'),
    t('analysis:col.decision')
  ]
  for (const s of must) if (!dom.text.includes(s)) fails.push(`not rendered: "${s}"`)
  const met = t('analysis:output.regression.assume.met')
  const violated = t('analysis:output.regression.assume.violated')
  if (!dom.text.includes(met) && !dom.text.includes(violated)) fails.push('no decision rendered')
  if (dom.leaks.length) fails.push(`raw key leaks: ${dom.leaks.join(', ')}`)
  if (pageErrors.length) fails.push(`page errors: ${pageErrors.join(' | ')}`)

  await win.screenshot({
    path: path.join(APP_DIR, 'e2e-regression-assumptions.png'),
    fullPage: true
  })
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
