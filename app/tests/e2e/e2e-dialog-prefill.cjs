// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Analysis dialogs open with nothing pre-selected unless there is a reason:
 *   1. On a fresh dataset (every variable has the default role "input") the
 *      target fields of Independent-Samples T Test, One-Way ANOVA, Means and
 *      Linear Regression are empty — the "input" role hint used to drop the
 *      first variable into the grouping field and every numeric variable
 *      into Regression's independents.
 *   2. Dialog Recall stays on its dataset: after a One-Way ANOVA run on iris
 *      the dialog reopens with that selection, but on another dataset it
 *      opens empty (colIds are per-dataset, col_1 there is another variable).
 *
 * Needs no fixture — sample data ships in resources/sample-data.
 * Run: node tests/e2e/run-e2e.cjs dialog-prefill   (after pnpm build)
 */
const path = require('path')
const { _electron } = require('@playwright/test')

const SAMPLE = path.join(__dirname, '..', '..', 'resources', 'sample-data')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: path.join(__dirname, '..', '..')
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  const load = file =>
    win.evaluate(
      async filePath => {
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
      },
      path.join(SAMPLE, file)
    )
  const send = channel =>
    app.evaluate(({ BrowserWindow }, ch) => {
      BrowserWindow.getAllWindows()[0].webContents.send(ch)
    }, channel)
  // Target boxes = every listbox in the dialog after the source list.
  const targets = () =>
    win.evaluate(() =>
      Array.from(document.querySelectorAll('[role="dialog"] [role="listbox"]'))
        .slice(1)
        .map(lb =>
          Array.from(lb.querySelectorAll('[role="option"]')).map(o => o.textContent.trim())
        )
    )
  const open = async channel => {
    await send(channel)
    await win.waitForSelector('[role="dialog"] [role="listbox"] [role="option"]', {
      timeout: 10000
    })
    await win.waitForTimeout(300)
  }
  const close = async () => {
    await win.keyboard.press('Escape')
    await win.waitForSelector('[role="dialog"]', { state: 'detached' })
  }

  await load('iris.csv')
  await win.waitForTimeout(800)

  for (const ch of [
    'menu:analyze:independent-ttest',
    'menu:analyze:oneway-anova',
    'menu:analyze:means',
    'menu:analyze:regression-linear'
  ]) {
    await open(ch)
    const t = await targets()
    check(
      `${ch} opens with empty targets`,
      t.length > 0 && t.every(x => x.length === 0),
      JSON.stringify(t)
    )
    await close()
  }

  // Run One-Way ANOVA on iris: Sepal_Length by Species.
  await open('menu:analyze:oneway-anova')
  await win.dblclick(`[role="dialog"] [role="listbox"] [role="option"]:has-text("Sepal_Length")`)
  await win.waitForTimeout(200)
  const boxes = await win.$$('[role="dialog"] [role="listbox"]')
  await boxes[2].click()
  await win.dblclick(`[role="dialog"] [role="listbox"] [role="option"]:has-text("Species")`)
  await win.waitForTimeout(200)
  const before = await targets()
  check(
    'ANOVA selection made',
    before[0]?.some(x => x.startsWith('Sepal_Length')) &&
      before[1]?.some(x => x.startsWith('Species')),
    JSON.stringify(before)
  )
  await win.click(
    '[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Tamam"), [role="dialog"] button:has-text("OK")'
  )
  await win.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 15000 })
  await win.waitForTimeout(1000)

  await open('menu:analyze:oneway-anova')
  const recalled = await targets()
  check(
    'same dataset recalls the ANOVA selection',
    recalled[0]?.some(x => x.startsWith('Sepal_Length')) &&
      recalled[1]?.some(x => x.startsWith('Species')),
    JSON.stringify(recalled)
  )
  await close()

  await load('mtcars.csv')
  await win.waitForTimeout(800)
  await open('menu:analyze:oneway-anova')
  const other = await targets()
  check(
    'another dataset opens ANOVA empty',
    other.every(x => x.length === 0),
    JSON.stringify(other)
  )
  await close()

  check('no page errors', errors.length === 0, errors.join(' | '))
  await app.close()
  const failed = results.filter(r => !r.ok)
  if (failed.length > 0) {
    console.log(`${failed.length} FAILED`)
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
