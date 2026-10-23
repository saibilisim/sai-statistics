// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Flathub MetaInfo screenshots: imports the bundled mtcars sample, then captures
 * Data View, Variable View and an Output tab with real R results.
 * Usage (after `pnpm build`, under a display or xvfb-run -a):
 *   node scripts/flathub-screenshots.cjs [outDir]      (default tmp/flathub-shots)
 * Window is fixed at 1280x800 (Flathub recommends 16:10, <= 1600 wide). */
const { _electron } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

const APP = path.join(__dirname, '..')
const OUT = path.resolve(process.argv[2] ?? path.join(APP, 'tmp', 'flathub-shots'))
const CSV = path.join(APP, 'resources', 'sample-data', 'mtcars.csv')

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: APP })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1280, height: 800 })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

  // MetaInfo screenshots must be in English. The language setting is persisted, so
  // remember it and put it back at the end.
  const prevLang = await win.evaluate(() => {
    const st = window.__SAI_TEST__.useSettingsStore.getState()
    const prev = st.settings.appearance.language
    st.setLanguage('en')
    return prev
  })
  await win.waitForTimeout(1000)
  await win.getByRole('button', { name: 'Close' }).first().click()
  await win.waitForTimeout(500)

  const setup = await win.evaluate(async filePath => {
    const result = await window.api.file.import({ filePath })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(
        result.dataset.id,
        result.dataset.name,
        result.dataset.filePath,
        result.variables,
        result.dataset.rowCount,
        result.styles
      )
    return {
      datasetId: result.dataset.id,
      byName: Object.fromEntries(result.variables.map(v => [v.name, v.colId]))
    }
  }, CSV)

  const tab = async name => {
    await win.evaluate(n => window.__SAI_TEST__.useUIStore.getState().setActiveTab(n), name)
    await win.waitForTimeout(1500)
  }
  const shot = async name => {
    await win.screenshot({ path: path.join(OUT, name) })
    console.log('saved', name)
  }

  await tab('data')
  await shot('01-data-view.png')
  await tab('variable')
  await shot('02-variable-view.png')

  await win.evaluate(() => {
    window.__done = 0
    window.api.on.jobComplete(() => (window.__done += 1))
    window.api.on.jobError(() => (window.__done += 100))
  })
  await tab('output')
  const v = setup.byName
  await win.evaluate(cfg => {
    const { datasetId, byName } = cfg
    const vars = ['mpg', 'hp', 'wt'].map(n => byName[n])
    window.api.analysis.run({
      analysisId: 'descriptives',
      datasetId,
      scriptFile: 'descriptives.R',
      params: {
        variables: vars,
        varNames: Object.fromEntries(['mpg', 'hp', 'wt'].map(n => [byName[n], n])),
        options: { mean: true, sd: true, min: true, max: true }
      }
    })
    window.api.analysis.run({
      analysisId: 'ttestInd',
      datasetId,
      scriptFile: 'ttest-independent.R',
      params: {
        variables: [byName.mpg],
        varNames: { [byName.mpg]: 'mpg' },
        groupVar: byName.am,
        groupName: 'am',
        group1: '0',
        group2: '1'
      }
    })
  }, setup)
  void v
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    const done = await win.evaluate(() => window.__done)
    if (done >= 2) break
    await win.waitForTimeout(500)
  }
  const done = await win.evaluate(() => window.__done)
  if (done !== 2) throw new Error(`analyses did not both succeed (counter=${done})`)
  await win.waitForTimeout(2500)
  await shot('03-output.png')

  await win.evaluate(l => window.__SAI_TEST__.useSettingsStore.getState().setLanguage(l), prevLang)
  await win.waitForTimeout(500)
  await app.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
