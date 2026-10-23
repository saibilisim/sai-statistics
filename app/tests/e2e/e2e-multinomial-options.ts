// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
// Run after pnpm build: pnpm exec node tests/e2e/e2e-multinomial-options.ts
// Uses a separate user-data directory and a generated fixture; no user data.
import { _electron, expect } from '@playwright/test'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { useDatasetStore } from '../src/store/dataset-store.ts'
import type { useSettingsStore } from '../src/store/settings-store.ts'
import type { useOutputStore } from '../src/store/output-store.ts'
import type { useUIStore } from '../src/store/ui-store.ts'
import type { api } from '../electron/preload.ts'

type TestWindow = Window & {
  api: typeof api
  __SAI_TEST__: {
    useDatasetStore: typeof useDatasetStore
    useSettingsStore: typeof useSettingsStore
    useOutputStore: typeof useOutputStore
    useUIStore: typeof useUIStore
  }
}
const dir = resolve('tmp/multinomial-e2e')
await mkdir(dir, { recursive: true })
const csv = resolve(dir, 'data.csv')
const xml = resolve(dir, 'model.xml')
const rows = ['outcome,age,group']
for (let i = 0; i < 180; i++)
  rows.push(
    `${['a', 'b', 'c'][(i * 13 + Math.floor(i / 7)) % 3]},${20 + ((i * 7) % 43)},${i % 2 ? 'B' : 'A'}`
  )
await writeFile(csv, rows.join('\n'), 'utf8')
const app = await _electron.launch({
  args: ['out/main/main.cjs', `--user-data-dir=${resolve(dir, 'profile')}`],
  cwd: process.cwd()
})
try {
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', error => errors.push(error.message))
  await win.waitForFunction(() => Boolean((window as TestWindow).__SAI_TEST__))
  await app.evaluate(({ dialog, BrowserWindow }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    dialog.showMessageBoxSync = () => 1
    BrowserWindow.getAllWindows()[0]?.setSize(1250, 950)
  }, xml)
  const ids = await win.evaluate(async filePath => {
    const w = window as TestWindow
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
  await expect(win.getByRole('tab', { name: 'Data View', exact: true })).toBeVisible()
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate(bw => {
    bw.webContents.send('menu:analyze:regression-multinomial')
  })
  const main = win.getByRole('dialog').first()
  await expect(main).toBeVisible()
  console.log('Variables:', await main.getByRole('option').allTextContents())
  for (const [field, variable] of [
    ['Dependent:', 'outcome'],
    ['Factors', 'group'],
    ['Covariates:', 'age']
  ]) {
    // Existing labels are localized resources, with punctuation varying by locale revision.
    await main.getByRole('listbox', { name: new RegExp(field.replace(':', ''), 'i') }).click()
    await main.getByRole('option', { name: new RegExp(`^${variable}(?:\\s|$)`) }).click()
    await main
      .getByRole('button', { name: 'Move right', exact: true })
      .nth(['Dependent:', 'Factors', 'Covariates:'].indexOf(field))
      .click()
  }
  const open = async (name: string) => {
    await main.getByRole('button', { name, exact: true }).click()
    const sub = win.getByRole('dialog').last()
    await expect(sub).toBeVisible()
    return sub
  }
  let sub = await open('Save')
  await sub.getByLabel('Estimated response probabilities', { exact: true }).check()
  await sub.getByLabel('Actual category probability', { exact: true }).check()
  await sub.getByRole('button', { name: 'Browse…' }).click()
  await expect(sub.getByLabel('Export model information to XML (PMML)')).toHaveValue(xml)
  await sub.screenshot({ path: resolve(dir, '01-save.png') })
  await sub.getByRole('button', { name: 'Continue', exact: true }).click()

  sub = await open('Model')
  await sub.getByLabel('Custom / Stepwise', { exact: true }).check()
  await sub.getByLabel('Factors & Covariates').selectOption([ids.group!, ids.age!])
  await sub.getByLabel('Build Terms').selectOption('main')
  await sub.getByRole('button', { name: 'Add to forced entry →' }).click()
  await sub.getByLabel('Build Terms').selectOption('interaction')
  await sub.getByRole('button', { name: 'Add to forced entry →' }).click()
  await sub.screenshot({ path: resolve(dir, '02-model.png') })
  await sub.getByRole('button', { name: 'Continue', exact: true }).click()

  sub = await open('Options')
  await sub.getByLabel('Scale', { exact: true }).selectOption('fixed')
  await sub.getByLabel('Value', { exact: true }).fill('2')
  await sub.screenshot({ path: resolve(dir, '03-options.png') })
  await sub.getByRole('button', { name: 'Continue', exact: true }).click()

  sub = await open('Convergence Criteria')
  await sub.getByLabel('Maximum iterations', { exact: true }).fill('150')
  await sub.getByLabel('Print iteration history', { exact: true }).check()
  await sub.screenshot({ path: resolve(dir, '04-criteria.png') })
  await sub.getByRole('button', { name: 'Continue', exact: true }).click()
  sub = await open('Convergence Criteria')
  await expect(sub.getByLabel('Maximum iterations', { exact: true })).toHaveValue('150')
  await sub.getByLabel('Maximum iterations', { exact: true }).fill('2')
  await sub.getByRole('button', { name: 'Cancel', exact: true }).click()
  sub = await open('Convergence Criteria')
  await expect(sub.getByLabel('Maximum iterations', { exact: true })).toHaveValue('150')
  await sub.getByRole('button', { name: 'Cancel', exact: true }).click()

  sub = await open('Statistics')
  for (const label of [
    'Classification table',
    'Goodness-of-fit',
    'Asymptotic correlations',
    'Asymptotic covariances',
    'Information criteria',
    'Cell probabilities',
    'Monotonicity measures'
  ])
    await sub.getByLabel(label, { exact: true }).check()
  await sub.getByLabel('Confidence interval (%)', { exact: true }).fill('90')
  await sub.screenshot({ path: resolve(dir, '05-statistics.png') })
  await sub.getByRole('button', { name: 'Continue', exact: true }).click()
  await main.getByRole('button', { name: 'OK', exact: true }).click()
  console.log('Analysis submitted')
  console.log(
    'Request:',
    await win.evaluate(() => (window as Window & { __SAI_RUNS__?: unknown[] }).__SAI_RUNS__)
  )
  await win.waitForFunction(
    () => (window as TestWindow).__SAI_TEST__.useOutputStore.getState().blocks.length > 0,
    undefined,
    { timeout: 60000 }
  )
  const result = await win.evaluate(() => {
    const w = window as TestWindow
    return {
      block: w.__SAI_TEST__.useOutputStore.getState().blocks[0],
      variables: w.__SAI_TEST__.useDatasetStore.getState().variables.map(v => v.name)
    }
  })
  console.log(
    'Analysis result:',
    JSON.stringify({
      success: result.block?.result.success,
      warnings: result.block?.result.warnings,
      tables: result.block?.result.tables.map(t => t.titleKey)
    })
  )
  expect(result.block?.result.success).toBe(true)
  expect(
    result.block?.result.tables.some(t => t.titleKey === 'output.multinom.extra.classification')
  ).toBe(true)
  await win.waitForFunction(() =>
    (window as TestWindow).__SAI_TEST__.useDatasetStore
      .getState()
      .variables.some(v => v.name === 'est3')
  )
  expect(await readFile(xml, 'utf8')).toContain('normalizationMethod="softmax"')
  expect(errors).toEqual([])
  console.log(
    'PASS: five dialogs, Continue/Cancel, real R analysis, saved probabilities, XML export'
  )
} finally {
  await app.close()
}
