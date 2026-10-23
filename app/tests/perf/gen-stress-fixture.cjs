// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * gen-stress-fixture.cjs — generates a large synthetic CSV for local
 * performance measurement (faz8-kalite-roadmap.md K5.1). NOT a CI fixture —
 * 500K rows is deliberately outside what the e2e suite or CI should ever
 * touch; this is a manual/local tool for tests/perf/measure-perf.cjs.
 *
 * 20 columns: a mix of numeric (with some NA gaps) and string/categorical
 * columns, matching what a real SPSS-style dataset looks like — not just
 * one dense numeric matrix — since Data View render cost and DuckDB type
 * handling differ by column type.
 *
 * Usage: node tests/perf/gen-stress-fixture.cjs [rowCount] [outPath]
 *   Defaults: 500000 rows -> /tmp/sai-stress-500k.csv
 */
const fs = require('fs')

const rowCount = parseInt(process.argv[2], 10) || 500_000
const outPath = process.argv[3] || '/tmp/sai-stress-500k.csv'

const CATEGORIES = ['A', 'B', 'C', 'D', 'E']
const CITIES = ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Antalya', 'Adana', 'Konya']

// 8 numeric, 1 date-like string, 11 string/categorical = 20 columns.
const columns = [
  'id',
  'age',
  'income',
  'score1',
  'score2',
  'score3',
  'weight',
  'height',
  'bmi',
  'signup_date',
  'gender',
  'city',
  'category_a',
  'category_b',
  'category_c',
  'category_d',
  'category_e',
  'notes_short',
  'status',
  'segment'
]

function randNormal(mean, sd) {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * sd
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate() {
  const start = new Date(2015, 0, 1).getTime()
  const end = new Date(2026, 0, 1).getTime()
  return new Date(start + Math.random() * (end - start)).toISOString().slice(0, 10)
}

const NA_RATE = 0.03 // ~3% missing on numeric columns, matches typical real survey data

function maybeNA(value) {
  return Math.random() < NA_RATE ? '' : value
}

console.log(
  `Generating ${rowCount.toLocaleString()} rows x ${columns.length} columns -> ${outPath}`
)

const stream = fs.createWriteStream(outPath)
stream.write(columns.join(',') + '\n')

const CHUNK = 5000
let buf = []

for (let i = 1; i <= rowCount; i++) {
  const age = maybeNA(Math.round(randNormal(40, 15)))
  const income = maybeNA(Math.round(randNormal(45000, 18000)))
  const score1 = maybeNA(Math.round(randNormal(50, 10) * 100) / 100)
  const score2 = maybeNA(Math.round(randNormal(70, 12) * 100) / 100)
  const score3 = maybeNA(Math.round(randNormal(30, 8) * 100) / 100)
  const weight = maybeNA(Math.round(randNormal(75, 12) * 10) / 10)
  const height = maybeNA(Math.round(randNormal(170, 9) * 10) / 10)
  const bmi =
    weight !== '' && height !== '' ? Math.round((weight / (height / 100) ** 2) * 10) / 10 : ''

  const row = [
    i,
    age,
    income,
    score1,
    score2,
    score3,
    weight,
    height,
    bmi,
    randomDate(),
    pick(['M', 'F']),
    pick(CITIES),
    pick(CATEGORIES),
    pick(CATEGORIES),
    pick(CATEGORIES),
    pick(CATEGORIES),
    pick(CATEGORIES),
    `note_${String(i % 1000)}`,
    pick(['active', 'inactive', 'pending']),
    pick(['low', 'mid', 'high'])
  ]

  buf.push(row.join(','))

  if (buf.length >= CHUNK) {
    stream.write(buf.join('\n') + '\n')
    buf = []
  }
  if (i % 100_000 === 0) {
    console.log(`  ${i.toLocaleString()} / ${rowCount.toLocaleString()}`)
  }
}
if (buf.length > 0) stream.write(buf.join('\n') + '\n')

stream.end(() => {
  const stats = fs.statSync(outPath)
  console.log(`Done: ${outPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
})
