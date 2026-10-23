// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: the Syntax/Terminal tab (5th tab) — Faz T1 SPSS dispatcher.
 *
 * Imports a CSV with two numeric columns (age, income) + one categorical (grp),
 * switches to the Terminal tab, drives the SPSS-syntax editor like a user
 * (FREQUENCIES + DESCRIPTIVES), clicks Run, and asserts that real R runs and the
 * results land in the Output store EVEN THOUGH we never opened the Output tab —
 * this verifies the global job subscription fix. Then runs RENAME VARIABLES and
 * asserts the dataset-store variable was renamed (data-side dispatch).
 *
 * Requires a real Rscript on PATH (this is a true end-to-end run).
 *
 * Run: xvfb-run -a node tests/e2e/e2e-terminal-syntax.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

function makeCsv() {
  const lines = ['age,income,grp,sex']
  for (let i = 0; i < 40; i++) {
    lines.push(
      `${20 + (i % 30)},${1000 + i * 37},${i % 2 === 0 ? 'A' : 'B'},${i % 3 === 0 ? 'M' : 'F'}`
    )
  }
  const file = path.join(os.tmpdir(), 'sai-terminal-e2e.csv')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

async function main() {
  const csvPath = makeCsv()
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  win.on('pageerror', err => console.log('[pageerror]', err.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // Import CSV and set as active dataset.
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
      vars: result.variables.map(v => ({ name: v.name, colId: v.colId, measure: v.measure }))
    }
  }, csvPath)
  console.log('setup:', JSON.stringify(setup))
  await win.waitForTimeout(500)

  // Open the Terminal tab.
  await win.evaluate(() => window.__SAI_TEST__.useUIStore.getState().setActiveTab('terminal'))
  await win.waitForTimeout(800)

  // Drive the SPSS editor + Run button like a user (analysis commands).
  const driveRun = async syntax => {
    await win.evaluate(text => {
      const ta = document.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set
      setter.call(ta, text)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /Run|Çalıştır/.test(b.textContent || '')
      )
      btn.click()
    }, syntax)
  }

  // Six analysis commands across the supported set — all should land in Output.
  await driveRun(
    [
      'FREQUENCIES VARIABLES=age.',
      'DESCRIPTIVES VARIABLES=income.',
      'CORRELATIONS VARIABLES=age income.',
      'MEANS TABLES=income BY grp.',
      'CROSSTABS /TABLES=grp BY sex.',
      'EXAMINE VARIABLES=income BY grp.'
    ].join('\n')
  )
  // Sequential R jobs — wait generously.
  await win.waitForTimeout(30000)

  const afterAnalysis = await win.evaluate(() => {
    const blocks = window.__SAI_TEST__.useOutputStore.getState().blocks
    const consoleLines = Array.from(document.querySelectorAll('[class*="line"]'))
      .map(e => e.textContent?.trim())
      .filter(Boolean)
    return {
      blockIds: blocks.map(b => b.analysisId),
      blockSuccess: blocks.map(b => b.result?.success),
      warnings: blocks.map(b => (b.result?.warnings || []).join(' | ')),
      consoleLines
    }
  })
  console.log('afterAnalysis:', JSON.stringify(afterAnalysis, null, 2))

  // Analysis batch 2 — BEFORE any rename (uses age/income/grp): t-test (3 forms),
  // oneway, regression, plus a physical SORT CASES.
  await driveRun(
    [
      'T-TEST GROUPS=grp(A B) /VARIABLES=income.',
      'T-TEST PAIRS=age WITH income.',
      'T-TEST /TESTVAL=1000 /VARIABLES=income.',
      'ONEWAY income BY grp.',
      'REGRESSION /DEPENDENT=income /METHOD=ENTER age.',
      'SORT CASES BY age (D).'
    ].join('\n')
  )
  await win.waitForTimeout(25000)
  const afterAnalysis2 = await win.evaluate(() => {
    const blocks = window.__SAI_TEST__.useOutputStore.getState().blocks
    const text = Array.from(document.querySelectorAll('[class*="line"]'))
      .map(e => e.textContent || '')
      .join('\n')
    return {
      blockIds: blocks.map(b => b.analysisId),
      blockSuccess: blocks.map(b => b.result?.success),
      text
    }
  })
  console.log(
    'afterAnalysis2:',
    JSON.stringify({ ids: afterAnalysis2.blockIds, ok: afterAnalysis2.blockSuccess })
  )

  // Data-side dispatches: recode, count, rank, autorecode, weight, split, rename.
  await driveRun(
    [
      "RECODE grp ('A'='1')('B'='2') INTO grpnum.",
      'COUNT hicount = income (1000).',
      'RANK VARIABLES=income (A).',
      'AUTORECODE VARIABLES=grp /INTO grpauto.',
      'WEIGHT BY income.',
      'SPLIT FILE BY grp.',
      'RENAME VARIABLES (age=ageYears).'
    ].join('\n')
  )
  await win.waitForTimeout(4000)
  const afterData = await win.evaluate(() => {
    const ds = window.__SAI_TEST__.useDatasetStore.getState()
    return {
      names: ds.variables.map(v => v.name),
      weight: ds.weightVariable,
      split: ds.splitVariable
    }
  })
  console.log('afterData:', JSON.stringify(afterData))

  // Recognition batch: a no-op (EXECUTE), three commands that now really run
  // (COMPUTE / SELECT IF / GLM — they only printed guidance when this test was
  // written), and an unknown one. None may hard-error; only GLM adds an
  // Output block.
  await driveRun(
    'EXECUTE.\nCOMPUTE bmi = 1.\nSELECT IF (income > 1000).\nFILTER BY grpnum.\nGLM income BY grp.\nFOOBAR spam.'
  )
  // GLM's block only lands once its R job finishes — a fixed 1.5 s wait
  // counted blocks before that on slower runs (11 instead of 12).
  for (let waited = 0; waited < 20000; waited += 300) {
    const n = await win.evaluate(() => window.__SAI_TEST__.useOutputStore.getState().blocks.length)
    if (n >= 12) break
    await win.waitForTimeout(300)
  }
  const recog = await win.evaluate(() => {
    const text = Array.from(document.querySelectorAll('[class*="line"]'))
      .map(e => e.textContent || '')
      .join('\n')
    return { text, blocks: window.__SAI_TEST__.useOutputStore.getState().blocks.length }
  })
  console.log('recog:', JSON.stringify(recog))

  await win.screenshot({ path: __dirname + '/../../e2e-terminal-syntax.png', fullPage: true })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 1
  })

  const want = ['frequencies', 'descriptives', 'correlate', 'means', 'crosstabs', 'explore']
  const want2 = ['ttestInd', 'ttestPaired', 'ttest1', 'anova', 'regression']
  const hasAll =
    want.every(id => afterAnalysis.blockIds.includes(id)) &&
    want2.every(id => afterAnalysis2.blockIds.includes(id))
  const noError =
    !afterAnalysis.blockIds.includes('error') && !afterAnalysis2.blockIds.includes('error')
  const allOk = [...afterAnalysis.blockSuccess, ...afterAnalysis2.blockSuccess].every(
    s => s === true
  )
  const sorted = /(Sorted|sıraland)/i.test(afterAnalysis2.text)
  const renamed = afterData.names.includes('ageYears') && !afterData.names.includes('age')
  const recoded = afterData.names.includes('grpnum')
  const counted = afterData.names.includes('hicount')
  const ranked = afterData.names.includes('income_rank')
  const autorecoded = afterData.names.includes('grpauto')
  const weighted = afterData.weight === 'col_2' // income
  const splitted = afterData.split === 'col_3' // grp

  const recNoop = /EXECUTE.*(acknowledged|kabul)/i.test(recog.text)
  // COMPUTE / SELECT IF / GLM were merely *recognised* when this test was
  // written — the dispatcher answered "use the cell formula" / "use Select
  // Cases" / "not yet implemented". All three are implemented now, so the
  // assertions check that they actually DO the work instead of declining it.
  const recCompute = /COMPUTE[\s\S]*?(Computed|Hesaplandı)/i.test(recog.text)
  const recFilter = /SELECT IF[\s\S]*?(applied|uygulandı)/i.test(recog.text)
  const recGlm = /GLM[\s\S]*?(sent to Output|Çıktı'ya gönderildi)/i.test(recog.text)
  const recUnknown = /(Unrecognized|Tanınmayan)[^\n]*FOOBAR/i.test(recog.text)
  // 6 + 5 analysis blocks from the phases above, plus the one GLM now emits.
  const recNoBlocks = recog.blocks === 12

  const pass =
    hasAll &&
    noError &&
    allOk &&
    sorted &&
    renamed &&
    recoded &&
    counted &&
    ranked &&
    autorecoded &&
    weighted &&
    splitted &&
    recNoop &&
    recCompute &&
    recFilter &&
    recGlm &&
    recUnknown &&
    recNoBlocks
  console.log(
    'checks:',
    JSON.stringify({
      hasAll,
      noError,
      allOk,
      sorted,
      renamed,
      recoded,
      counted,
      ranked,
      autorecoded,
      weighted,
      splitted,
      recNoop,
      recCompute,
      recFilter,
      recGlm,
      recUnknown,
      recNoBlocks
    })
  )

  await app.close()
  if (!pass) {
    console.error('E2E FAILED — see assertions above')
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
