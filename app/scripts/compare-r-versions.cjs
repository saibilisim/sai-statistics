// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Compare two R builds on the app's own analysis scripts — number by number.
 *
 * Why: the SPSS parity suites prove R 4.3.3 + today's packages match SPSS. When
 * the bundled R is upgraded, re-proving that against SPSS is slow; the cheaper,
 * stricter question is "does the new R give the SAME output as the one already
 * validated?". Every difference is then either explained (a documented upstream
 * fix) or a regression.
 *
 * What runs, once per R build. Each build sees only its own library plus,
 * optionally, a user library built FOR THAT VERSION: R_USER/HOME point at a
 * per-run fake home, because _bootstrap.R, run-all.R and _harness.R all add
 * ~/R/library — a ~/R/library built for another R version would otherwise
 * leak in (a 4.3-built rlang.dll fails to load in 4.6; worse, in 4.5 it
 * loaded, so ordinal/lme4/mvtnorm silently came from the OLD stack).
 *   tests/r-validation/run-all.R   (82 files of reference-value tests)
 *   tests/spss-parity/compare.R    (SPSS parity scenarios)
 *   tests/spss-parity/compare-ui.R (the 57 recorded UI dialog runs)
 * _harness.R writes every script result to SAI_RESULT_DUMP; this script then
 * diffs the two dumps and writes tmp/rcompare/report.md.
 *
 * Usage (from app/):
 *   node scripts/compare-r-versions.cjs run  <label> <path-to-Rscript.exe> [<userLibDir>]
 *   node scripts/compare-r-versions.cjs diff <labelA> <labelB>
 * e.g.
 *   node scripts/compare-r-versions.cjs run r433 resources/r-runtime-win/lib/R/bin/x64/Rscript.exe %USERPROFILE%/R/library
 *   node scripts/compare-r-versions.cjs run r461 "tmp/cranr/r 4.6.1/bin/x64/Rscript.exe"
 *   node scripts/compare-r-versions.cjs diff r433 r461
 * <userLibDir> stands in for ~/R/library (packages installed into the user
 * library) — the root holding the per-version folders (4.3/, 4.6/, …); each
 * R picks its own folder, so the same root serves every run.
 * (a second runtime: SAI_R_VERSION=4.5 SAI_R_DEST=… pnpm vendor:r-runtime:win)
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const APP = path.join(__dirname, '..')
const OUT = path.join(APP, 'tmp', 'rcompare')
const SUITES = [
  ['r-validation', path.join(APP, 'tests', 'r-validation', 'run-all.R')],
  ['spss-parity', path.join(APP, 'tests', 'spss-parity', 'compare.R')],
  ['spss-parity-ui', path.join(APP, 'tests', 'spss-parity', 'compare-ui.R')]
]
// Relative tolerance for "identical": float noise from a different compiler /
// BLAS build is ~1e-12; anything above 1e-9 is a real change worth a look.
const REL_TOL = 1e-9
const ABS_TOL = 1e-12

function run(label, rscript, userLib) {
  const exe = path.resolve(APP, rscript)
  if (!fs.existsSync(exe)) throw new Error(`Rscript not found: ${exe}`)
  // conda layout <root>/lib/R/bin/x64/Rscript.exe → <root>/Library/bin on
  // PATH, as r-bridge.ts withBundledRPath() does; a CRAN layout
  // (<root>/bin/x64) has no such dir and only needs its own bin.
  const root = path.resolve(path.dirname(exe), '..', '..', '..', '..')
  const home = path.join(OUT, `home-${label}`)
  fs.rmSync(home, { recursive: true, force: true })
  fs.mkdirSync(path.join(home, 'R'), { recursive: true })
  if (userLib) fs.symlinkSync(path.resolve(userLib), path.join(home, 'R', 'library'), 'junction')
  const dump = path.join(OUT, label)
  fs.rmSync(dump, { recursive: true, force: true })
  fs.mkdirSync(dump, { recursive: true })
  const win = process.platform === 'win32'
  const sys = process.env.SystemRoot ?? 'C:\\Windows'
  const env = {
    ...process.env,
    PATH: (win
      ? [path.dirname(exe), path.join(root, 'Library', 'bin'), path.join(sys, 'System32'), sys]
      : [path.dirname(exe), '/usr/bin', '/bin']
    ).join(path.delimiter),
    R_USER: home, // what path.expand("~") resolves to on Windows
    HOME: home,
    R_LIBS: process.env.SAI_R_LIBS ?? '', // Linux: ek paket kütüphanesi (örn. kaynaktan derlenmiş 4.6)
    LC_COLLATE: 'C', // as r-bridge.ts rChildEnv() — the app fixes text collation
    R_LIBS_USER: path.join(OUT, 'no-user-lib'), // nonexistent → R drops it
    SAI_RESULT_DUMP: dump
  }
  const summary = {}
  for (const [name, script] of SUITES) {
    const t0 = Date.now()
    const r = spawnSync(exe, ['--no-save', '--no-restore', script], {
      env,
      encoding: 'utf8',
      maxBuffer: 1 << 28
    })
    const log = (r.stdout ?? '') + (r.stderr ?? '')
    fs.writeFileSync(path.join(OUT, `${label}-${name}.log`), log)
    const lines = log.split(/\r?\n/)
    const tally = lines
      .filter(l => /assertions passed|^SONUC:|^OK: \d+\s+FARK|LOAD FAIL/.test(l))
      .slice(-3)
    summary[name] = { exit: r.status, seconds: Math.round((Date.now() - t0) / 1000), tail: tally }
    console.log(
      `[${label}] ${name}: exit ${r.status} (${summary[name].seconds}s) ${tally.join(' | ')}`
    )
  }
  const ver = spawnSync(exe, ['-e', 'cat(R.version.string)'], { env, encoding: 'utf8' }).stdout
  fs.writeFileSync(
    path.join(dump, '_meta.json'),
    JSON.stringify(
      { label, rscript: exe, userLib: userLib ?? null, version: ver, summary },
      null,
      2
    )
  )
}

function numDiff(a, b) {
  if (Object.is(a, b)) return 0
  const d = Math.abs(a - b)
  return d <= ABS_TOL ? 0 : d / Math.max(Math.abs(a), Math.abs(b))
}

/** Walk two parsed results; collect differences as {path, a, b, rel}. */
function walk(a, b, p, out) {
  if (typeof a === 'number' && typeof b === 'number') {
    const rel = numDiff(a, b)
    if (rel > REL_TOL) out.push({ path: p, a, b, rel })
    return
  }
  // R/jsonlite often prints numbers as strings in table cells ("0.024", "NaN")
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return
    const na = Number(a),
      nb = Number(b)
    if (a.trim() !== '' && b.trim() !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) {
      const rel = numDiff(na, nb)
      if (rel > REL_TOL) out.push({ path: p, a, b, rel })
      return
    }
    out.push({ path: p, a, b, rel: Infinity })
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      out.push({ path: p + '.length', a: a.length, b: b.length, rel: Infinity })
    for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${p}[${i}]`, out)
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a) || !(k in b))
        out.push({
          path: `${p}.${k}`,
          a: k in a ? '(present)' : '(missing)',
          b: k in b ? '(present)' : '(missing)',
          rel: Infinity
        })
      else walk(a[k], b[k], `${p}.${k}`, out)
    }
    return
  }
  if (a !== b) out.push({ path: p, a: JSON.stringify(a), b: JSON.stringify(b), rel: Infinity })
}

function diff(la, lb) {
  const da = path.join(OUT, la),
    db = path.join(OUT, lb)
  const meta = d => JSON.parse(fs.readFileSync(path.join(d, '_meta.json'), 'utf8'))
  const ma = meta(da),
    mb = meta(db)
  const keys = new Set(
    [...fs.readdirSync(da), ...fs.readdirSync(db)]
      .filter(f => f !== '_meta.json')
      .map(f => f.replace(/\.(json|failed)$/, ''))
  )
  const rows = []
  for (const k of [...keys].sort()) {
    const fa = path.join(da, k + '.json'),
      fb = path.join(db, k + '.json')
    const okA = fs.existsSync(fa),
      okB = fs.existsSync(fb)
    if (!okA || !okB) {
      // .failed = the script ran and produced no result (crash/error);
      // no file at all = never reached (the suite aborted earlier)
      const why = (d, l) =>
        fs.existsSync(path.join(d, k + '.failed')) ? `fails-on-${l}` : `not-run-on-${l}`
      rows.push({
        k,
        status: !okA && !okB ? 'both-failed' : okA ? why(db, lb) : why(da, la),
        diffs: []
      })
      continue
    }
    const out = []
    walk(JSON.parse(fs.readFileSync(fa, 'utf8')), JSON.parse(fs.readFileSync(fb, 'utf8')), '$', out)
    // plot traces carry the same numbers as the tables, often thousands of
    // them — counted, but listed only when no table/warning changed
    const core = out.filter(d => !/^\$\.plots/.test(d.path))
    rows.push({
      k,
      status: out.length === 0 ? 'identical' : core.length === 0 ? 'plots-only' : 'differs',
      diffs: out,
      core
    })
  }
  const count = s => rows.filter(r => r.status === s).length
  const lines = [
    `# R comparison: ${la} vs ${lb}`,
    '',
    `- ${la}: ${ma.version}`,
    `- ${lb}: ${mb.version}`,
    `- Tolerance: relative ${REL_TOL} (absolute ${ABS_TOL})`,
    '',
    '| Suite | ' + la + ' | ' + lb + ' |',
    '|---|---|---|',
    ...SUITES.map(
      ([n]) =>
        `| ${n} | exit ${ma.summary[n]?.exit} — ${(ma.summary[n]?.tail ?? []).join(' ')} | exit ${mb.summary[n]?.exit} — ${(mb.summary[n]?.tail ?? []).join(' ')} |`
    ),
    '',
    `**${rows.length} script results:** ${count('identical')} identical · ${count('plots-only')} plot-data only · ${count('differs')} differ · ` +
      `${rows.filter(r => r.status.startsWith('fails-on')).length} fail on one side · ` +
      `${rows.filter(r => r.status.startsWith('not-run-on')).length} not reached on one side (suite aborted) · ${count('both-failed')} fail on both`,
    ''
  ]
  const notRun = rows.filter(r => r.status.startsWith('not-run-on'))
  if (notRun.length)
    lines.push(`Not reached (${notRun.length}): ${notRun.map(r => r.k).join(', ')}`, '')
  for (const r of rows.filter(
    r => r.status !== 'identical' && !r.status.startsWith('not-run-on')
  )) {
    lines.push(`## ${r.k} — ${r.status}`)
    const list = (r.core && r.core.length ? r.core : r.diffs).sort((x, y) => y.rel - x.rel)
    for (const d of list.slice(0, 12)) {
      lines.push(
        `- \`${d.path}\`: ${String(d.a).slice(0, 80)} → ${String(d.b).slice(0, 80)}` +
          (Number.isFinite(d.rel) ? ` (rel ${d.rel.toExponential(2)})` : '')
      )
    }
    if (list.length > 12) lines.push(`- … ${list.length - 12} more`)
    if (r.core && r.diffs.length > r.core.length)
      lines.push(`- (+ ${r.diffs.length - r.core.length} plot-data differences)`)
    lines.push('')
  }
  const report = path.join(OUT, `report-${la}-vs-${lb}.md`)
  fs.writeFileSync(report, lines.join('\n'))
  console.log(lines.slice(0, 14).join('\n'))
  console.log(`\nfull report: ${path.relative(APP, report)}`)
}

const [cmd, a, b, c] = process.argv.slice(2)
if (cmd === 'run' && a && b) run(a, b, c)
else if (cmd === 'diff' && a && b) diff(a, b)
else {
  console.error(
    'usage: compare-r-versions.cjs run <label> <Rscript.exe> [<userLibDir>] | diff <labelA> <labelB>'
  )
  process.exit(2)
}
