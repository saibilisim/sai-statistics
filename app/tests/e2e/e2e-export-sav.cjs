// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* File > Export Data > SPSS (.sav) end to end:
 *   1. Import a small fixture, give it Variable View metadata (variable
 *      label, value labels, discrete + range user-missing, decimals).
 *   2. Trigger the menu channel (save dialog stubbed to app/tmp/…sav).
 *   3. Read the .sav back with R/haven — values, row order, labels, value
 *      labels, user-missing and print formats must all survive; Turkish
 *      characters must round-trip (UTF-8).
 *   4. Re-import the .sav into the app: values (incl. the user-missing code),
 *      labels and the missing-value definition come back.
 *
 * Needs R with haven + arrow (bundled runtime or system R).
 * Usage: node tests/e2e/run-e2e.cjs export-sav   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const TMP = path.join(__dirname, '..', '..', 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const FX = path.join(TMP, 'sai-sav-src.csv')
const OUT = path.join(TMP, 'sai-sav-out.sav')
fs.writeFileSync(
  FX,
  'id,grp,x,s\n3,1,1.5,çiğ öğrenci\n1,2,2.25,a\n2,9,,uzun bir metin değeri burada\n4,1,40,b\n'
)
if (fs.existsSync(OUT)) fs.unlinkSync(OUT)

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

  await app.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: out })
    dialog.showMessageBoxSync = () => 1
    globalThis.__savMessages = []
    dialog.showMessageBox = async opts => {
      globalThis.__savMessages.push(opts.message)
      return { response: 0, checkboxChecked: false }
    }
  }, OUT)

  await win.evaluate(async fp => {
    const r = await window.api.file.import({ filePath: fp })
    const ds = r.dataset.id
    const byName = n => r.variables.find(v => v.name === n).colId
    await window.api.variable.update({
      datasetId: ds,
      colId: byName('grp'),
      updates: {
        label: 'Grup değişkeni',
        valueLabels: { 1: 'Kadın', 2: 'Erkek', 9: 'Cevapsız' },
        missing: { type: 'discrete', discrete: [9] }
      }
    })
    await window.api.variable.update({
      datasetId: ds,
      colId: byName('x'),
      updates: { decimals: 3, columns: 12, missing: { type: 'range', rangeLow: 30, rangeHigh: 50 } }
    })
    // Sort by id so the exported row order must follow the CASE order,
    // not the physical insertion order.
    await window.api.data.sortMulti({
      datasetId: ds,
      keys: [{ colId: byName('id'), direction: 'asc' }]
    })
    const vars = await window.api.variable.getAll({ datasetId: ds })
    window.__SAI_TEST__.useDatasetStore
      .getState()
      .setDataset(ds, r.dataset.name, r.dataset.filePath, vars, r.dataset.rowCount, r.styles)
  }, FX)
  await win.waitForTimeout(800)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:file:export:spss')
  })
  // R startup + haven load
  for (let i = 0; i < 60 && !fs.existsSync(OUT); i++) await win.waitForTimeout(500)
  await win.waitForTimeout(500)
  const written = fs.existsSync(OUT)
  const messages = await app.evaluate(() => globalThis.__savMessages)

  // ── Read it back with haven ────────────────────────────────────────────
  let rCheck = null
  if (written) {
    const rCode = `
      suppressPackageStartupMessages({library(haven); library(jsonlite)})
      d <- read_sav(${JSON.stringify(OUT.replace(/\\/g, '/'))}, user_na = TRUE)
      cat(toJSON(list(
        names = names(d),
        id = as.numeric(d$id),
        grp = as.numeric(d$grp),
        x = as.numeric(d$x),
        s = as.character(d$s),
        grpLabel = attr(d$grp, "label"),
        idLabel = if (is.null(attr(d$id, "label"))) NA else attr(d$id, "label"),
        grpLabels = as.list(attr(d$grp, "labels")),
        grpNa = attr(d$grp, "na_values"),
        xNaRange = attr(d$x, "na_range"),
        xFormat = attr(d$x, "format.spss"),
        xWidth = attr(d$x, "display_width")
      ), auto_unbox = TRUE, na = "null"))`
    // Via a file: multi-line -e code does not survive Windows argv quoting.
    const rFile = path.join(TMP, 'sai-sav-check.R')
    fs.writeFileSync(rFile, rCode)
    const r = spawnSync('Rscript', [rFile], { encoding: 'utf8' })
    try {
      rCheck = JSON.parse(r.stdout)
    } catch {
      rCheck = { parseError: r.stdout + r.stderr }
    }
  }

  // ── CSV export shares the "user-facing columns" query with Excel: the
  // header must carry variable NAMES (was col_1,col_2,…) in case order.
  const csvOut = path.join(TMP, 'sai-sav-out.csv')
  await win.evaluate(async out => {
    const s = window.__SAI_TEST__.useDatasetStore.getState()
    await window.api.file.exportCsv({ datasetId: s.datasetId, filePath: out })
  }, csvOut)
  const csvLines = fs.readFileSync(csvOut, 'utf8').trim().split(/\r?\n/)

  // ── Re-import into the app ─────────────────────────────────────────────
  const reimport = written
    ? await win.evaluate(async out => {
        const r = await window.api.file.import({ filePath: out })
        const all = await window.api.data.getAll({ datasetId: r.dataset.id })
        const grp = r.variables.find(v => v.name === 'grp')
        const gi = r.variables.indexOf(grp)
        return {
          names: r.variables.map(v => v.name),
          grp: all.rows.map(row => row[gi]),
          grpLabel: grp?.label,
          grpMissing: grp?.missing,
          grpValueLabels: grp?.valueLabels
        }
      }, OUT)
    : null

  const checks = {
    written,
    noErrorDialog: messages.length === 0,
    names: JSON.stringify(rCheck?.names) === JSON.stringify(['id', 'grp', 'x', 's']),
    caseOrder: JSON.stringify(rCheck?.id) === JSON.stringify([1, 2, 3, 4]),
    values:
      JSON.stringify(rCheck?.grp) === JSON.stringify([2, 9, 1, 1]) &&
      JSON.stringify(rCheck?.x) === JSON.stringify([2.25, null, 1.5, 40]),
    utf8Strings:
      rCheck?.s?.[2] === 'çiğ öğrenci' && rCheck?.s?.[1] === 'uzun bir metin değeri burada',
    varLabel: rCheck?.grpLabel === 'Grup değişkeni' && rCheck?.idLabel === null,
    valueLabels: rCheck?.grpLabels?.['Kadın'] === 1 && rCheck?.grpLabels?.['Cevapsız'] === 9,
    discreteMissing: [9, '[9]'].includes(
      Array.isArray(rCheck?.grpNa) ? JSON.stringify(rCheck.grpNa) : rCheck?.grpNa
    ),
    rangeMissing: JSON.stringify(rCheck?.xNaRange) === '[30,50]',
    format: rCheck?.xFormat === 'F8.3',
    columnWidth: rCheck?.xWidth === 12,
    reimportLabels:
      reimport?.grpLabel === 'Grup değişkeni' && reimport?.grpValueLabels?.['1'] === 'Kadın',
    // Full round trip: the user-missing code 9 must survive export AND import
    // (the old read_stat importer turned it into NULL), with its definition.
    reimportValues: JSON.stringify(reimport?.grp) === JSON.stringify([2, 9, 1, 1]),
    reimportMissingDef:
      reimport?.grpMissing?.type === 'discrete' && reimport.grpMissing.discrete?.[0] === 9,
    csvHeader: csvLines[0] === 'id,grp,x,s',
    csvCaseOrder:
      csvLines
        .slice(1)
        .map(l => parseFloat(l))
        .join() === '1,2,3,4',
    noPageErrors: errors.length === 0
  }
  const failed = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  console.log('RESULT:' + JSON.stringify({ failed, messages, rCheck, reimport, errors }))

  await app.close()
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
