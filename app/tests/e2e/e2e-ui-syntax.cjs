// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the menu -> dialog -> syntax chain, captured for the SPSS parity run.
 *
 * For each scenario below this script
 *   1. opens the dialog through the SAME channel the native menu item pushes;
 *   2. makes real selections (source list + ▶ buttons, sub-dialog checkboxes,
 *      text fields);
 *   3. clicks "Paste Syntax" and reads the SPSS command the dialog's state
 *      produces out of the Terminal buffer;
 *   4. re-opens the dialog, makes the SAME selections again, clicks OK and
 *      captures the exact payload window.api.analysis.run received.
 *
 * Outputs (consumed by the rest of the ui-parity harness):
 *   tests/spss-parity/ui-job.sps           — pasted commands, ready for SPSS
 *   tests/spss-parity/ui-dialog-runs.json  — {id, channel, syntax, okRequest}
 *
 * The parity side then runs the .sps in real SPSS (ui-job.spj), dispatches the
 * same text through our syntax registry (dispatch-ui-syntax.test.ts), and
 * compare-ui.R checks the numbers — one run over the whole chain:
 * menu -> dialog wiring -> syntax generation -> syntax parsing -> R -> SPSS.
 *
 * Run: node tests/e2e/e2e-ui-syntax.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const { SCENARIOS, makeT, createDriver } = require('./lib/ui-dialog-driver.cjs')
const fs = require('node:fs')
const path = require('node:path')

const APP_DIR = path.join(__dirname, '..', '..')
const PARITY_DIR = path.join(APP_DIR, 'tests', 'spss-parity')
const CSV = path.join(PARITY_DIR, 'data.csv')

async function main() {
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: APP_DIR
  })
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

  // The parity dataset itself, through the real import IPC + store mount — the
  // same data.csv SPSS will read, so the numbers are comparable cell by cell.
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
  const mounted = await win.evaluate(() =>
    (window.__SAI_TEST__.useDatasetStore.getState().variables ?? []).map(v => v.name)
  )
  check(
    mounted.includes('score') && mounted.includes('grp3'),
    `parity data.csv mounted (${mounted.length} variables)`
  )

  // Capture every OK-path analysis request: this is the dialog -> params half.
  // useRunAnalysis pushes each queued request onto window.__SAI_RUNS__ (the
  // preload's contextBridge objects are frozen, so wrapping api.analysis.run
  // itself silently does nothing).
  await win.evaluate(() => {
    window.__SAI_RUNS__ = []
  })

  // Read the language only once settings are loaded from disk — before that
  // the store holds the schema default ('en'), not the profile's language.
  await win.waitForFunction(() => window.__SAI_TEST__?.useSettingsStore.getState().isLoaded)
  const lang = await win.evaluate(
    () => window.__SAI_TEST__.useSettingsStore.getState().settings?.appearance?.language ?? 'tr'
  )
  const t = makeT(lang)
  console.log(`   ui language: ${lang}`)

  const { openDialog, clickMainButton, applySelections, lastBlockId, waitForBlock } = createDriver({
    app,
    win,
    t,
    fails
  })

  // 57 scenarios, each opening two dialogs and running a real analysis, is a
  // long session — and when one procedure is under change, re-running the
  // other 56 only makes the failure harder to find. SAI_E2E_SCENARIO takes a
  // substring (or comma-separated list) of scenario ids to run just those:
  //   SAI_E2E_SCENARIO=km-surv,cox-surv node tests/e2e/run-e2e.cjs ui-syntax
  // Unset runs everything, so CI is unaffected.
  const only = (process.env.SAI_E2E_SCENARIO ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const selected = only.length ? SCENARIOS.filter(s => only.some(o => s.id.includes(o))) : SCENARIOS
  if (only.length) {
    console.log(`(SAI_E2E_SCENARIO=${only.join(',')} -> ${selected.length} scenario(s))`)
  }

  const runs = []
  for (const scn of selected) {
    console.log(`\n== ${scn.id} ==`)

    // Pass 1: selections -> Paste Syntax -> the SPSS command out of the buffer.
    await win.evaluate(() => window.__SAI_TEST__.useTerminalStore.getState().setSource(''))
    if (!(await openDialog(scn.channel, scn.id, (scn.vars ?? []).length > 0))) continue
    await applySelections(scn)
    const beforePaste = await win.evaluate(() => window.__SAI_RUNS__.length)
    const pasted = await clickMainButton(t('common:common.pasteSyntax'))
    check(pasted, `${scn.id}: Paste Syntax button found and clicked`)
    await win.waitForTimeout(400)
    const syntax = await win.evaluate(() =>
      window.__SAI_TEST__.useTerminalStore.getState().source.trim()
    )
    check(
      syntax.length > 0,
      `${scn.id}: syntax landed in the terminal buffer [${syntax.replace(/\s+/g, ' ')}]`
    )
    check(
      await win.evaluate(() => !document.querySelector('[role="dialog"]')),
      `${scn.id}: dialog closed after Paste`
    )

    // Pass 2: the same selections -> OK -> the params the analysis received.
    if (!(await openDialog(scn.channel, scn.id, (scn.vars ?? []).length > 0))) continue
    await applySelections(scn)
    const prevBlock = await lastBlockId()
    const okClicked = await clickMainButton(t('common:common.ok'))
    check(okClicked, `${scn.id}: OK button found and clicked`)
    const block = await waitForBlock(prevBlock)
    check(
      Boolean(block) && !block.error,
      `${scn.id}: OK run produced a new output block (${block?.error ?? 'ok'})`
    )
    const okRequest = await win.evaluate(idx => window.__SAI_RUNS__[idx] ?? null, beforePaste)
    check(Boolean(okRequest), `${scn.id}: analysis.run payload captured on the OK path`)

    runs.push({
      id: scn.id,
      channel: scn.channel,
      spss32: Boolean(scn.spss32),
      syntax,
      okRequest
    })
  }

  // ── Emit the artifacts ──────────────────────────────────────────────────
  const header = [
    '* UI-driven parity job — written by e2e-ui-syntax.cjs; do not edit by hand.',
    '* Each command below is the Paste-Syntax output of a dialog driven through',
    '* the real menu channel. Same data and import as job.sps.',
    'SET DECIMAL=DOT.',
    '',
    'GET DATA /TYPE=TXT',
    `  /FILE='${CSV.replace(/\//g, '\\')}'`,
    '  /DELIMITERS="," /QUALIFIER=\'"\' /FIRSTCASE=2',
    '  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0',
    '             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0',
    '             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0',
    '             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.',
    '',
    '* Enough decimals that comparisons are not limited by the display format.',
    'FORMATS score income age pre post surv (F14.6).',
    ''
  ]
  // Two jobs, not one: procedures that only exist in SPSS 27+ (PROPORTIONS,
  // GENLINMIXED) go to ui-job32.sps and run against the SPSS 32 install; the
  // rest stay on the SPSS 26 reference so its numbers keep their baseline.
  const byVersion = want32 => runs.filter(r => r.syntax && Boolean(r.spss32) === want32)
  const bodyOf = list => list.map(r => [`* scenario: ${r.id}.`, r.syntax, ''].join('\n'))
  fs.writeFileSync(
    path.join(PARITY_DIR, 'ui-job.sps'),
    header.join('\n') + bodyOf(byVersion(false)).join('\n')
  )
  fs.writeFileSync(
    path.join(PARITY_DIR, 'ui-job32.sps'),
    header
      .join('\n')
      .replace('Same data and import as job.sps.', 'SPSS 27+ procedures — run against SPSS 32.') +
      bodyOf(byVersion(true)).join('\n')
  )
  fs.writeFileSync(path.join(PARITY_DIR, 'ui-dialog-runs.json'), JSON.stringify(runs, null, 2))
  console.log(
    `\nwrote ui-job.sps (${byVersion(false).length} commands) + ` +
      `ui-job32.sps (${byVersion(true).length}) + ui-dialog-runs.json`
  )

  check(pageErrors.length === 0, `no page errors (${pageErrors.join(' | ') || 'none'})`)

  await app.close()

  if (fails.length) {
    console.error('\nFAILED:\n  - ' + fails.join('\n  - '))
    process.exit(1)
  }
  console.log('\nPASSED: dialog selections captured as syntax and OK payloads')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
