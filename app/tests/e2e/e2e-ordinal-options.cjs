// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Real dialog -> IPC -> R -> output/new columns, including panel cancel. */
const { _electron, expect } = require('@playwright/test')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const csv = path.resolve(__dirname, '../../tmp/ordinal-e2e.csv')
  const rows = ['response,group,age']
  for (let g = 0; g < 2; g++)
    for (let x = 1; x <= 3; x++)
      for (let y = 1; y <= 3; y++)
        for (let i = 0; i < 8 + ((y + x + g) % 4); i++) rows.push(`${y},${g},${x}`)
  fs.writeFileSync(csv, rows.join('\n'))
  const app = await _electron.launch({
    args: [
      'out/main/main.cjs',
      '--no-sandbox',
      `--user-data-dir=${path.resolve(__dirname, '../../tmp/ordinal-profile')}`
    ],
    cwd: path.resolve(__dirname, '..', '..')
  })
  try {
    const win = await app.firstWindow()
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0 })
      dialog.showMessageBoxSync = () => 1
    })
    await win.waitForLoadState('domcontentloaded')
    await win.waitForFunction(() => Boolean(window.__SAI_TEST__))
    // Read the language only once settings are loaded from disk — before that
    // the store holds the schema default ('en'), not the profile's language.
    await win.waitForFunction(() => window.__SAI_TEST__?.useSettingsStore.getState().isLoaded)
    const lang = await win.evaluate(
      () => window.__SAI_TEST__.useSettingsStore.getState().settings?.appearance?.language ?? 'tr'
    )
    const a = require(`../../src/i18n/locales/${lang}/analysis.json`)
    const c = require(`../../src/i18n/locales/${lang}/common.json`).common
    const t = a.ordinal.extra
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
      window.__SAI_RUNS__ = []
    }, csv)
    // The dataset update replaces menu subscriptions in a React effect.
    await win.waitForTimeout(500)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('menu:analyze:regression-ordinal')
    )
    const mainDialog = win.getByRole('dialog').first()
    await expect(mainDialog).toBeVisible()
    for (const [name, index] of [
      ['response', 0],
      ['group', 1],
      ['age', 2]
    ]) {
      await mainDialog
        .getByRole('listbox')
        .first()
        .getByRole('option')
        .filter({ hasText: name })
        .click()
      await mainDialog.locator('button').filter({ hasText: /^▶$/ }).nth(index).click()
    }
    const sub = () => win.getByRole('dialog').last()
    const open = async kind => {
      await mainDialog.getByRole('button', { name: t[kind], exact: true }).click()
      await expect(win.getByRole('dialog')).toHaveCount(2)
    }
    const done = async () => {
      await sub().getByRole('button', { name: c.continue, exact: true }).click()
      await expect(win.getByRole('dialog')).toHaveCount(1)
    }
    await open('scale')
    await sub().getByLabel(t.predictors).selectOption({ label: 'group' })
    await sub().getByRole('button', { name: t.add, exact: true }).click()
    await win.screenshot({
      animations: 'disabled',
      path: path.resolve(__dirname, '../../tmp/ordinal-scale.png')
    })
    await done()
    await open('options')
    await sub().getByLabel(t.link).selectOption('probit')
    await sub().getByLabel(t.ciLevel).fill('90')
    await win.screenshot({
      animations: 'disabled',
      path: path.resolve(__dirname, '../../tmp/ordinal-options.png')
    })
    await done()
    await open('options')
    await sub().getByLabel(t.link).selectOption('cauchit')
    await sub().getByRole('button', { name: c.cancel, exact: true }).click()
    await open('options')
    await expect(sub().getByLabel(t.link)).toHaveValue('probit')
    await done()
    await open('location')
    await sub().getByRole('radio', { name: t.custom, exact: true }).check()
    await sub()
      .getByLabel(t.predictors)
      .selectOption([{ label: 'group' }, { label: 'age' }])
    await sub().getByRole('button', { name: t.add, exact: true }).click()
    await done()
    await open('output')
    await win.screenshot({
      animations: 'disabled',
      path: path.resolve(__dirname, '../../tmp/ordinal-output-panel.png')
    })
    for (const key of [
      'history',
      'correlations',
      'covariances',
      'cellInfo',
      'parallelLines',
      'estimatedProbabilities',
      'actualProbability'
    ])
      await sub().getByRole('checkbox', { name: t[key], exact: true }).check()
    await sub()
      .getByRole('checkbox', { name: a.ordinal.newVar.predictedGroup, exact: true })
      .check()
    await sub().getByRole('checkbox', { name: a.ordinal.newVar.probability, exact: true }).check()
    await done()
    await win.screenshot({
      animations: 'disabled',
      path: path.resolve(__dirname, '../../tmp/ordinal-dialog.png')
    })
    await mainDialog.getByRole('button', { name: c.ok, exact: true }).click()
    await win.waitForFunction(
      () => {
        const b = window.__SAI_TEST__.useOutputStore.getState().blocks[0]
        return b?.analysisId === 'ordinal' && !b.running && (b.result || b.error)
      },
      null,
      { timeout: 90000 }
    )
    const state = await win.evaluate(() => ({
      block: window.__SAI_TEST__.useOutputStore.getState().blocks[0],
      request: window.__SAI_RUNS__.at(-1),
      variables: window.__SAI_TEST__.useDatasetStore.getState().variables
    }))
    expect(state.block.error).toBeFalsy()
    expect(state.block.result.success).toBe(true)
    expect(state.request.params.settings.options.link).toBe('probit')
    expect(state.request.params.settings.scale.terms).toHaveLength(1)
    expect(state.request.params.settings.location.terms).toHaveLength(2)
    const titles = state.block.result.tables.map(t => t.titleKey)
    for (const key of ['history', 'correlations', 'covariances', 'cellInfo', 'parallelLines'])
      expect(titles).toContain(`output.ordinal.extra.${key}`)
    await win.waitForFunction(() =>
      window.__SAI_TEST__.useDatasetStore.getState().variables.some(v => v.name === 'est3')
    )
    const names = await win.evaluate(() =>
      window.__SAI_TEST__.useDatasetStore.getState().variables.map(v => v.name)
    )
    for (const name of ['est1', 'est2', 'est3', 'pgr', 'pre', 'acp']) expect(names).toContain(name)
    await win.screenshot({
      animations: 'disabled',
      path: path.resolve(__dirname, '../../tmp/ordinal-output.png')
    })
    console.log('PASS: four panels, cancel isolation, real R output, six saved columns')
  } finally {
    await app.close()
  }
}
main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
