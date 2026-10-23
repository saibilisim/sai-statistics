// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Import of Excel and SPSS files, value by value:
 *
 *  Excel (tests/fixtures/import-excel*.xlsx):
 *   - date cells arrive as dates (were Excel serial numbers: 2003-04-01 → 37712)
 *   - leading-zero codes stored as text stay text ("001" became 1)
 *   - a number stored as text ("24") in a numeric column still reads as 24
 *   - a column mixing numbers/dates with text imports as text without losing
 *     a single value (a typed read aborts on such columns)
 *
 *  SPSS (.sav written here with R/haven, so the file is known exactly):
 *   - user-missing codes stay VALUES (9, 99999 — read_stat made them NULL)
 *     and their definitions come along (discrete + range)
 *   - variable labels, value labels, F-format decimals, column width, dates,
 *     string codes with leading zeros
 *
 * Needs R with haven + arrow. Usage: node tests/e2e/run-e2e.cjs import-formats
 */
const { _electron } = require('@playwright/test')
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const TMP = path.join(ROOT, 'tmp')
fs.mkdirSync(TMP, { recursive: true })
const XLSX = path.join(ROOT, 'tests', 'fixtures', 'import-excel.xlsx')
const XLSX_MIXED = path.join(ROOT, 'tests', 'fixtures', 'import-excel-mixed.xlsx')
const SAV = path.join(TMP, 'sai-import-test.sav')

// ── Write the .sav fixture with haven ───────────────────────────────────
const makeSav = path.join(TMP, 'sai-make-sav.R')
fs.writeFileSync(
  makeSav,
  `suppressPackageStartupMessages(library(haven))
cins <- labelled_spss(c(1, 2, 1, 9, 2), labels = c("Kadın" = 1, "Erkek" = 2, "Cevapsız" = 9),
                      na_values = 9, label = "Cinsiyet")
attr(cins, "format.spss") <- "F1.0"
gelir <- labelled_spss(c(1500.5, 99999, 2300.25, NA, 800), na_range = c(99990, 99999),
                       label = "Aylık gelir (TL)")
attr(gelir, "format.spss") <- "F10.2"
attr(gelir, "display_width") <- 14
kod <- c("001", "002", "010", "100", "")
dogum <- as.Date(c("2001-01-15", "1999-12-31", NA, "2010-06-30", "2020-02-29"))
write_sav(tibble::tibble(cinsiyet = cins, gelir = gelir, kod = kod, dogum = dogum),
          ${JSON.stringify(SAV.replace(/\\/g, '/'))})
`
)
const mk = spawnSync('Rscript', [makeSav], { encoding: 'utf8' })
if (mk.status !== 0 || !fs.existsSync(SAV)) {
  console.error('could not write the .sav fixture:', mk.stderr)
  process.exit(1)
}

async function main() {
  const app = await _electron.launch({ args: ['out/main/main.cjs', '--no-sandbox'], cwd: ROOT })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)

  const importFile = fp =>
    win.evaluate(async p => {
      const r = await window.api.file.import({ filePath: p })
      const all = await window.api.data.getAll({ datasetId: r.dataset.id })
      const col = {}
      const v = {}
      r.variables.forEach((vv, i) => {
        col[vv.name] = all.rows.map(row => row[i])
        v[vv.name] = vv
      })
      return { col, v }
    }, fp)
  const ymd = x => (x === null || x === undefined ? null : String(x).slice(0, 10))

  const x = await importFile(XLSX)
  const m = await importFile(XLSX_MIXED)
  const s = await importFile(SAV)

  const checks = {
    // Excel
    xlsxDateType: x.v.Dogum_Tarihi?.type === 'date',
    xlsxDateValues:
      JSON.stringify(x.col.Dogum_Tarihi?.map(ymd)) ===
      JSON.stringify(['2003-04-01', '2002-12-31', '2001-01-15', null]),
    xlsxLeadingZeroText:
      x.v.Kod?.type === 'string' && JSON.stringify(x.col.Kod) === '["001","002","010","100"]',
    xlsxNumberAsText: x.v.Yas?.type === 'numeric' && x.col.Yas?.[3] === 24,
    xlsxTurkishHeaderLabel: x.v.Ogrenci_No?.label === 'Öğrenci No',
    xlsxDecimals: x.col.Puan?.[2] === 77.25,
    mixedKeepsEveryValue:
      m.v.a_num_then_text?.type === 'string' &&
      m.col.a_num_then_text?.[2] === 'abc' &&
      m.col.a_num_then_text?.[0] === '1',
    mixedDatesReadable:
      m.col.c_date_then_text?.[0] === '2020-01-01' && m.col.c_date_then_text?.[2] === 'bilinmiyor',
    // SPSS
    savUserMissingKept: JSON.stringify(s.col.cinsiyet) === '[1,2,1,9,2]',
    savRangeMissingKept: s.col.gelir?.[1] === 99999,
    savDiscreteMissingDef:
      s.v.cinsiyet?.missing?.type === 'discrete' && s.v.cinsiyet.missing.discrete?.[0] === 9,
    savRangeMissingDef:
      s.v.gelir?.missing?.type === 'range' &&
      s.v.gelir.missing.rangeLow === 99990 &&
      s.v.gelir.missing.rangeHigh === 99999,
    savLabels:
      s.v.gelir?.label === 'Aylık gelir (TL)' && s.v.cinsiyet?.valueLabels?.['9'] === 'Cevapsız',
    savFormats:
      s.v.cinsiyet?.decimals === 0 && s.v.gelir?.decimals === 2 && s.v.gelir?.columns === 14,
    savStringCodes: s.v.kod?.type === 'string' && s.col.kod?.[0] === '001',
    savDates:
      s.v.dogum?.type === 'date' &&
      ymd(s.col.dogum?.[3]) === '2010-06-30' &&
      s.col.dogum?.[2] === null,
    noPageErrors: errors.length === 0
  }
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)
  console.log(
    'RESULT:' +
      JSON.stringify({
        failed,
        excel: { Dogum_Tarihi: x.col.Dogum_Tarihi, Kod: x.col.Kod, Yas: x.col.Yas },
        mixed: m.col,
        sav: { col: s.col, cinsiyet: s.v.cinsiyet?.missing, gelir: s.v.gelir?.missing },
        errors
      })
  )
  await app.close()
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
