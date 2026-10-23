// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scrape the SPSS 32 run (job32.sps) into spss32-values.json.
 *
 * Why a second extractor instead of extending extract-spss.cjs:
 *
 * SPSS 27+ writes a DIFFERENT HTML dialect. SPSS 26 emits
 *   <table summary="..." class="Default PivotTable" data-col-labels="...">
 * while 32 emits
 *   <table class="pivot"><caption>Title</caption><thead>…</thead><tbody>…
 * The generic row/cell parsing works on both, but every selector in
 * extract-spss.cjs finds its table by an SPSS 26 label, and several tables
 * changed shape in 27+ as well — the Independent Samples Test no longer carries
 * Levene's columns and splits Significance into One-Sided p / Two-Sided p.
 * Teaching one file both dialects would put the 661-comparison SPSS 26 baseline
 * at risk for no gain, so the versions stay in separate files with separate
 * value sets.
 *
 * This file only reads what SPSS 26 cannot produce at all: the 27+ procedures.
 *
 * Usage: node extract-spss32.cjs spss32-out.htm spss32-values.json
 */
const fs = require('fs')

const src = process.argv[2] ?? 'spss32-out.htm'
const dst = process.argv[3] ?? 'spss32-values.json'
const html = fs.readFileSync(src, 'latin1')

/** Depth-aware table split: SPSS nests tables inside layered pivots. */
function tableBlocks(s) {
  const out = []
  const re = /<table\b/gi
  let m
  while ((m = re.exec(s))) {
    const scan = /<table\b|<\/table\s*>/gi
    scan.lastIndex = m.index
    let depth = 0
    let k
    while ((k = scan.exec(s))) {
      if (k[0][1] === '/') {
        depth--
        if (depth === 0) {
          out.push(s.slice(m.index, k.index + k[0].length))
          break
        }
      } else depth++
    }
  }
  return out
}

// Quote-aware: SPSS writes raw > inside title attributes.
const CELL = /<t[hd](?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/t[hd]>/gi
const clean = s =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()

/**
 * SPSS 27+ prints tiny p-values as "<.001" instead of ",000". Returning 0.001
 * would be a lie in the direction that makes comparisons pass, so the marker is
 * kept: `{ lt: 0.001 }` means "smaller than this", and the comparison treats it
 * as satisfied by anything below the bound rather than as an equality.
 */
function num(t) {
  if (t == null) return null
  const s = String(t).trim()
  if (!s || s === '.' || s === '-') return null
  const lt = /^</.test(s)
  const m = s.replace(/ /g, ' ').match(/-?[\d.,]+/)
  if (!m) return null
  let v = m[0]
  // SPSS decimal comma; thousands separators do not appear in these tables.
  v = v.replace(/\./g, s.includes(',') ? '' : '.').replace(',', '.')
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return lt ? { lt: n } : n
}

const tables = tableBlocks(html).map(tb => {
  const capM = /<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(tb)
  const caption = capM
    ? clean(capM[1])
        .replace(/Notes,.*/, '')
        .trim()
    : ''
  const rows = tb
    .split(/<tr\b/i)
    .slice(1)
    .map(r => {
      const cells = []
      let m
      const re = new RegExp(CELL.source, 'gi')
      while ((m = re.exec(r))) cells.push(clean(m[1]))
      return cells
    })
    .filter(r => r.some(Boolean))
  return { caption, rows }
})

const byCaption = c => tables.find(t => t.caption === c)
/** The row whose cells contain `label`, or the nth such row. */
const rowWith = (t, label, nth = 1) => {
  if (!t) return null
  let seen = 0
  for (const r of t.rows) {
    if (r.some(c => c === label)) {
      seen++
      if (seen === nth) return r
    }
  }
  return null
}
/**
 * Numbers in a row, in order, ignoring the label cells.
 *
 * A cell must LOOK numeric to count. Without that, the row label of the first
 * row in each block — "d1 = 1", "= 1" — contributes its own 1 and shifts every
 * value in that row by one column, which is silent and looks plausible: the
 * first CI method came out with proportion 120 and lower bound 0.24.
 */
const nums = r =>
  (r ?? [])
    .filter(c => /^[<>]?\s*-?[\d.,]+%?$/.test(String(c).trim()))
    .map(num)
    .filter(v => v !== null)

const out = {}

// ── One-Sample Proportions ────────────────────────────────────────────────
{
  const ci = byCaption('One-Sample Proportions Confidence Intervals')
  if (ci) {
    out.propOneCI = {}
    for (const [key, label] of [
      ['agrestiCoull', 'Agresti-Coull'],
      ['jeffreys', 'Jeffreys'],
      ['wilson', 'Wilson Score']
    ]) {
      const v = nums(rowWith(ci, label))
      // successes | trials | proportion | ASE | lower | upper
      if (v.length >= 6) {
        out.propOneCI[key] = {
          successes: v[0],
          trials: v[1],
          proportion: v[2],
          ase: v[3],
          lower: v[4],
          upper: v[5]
        }
      }
    }
  }
  const tt = byCaption('One-Sample Proportions Tests')
  if (tt) {
    const v = nums(rowWith(tt, 'Score'))
    // successes | trials | proportion | obs-test | ASE | Z | one-sided | two-sided
    if (v.length >= 8) {
      out.propOneTest = {
        successes: v[0],
        trials: v[1],
        proportion: v[2],
        diff: v[3],
        ase: v[4],
        z: v[5],
        sigOne: v[6],
        sigTwo: v[7]
      }
    }
  }
}

// ── Independent-Samples Proportions ───────────────────────────────────────
{
  const gs = byCaption('Independent-Samples Proportions Group Statistics')
  if (gs) {
    out.propIndepGroups = {}
    // Label cells ("d1 = 1", "= 1") are dropped by nums(), so the four values
    // start at index 0 in both rows even though the first row has two labels.
    for (const [key, label] of [
      ['1', '= 1'],
      ['2', '= 2']
    ]) {
      const v = nums(rowWith(gs, label))
      if (v.length >= 4) {
        out.propIndepGroups[key] = { successes: v[0], trials: v[1], proportion: v[2], ase: v[3] }
      }
    }
  }
  const ci = byCaption('Independent-Samples Proportions Confidence Intervals')
  if (ci) {
    out.propIndepCI = {}
    for (const [key, label] of [
      ['agrestiCaffo', 'Agresti-Caffo'],
      ['newcombe', 'Newcombe']
    ]) {
      const v = nums(rowWith(ci, label))
      if (v.length >= 4) out.propIndepCI[key] = { diff: v[0], ase: v[1], lower: v[2], upper: v[3] }
    }
  }
  const tt = byCaption('Independent-Samples Proportions Tests')
  if (tt) {
    const v = nums(rowWith(tt, 'Wald H0'))
    if (v.length >= 5)
      out.propIndepTest = { diff: v[0], ase: v[1], z: v[2], sigOne: v[3], sigTwo: v[4] }
  }
}

// ── Paired-Samples Proportions ────────────────────────────────────────────
{
  const st = byCaption('Paired-Samples Proportions Statistics')
  if (st) {
    out.propPairedStats = {}
    for (const [key, label] of [
      ['d1', 'd1 = 1'],
      ['d2', 'd2 = 1']
    ]) {
      const v = nums(rowWith(st, label))
      if (v.length >= 4) {
        out.propPairedStats[key] = { successes: v[0], trials: v[1], proportion: v[2], ase: v[3] }
      }
    }
  }
  const ci = byCaption('Paired-Samples Proportions Confidence Intervals')
  if (ci) {
    out.propPairedCI = {}
    for (const [key, label] of [
      ['bonettPrice', 'Bonett-Price'],
      ['newcombe', 'Newcombe']
    ]) {
      const v = nums(rowWith(ci, label))
      if (v.length >= 4) out.propPairedCI[key] = { diff: v[0], ase: v[1], lower: v[2], upper: v[3] }
    }
  }
  const tt = byCaption('Paired-Samples Proportions Tests')
  if (tt) {
    out.propPairedTest = {}
    for (const [key, label] of [
      ['midP', 'Mid-p Adjusted Binomial'],
      ['mcnemar', 'McNemar']
    ]) {
      const v = nums(rowWith(tt, label))
      if (key === 'mcnemar' && v.length >= 5) {
        out.propPairedTest[key] = { diff: v[0], ase: v[1], z: v[2], sigOne: v[3], sigTwo: v[4] }
      } else if (v.length >= 4) {
        out.propPairedTest[key] = { diff: v[0], ase: v[1], sigOne: v[2], sigTwo: v[3] }
      }
    }
  }
}

// ── Bayesian (27+) ────────────────────────────────────────────────────────
// SPSS prints these Bayes factors to three decimals and, for the t tests and
// the correlation, as BF01 (null versus alternative) — the reciprocal of what
// BayesFactor reports. Both facts are handled at the comparison, not here:
// this only records what was printed.
{
  const ind = tables.find(t => /^Bayes Factor Independent Sample Test/.test(t.caption))
  if (ind) {
    const v = nums(rowWith(ind, 'score'))
    // mean difference | pooled SE | BF01 | t | df | sig
    if (v.length >= 6) {
      out.bayesIndep = { meanDiff: v[0], seDiff: v[1], bf01: v[2], t: v[3], df: v[4], sig: v[5] }
    }
  }
  const reg = tables.find(t => /^Bayes Factor Model Summary/.test(t.caption))
  if (reg) {
    const row = reg.rows.find(r => nums(r).length >= 5)
    const v = nums(row)
    // BF10 | R | R square | adj R square | SE of estimate
    if (v.length >= 5) out.bayesRegression = { bf10: v[0], r: v[1], rSquare: v[2] }
  }
  const corr = tables.find(t => /^Bayes Factor Inference on Pairwise Correlations/.test(t.caption))
  if (corr) {
    const row = corr.rows.find(r => r.some(c => c === 'Bayes Factor') && nums(r).length)
    const v = nums(row)
    if (v.length) out.bayesCorrelation = { bf01: v[0] }
  }
  const anv = tables.find(
    t => t.caption === 'ANOVA' && t.rows.some(r => r.some(c => c === 'Between Groups'))
  )
  if (anv) {
    const v = nums(rowWith(anv, 'Between Groups'))
    // SS | df | MS | F | sig | BF10
    if (v.length >= 6) out.bayesAnova = { bf10: v[5] }
  }
}

// ── ROC ANALYSIS (27+) ────────────────────────────────────────────────────
{
  const auc = byCaption('Area Under the ROC Curve')
  if (auc) {
    const v = auc.rows
      .flat()
      .map(num)
      .filter(x => x !== null && typeof x === 'number')
    if (v.length) out.rocAnalysisArea = v[0]
  }
}

fs.writeFileSync(dst, JSON.stringify(out, null, 2))
const count = o =>
  Object.values(o).reduce((n, v) => n + (v && typeof v === 'object' ? count(v) : 1), 0)
console.log(`${dst}: ${Object.keys(out).length} blok, ${count(out)} değer`)
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k}: ${v && typeof v === 'object' ? Object.keys(v).length + ' alt' : v}`)
}
