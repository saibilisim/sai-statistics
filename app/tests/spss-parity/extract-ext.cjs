// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Extract reference values from the EXTENSION runs (job-ext.sps on SPSS 26,
 * job-ext32.sps on SPSS 32) into spss-ext-values.json.
 *
 * Same parsing rules as extract-spss.cjs (brace-matched tables, comma-decimal
 * pivots, bare ",124" = 0.124). Two procedures emit preformatted TEXT instead
 * of pivot tables — REPORT (legacy text report) and ALSCAL — and those are
 * parsed from the &nbsp;/<br> text blocks, where numbers use DOTS.
 */
const fs = require('fs')

const html26 = fs.readFileSync(process.argv[2], 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '')
const html32 = fs.readFileSync(process.argv[3], 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '')

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

const dec = x =>
  x
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

function rowsOf(block) {
  let inner = block.replace(/^<table[^>]*>/i, '').replace(/<\/table\s*>$/i, '')
  for (const t of tableBlocks(inner)) inner = inner.split(t).join('')
  const CELL = /<t[hd](?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/t[hd]>/gi
  return [...inner.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r =>
    [...r[0].matchAll(CELL)].map(c => dec(c[1]))
  )
}

const num = s => {
  if (s === undefined || s === null) return null
  const t = String(s).trim()
  if (t === '' || t === '.' || t === 'a' || t === '.b') return null
  const m = /-?[\d.,]*\d(?:E[-+]?\d+)?/i.exec(t.replace(/\s/g, ''))
  if (!m) return null
  const v = Number(m[0].replace(/\.(?=.*,)/g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

const blocks = tableBlocks(html26)
const keep = blocks
  .map(b => ({
    rows: rowsOf(b),
    label: (b.match(/aria-label="([^"]*)"/) || [])[1] || ''
  }))
  .filter(x => x.rows.length >= 2)

const findByLabel = (label, ...needles) => {
  for (const { rows, label: l } of keep) {
    if (l !== label) continue
    const flat = rows.map(r => r.join('|')).join(' // ')
    if (needles.every(n => flat.includes(n))) return rows
  }
  return null
}

const out = {}

/* ── REPORT (legacy text report): parse the text block that follows the
 * REPORT echo. Layout:
 *   PAGE  1 / header line (grp2  score  income) / underscores /
 *   "1" / N 57 58 / Mean … / … / "2" / … / "Grand Total" / …
 * Text blocks use DOT decimals. */
{
  const i = html26.indexOf('REPORT FORMAT=AUTOMATIC')
  if (i < 0) throw new Error('REPORT echo not found')
  const seg = html26
    .slice(i)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/br>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
  const lines = seg.split('\n').map(l => l.replace(/\s+/g, ' ').trim())
  // Start after the column-header line (the one containing "grp2"), which
  // comes after the PAGE line; stop at the next procedure's Notes table.
  const start = lines.findIndex(l => /^grp2 /.test(l))
  if (start < 0) throw new Error('REPORT header line not found')
  const groups = {}
  let cur = null
  const statKey = {
    N: 'N',
    Mean: 'Mean',
    StdDev: 'StdDev',
    Sum: 'Sum',
    Minimum: 'Min',
    Maximum: 'Max'
  }
  for (const l of lines.slice(start + 1)) {
    if (/^Notes$/.test(l)) break
    if (/^_{3,}/.test(l) || /^PAGE/.test(l) || l === '') continue
    if (/^\d+$/.test(l) || /^TOTAL$/i.test(l)) {
      cur = /^\d+$/.test(l) ? 'g' + l : 'total'
      groups[cur] = {}
      continue
    }
    const m = /^([A-Za-z]+)\s+(.+)$/.exec(l)
    if (cur && m && statKey[m[1]]) {
      groups[cur][statKey[m[1]]] = m[2].split(' ').map(Number)
    }
    if (cur === 'total' && groups.total.Max) break
  }
  out.reportRows = groups
}

/* ── SUMMARIZE pivot (Report Summaries in Columns): aria-label "Report". */
{
  const rows = findByLabel('Report', 'Std. Deviation')
  if (!rows) throw new Error('SUMMARIZE table not found')
  const grab = lbl => {
    const r = rows.find(r => r.includes(lbl))
    return r ? r.slice(r.indexOf(lbl) + 1).map(num) : null
  }
  out.summarizeCols = { g1: grab('1'), g2: grab('2'), total: grab('Total') }
}

/* ── PROBIT. */
{
  const rows = findByLabel('Parameter Estimates', 'PROBIT model')
  if (!rows) throw new Error('PROBIT parameter table not found')
  const grab = lbl => {
    const r = rows.find(r => r.includes(lbl))
    // Estimate | Std. Error | Z | Sig. | CI lo | CI hi
    return r ? r.slice(r.indexOf(lbl) + 1).map(num) : null
  }
  out.probit = { score: grab('score'), age: grab('age'), intercept: grab('Intercept') }
  const chi = findByLabel('Chi-Square Tests', 'Pearson')
  const pr = chi && chi.find(r => r.some(c => /Pearson/.test(c)))
  out.probitPearson = pr
    ? pr
        .slice(1)
        .map(num)
        .filter(v => v !== null)
    : null
}

/* ── QUICK CLUSTER. */
{
  const rows = findByLabel('Final Cluster Centers')
  if (!rows) throw new Error('Final Cluster Centers not found')
  out.kmeansCenters = {}
  for (const v of ['q1', 'q2', 'q3']) {
    const r = rows.find(r => r[0] === v || r[1] === v)
    out.kmeansCenters[v] = r
      ? r
          .slice(1)
          .map(num)
          .filter(v2 => v2 !== null)
      : null
  }
  const an = findByLabel('ANOVA', 'Mean Square')
  out.kmeansF = {}
  for (const v of ['q1', 'q2', 'q3']) {
    const r = an && an.find(r2 => r2[0] === v || r2[1] === v)
    // q1 | ClusterMS | df | ErrorMS | df | F | Sig
    const vals = r
      ? r
          .slice(1)
          .map(num)
          .filter(x => x !== null)
      : []
    out.kmeansF[v] = vals.length >= 5 ? vals[4] : null
  }
  const sz = findByLabel('Number of Cases in each Cluster')
  out.kmeansSizes = sz
    ? ['1', '2', '3'].map(k => {
        const r = sz.find(r2 => r2[0] === k || (r2[0] === 'Cluster' && r2[1] === k))
        return r ? num(r[r.length - 1]) : null
      })
    : null
  const mem = findByLabel('Cluster Membership', 'Distance')
  out.kmeansMembership = mem
    ? mem
        .map(r => r.map(num))
        .filter(r => r.length >= 2 && r[0] !== null && !isNaN(r[0]))
        .filter(r => r[0] >= 1 && r[0] <= 120)
        .map(r => ({ case: r[0], cluster: r[1] }))
    : null
}

/* ── CLUSTER (hierarchical, EUCLID BAVERAGE) agglomeration schedules: first
 * the Likert items (ties), then score/income/pre (tie-free). */
{
  const all = []
  for (const { rows, label: l } of keep) {
    if (l !== 'Agglomeration Schedule') continue
    if (
      !rows
        .map(r => r.join('|'))
        .join(' // ')
        .includes('Next Stage')
    )
      continue
    all.push(rows)
  }
  const parse = rows =>
    rows
      .filter(r => !r.some(c => /Cluster|Stage/.test(c))) // header rows
      .map(r => r.map(num))
      .filter(r => r.length >= 7 && r.every(v => v !== null))
      .filter(r => r[0] >= 1)
      .map(r => ({ stage: r[0], c1: r[1], c2: r[2], coef: r[3] }))
  out.clusterSchedule = all[0] ? parse(all[0]) : []
  out.clusterScheduleCont = all[1] ? parse(all[1]) : []
}

/* ── ALSCAL text block: stress, RSQ, stimulus coordinates. */
{
  const flat = html26.replace(/&nbsp;/g, ' ')
  const i = flat.indexOf('Alscal Procedure Options')
  if (i < 0) throw new Error('ALSCAL output not found')
  const seg = flat
    .slice(i, i + 30000)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/br>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  const lines = seg.split('\n').map(l => l.replace(/\s+/g, ' ').trim())
  const sm = /Stress = ([\d.]+) RSQ = ([\d.]+)/.exec(lines.find(l => /Stress = /.test(l)) || '')
  out.alscal = { stress: sm ? Number(sm[1]) : null, rsq: sm ? Number(sm[2]) : null, coords: {} }
  const cs = lines.findIndex(l => /Stimulus Coordinates/.test(l))
  for (const l of lines.slice(cs)) {
    const m = /^(\d) (q\d) (-?[\d.]+) (-?[\d.]+)$/.exec(l)
    if (m) out.alscal.coords[m[2]] = [Number(m[3]), Number(m[4])]
  }
}

/* ── SPSS 32: Bayes one-sample / related, POWER. The 32 dialect flattens
 * cleanly; anchor on table titles in the de-tagged text. */
{
  const txt = html32
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/−/g, '-') // SPSS prints U+2212, not ASCII '-'
  const grab = (anchor, len) => {
    const i = txt.indexOf(anchor)
    return i < 0 ? '' : txt.slice(i, i + len).replace(/\s+/g, ' ')
  }
  const numsAfter = (anchor, len) => {
    const seg = grab(anchor, len)
    return (seg.match(/-?[\d.,]*\d(?:E[-+]?\d+)?/gi) || []).map(num)
  }
  // One-sample: "score 117 52,91854701 11,872537949 1,097616522 ,454 2,659 116 ,009"
  {
    const seg = grab('Bayes Factor for One-Sample T Test', 400)
    const m = /score\s+(-?[\d.,\s]+?)\s+a\. Bayes/.exec(seg)
    const vals = m ? m[1].trim().split(/\s+/).map(num) : []
    out.bayesOne = {
      n: vals[0],
      mean: vals[1],
      sd: vals[2],
      se: vals[3],
      bf01: vals[4],
      t: vals[5],
      df: vals[6],
      sig: vals[7]
    }
  }
  // Related: "pre - post 118 -5,34466102 8,408217255 ,774039139 ,000 -6,905 117 <,001"
  {
    const seg = grab('Bayes Factor for Related-Sample T Test', 400)
    const m = /pre - post\s+(-?[\d.,\s-]+?)\s+(?:Bayes factor|&)/.exec(seg)
    const vals = m ? m[1].trim().split(/\s+/).map(num) : []
    out.bayesRelated = {
      n: vals[0],
      meanDiff: vals[1],
      sd: vals[2],
      se: vals[3],
      bf01: vals[4],
      t: vals[5],
      df: vals[6]
    }
  }
  // POWER tables, in order: onesample N=30 -> power; onesample power=.8 -> N;
  // independent power=.8 -> N1 N2.
  const powerSegs = []
  let idx = -1
  while ((idx = txt.indexOf('Power Analysis Table', idx + 1)) >= 0)
    powerSegs.push(txt.slice(idx, idx + 330).replace(/\s+/g, ' '))
  out.power = {}
  if (powerSegs[0]) {
    const v = /,(\d+) 30 ,5 ,05/.exec(powerSegs[0])
    out.power.oneSamplePowerAtN30 = v ? Number('0.' + v[1]) : null
  }
  if (powerSegs[1]) {
    const m = /(\d+) ,(\d+) ,8 ,5 ,05/.exec(powerSegs[1])
    out.power.oneSampleReqN = m ? { n: Number(m[1]), actual: Number('0.' + m[2]) } : null
  }
  if (powerSegs[2]) {
    const m = /(\d+) (\d+) ,(\d+) ,8 ,5 ,05/.exec(powerSegs[2])
    out.power.indepReqN = m
      ? { n1: Number(m[1]), n2: Number(m[2]), actual: Number('0.' + m[3]) }
      : null
  }
}

fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1))
console.log('extracted:', Object.keys(out).join(', '))
