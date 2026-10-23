// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * setup-e2e-fixtures.cjs — writes the /tmp/sai-*.csv fixture files that
 * several tests/e2e/e2e-*.cjs scenarios expect to already exist (documented,
 * until now, only as scattered header comments in each script — see
 * faz8-kalite-roadmap.md K8.1). Idempotent: always (re)writes the same
 * known-good content, so re-running is safe.
 *
 * Column conventions come directly from the consuming scripts' own header
 * comments:
 *   sai-test.csv  — cinsiyet (1/2 coded, used by value-label tests),
 *                   yas (numeric age), puan (numeric score). col_1/2/3.
 *   sai-30.csv    — ad, yas, puan (see e2e-filter-weight.cjs/e2e-row-click.cjs).
 *   sai-group.csv — grup (A/B/C), yas (see e2e-split.cjs).
 *   sai-drag.csv  — id (1..12, unique + order-revealing), deger. Row-drag
 *                   tests need to tell rows apart AFTER a reorder, which
 *                   sai-test.csv's repeating 1/2 cinsiyet codes can't do.
 *
 * Usage: node tests/e2e/setup-e2e-fixtures.cjs
 */
const fs = require('fs')
const nodePath = require('path')

function write(path, rows) {
  // Create the directory first. These fixtures live at "/tmp/...", which Node
  // on Windows resolves drive-relative ("C:\tmp\..."), and that directory does
  // not exist on a fresh Windows machine. Without this the write threw ENOENT,
  // and the ~30 e2e scripts that need these files then failed with DuckDB's
  // "No files found that match the pattern" — which reads like a product bug
  // and is not one.
  fs.mkdirSync(nodePath.dirname(path), { recursive: true })
  fs.writeFileSync(path, rows.join('\n') + '\n')
  console.log(`wrote ${path} (${rows.length - 1} data rows)`)
}

// NOTE: the first five data rows are load-bearing — several e2e scripts
// assert on their exact values. Rows 6-12 were appended (2026-07-24) because
// e2e-keyboard-select / e2e-deselect-split / e2e-multi-select-copy /
// e2e-fill-shortcuts click row-index 5 and 6, and timed out at the fixture-
// load step with only five rows. Append here, never renumber the first five.
write('/tmp/sai-test.csv', [
  'cinsiyet,yas,puan',
  '1,25,80',
  '2,30,75',
  '1,22,90',
  '2,28,60',
  '1,35,70',
  '2,40,55',
  '1,27,88',
  '2,33,62',
  '1,29,77',
  '2,45,50',
  '1,31,84',
  '2,38,66'
])

write('/tmp/sai-30.csv', [
  'ad,yas,puan',
  ...Array.from({ length: 30 }, (_, i) => {
    const n = i + 1
    const ad = `Kisi${String(n).padStart(2, '0')}`
    const yas = 18 + (n % 40)
    const puan = 50 + ((n * 7) % 51)
    return `${ad},${yas},${puan}`
  })
])

write('/tmp/sai-drag.csv', [
  'id,deger',
  ...Array.from({ length: 12 }, (_, i) => `${i + 1},${(i + 1) * 10}`)
])

write('/tmp/sai-group.csv', [
  'grup,yas',
  'A,22',
  'A,25',
  'A,28',
  'B,31',
  'B,34',
  'B,37',
  'C,40',
  'C,43',
  'C,46'
])

console.log('e2e fixtures ready.')
