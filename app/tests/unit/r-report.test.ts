// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  buildReportHtml,
  mdBlocks,
  mdInline,
  parseRReport,
  type RReport
} from '../../src/lib/r-report'

describe('parseRReport', () => {
  it('splits spin-style prose, headings and code', () => {
    const src = [
      "#' # Iris summary",
      "#' The data has **150** rows.",
      "#' Second line of the same paragraph.",
      "#'",
      "#' Another paragraph.",
      '',
      'x <- 1',
      '',
      'y <- 2',
      "#' After the code."
    ].join('\n')
    expect(parseRReport(src)).toEqual([
      { kind: 'heading', level: 1, text: 'Iris summary' },
      { kind: 'text', text: 'The data has **150** rows.\nSecond line of the same paragraph.' },
      { kind: 'text', text: 'Another paragraph.' },
      { kind: 'code', code: 'x <- 1\n\ny <- 2' },
      { kind: 'text', text: 'After the code.' }
    ])
  })

  it('breaks chunks at # %% cells, RStudio sections and #+ options', () => {
    const src = [
      'a <- 1',
      '# %% Model',
      'fit <- lm(y ~ x)',
      '# Plots ----',
      'plot(1:3)',
      '#+ fig.width=5',
      'hist(1:9)',
      '# --------',
      'b <- 2'
    ].join('\n')
    expect(parseRReport(src)).toEqual([
      { kind: 'code', code: 'a <- 1' },
      { kind: 'heading', level: 2, text: 'Model' },
      { kind: 'code', code: 'fit <- lm(y ~ x)' },
      { kind: 'heading', level: 2, text: 'Plots' },
      { kind: 'code', code: 'plot(1:3)' },
      { kind: 'code', code: 'hist(1:9)' },
      { kind: 'code', code: 'b <- 2' }
    ])
  })

  it('keeps ordinary comments as code and handles CRLF', () => {
    expect(parseRReport('# just a comment\r\nx <- 1\r\n')).toEqual([
      { kind: 'code', code: '# just a comment\nx <- 1' }
    ])
  })

  it('returns nothing for an empty script', () => {
    expect(parseRReport('\n\n')).toEqual([])
  })
})

describe('mdBlocks / mdInline', () => {
  it('groups paragraphs and lists', () => {
    expect(mdBlocks('Intro\nline two\n- a\n- b\n  more b\n1. one\n2. two')).toEqual([
      { kind: 'p', text: 'Intro line two' },
      { kind: 'ul', items: ['a', 'b more b'] },
      { kind: 'ol', items: ['one', 'two'] }
    ])
  })

  it('parses code, bold and italic spans', () => {
    expect(mdInline('Use `lm()` for **linear** models, *not* glm. snake_case_name')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'lm()' },
      { kind: 'text', text: ' for ' },
      { kind: 'bold', text: 'linear' },
      { kind: 'text', text: ' models, ' },
      { kind: 'italic', text: 'not' },
      { kind: 'text', text: ' glm. snake_case_name' }
    ])
  })
})

describe('buildReportHtml', () => {
  const report: RReport = {
    title: 'a<b>.R',
    createdAt: '2026-10-18T10:00:00Z',
    datasetName: 'iris',
    incomplete: true,
    items: [
      { kind: 'heading', level: 1, text: 'Results & <notes>' },
      { kind: 'text', text: 'Mean is `x <- 1` <script>alert(1)</script>' },
      {
        kind: 'code',
        code: 'cat("<b>")',
        output: '<b>',
        error: false,
        plots: ['iVBORw0KGgo="onerror="x'],
        tables: [{ title: 't<1>', columns: ['n<'], rows: [[1, 'a&b', null]] }]
      }
    ]
  }
  const html = buildReportHtml(report, { generated: 'Generated', incomplete: 'Stopped early' })

  it('escapes every piece of user/R text', () => {
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('<title>a&lt;b&gt;.R</title>')
    expect(html).toContain('<h2>Results &amp; &lt;notes&gt;</h2>')
    expect(html).toContain('<code>x &lt;- 1</code>')
    expect(html).toContain('<pre class="code">cat(&quot;&lt;b&gt;&quot;)</pre>')
    expect(html).toContain('<td class="num">1</td><td>a&amp;b</td><td></td>')
  })

  it('keeps only base64 characters in inlined plots', () => {
    // Quotes are dropped, so the value can't close the attribute.
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo=onerror=x"')
  })

  it('marks an incomplete report', () => {
    expect(html).toContain('Stopped early')
  })
})
