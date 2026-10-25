// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* File > Export Data > Excel (.xlsx) end to end. The DuckDB excel extension
 * renamed its COPY format to `xlsx`; the old `FORMAT EXCEL` made every Excel
 * export fail ("Copy Function with name excel does not exist") with nothing
 * catching it. This script:
 *   1. imports a small fixture (Turkish characters, a decimal, an empty cell),
 *   2. exports it through window.api.file.exportXlsx (path given directly —
 *      SAI_E2E, electron/ipc/approved-paths.ts),
 *   3. imports the .xlsx back: header row, values and row count must survive.
 *
 * Usage: node tests/e2e/run-e2e.cjs export-xlsx   (after pnpm build)
 */
const { _electron } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const TMP = path.join(__dirname, '..', '..', 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const FX = path.join(TMP, 'sai-xlsx-src.csv')
const OUT = path.join(TMP, 'sai-xlsx-out.xlsx')
fs.writeFileSync(FX, 'id,ad,puan\n1,çiğdem,1.5\n2,Şükrü,\n3,ılgın,40\n')
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

  const result = await win.evaluate(
    async ({ fx, out }) => {
      const r = await window.api.file.import({ filePath: fx })
      let exported = null
      let exportError = null
      try {
        exported = await window.api.file.exportXlsx({ datasetId: r.dataset.id, filePath: out })
      } catch (e) {
        exportError = String(e)
      }
      if (exportError) return { exportError }
      const back = await window.api.file.import({ filePath: out })
      const slice = await window.api.data.getAll({ datasetId: back.dataset.id })
      return {
        exported,
        names: back.variables.map(v => v.name),
        rowCount: back.dataset.rowCount,
        rows: slice.rows ?? slice
      }
    },
    { fx: FX, out: OUT }
  )
  await app.close()

  console.log('RESULT:', JSON.stringify(result))
  const rowsText = JSON.stringify(result.rows ?? '')
  const checks = {
    exported: !result.exportError && fs.existsSync(OUT),
    header: JSON.stringify(result.names) === JSON.stringify(['id', 'ad', 'puan']),
    rowCount: result.rowCount === 3,
    turkish:
      rowsText.includes('çiğdem') && rowsText.includes('Şükrü') && rowsText.includes('ılgın'),
    noPageErrors: errors.length === 0
  }
  console.log('checks:', JSON.stringify(checks))
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)
  if (failed.length) {
    console.log('FAILED:', failed.join(', '))
    process.exit(1)
  }
  console.log('E2E PASSED')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
