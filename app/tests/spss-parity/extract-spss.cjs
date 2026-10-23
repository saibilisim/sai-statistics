// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Pull the reference values out of SPSS's HTML export into JSON.
 *
 * Tables are located by a content signature rather than by position: SPSS
 * emits a Notes table before every procedure and the count varies with the
 * syntax, so index-based lookup silently reads the wrong table.
 *
 * Numbers come back in the SPSS locale (comma decimal, "," thousands absent),
 * and SPSS writes a bare "," for values below 1 — ",124" means 0.124.
 */
const fs = require('fs')

const html = fs.readFileSync(process.argv[2], 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '')

/* SPSS nests tables: a pivot table with a layer dimension carries a small
 * <table class="defaultLayer"> inside its first row. A non-greedy
 * /<table[\s\S]*?<\/table>/ therefore ends the OUTER table at the INNER
 * table's closing tag, leaving two rows of layer chrome and none of the data.
 * That is why FREQUENCIES' Statistics table looked absent from the export
 * while sitting there in plain HTML. Match brace-style instead. */
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

/** Rows of one table, with any nested tables removed so their cells are not
 *  mistaken for the outer table's own. */
function rowsOf(block) {
  let inner = block.replace(/^<table[^>]*>/i, '').replace(/<\/table\s*>$/i, '')
  for (const t of tableBlocks(inner)) inner = inner.split(t).join('')
  // The opening-tag matcher has to be quote-aware: SPSS writes footnote text
  // into title attributes without escaping `>` ("post > pre"), and a plain
  // [^>]* ends the tag there — the cell then "contains" the tail of the
  // attribute (`pre">87`) instead of its value.
  const CELL = /<t[hd](?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/t[hd]>/gi
  return [...inner.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r =>
    [...r[0].matchAll(CELL)].map(c => dec(c[1]))
  )
}

const blocks = tableBlocks(html)
const labels = blocks.map(b => (b.match(/aria-label="([^"]*)"/) || [])[1] || '')
const allRows = blocks.map(rowsOf)
const keep = allRows.map((rows, i) => ({ rows, label: labels[i] })).filter(x => x.rows.length >= 2)
const tables = keep.map(x => x.rows)

/** SPSS prints ",124" for 0.124 and "-,321" for -0.321; "." means missing.
 *  Footnote letters ("5,580a", ",793b") are stripped; E notation is kept. */
const num = s => {
  if (s === undefined || s === null) return null
  const t = String(s).trim()
  if (t === '' || t === '.' || t === 'a' || t === '.b') return null
  // Take the FIRST numeric token: SPSS appends footnote letters, and more than
  // one of them ("Asymp. Sig. ,200c,d" — a Lilliefors-corrected lower bound),
  // which a blanket strip turns into the unparseable ",200,".
  const m = /-?[\d.,]*\d(?:E[-+]?\d+)?/i.exec(t.replace(/\s/g, ''))
  if (!m) return null
  const v = Number(m[0].replace(/\.(?=.*,)/g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : null
}

/** First table whose flattened text matches every needle. */
const find = (...needles) => {
  for (const rows of tables) {
    const flat = rows.map(r => r.join('|')).join(' // ')
    if (needles.every(n => flat.includes(n))) return rows
  }
  return null
}

/** First table with this aria-label (SPSS's own table title), optionally also
 *  matching content needles. Content signatures alone are not always enough:
 *  OLAP's cube row (`score | 117 | 52,9 | 11,9`) looks exactly like a row of
 *  DESCRIPTIVES, and the wrong table matched first. */
const findByLabel = (label, ...needles) => {
  for (const { rows, label: l } of keep) {
    if (l !== label) continue
    const flat = rows.map(r => r.join('|')).join(' // ')
    if (needles.every(n => flat.includes(n))) return rows
  }
  return null
}

/** Row whose first non-empty cell equals `label`. Null-safe: a procedure whose
 *  table is absent from the export must not abort the whole extraction. */
const row = (rows, label) => (rows ?? []).find(r => r.some(c => c === label)) ?? null

/** Values after the cell matching `label`, as numbers. */
const after = (rows, label) => {
  const r = row(rows, label)
  if (!r) return null
  return r.slice(r.indexOf(label) + 1).map(num)
}

/** Run one extraction block, recording rather than throwing on a miss. */
const missing = []
const block = (name, fn) => {
  try {
    fn()
  } catch (e) {
    missing.push(`${name}: ${e.message}`)
  }
}

const out = {}

// ── DESCRIPTIVES ──
block('DESCRIPTIVES', () => {
  const t = find('Valid N (listwise)', 'Std. Deviation')
  const cols = [
    'n',
    'range',
    'min',
    'max',
    'sum',
    'mean',
    'seMean',
    'sd',
    'variance',
    'skew',
    'seSkew',
    'kurt',
    'seKurt'
  ]
  out.descriptives = {}
  for (const v of ['score', 'income', 'pre', 'post']) {
    const vals = after(t, v)
    if (!vals) continue
    out.descriptives[v] = Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? null]))
  }
})

// ── FREQUENCIES statistics (age) ──
block('FREQUENCIES statistics (age)', () => {
  const t = find('Std. Error of Skewness', 'Percentiles')
  out.frequencies = {}
  // Statistic rows are "<label> | <value>"; N is split over two rows
  // ("N | Valid | 120" then "Missing | 0"), so read the last cell.
  const grab = label => {
    const r = row(t, label)
    return r ? num(r[r.length - 1]) : null
  }
  for (const [key, label] of [
    ['nValid', 'Valid'],
    ['nMissing', 'Missing'],
    ['mean', 'Mean'],
    ['median', 'Median'],
    ['mode', 'Mode'],
    ['sd', 'Std. Deviation'],
    ['variance', 'Variance'],
    ['range', 'Range'],
    ['min', 'Minimum'],
    ['max', 'Maximum'],
    ['seMean', 'Std. Error of Mean'],
    ['sum', 'Sum'],
    ['skew', 'Skewness'],
    ['seSkew', 'Std. Error of Skewness'],
    ['kurt', 'Kurtosis'],
    ['seKurt', 'Std. Error of Kurtosis']
  ]) {
    out.frequencies[key] = grab(label)
  }
  // Percentiles: the first row is "Percentiles | 25 | 30,0", the rest drop the
  // group label and read "50 | 42,0".
  out.frequencies.percentiles = {}
  let inPct = false
  for (const r of t) {
    if (r[0] === 'Percentiles') {
      inPct = true
      out.frequencies.percentiles[r[1]] = num(r[r.length - 1])
      continue
    }
    if (!inPct) continue
    if (/^\d+(,\d+)?$/.test(r[0]) && r.length >= 2) {
      out.frequencies.percentiles[r[0]] = num(r[r.length - 1])
    }
  }
})

// ── Independent-samples t test ──
block('Independent-samples t test', () => {
  const g = find("Levene's Test for Equality of Variances", 't-test for Equality of Means')
  out.ttestInd = {}
  const v = after(g, 'Equal variances assumed')
  if (v) {
    out.ttestInd = {
      leveneF: v[0],
      leveneSig: v[1],
      t: v[2],
      df: v[3],
      sig: v[4],
      meanDiff: v[5],
      seDiff: v[6],
      ciLower: v[7],
      ciUpper: v[8]
    }
  }
  const grpStats = find('Std. Error Mean', 'grp2')
  if (grpStats) {
    out.ttestIndGroups = grpStats
      .filter(r => r.length >= 4 && num(r[r.length - 1]) !== null)
      .map(r => r.map(c => (num(c) === null ? c : num(c))))
  }
})

// ── Paired-samples t test (pre vs post) ──
block('Paired-samples t test', () => {
  const t = find('Paired Differences', 'Sig. (2-tailed)')
  const v = after(t, 'pre - post')
  if (v) {
    out.ttestPaired = {
      mean: v[0],
      sd: v[1],
      seMean: v[2],
      ciLower: v[3],
      ciUpper: v[4],
      t: v[5],
      df: v[6],
      sig: v[7]
    }
  }
  const c = after(
    find('Paired Samples Correlations', 'Correlation') ?? find('Correlation', 'Sig.'),
    'pre & post'
  )
  if (c) out.ttestPairedCorr = { n: c[0], r: c[1], sig: c[2] }
  const s =
    find('Paired Samples Statistics', 'Std. Error Mean') ?? find('Pair 1', 'Std. Error Mean')
  if (s) {
    out.ttestPairedStats = {}
    for (const v2 of ['pre', 'post']) {
      const r = after(s, v2)
      if (r) out.ttestPairedStats[v2] = { mean: r[0], n: r[1], sd: r[2], seMean: r[3] }
    }
  }
})

// ── One-sample t test (score vs 50) ──
block('One-sample t test', () => {
  const t = find('Test Value = 50', 'Sig. (2-tailed)')
  const v = after(t, 'score')
  if (v) {
    out.ttestOne = {
      t: v[0],
      df: v[1],
      sig: v[2],
      meanDiff: v[3],
      ciLower: v[4],
      ciUpper: v[5]
    }
  }
})

// ── One-way ANOVA (+ its Descriptives and Levene tables) ──
block('One-way ANOVA', () => {
  const t = find('Between Groups', 'Within Groups', 'Sum of Squares')
  // With two dependents the table stacks them, labelling only the first row of
  // each block with the variable name, so carry a cursor rather than taking
  // the first "Between Groups" row and calling it score's.
  out.anova = {}
  let cur = null
  for (const r of t ?? []) {
    const iv = r.findIndex(c => ['score', 'income'].includes(c))
    if (iv >= 0) cur = r[iv]
    if (!cur) continue
    for (const label of ['Between Groups', 'Within Groups', 'Total']) {
      if (!r.includes(label)) continue
      const v = r.slice(r.indexOf(label) + 1).map(num)
      out.anova[cur] = out.anova[cur] ?? {}
      out.anova[cur][label.replace(/\s/g, '')] = {
        ss: v[0],
        df: v[1],
        ms: v[2],
        f: v[3],
        sig: v[4]
      }
    }
  }
  // Group descriptives: rows are "<var> | <group> | N | Mean | SD | SE | …"
  // for the first group, then "<group> | …" for the rest.
  const d = find('95% Confidence Interval for Mean', 'Lower Bound')
  out.anovaDesc = {}
  cur = null
  for (const r of d ?? []) {
    const iv = r.findIndex(c => ['score', 'income'].includes(c))
    if (iv >= 0) cur = r[iv]
    if (!cur) continue
    const cells = iv >= 0 ? r.slice(iv + 1) : r
    const grp = cells[0]
    if (!/^(1|2|3|Total)$/.test(grp)) continue
    const v = cells.slice(1).map(num)
    out.anovaDesc[cur] = out.anovaDesc[cur] ?? {}
    out.anovaDesc[cur][grp] = { n: v[0], mean: v[1], sd: v[2], seMean: v[3] }
  }
  // Levene, "Based on Mean" only — that is the row SPSS's ONEWAY /HOMOGENEITY
  // historically printed and the one our table's first row corresponds to.
  const h = find('Levene Statistic', 'Based on Mean')
  out.levene = {}
  cur = null
  for (const r of h ?? []) {
    const iv = r.findIndex(c => ['score', 'income'].includes(c))
    if (iv >= 0) cur = r[iv]
    if (!cur || !r.includes('Based on Mean')) continue
    const v = r.slice(r.indexOf('Based on Mean') + 1).map(num)
    out.levene[cur] = { stat: v[0], df1: v[1], df2: v[2], sig: v[3] }
  }
})

// ── Correlations ──
block('Correlations', () => {
  const t = find('Pearson Correlation', 'Sig. (2-tailed)')
  out.pearson = t ? t.map(r => r.map(c => (num(c) === null ? c : num(c)))) : null
  const s = find("Spearman's rho", 'Correlation Coefficient')
  out.spearman = s ? s.map(r => r.map(c => (num(c) === null ? c : num(c)))) : null
})

// ── Crosstabs ──
block('Crosstabs', () => {
  const t = find('Pearson Chi-Square', 'Likelihood Ratio')
  out.chisq = {}
  for (const [key, label] of [
    ['pearson', 'Pearson Chi-Square'],
    ['lr', 'Likelihood Ratio']
  ]) {
    const v = after(t, label)
    if (v) out.chisq[key] = { value: v[0], df: v[1], sig: v[2] }
  }
  const sym = find('Cramer', 'Phi')
  if (sym) {
    for (const [key, label] of [
      ['phi', 'Phi'],
      ['cramersV', "Cramer's V"]
    ]) {
      const v = after(sym, label)
      if (v) out.chisq[key] = { value: v[0], sig: v[1] }
    }
  }
  // Observed counts, so a chi-square match cannot be hiding a wrong table.
  const ct = find('Crosstabulation', 'Expected Count') ?? find('Expected Count', 'Total')
  if (ct) {
    out.crosstab = {}
    let cur = null
    for (const r of ct) {
      // 'Total' must reset the cursor too, or the totals row is filed under
      // whichever region happened to come last.
      const iv = r.findIndex(c => ['North', 'South', 'East', 'West', 'Total'].includes(c))
      if (iv >= 0) cur = r[iv]
      if (!cur || !r.includes('Count') || r.includes('Expected Count')) continue
      const v = r.slice(r.indexOf('Count') + 1).map(num)
      out.crosstab[cur] = { g1: v[0], g2: v[1], total: v[2] }
    }
  }
})

// ── Regression ──
block('Regression', () => {
  const m = find('R Square', 'Adjusted R Square')
  if (m) {
    const r = m.find(x => x[0] === '1')
    if (r) out.regression = { r: num(r[1]), r2: num(r[2]), adjR2: num(r[3]), se: num(r[4]) }
  }
  // The regression ANOVA is a second table also titled "ANOVA"; the needles
  // pick it apart from ONEWAY's by the Regression/Residual row labels.
  const a = find('Regression', 'Residual', 'Sum of Squares')
  if (a) {
    out.regressionAnova = {}
    for (const label of ['Regression', 'Residual', 'Total']) {
      const v = after(a, label)
      if (v) out.regressionAnova[label] = { ss: v[0], df: v[1], ms: v[2], f: v[3], sig: v[4] }
    }
  }
  const c = find('Unstandardized Coefficients', 'Standardized Coefficients')
  if (c) {
    out.regressionCoef = {}
    for (const label of ['(Constant)', 'income', 'age']) {
      const v = after(c, label)
      if (v) out.regressionCoef[label] = { b: v[0], se: v[1], beta: v[2], t: v[3], sig: v[4] }
    }
  }
})

// ── EXAMINE (Explore) ──
block('Explore', () => {
  const d = find('5% Trimmed Mean', 'Interquartile Range')
  out.explore = {}
  const g = label => {
    const r = row(d, label)
    if (!r) return null
    // Statistic column is the first numeric after the label.
    return r.slice(r.indexOf(label) + 1).map(num)[0] ?? null
  }
  for (const [k, l] of [
    ['mean', 'Mean'],
    ['trimmed', '5% Trimmed Mean'],
    ['median', 'Median'],
    ['variance', 'Variance'],
    ['sd', 'Std. Deviation'],
    ['min', 'Minimum'],
    ['max', 'Maximum'],
    ['range', 'Range'],
    ['iqr', 'Interquartile Range'],
    ['skew', 'Skewness'],
    ['kurt', 'Kurtosis']
  ]) {
    out.explore[k] = g(l)
  }
  const ciLo = row(d, 'Lower Bound')
  const ciHi = row(d, 'Upper Bound')
  out.explore.ciLower = ciLo ? num(ciLo[ciLo.indexOf('Lower Bound') + 1]) : null
  out.explore.ciUpper = ciHi ? num(ciHi[ciHi.indexOf('Upper Bound') + 1]) : null

  // Percentiles: the "Weighted Average(Definition 1)" row is SPSS's HAVERAGE.
  const p = find('Weighted Average(Definition 1)', "Tukey's Hinges")
  out.explorePct = {}
  if (p) {
    const head = p.find(r => r.includes('5') && r.includes('95'))
    const wa = row(p, 'Weighted Average(Definition 1)')
    if (head && wa) {
      const vals = wa
        .slice(wa.indexOf('Weighted Average(Definition 1)') + 1)
        .map(num)
        .filter(v => v !== null)
      const keys = head.filter(c => /^\d+$/.test(c))
      keys.forEach((k, i) => (out.explorePct[k] = vals[i] ?? null))
    }
  }
})

// ── MEANS / SUMMARIZE / OLAP: the same "Report" shape, told apart by header ──
const groupReport = (rows, groupVar) => {
  const res = {}
  if (!rows) return res
  const head = rows.find(r => r.includes(groupVar))
  if (!head) return res
  const cols = head.slice(head.indexOf(groupVar) + 1)
  for (const r of rows) {
    const key = r[0]
    if (!/^(1|2|3|Total)$/.test(key)) continue
    const vals = r.slice(1).map(num)
    res[key] = Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? null]))
  }
  return res
}

block('Means', () => {
  out.means = groupReport(find('grp3', 'Std. Deviation', 'Total'), 'grp3')
  // The wave-7 run with the full /CELLS list. find() returns the FIRST match
  // and the default run above matches too, so this one is selected by a column
  // only it has: Kurtosis.
  out.meansCells = groupReport(find('grp3', 'Kurtosis', 'Total'), 'grp3')
})

block('Summarize / OLAP', () => {
  // Both print "score * grp2"; SUMMARIZE's Report is broken down by grp2,
  // OLAP's default layer is the total. Distinguish by the header row.
  const tabs = tables.filter(rows => rows.some(r => r.includes('grp2') && r.includes('Mean')))
  for (const t of tabs) {
    const g = groupReport(t, 'grp2')
    if (Object.keys(g).length >= 2 && !out.summarize) out.summarize = g
  }
  const olap = findByLabel('OLAP Cube')
  if (olap) {
    const r = row(olap, 'score')
    if (r) {
      const v = r.slice(r.indexOf('score') + 1).map(num)
      out.olap = { n: v[0], mean: v[1], sd: v[2] }
    }
  }
})

// ── PARTIAL CORR ──
block('Partial correlation', () => {
  const t = find('Control Variables', 'Significance (2-tailed)')
  if (!t) return
  const r = row(t, 'Correlation')
  const s = row(t, 'Significance (2-tailed)')
  const d = row(t, 'df')
  // First data row is score's; its off-diagonal value is the partial r.
  const rv = r ? r.slice(r.indexOf('Correlation') + 1).map(num) : []
  const sv = s ? s.slice(s.indexOf('Significance (2-tailed)') + 1).map(num) : []
  const dv = d ? d.slice(d.indexOf('df') + 1).map(num) : []
  out.partial = { r: rv[1] ?? null, sig: sv[1] ?? null, df: dv[1] ?? null }
})

// ── NPAR TESTS ──
// Row labels in these tables often carry a footnote letter ("Test Valuea",
// "Chi-Squarea"), so match on the prefix rather than on equality.
const testStat = (t, label) => {
  const r = (t ?? []).find(x => x.some(c => c === label || c.startsWith(label)))
  return r ? num(r[r.length - 1]) : null
}

block('Mann-Whitney', () => {
  const t = find('Mann-Whitney U', 'Wilcoxon W')
  out.mannWhitney = {
    u: testStat(t, 'Mann-Whitney U'),
    w: testStat(t, 'Wilcoxon W'),
    z: testStat(t, 'Z'),
    sig: testStat(t, 'Asymp. Sig. (2-tailed)')
  }
  const ranks = find('Mean Rank', 'Sum of Ranks', 'grp2')
  if (ranks) {
    out.mannWhitneyRanks = {}
    for (const r of ranks) {
      const i = r.findIndex(c => c === '1' || c === '2')
      if (i < 0 || r.length < i + 3) continue
      const v = r.slice(i + 1).map(num)
      if (v[0] === null) continue
      out.mannWhitneyRanks[r[i]] = { n: v[0], meanRank: v[1], sumRanks: v[2] }
    }
  }
})

block('Wilcoxon signed-rank', () => {
  const t = find('Wilcoxon Signed Ranks Test', 'Asymp. Sig. (2-tailed)')
  out.wilcoxon = { z: testStat(t, 'Z'), sig: testStat(t, 'Asymp. Sig. (2-tailed)') }
  const ranks = find('Negative Ranks', 'Positive Ranks', 'Sum of Ranks')
  if (ranks) {
    out.wilcoxonRanks = {}
    for (const label of ['Negative Ranks', 'Positive Ranks', 'Ties', 'Total']) {
      const r = row(ranks, label)
      if (!r) continue
      const v = r.slice(r.indexOf(label) + 1).map(num)
      out.wilcoxonRanks[label] = { n: v[0], meanRank: v[1], sumRanks: v[2] }
    }
  }
})

block('Kruskal-Wallis', () => {
  const t = find('Kruskal-Wallis H', 'Asymp. Sig.')
  out.kruskal = {
    h: testStat(t, 'Kruskal-Wallis H'),
    df: testStat(t, 'df'),
    sig: testStat(t, 'Asymp. Sig.')
  }
})

block('Friedman', () => {
  const t = find('Friedman Test', 'Chi-Square')
  out.friedman = {
    n: testStat(t, 'N'),
    chi: testStat(t, 'Chi-Square'),
    df: testStat(t, 'df'),
    sig: testStat(t, 'Asymp. Sig.')
  }
  const ranks = find('Mean Rank', 'q1', 'q3')
  if (ranks) {
    out.friedmanRanks = {}
    for (const q of ['q1', 'q2', 'q3']) {
      const r = row(ranks, q)
      if (r) out.friedmanRanks[q] = num(r[r.length - 1])
    }
  }
})

block('Binomial', () => {
  const t = find('Observed Prop.', 'Test Prop.')
  if (!t) return
  out.binomial = {}
  for (const r of t) {
    if (!r.includes('Group 1') && !r.includes('Group 2')) continue
    const i = r.findIndex(c => /^Group [12]$/.test(c))
    const v = r.slice(i + 1)
    out.binomial[r[i]] = { category: v[0], n: num(v[1]), prop: num(v[2]) }
  }
  const sig = t.find(r => r.includes('Group 1'))
  if (sig) out.binomial.exactSig = num(sig[sig.length - 1])
})

block('Chi-square goodness of fit', () => {
  const t = find('Chi-Square', 'Asymp. Sig.', 'grp3')
  out.gof = {
    chi: testStat(t, 'Chi-Square'),
    df: testStat(t, 'df'),
    sig: testStat(t, 'Asymp. Sig.')
  }
})

block('One-sample K-S', () => {
  const t =
    find('One-Sample Kolmogorov-Smirnov Test', 'Most Extreme Differences') ??
    find('Most Extreme Differences', 'Test Statistic')
  out.ks = {
    n: testStat(t, 'N'),
    mean: testStat(t, 'Mean'),
    sd: testStat(t, 'Std. Deviation'),
    absolute: testStat(t, 'Absolute'),
    positive: testStat(t, 'Positive'),
    negative: testStat(t, 'Negative'),
    statistic: testStat(t, 'Test Statistic'),
    sig: testStat(t, 'Asymp. Sig. (2-tailed)')
  }
})

block('Runs test', () => {
  const t = find('Number of Runs', 'Total Cases')
  out.runs = {
    testValue: testStat(t, 'Test Value'),
    below: testStat(t, 'Cases < Test Value'),
    atOrAbove: testStat(t, 'Cases >= Test Value'),
    total: testStat(t, 'Total Cases'),
    nRuns: testStat(t, 'Number of Runs'),
    z: testStat(t, 'Z'),
    sig: testStat(t, 'Asymp. Sig. (2-tailed)')
  }
})

// ── RELIABILITY ──
block('Reliability', () => {
  const t = find("Cronbach's Alpha", 'N of Items')
  if (t) {
    const r = t.find(x => num(x[0]) !== null)
    if (r) out.reliability = { alpha: num(r[0]), nItems: num(r[1]) }
  }
  const it = find('Scale Mean if Item Deleted', 'Corrected Item-Total Correlation')
  if (it) {
    out.reliabilityItems = {}
    for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      const v = after(it, q)
      if (v) out.reliabilityItems[q] = { meanDel: v[0], varDel: v[1], corr: v[2], alphaDel: v[3] }
    }
  }
  const sc = find('Mean', 'Variance', 'Std. Deviation', 'N of Items')
  if (sc) {
    const r = sc.find(x => x.length >= 4 && num(x[0]) !== null)
    if (r) out.reliabilityScale = { mean: num(r[0]), variance: num(r[1]), sd: num(r[2]) }
  }

  // /MODEL=SPLIT. The row labels carry the values at different depths (the
  // pivot nests Part 1 / Part 2 under "Cronbach's Alpha"), so each is taken
  // from the LAST cell of the row that names it — and the N-of-Items cells
  // read "3a"/"2b" with the footnote marker glued on, which num() strips by
  // taking the first numeric token.
  const sp = find('Spearman-Brown Coefficient', 'Guttman Split-Half Coefficient')
  if (sp) {
    const last = label => {
      const r = sp.find(x => x.some(c => c === label))
      return r ? num(r[r.length - 1]) : null
    }
    const nth = (label, i) => {
      let seen = 0
      for (const r of sp) {
        if (r.some(c => c === label)) {
          seen += 1
          if (seen === i) return num(r[r.length - 1])
        }
      }
      return null
    }
    out.reliabilitySplit = {
      alphaPart1: last("Cronbach's Alpha"),
      nItemsPart1: nth('N of Items', 1),
      alphaPart2: last('Part 2'),
      nItemsPart2: nth('N of Items', 2),
      nItemsTotal: last('Total N of Items'),
      corrBetweenForms: last('Correlation Between Forms'),
      sbEqual: last('Spearman-Brown Coefficient'),
      sbUnequal: last('Unequal Length'),
      guttman: last('Guttman Split-Half Coefficient')
    }
  }
})

// ── ROC ──
block('ROC', () => {
  const t =
    find('Area Under the Curve', 'Asymptotic Sig.') ??
    find('Asymptotic 95% Confidence Interval', 'Area')
  if (!t) return
  const r = t.find(x => x.length >= 5 && x.every(c => num(c) !== null || c === ''))
  if (r) {
    const v = r.map(num).filter(x => x !== null)
    out.roc = { area: v[0], se: v[1], sig: v[2], ciLower: v[3], ciUpper: v[4] }
  }
})

// ── Kaplan-Meier / Cox ──
block('Kaplan-Meier', () => {
  const t =
    find('Means and Medians for Survival Time', 'Median') ??
    find('Estimate', 'Std. Error', 'Lower Bound', 'Upper Bound')
  if (t) {
    out.km = {}
    for (const g of ['1', '2', 'Overall']) {
      const r = t.find(x => x[0] === g)
      if (!r) continue
      const v = r.slice(1).map(num)
      // Mean block first (est, se, lo, hi), then the Median block.
      out.km[g] = {
        mean: v[0],
        meanSe: v[1],
        meanLo: v[2],
        meanHi: v[3],
        median: v[4],
        medianSe: v[5],
        medianLo: v[6],
        medianHi: v[7]
      }
    }
  }
  const lr = find('Log Rank (Mantel-Cox)', 'Chi-Square')
  const r2 = row(lr, 'Log Rank (Mantel-Cox)')
  if (r2) {
    const v = r2.slice(r2.indexOf('Log Rank (Mantel-Cox)') + 1).map(num)
    out.logrank = { chi: v[0], df: v[1], sig: v[2] }
  }
})

block('Cox regression', () => {
  const t = find('95,0% CI for Exp(B)', 'Wald') ?? find('Exp(B)', 'Wald', 'SE')
  if (t) {
    out.cox = {}
    for (const v of ['score', 'age']) {
      const r = after(t, v)
      if (r) out.cox[v] = { b: r[0], se: r[1], wald: r[2], df: r[3], sig: r[4], expB: r[5] }
    }
  }
  const om = find('Change From Previous Step', '-2 Log Likelihood')
  if (om) {
    const r = om.find(x => x.length >= 9 && num(x[0]) !== null)
    if (r) {
      const v = r.map(num)
      // Columns: -2LL | Overall(score) chi/df/sig | Change from previous STEP
      // chi/df/sig | Change from previous BLOCK chi/df/sig. The likelihood
      // ratio test our script reports is the block change (v[4]), not the
      // score test (v[1]) — comparing against v[1] made a matching model look
      // like a 1.336-vs-1.348 disagreement.
      out.coxOmnibus = { neg2LL: v[0], scoreChi: v[1], chi: v[4], df: v[5], sig: v[6] }
    }
  }
})

// ── Binary logistic ──
block('Logistic regression', () => {
  const ms = find('Cox & Snell R Square', 'Nagelkerke R Square')
  if (ms) {
    const r = ms.find(x => x[0] === '1')
    if (r) out.logistic = { neg2LL: num(r[1]), coxSnell: num(r[2]), nagelkerke: num(r[3]) }
  }
  // Step 1's table is the second "Variables in the Equation"; find it by its
  // own predictor rows rather than by position.
  const eq = tables.find(
    rows =>
      rows.some(r => r.includes('score')) &&
      rows.some(r => r.includes('Constant')) &&
      rows.some(r => r.includes('Exp(B)'))
  )
  if (eq) {
    out.logisticCoef = {}
    for (const v of ['score', 'age', 'Constant']) {
      const r = after(eq, v)
      if (r)
        out.logisticCoef[v] = { b: r[0], se: r[1], wald: r[2], df: r[3], sig: r[4], expB: r[5] }
    }
  }
})

// ── Curve estimation ──
block('Curve estimation', () => {
  const t =
    find('Model Summary and Parameter Estimates', 'Equation') ?? find('b1', 'R Square', 'Sig.')
  if (!t) return
  out.curve = {}
  for (const m of ['Linear', 'Quadratic']) {
    const v = after(t, m)
    if (v)
      out.curve[m] = {
        r2: v[0],
        f: v[1],
        df1: v[2],
        df2: v[3],
        sig: v[4],
        constant: v[5],
        b1: v[6],
        b2: v[7]
      }
  }
})

// ── FACTOR ──
block('Factor analysis', () => {
  const c = findByLabel('Communalities')
  if (c) {
    out.factorComm = {}
    for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      const v = after(c, q)
      if (v) out.factorComm[q] = { initial: v[0], extraction: v[1] }
    }
  }
  const t = findByLabel('Total Variance Explained')
  if (t) {
    out.factorTve = {}
    for (const comp of ['1', '2', '3', '4', '5']) {
      const r = t.find(x => x[0] === comp)
      if (!r) continue
      const v = r.slice(1).map(num)
      out.factorTve[comp] = { eigenvalue: v[0], pct: v[1], cumPct: v[2] }
    }
  }
  const m = findByLabel('Component Matrix')
  if (m) {
    out.factorLoadings = {}
    for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      const v = after(m, q)
      if (v) out.factorLoadings[q] = v[0]
    }
  }
})

// ── DISCRIMINANT ──
block('Discriminant', () => {
  const e = findByLabel('Eigenvalues')
  if (e) {
    const r = e.find(x => x[0] === '1')
    if (r) {
      const v = r.slice(1).map(num)
      out.discEigen = { eigenvalue: v[0], pctVariance: v[1], cumPct: v[2], canonicalCorr: v[3] }
    }
  }
  const w = findByLabel("Wilks' Lambda")
  if (w) {
    const r = w.find(x => x[0] === '1')
    if (r) {
      const v = r.slice(1).map(num)
      out.discWilks = { lambda: v[0], chi: v[1], df: v[2], sig: v[3] }
    }
  }
  // "60,5% of original grouped cases correctly classified" sits in a footnote.
  const cr = findByLabel('Classification Results')
  if (cr) {
    const flat = cr.map(r => r.join(' ')).join(' ')
    const pm = /([\d,.]+)%\s*of original grouped cases correctly classified/i.exec(flat)
    if (pm) out.discPctCorrect = num(pm[1])
  }
})

// ── RATIO STATISTICS ──
block('Ratio statistics', () => {
  const t = tables.find(rows => rows.some(r => r.includes('Price Related Differential')))
  if (!t) return
  const head = t.find(r => r.includes('Price Related Differential'))
  const data = t.find(r => r.length >= 6 && num(r[0]) !== null)
  if (!head || !data) return
  const v = data.map(num)
  // Header order: Mean | CI lo | CI hi | Median | CI lo | CI hi | coverage | PRD | COD
  out.ratio = { mean: v[0], median: v[3], prd: v[7], cod: v[8] }
})

// ── PLUM (ordinal) ──
block('Ordinal regression', () => {
  const f = findByLabel('Model Fitting Information')
  if (f) {
    const r = row(f, 'Final')
    if (r) {
      const v = r.slice(r.indexOf('Final') + 1).map(num)
      out.ordinalFit = { neg2LL: v[0], chi: v[1], df: v[2], sig: v[3] }
    }
  }
  // PLUM's Parameter Estimates, not NOMREG's — pick the one with Threshold rows.
  const p = tables.find(
    rows => rows.some(r => r.includes('Threshold')) && rows.some(r => r.includes('Estimate'))
  )
  if (p) {
    out.ordinalParams = {}
    for (const v of ['score', 'age']) {
      const r = after(p, v)
      if (r) out.ordinalParams[v] = { estimate: r[0], se: r[1], wald: r[2], df: r[3], sig: r[4] }
    }
    for (const th of ['[grp3 = 1]', '[grp3 = 2]']) {
      const r = after(p, th)
      if (r) out.ordinalParams[th] = { estimate: r[0], se: r[1], wald: r[2] }
    }
  }
})

// ── MVA ──
block('Missing value analysis', () => {
  const t = findByLabel('Univariate Statistics')
  if (!t) return
  out.mva = {}
  for (const v of ['score', 'income', 'post']) {
    const r = after(t, v)
    if (r) out.mva[v] = { n: r[0], mean: r[1], sd: r[2], missingN: r[3], missingPct: r[4] }
  }
})

// ── GLM ──
block('GLM univariate', () => {
  const t = tables.find(
    rows =>
      rows.some(r => r.includes('Corrected Model')) &&
      rows.some(r => r.includes('Type III Sum of Squares'))
  )
  if (!t) return
  out.glmUni = {}
  for (const src of ['Corrected Model', 'Intercept', 'grp3', 'grp4', 'grp3 * grp4', 'Error']) {
    const v = after(t, src)
    if (v) out.glmUni[src] = { ss: v[0], df: v[1], ms: v[2], f: v[3], sig: v[4] }
  }
})

block('GLM multivariate', () => {
  const t = findByLabel('Multivariate Tests')
  if (!t) return
  out.glmMulti = {}
  // Rows are (effect?, statistic, value, F, hypDf, errDf, sig); the effect name
  // appears only on its first row, so carry a cursor.
  let cur = null
  for (const r of t) {
    const iv = r.findIndex(c => c === 'Intercept' || c === 'grp2')
    if (iv >= 0) cur = r[iv]
    if (!cur) continue
    for (const stat of ["Pillai's Trace", "Wilks' Lambda", "Hotelling's Trace"]) {
      if (!r.includes(stat)) continue
      const v = r.slice(r.indexOf(stat) + 1).map(num)
      out.glmMulti[`${cur}|${stat}`] = { value: v[0], f: v[1], hypDf: v[2], errDf: v[3], sig: v[4] }
    }
  }
})

// ── NOMREG with BASE=FIRST (the run that matches our reference category) ──
block('Multinomial logistic', () => {
  // Two NOMREG runs are in the job; take the one whose footnote says the
  // reference category is 1, not the BASE=LAST one.
  const t = tables.find(
    rows =>
      rows.some(r => r.some(c => /The reference category is: 1/.test(c))) &&
      rows.some(r => r.includes('Exp(B)'))
  )
  if (!t) return
  out.multinom = {}
  let cur = null
  for (const r of t) {
    const iv = r.findIndex(c => c === '2' || c === '3')
    if (iv >= 0 && r.includes('Intercept')) cur = r[iv]
    if (!cur) continue
    for (const p of ['Intercept', 'score', 'age']) {
      if (!r.includes(p)) continue
      const v = r.slice(r.indexOf(p) + 1).map(num)
      out.multinom[`${cur}|${p}`] = { b: v[0], se: v[1], wald: v[2], df: v[3], sig: v[4] }
    }
  }
})

// ── Ungrouped life table ──
block('Life table', () => {
  // Two SURVIVAL runs; the ungrouped one has no "First-order Controls" column.
  const t = tables.find(
    rows =>
      rows.some(r => r.includes('Number Exposed to Risk')) &&
      !rows.some(r => r.includes('First-order Controls'))
  )
  if (!t) return
  out.lifeTable = {}
  for (const start of ['0', '6', '12', '18']) {
    const r = t.find(x => x[0] === start)
    if (!r) continue
    const v = r.slice(1).map(num)
    out.lifeTable[start] = {
      entering: v[0],
      withdrawing: v[1],
      exposed: v[2],
      terminal: v[3],
      propTerm: v[4],
      propSurv: v[5],
      cumSurv: v[6]
    }
  }
})

// ── GENLIN (Poisson) ──
block('GENLIN', () => {
  const g = findByLabel('Goodness of Fit')
  if (g) {
    out.genlinGof = {}
    for (const [k, label] of [
      ['deviance', 'Deviance'],
      ['pearson', 'Pearson Chi-Square'],
      ['aic', "Akaike's Information Criterion (AIC)"],
      ['bic', 'Bayesian Information Criterion (BIC)']
    ]) {
      const v = after(g, label)
      if (v) out.genlinGof[k] = v[0]
    }
    const ll = (g ?? []).find(r => r.some(c => c.startsWith('Log Likelihood')))
    if (ll) out.genlinGof.logLik = num(ll[1])
  }
  // The Poisson run's Parameter Estimates: identified by its (Scale) row fixed
  // at 1 and the presence of both predictors.
  const p = tables.find(
    rows =>
      rows.some(r => r.includes('(Intercept)')) &&
      rows.some(r => r.includes('age')) &&
      rows.some(r => r.includes('Wald Chi-Square'))
  )
  if (p) {
    out.genlinParams = {}
    for (const v of ['(Intercept)', 'score', 'age']) {
      const r = after(p, v)
      // Columns: B | SE | CI lo | CI hi | Wald | df | Sig.
      if (r) out.genlinParams[v] = { b: r[0], se: r[1], wald: r[4], df: r[5], sig: r[6] }
    }
  }
})

// ── GEE (GENLIN /REPEATED SUBJECT=grp3 CORRTYPE=EXCHANGEABLE) ──
//
// SPSS prints this under the plain "Generalized Linear Models" heading with the
// same Parameter Estimates layout as the Poisson run above, so it is selected
// by content: the GEE model has `score` and no `age`, and its (Scale) row
// carries an estimate rather than the Poisson run's fixed 1.
block('GEE', () => {
  const p = tables.find(
    rows =>
      rows.some(r => r.includes('(Intercept)')) &&
      rows.some(r => r.includes('score')) &&
      !rows.some(r => r.includes('age')) &&
      rows.some(r => r.some(c => c.includes('Wald Chi-Square')))
  )
  if (!p) return
  out.geeParams = {}
  for (const v of ['(Intercept)', 'score']) {
    const r = after(p, v)
    if (r) out.geeParams[v] = { b: r[0], se: r[1], wald: r[4], df: r[5], sig: r[6] }
  }
  const sc = after(p, '(Scale)')
  if (sc) out.geeScale = sc[0]
})

// ── GLM repeated measures ──
block('GLM repeated', () => {
  const m = findByLabel("Mauchly's Test of Sphericity")
  if (m) {
    const r = row(m, 'timepoint')
    if (r) {
      const v = r.slice(r.indexOf('timepoint') + 1).map(num)
      out.glmRepMauchly = { w: v[0], chi: v[1], df: v[2] }
    }
  }
  const w = findByLabel('Tests of Within-Subjects Effects')
  if (w) {
    const r = w.find(x => x.includes('Sphericity Assumed') && x.includes('timepoint'))
    const e = w.find(x => x.includes('Sphericity Assumed') && x.includes('Error(timepoint)'))
    if (r) {
      const v = r.slice(r.indexOf('Sphericity Assumed') + 1).map(num)
      out.glmRepWithin = { ss: v[0], df: v[1], ms: v[2], f: v[3], sig: v[4] }
    }
    if (e) {
      const v = e.slice(e.indexOf('Sphericity Assumed') + 1).map(num)
      out.glmRepError = { ss: v[0], df: v[1], ms: v[2] }
    }
  }
})

// ── PROXIMITIES ──
block('Proximities', () => {
  const t = findByLabel('Proximity Matrix')
  if (!t) return
  out.proximity = {}
  for (const v of ['q1', 'q2', 'q3']) {
    // The variable names also appear in the HEADER row (q1 | q2 | q3), whose
    // cells num() happily reads as 1/2/3 — it takes the first numeric token of
    // whatever it is given. Require the cells to LOOK numeric, not merely to
    // contain a digit.
    const numeric = c => /^-?[\d.,]+$/.test(c)
    const r = t.find(x => x[0] === v && x.length >= 4 && x.slice(1, 4).every(numeric))
    if (r) out.proximity[v] = r.slice(1, 4).map(num)
  }
})

// ── MULT RESPONSE ──
block('Multiple response', () => {
  const t = tables.find(rows => rows.some(r => r.includes('Percent of Cases')))
  if (!t) return
  out.multResponse = {}
  for (const d of ['d1', 'd2', 'd3', 'Total']) {
    const r = after(t, d)
    if (r) out.multResponse[d] = { n: r[0], pctResponses: r[1], pctCases: r[2] }
  }
})

// ── Hierarchical cluster ──
block('Hierarchical cluster', () => {
  const t = findByLabel('Agglomeration Schedule')
  if (!t) return
  // Only the coefficients are comparable: the fixture has many zero-distance
  // ties, so which pair merges first is implementation-defined, but the
  // sequence of merge distances is not.
  const coefs = []
  for (const r of t) {
    if (!/^\d+$/.test(r[0])) continue
    const v = r.slice(1).map(num)
    if (v[2] !== null) coefs.push(v[2])
  }
  out.agglomCoefficients = coefs
})

// ── Sub-dialog option sets (wave 5) ──
block('Crosstabs full statistics', () => {
  // The 2x2 run (d1 BY grp2), told apart from the earlier region x grp2 one by
  // its Risk Estimate table, which only exists for a 2x2.
  const sym = tables.find(
    rows => rows.some(r => r.includes('Kappa')) && rows.some(r => r.includes("Kendall's tau-b"))
  )
  if (sym) {
    out.crossMeasures = {}
    for (const [k, label] of [
      ['phi', 'Phi'],
      ['cramersV', "Cramer's V"],
      ['contingency', 'Contingency Coefficient'],
      ['taub', "Kendall's tau-b"],
      ['tauc', "Kendall's tau-c"],
      ['gamma', 'Gamma'],
      ['kappa', 'Kappa']
    ]) {
      const v = after(sym, label)
      if (v) out.crossMeasures[k] = { value: v[0], sig: v[v.length - 1] }
    }
  }
  const dir = findByLabel('Directional Measures')
  if (dir) {
    out.crossDirectional = {}
    const sd = dir.find(r => r.includes("Somers' d") && r.includes('Symmetric'))
    if (sd) out.crossDirectional.somersSymmetric = num(sd[sd.indexOf('Symmetric') + 1])
    const eta = dir.find(r => r.includes('Eta'))
    if (eta) out.crossDirectional.eta = num(eta[eta.length - 3] ?? eta[eta.length - 1])
  }
  const risk = findByLabel('Risk Estimate')
  if (risk) {
    const r = risk.find(x => x.some(c => /^Odds Ratio/.test(c)))
    if (r) {
      const v = r.slice(1).map(num)
      out.crossRisk = { oddsRatio: v[0], ciLower: v[1], ciUpper: v[2] }
    }
  }
  // The 2x2 chi-square run also carries continuity correction and Fisher.
  const cs = tables.find(rows => rows.some(r => r.some(c => /Continuity Correction/.test(c))))
  if (cs) {
    out.cross2x2 = {}
    const cc = cs.find(r => r.some(c => /Continuity Correction/.test(c)))
    if (cc) {
      const v = cc.slice(1).map(num)
      out.cross2x2.continuity = { value: v[0], df: v[1], sig: v[2] }
    }
    const fe = cs.find(r => r.includes("Fisher's Exact Test"))
    if (fe) {
      const v = fe
        .slice(fe.indexOf("Fisher's Exact Test") + 1)
        .map(num)
        .filter(x => x !== null)
      out.cross2x2.fisher2 = v[0]
      out.cross2x2.fisher1 = v[1]
    }
    const pe = cs.find(r => r.includes('Pearson Chi-Square'))
    if (pe) {
      const v = pe.slice(pe.indexOf('Pearson Chi-Square') + 1).map(num)
      out.cross2x2.pearson = { value: v[0], df: v[1], sig: v[2] }
    }
  }
})

block('ONEWAY post hoc and robust tests', () => {
  const r = findByLabel('Robust Tests of Equality of Means')
  if (r) {
    out.robustTests = {}
    for (const [k, label] of [
      ['welch', 'Welch'],
      ['brownForsythe', 'Brown-Forsythe']
    ]) {
      const v = after(r, label)
      if (v) out.robustTests[k] = { stat: v[0], df1: v[1], df2: v[2], sig: v[3] }
    }
  }
  const mc = findByLabel('Multiple Comparisons')
  if (mc) {
    // Rows: [method?] (I) (J) meanDiff SE Sig CIlo CIhi — the method and the
    // (I) group appear only on their first row, so carry both as cursors.
    out.postHoc = {}
    const METHODS = [
      'LSD',
      'Bonferroni',
      'Sidak',
      'Scheffe',
      'Tukey HSD',
      'Games-Howell',
      'Tamhane'
    ]
    let method = null
    let gi = null
    for (const row2 of mc) {
      const mIdx = row2.findIndex(c => METHODS.some(m => c === m || c.startsWith(m)))
      if (mIdx >= 0) method = METHODS.find(m => row2[mIdx] === m || row2[mIdx].startsWith(m))
      const rest = mIdx >= 0 ? row2.slice(mIdx + 1) : row2
      // The remaining cells are either (I)(J)… or just (J)…
      const nums = rest.map(num)
      if (nums.length >= 5 && /^[123]$/.test(rest[0] ?? '')) {
        if (nums.length >= 6 && /^[123]$/.test(rest[1] ?? '')) {
          gi = rest[0]
          out.postHoc[`${method}|${gi}|${rest[1]}`] = { diff: nums[2], se: nums[3], sig: nums[4] }
        } else if (gi) {
          out.postHoc[`${method}|${gi}|${rest[0]}`] = { diff: nums[1], se: nums[2], sig: nums[3] }
        }
      }
    }
  }
})

block('Explore M-estimators and extremes', () => {
  const m = findByLabel('M-Estimators')
  if (m) {
    const r = after(m, 'score')
    if (r) out.mEstimators = { huber: r[0], tukey: r[1], hampel: r[2], andrews: r[3] }
  }
  const e = findByLabel('Extreme Values')
  if (e) {
    out.extremes = { highest: [], lowest: [] }
    let mode = null
    for (const row2 of e) {
      if (row2.includes('Highest')) mode = 'highest'
      else if (row2.includes('Lowest')) mode = 'lowest'
      if (!mode) continue
      const nums = row2.map(num).filter(x => x !== null)
      // …| rank | case number | value
      if (nums.length >= 3) out.extremes[mode].push(nums[nums.length - 1])
      else if (nums.length === 2) out.extremes[mode].push(nums[1])
    }
  }
})

block('Kendall correlation', () => {
  const t = find("Kendall's tau_b", 'Correlation Coefficient')
  out.kendall = t ? t.map(r => r.map(c => (num(c) === null ? c : num(c)))) : null
})

block('Frequencies NTILES', () => {
  // The /NTILES=4 run asks for nothing but the quartiles, so its Statistics
  // table is the one with percentile rows and no Mean row. Picking it by
  // position ("the last one") broke the moment wave 6 added a FREQUENCIES
  // after it — and broke silently, reading the WEIGHTED run's quartiles.
  const t = keep
    .filter(x => x.label === 'Statistics')
    .map(x => x.rows)
    .find(rows => rows.some(r => r[0] === 'Percentiles') && !rows.some(r => r[0] === 'Mean'))
  if (!t) return
  out.ntiles = {}
  for (const r of t) {
    const i = r.findIndex(c => ['25', '50', '75'].includes(c))
    if (i >= 0 && num(r[r.length - 1]) !== null) out.ntiles[r[i]] = num(r[r.length - 1])
  }
})

// ── WEIGHT / SPLIT FILE / FILTER matrix (wave 6) ──
block('Weight/split/filter matrix', () => {
  // Each cell uses its own alias of `score`, so the row label says which cell
  // produced the table. Split runs emit one table per group, in group order.
  out.wsf = {}
  const COLS = [
    'N',
    'Minimum',
    'Maximum',
    'Sum',
    'Mean',
    'Std. Deviation',
    'Variance',
    'Skewness',
    'Kurtosis'
  ]
  for (const alias of ['s_w', 's_f', 's_wf', 's_s', 's_ws', 's_fs', 's_wfs']) {
    const hits = []
    for (const { rows } of keep) {
      const head = rows.find(r => r.includes('N') && r.includes('Mean'))
      const data = rows.find(r => r[0] === alias)
      if (!head || !data) continue
      const vals = data.slice(1).map(num)
      const cell = {}
      if (alias === 's_w') {
        // This is the only run that asks for SEMEAN/SKEWNESS/KURTOSIS, and each
        // of those adds a second "Std. Error" cell under one header — so the
        // header names and the data cells no longer line up one to one, and
        // the generic mapping read Std. Deviation as 0.787 (the mean's SE).
        // Spelled out in SPSS's own column order for this command.
        const ORDER = [
          'N',
          'Minimum',
          'Maximum',
          'Sum',
          'Mean',
          'seMean',
          'Std. Deviation',
          'Variance',
          'Skewness',
          'seSkew',
          'Kurtosis',
          'seKurt'
        ]
        ORDER.forEach((nm, i) => (cell[nm] = vals[i] ?? null))
      } else {
        // The other runs request only single-cell statistics, so the header
        // names map straight onto the data cells.
        const names = head.filter(c => COLS.includes(c))
        names.forEach((nm, i) => (cell[nm] = vals[i] ?? null))
      }
      hits.push(cell)
    }
    if (hits.length) out.wsf[alias] = hits
  }
  // Weighted FREQUENCIES on the age alias.
  // The variable an SPSS Statistics table belongs to lives in its layer, not in
  // a row, so it cannot be found by name; the weighted a_w run is the LAST
  // FREQUENCIES in the job.
  const statsTables = keep.filter(x => x.label === 'Statistics')
  const fq = statsTables[statsTables.length - 1]
  if (fq) {
    out.wsfFreq = {}
    const grab = label => {
      const r = fq.rows.find(x => x.some(c => c === label || c.startsWith(label)))
      return r ? num(r[r.length - 1]) : null
    }
    for (const [k, l] of [
      ['nValid', 'Valid'],
      ['mean', 'Mean'],
      ['median', 'Median'],
      ['sd', 'Std. Deviation'],
      ['sum', 'Sum']
    ]) {
      out.wsfFreq[k] = grab(l)
    }
    out.wsfFreq.percentiles = {}
    let inPct = false
    for (const r of fq.rows) {
      if (r[0] === 'Percentiles') {
        inPct = true
        out.wsfFreq.percentiles[r[1]] = num(r[r.length - 1])
        continue
      }
      if (inPct && /^\d+$/.test(r[0])) out.wsfFreq.percentiles[r[0]] = num(r[r.length - 1])
    }
  }
})

if (missing.length) console.log('NOT EXTRACTED:\n  ' + missing.join('\n  '))
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 2))
console.log('wrote', process.argv[3], `(${tables.length} tables parsed)`)
for (const k of Object.keys(out)) {
  const v = out[k]
  const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 1
  console.log(`  ${k}: ${n}`)
}
