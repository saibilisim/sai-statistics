// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Dump EVERY pivot table of an OXML output capture (OMS FORMAT=OXML) into
 * JSON: one synthetic header row ([tableText, ...column category texts])
 * followed by one array per leaf row ([...row label path, ...cell texts]).
 *
 * The comparison scripts navigate by command title + table label + order, so
 * a new scenario needs no bespoke extractor. It replaced the hand-written
 * per-block extractors the ui pilot started with (extract-ui[-oxml].cjs,
 * removed 2026-08-13).
 *
 *   node extract-tables-oxml.cjs missing-job-output.xml spss-missing-tables.json
 *   node extract-tables-oxml.cjs ui-job-output.xml      spss-ui-tables.json
 */
const fs = require('fs')

const xml = fs.readFileSync(process.argv[2], 'utf8')

const decode = s =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

function parse(src) {
  const root = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  for (const m of src.matchAll(/<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, tag, attrSrc, selfClose] = m
    if (closing) {
      while (stack.length > 1 && stack.pop().tag !== tag) {
        /* tolerate nesting slips */
      }
      continue
    }
    if (tag.startsWith('?') || tag.startsWith('!')) continue
    const attrs = {}
    for (const a of attrSrc.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2])
    const node = { tag, attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!selfClose) stack.push(node)
  }
  return root
}

const tree = parse(xml)
const all = []
;(function walk(n) {
  all.push(n)
  for (const c of n.children) walk(c)
})(tree)

function flatten(pt) {
  const findDim = (n, axis) => {
    if (n.tag === 'dimension' && n.attrs.axis === axis) return n
    for (const c of n.children) {
      const r = findDim(c, axis)
      if (r) return r
    }
    return null
  }
  const rowDim = findDim(pt, 'row')
  const colDim = findDim(pt, 'column')
  const colTexts = []
  ;(function pre(n) {
    if ((n.tag === 'category' || n.tag === 'group') && n.attrs.text !== undefined) {
      colTexts.push(n.attrs.text)
    }
    for (const c of n.children) pre(c)
  })(colDim ?? { children: [] })
  const rows = [[pt.attrs.text ?? '', ...colTexts]]
  const walkCat = (node, prefix) => {
    const label = node.attrs.text ?? ''
    const subCol = node.children.find(c => c.tag === 'dimension' && c.attrs.axis === 'column')
    if (subCol) {
      const cells = []
      ;(function coll(n) {
        for (const c of n.children) {
          if (c.tag === 'cell') cells.push(c.attrs.text ?? '')
          else coll(c)
        }
      })(subCol)
      rows.push([...prefix, label, ...cells])
      return
    }
    const subRow = node.children.find(c => c.tag === 'dimension' && c.attrs.axis !== 'column')
    const kids = node.children.filter(c => c.tag === 'category' || c.tag === 'group')
    if (subRow) kids.push(...subRow.children.filter(c => c.tag === 'category' || c.tag === 'group'))
    if (kids.length) {
      for (const c of kids) walkCat(c, [...prefix, label])
    } else {
      const cells = node.children.filter(c => c.tag === 'cell').map(c => c.attrs.text ?? '')
      rows.push([...prefix, label, ...cells])
    }
  }
  /** A dimension of THIS node (descending through hidden group wrappers). */
  const ownDim = (n, axis) => {
    for (const c of n.children) {
      if (c.tag === 'dimension' && c.attrs.axis === axis) return c
      if (c.tag === 'group') {
        const r = ownDim(c, axis)
        if (r) return r
      }
    }
    return null
  }
  const catsOf = n => {
    const out = []
    for (const c of n.children) {
      if (c.tag === 'category') out.push(c)
      else if (c.tag === 'group') out.push(...catsOf(c))
    }
    return out
  }

  /**
   * Layer tables (OLAP Cubes: `axis="layer"` on the grouping variable) repeat
   * the whole row block once per layer category. Walking only the first row
   * dimension found returned the FIRST layer and silently dropped the rest —
   * an OLAP Cube by grp3 looked like a one-group table. Each layer's label is
   * pushed onto the row-label path instead, so a row reads
   * [layer, variable, ...cells].
   */
  const emitFrom = (node, prefix) => {
    const layer = ownDim(node, 'layer')
    if (layer) {
      for (const c of catsOf(layer)) emitFrom(c, [...prefix, c.attrs.text ?? ''])
      return
    }
    // Groups keep their own label here (walkCat pushes it onto the prefix) —
    // flattening them away turned "Pair 1 / pre" into a bare "pre".
    const rd = ownDim(node, 'row') ?? findDim(node, 'row')
    if (rd) {
      for (const c of rd.children.filter(x => x.tag === 'category' || x.tag === 'group')) {
        walkCat(c, prefix)
      }
      return
    }
    // Column-only table (Reliability Statistics, ROC's Area Under the Curve,
    // Curve Fit's Model Summary): there is no row dimension at all and the
    // cells hang off the column categories, so the table came out as a bare
    // header. Emitted with an empty row label to keep the [labels..., cells...]
    // shape every consumer expects.
    const cd = ownDim(node, 'column')
    if (cd) {
      const cells = []
      ;(function coll(n) {
        for (const c of n.children) {
          if (c.tag === 'cell') cells.push(c.attrs.text ?? '')
          else coll(c)
        }
      })(cd)
      if (cells.length) rows.push([...prefix, '', ...cells])
    }
  }
  emitFrom(pt, [])
  return rows
}

// Command titles group the pivots; keeping them lets the consumer attribute a
// table to the procedure that produced it (two runs of the same procedure
// share table labels — order is the only discriminator).
const out = []
let lastCommand = ''
for (const n of all) {
  if (n.tag === 'command') lastCommand = n.attrs.command ?? lastCommand
  if (n.tag === 'pivotTable') {
    out.push({ command: lastCommand, label: n.attrs.text ?? '', rows: flatten(n) })
  }
}

fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1))
console.log(`tables: ${out.length}`)
