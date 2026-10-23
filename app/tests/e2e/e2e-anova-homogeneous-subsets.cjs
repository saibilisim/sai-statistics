// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: One-Way ANOVA dialog, every post hoc box checked (LSD through
 * Waller-Duncan) plus Homogeneity/Welch/Brown-Forsythe/Effect size/Means
 * plot — drives the real dialog against a real 4-group dataset, runs the
 * real R script, and asserts every Homogeneous Subsets table SPSS would
 * produce for this shape (Tukey HSD, Scheffe, SNK, Duncan, REGW Range) is
 * actually present in the result. Regression test for a real user report:
 * checking every box produced zero Homogeneous Subsets tables. */
const { _electron } = require('@playwright/test')
const { mkdir, writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')

async function main() {
  const dir = resolve('tmp/anova-homog-e2e')
  await mkdir(dir, { recursive: true })
  const csv = resolve(dir, 'data.csv')
  const groups = ['Viral', 'Diger', 'ToksikMetabolik', 'Otoimmun']
  const groupN = [18, 22, 34, 16]
  const groupMean = [4.35, 4.29, 4.25, 4.18]
  const rows = ['score,etiyoloji']
  groups.forEach((g, gi) => {
    for (let i = 0; i < groupN[gi]; i++) {
      // Deterministic small spread around each group mean — real ANOVA
      // shape (unequal n, close-but-not-identical means), no RNG needed.
      const jitter = ((i * 37) % 21) / 100 - 0.1
      rows.push(`${(groupMean[gi] + jitter).toFixed(3)},${g}`)
    }
  })
  await writeFile(csv, rows.join('\n'), 'utf8')

  const app = await _electron.launch({
    args: ['out/main/main.cjs', `--user-data-dir=${resolve(dir, 'profile')}`],
    cwd: __dirname + '/../..'
  })
  try {
    const win = await app.firstWindow()
    const errors = []
    win.on('pageerror', error => errors.push(error.message))
    await win.waitForFunction(() => Boolean(window.__SAI_TEST__))
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBoxSync = () => 1
      BrowserWindow.getAllWindows()[0]?.setSize(1250, 950)
    })
    const ids = await win.evaluate(async filePath => {
      const w = window
      w.__SAI_TEST__.useSettingsStore.getState().setLanguage('en')
      const result = await w.api.file.import({ filePath })
      if (!result) throw new Error('Fixture import cancelled')
      w.__SAI_TEST__.useDatasetStore
        .getState()
        .setDataset(
          result.dataset.id,
          result.dataset.name,
          result.dataset.filePath,
          result.variables,
          result.dataset.rowCount
        )
      return Object.fromEntries(result.variables.map(v => [v.name, v.colId]))
    }, csv)
    if (!ids.score || !ids.etiyoloji)
      throw new Error('Fixture columns not found: ' + JSON.stringify(ids))
    await win.getByRole('tab', { name: 'Data View', exact: true }).waitFor({ state: 'visible' })

    const browserWindow = await app.browserWindow(win)
    await browserWindow.evaluate(bw => {
      bw.webContents.send('menu:analyze:oneway-anova')
    })
    const main = win.getByRole('dialog').first()
    await main.waitFor({ state: 'visible' })

    for (const [field, variable] of [
      ['Dependent List:', 'score'],
      ['Factor:', 'etiyoloji']
    ]) {
      await main.getByRole('listbox', { name: new RegExp(field.replace(':', ''), 'i') }).click()
      await main.getByRole('option', { name: new RegExp(`^${variable}(?:\\s|$)`) }).click()
      await main
        .getByRole('button', { name: 'Move right', exact: true })
        .nth(['Dependent List:', 'Factor:'].indexOf(field))
        .click()
    }

    const open = async name => {
      await main.getByRole('button', { name, exact: true }).click()
      const sub = win.getByRole('dialog').last()
      await sub.waitFor({ state: 'visible' })
      return sub
    }

    let sub = await open('Post Hoc')
    for (const label of [
      'LSD',
      'Bonferroni',
      'Sidak',
      'Scheffe',
      'Tukey',
      "Hochberg's GT2",
      'Student-Newman-Keuls',
      'Duncan',
      'Ryan-Einot-Gabriel-Welsch Range',
      'Waller-Duncan',
      'Games-Howell',
      "Tamhane's T2",
      "Dunnett's T3",
      "Dunnett's C"
    ])
      await sub.getByLabel(label, { exact: true }).check()
    // "Dunnett" (vs control) is its own section, same label text as the
    // section title — check the checkbox specifically, not the heading.
    await sub.getByRole('checkbox', { name: 'Dunnett', exact: true }).check()
    await sub.getByRole('button', { name: 'Continue', exact: true }).click()

    sub = await open('Options')
    for (const label of [
      'Homogeneity of variance test',
      'Welch',
      'Brown-Forsythe',
      'Estimates of effect size',
      'Means plot'
    ])
      await sub.getByLabel(label, { exact: true }).check()
    await sub.getByRole('button', { name: 'Continue', exact: true }).click()

    await main.getByRole('button', { name: 'OK', exact: true }).click()
    await win.waitForFunction(
      () => window.__SAI_TEST__.useOutputStore.getState().blocks.length > 0,
      undefined,
      { timeout: 180000 }
    )
    const result = await win.evaluate(
      () => window.__SAI_TEST__.useOutputStore.getState().blocks[0].result
    )
    console.log('Result:', JSON.stringify(result, null, 2))

    const titleKeys = result.tables.map(t => t.titleKey)
    const hasHomogSubset = method =>
      titleKeys.some(k => k.includes('output.anova.homogSubsetsTitle:') && k.includes(method))
    const checks = {
      success: result.success === true,
      noPageErrors: errors.length === 0,
      tukey: hasHomogSubset('output.col.tukeyHSD'),
      scheffe: hasHomogSubset('output.col.scheffe'),
      snk: hasHomogSubset('output.anova.snk'),
      duncan: hasHomogSubset('output.anova.duncan'),
      regwQ: hasHomogSubset('output.anova.regwQ')
      // wallerDuncan intentionally not asserted: legitimately absent
      // whenever the observed F ratio is below ~1 (K's own real-data case;
      // SPSS itself shows "no homogeneous subsets" there too), so its
      // presence depends on the fixture's actual F, not on wiring.
    }
    console.log('Checks:', JSON.stringify(checks, null, 2))
    const pass = Object.values(checks).every(Boolean)

    await app.close()
    if (!pass) {
      console.error('E2E FAILED')
      process.exit(1)
    }
    console.log('E2E PASSED')
  } catch (err) {
    await app.close()
    throw err
  }
}
main().catch(err => {
  console.error(err)
  process.exit(1)
})
