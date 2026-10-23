// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* E2E: both Report Summaries procedures (Rows and Columns), end to end against
 * the built app —
 * real CSV import → DuckDB → analysis:run → report-summaries.R → job:complete
 * → Output store → rendered DOM.
 *
 * The r-validation suite already checks the arithmetic against independently
 * computed references. What only an e2e can prove is the wiring: that the
 * dialog's params survive the IPC hop, that the R script is actually shipped
 * in the build, and — the part that has bitten this menu before — that the
 * layout renders with the statistic NAMES resolved rather than raw
 * `output.col.*` keys leaking into the table. The Columns report additionally
 * exercises the composed "<variable> — <statistic>" header, whose statistic
 * half is a nested i18n key: if translateOutputKey stops resolving it, the raw
 * key shows up in the header and the assertions here catch it.
 *
 * Run: node tests/e2e/e2e-report-summaries.cjs   (after `pnpm build`)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 8 rows, two break groups of 4, salaries chosen so every asserted mean is
// exact in binary floating point and readable in the failure output.
function makeCsv() {
  const lines = [
    'salary,age,gender',
    '100,20,F',
    '300,30,F',
    '500,40,F',
    '700,50,F',
    '200,25,M',
    '400,35,M',
    '600,45,M',
    '800,55,M'
  ]
  const file = path.join(os.tmpdir(), 'sai-report-summaries-e2e.csv')
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return file
}

async function main() {
  const csvPath = makeCsv()
  const app = await _electron.launch({
    args: ['out/main/main.cjs', '--no-sandbox'],
    cwd: __dirname + '/../..'
  })
  const win = await app.firstWindow()
  const pageErrors = []
  win.on('pageerror', e => pageErrors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // Analysis results dirty the Output; the close guard's native dialog would
  // block forever headless (same pattern as e2e-analysis-cancel.cjs).
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showMessageBoxSync = () => 1
  })

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
    const byName = Object.fromEntries(result.variables.map(v => [v.name, v.colId]))
    return { datasetId: result.dataset.id, byName }
  }, csvPath)
  console.log('setup:', JSON.stringify(setup))

  await win.evaluate(() => {
    window.__jobs = []
    window.api.on.jobComplete(p =>
      window.__jobs.push({ ok: true, jobId: p.jobId, analysisId: p.analysisId })
    )
    window.api.on.jobError(p =>
      window.__jobs.push({ ok: false, errorKey: p.errorKey, details: p.details ?? null })
    )
    window.__SAI_TEST__.useUIStore.getState().setActiveTab('output')
  })

  // Exactly the params ReportSummariesDialog builds.
  await win.evaluate(cfg => {
    const { datasetId, byName } = cfg
    return window.api.analysis.run({
      analysisId: 'reportSummaries',
      datasetId,
      scriptFile: 'report-summaries.R',
      params: {
        variables: [byName.salary, byName.age],
        varNames: { [byName.salary]: 'Salary', [byName.age]: 'Age' },
        breakVars: [byName.gender],
        breakVarNames: { [byName.gender]: 'Gender' },
        breakValueLabels: { [byName.gender]: { F: 'Female', M: 'Male' } },
        displayCases: false,
        grandTotal: true,
        limitCases: null,
        options: { missing: 'analysis', stats: { n: true, mean: true } }
      }
    })
  }, setup)

  // The same data through Report Summaries in Columns.
  await win.evaluate(cfg => {
    const { datasetId, byName } = cfg
    return window.api.analysis.run({
      analysisId: 'reportColumns',
      datasetId,
      scriptFile: 'report-summaries-columns.R',
      params: {
        variables: [byName.salary, byName.age],
        varNames: { [byName.salary]: 'Salary', [byName.age]: 'Age' },
        breakVars: [byName.gender],
        breakVarNames: { [byName.gender]: 'Gender' },
        breakValueLabels: { [byName.gender]: { F: 'Female', M: 'Male' } },
        grandTotal: true,
        options: { missing: 'analysis', stats: { n: true, mean: true } }
      }
    })
  }, setup)

  // Wait for the jobs rather than sleeping: R start-up time varies a lot
  // between a cold and a warm run.
  const deadline = Date.now() + 90000
  let jobs = []
  for (;;) {
    jobs = await win.evaluate(() => window.__jobs)
    if (jobs.length >= 2) break
    if (Date.now() > deadline) break
    await win.waitForTimeout(250)
  }
  await win.waitForTimeout(600)

  // Select by job id, not DOM position: the Output view does not necessarily
  // render blocks in completion order, and an index-based lookup silently
  // compared the two reports against each other's expectations.
  const readTable = analysisId =>
    win.evaluate(id => {
      const jobId = (window.__jobs.find(j => j.analysisId === id) || {}).jobId
      const tbl = jobId ? document.querySelector(`#block-${jobId} table`) : null
      if (!tbl) return null
      const head = Array.from(tbl.querySelectorAll('thead th')).map(th =>
        (th.textContent || '').trim()
      )
      const rows = Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
        Array.from(tr.querySelectorAll('td, th')).map(td => (td.textContent || '').trim())
      )
      return { head, rows }
    }, analysisId)

  const table = await readTable('reportSummaries')
  const columnsTable = await readTable('reportColumns')

  console.log('jobs:', JSON.stringify(jobs))
  console.log('rows report:', JSON.stringify(table))
  console.log('columns report:', JSON.stringify(columnsTable))

  const fails = []
  const check = (cond, msg) => {
    if (!cond) fails.push(msg)
  }

  check(
    jobs.length === 2 && jobs.every(j => j.ok),
    `expected two successful jobs, got ${JSON.stringify(jobs)}`
  )
  check(table !== null, 'no rows-report table rendered')
  check(columnsTable !== null, 'no columns-report table rendered')

  if (table) {
    // Columns: Gender, Statistic, Salary, Age.
    check(table.head.length === 4, `expected 4 columns, got ${JSON.stringify(table.head)}`)
    check(table.head[0] === 'Gender', `col 1 should be the break variable, got "${table.head[0]}"`)
    check(table.head[2] === 'Salary' && table.head[3] === 'Age', 'data variables should be columns')

    // 2 groups × 2 statistics + 2 grand-total rows.
    check(table.rows.length === 6, `expected 6 rows, got ${table.rows.length}`)

    // Value labels resolved, break label printed once per block.
    check(table.rows[0]?.[0] === 'Female', `row 1 break label: "${table.rows[0]?.[0]}"`)
    check(table.rows[1]?.[0] === '', 'row 2 should repeat no break label')
    check(table.rows[2]?.[0] === 'Male', `row 3 break label: "${table.rows[2]?.[0]}"`)

    // The statistics are ROWS, and their names are translated — a raw
    // "output.col.mean" here is the leak this check exists for.
    const statCol = table.rows.map(r => r[1])
    check(
      !statCol.some(s => /^output\./.test(s) || /^col\./.test(s)),
      `untranslated statistic label(s): ${JSON.stringify(statCol)}`
    )
    check(
      statCol.filter(Boolean).length === 6,
      `every row needs a statistic label: ${JSON.stringify(statCol)}`
    )

    // Female salaries 100/300/500/700 → N 4, mean 400; Male → mean 500;
    // grand total mean 450. Asserted as text so the formatter is covered too.
    const cell = (r, c) => table.rows[r]?.[c]
    check(cell(0, 2) === '4', `Female Salary N: "${cell(0, 2)}"`)
    check(cell(1, 2) === '400', `Female Salary mean: "${cell(1, 2)}"`)
    check(cell(3, 2) === '500', `Male Salary mean: "${cell(3, 2)}"`)
    check(cell(4, 2) === '8', `Total Salary N: "${cell(4, 2)}"`)
    check(cell(5, 2) === '450', `Total Salary mean: "${cell(5, 2)}"`)
    // Age is a second, independent column — proves the report is not just
    // repeating the first variable across the row.
    check(cell(1, 3) === '35', `Female Age mean: "${cell(1, 3)}"`)
    check(cell(3, 3) === '40', `Male Age mean: "${cell(3, 3)}"`)
  }

  if (columnsTable) {
    // Gender + (Salary × {N, Mean}) + (Age × {N, Mean}).
    const h = columnsTable.head
    check(h.length === 5, `columns report should have 5 columns, got ${JSON.stringify(h)}`)
    check(h[0] === 'Gender', `columns report col 1: "${h[0]}"`)
    // The composed header: literal variable name + TRANSLATED statistic. A raw
    // "output.col.*" here means the nested key stopped being resolved.
    check(
      !h.some(c => /output\.|^col\./.test(c)),
      `untranslated column header(s): ${JSON.stringify(h)}`
    )
    check(
      h[1].includes('Salary') && h[2].includes('Salary') && h[3].includes('Age'),
      `columns report headers should name their variable: ${JSON.stringify(h)}`
    )
    check(h[1] !== h[2], `the two Salary columns must differ by statistic: ${JSON.stringify(h)}`)

    // One row per group plus the report-level row — the compactness that makes
    // this a different procedure from the rows report (6 rows for the same run).
    check(
      columnsTable.rows.length === 3,
      `columns report should have 3 rows, got ${columnsTable.rows.length}`
    )
    const c = (r, col) => columnsTable.rows[r]?.[col]
    check(c(0, 0) === 'Female', `columns row 1 label: "${c(0, 0)}"`)
    check(c(1, 0) === 'Male', `columns row 2 label: "${c(1, 0)}"`)
    check(c(0, 1) === '4' && c(0, 2) === '400', `Female Salary N/mean: ${c(0, 1)}/${c(0, 2)}`)
    check(c(1, 2) === '500', `Male Salary mean: "${c(1, 2)}"`)
    check(c(2, 2) === '450', `Total Salary mean: "${c(2, 2)}"`)
    check(c(0, 4) === '35', `Female Age mean: "${c(0, 4)}"`)

    // Same data, same statistics: the two layouts must agree cell for cell.
    check(c(0, 2) === table.rows[1]?.[2], 'Female Salary mean differs between the two reports')
    check(c(1, 2) === table.rows[3]?.[2], 'Male Salary mean differs between the two reports')
    check(c(2, 2) === table.rows[5]?.[2], 'Total Salary mean differs between the two reports')
  }

  check(pageErrors.length === 0, `page errors: ${JSON.stringify(pageErrors)}`)

  await app.close()

  if (fails.length > 0) {
    console.error('E2E FAILED:\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
