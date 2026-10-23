// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/* Report what a probe run produced: one line per command, the tables it
 * emitted, and the warning text when it produced none.
 *
 * Used to establish which procedures this SPSS install can actually run before
 * writing comparisons for them — licensing and syntax both have to be measured,
 * not assumed.
 *
 *   node tests/spss-parity/probe-report.cjs tests/spss-parity/probe-out.htm
 */
const fs = require('fs')

const html = fs.readFileSync(process.argv[2], 'utf8').replace(/<style[\s\S]*?<\/style>/gi, '')
const marks = [...html.matchAll(/aria-label="([^"]+)"/g)].map(m => ({ i: m.index, l: m[1] }))
const syn = [...html.matchAll(/Syntax<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => ({
  i: m.index,
  s: m[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}))

let ok = 0
let bad = 0
for (let k = 0; k < syn.length; k++) {
  const end = k + 1 < syn.length ? syn[k + 1].i : html.length
  const inside = marks.filter(m => m.i > syn[k].i && m.i < end && m.l !== 'Notes').map(m => m.l)
  const good = inside.length > 0 && !(inside.length === 1 && inside[0] === 'Warnings')
  good ? ok++ : bad++
  console.log(
    (good ? 'OK   ' : 'HATA ') +
      syn[k].s.slice(0, 56).padEnd(58) +
      ' -> ' +
      inside.join(', ').slice(0, 90)
  )
  if (!good) {
    const seg = html
      .slice(syn[k].i, end)
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
    const lines = [
      ...new Set(
        seg
          .split('\n')
          .map(s => s.trim())
          .filter(
            s =>
              s.length > 25 &&
              !/^(Output|Comments|Input|Filter|Weight|Split|N of|Missing|Cases|Syntax|Resources|Processor|Elapsed|C:|Warnings,)/.test(
                s
              ) &&
              s !== syn[k].s
          )
      )
    ]
    for (const l of lines.slice(0, 2)) console.log('       ' + l.slice(0, 150))
  }
}
console.log(`\n${ok} calisti, ${bad} calismadi`)
