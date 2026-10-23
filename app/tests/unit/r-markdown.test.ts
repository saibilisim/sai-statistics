// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * r-markdown.test.ts — .Rmd / .qmd in the R script editor (2026-10-21):
 * report parsing (parseRmd) and the run text that keeps only evaluated R
 * chunks (rmdRunnableText).
 */
import { describe, it, expect } from 'vitest'
import { isRMarkdown, parseRmd, rmdRunnableText } from '../../src/lib/r-report'

const DOC = [
  '---',
  'title: "Iris özeti"',
  'output: html_document',
  '---',
  '',
  '```{r setup, include=FALSE}',
  'library(stats)',
  '```',
  '',
  '# Giriş',
  '',
  'Bu bir **paragraf**.',
  '',
  '```{r}',
  'summary(iris)',
  '```',
  '',
  '```{r gizli, echo = FALSE}',
  'plot(1:3)',
  '```',
  '',
  '```{r}',
  '#| eval: false',
  'install.packages("x")',
  '```',
  '',
  '```{python}',
  'print(1)',
  '```'
].join('\n')

describe('isRMarkdown', () => {
  it('by extension or by an {r} chunk', () => {
    expect(isRMarkdown('a.Rmd', '')).toBe(true)
    expect(isRMarkdown('a.qmd', '')).toBe(true)
    expect(isRMarkdown('a.R', 'x <- 1')).toBe(false)
    expect(isRMarkdown('script.R', '```{r}\nx\n```')).toBe(true)
  })
})

describe('parseRmd', () => {
  const { title, parts } = parseRmd(DOC)

  it('takes the YAML title', () => {
    expect(title).toBe('Iris özeti')
  })

  it('splits Markdown and chunks, with their options', () => {
    expect(parts.map(p => p.kind)).toEqual([
      'code',
      'heading',
      'text',
      'code',
      'code',
      'code',
      'code'
    ])
    const [setup, , , plain, hidden, notRun, python] = parts
    expect(setup).toMatchObject({ code: 'library(stats)', opts: { include: false, eval: true } })
    expect(plain).toMatchObject({ code: 'summary(iris)', opts: { eval: true, echo: true } })
    expect(hidden).toMatchObject({ opts: { echo: false, eval: true } })
    // Quarto `#|` options are read and not kept as code.
    expect(notRun).toMatchObject({ code: 'install.packages("x")', opts: { eval: false } })
    // Another engine is shown, never run by R.
    expect(python).toMatchObject({ opts: { eval: false } })
  })
})

describe('rmdRunnableText', () => {
  const run = rmdRunnableText(DOC)

  it('keeps offsets: same length, same line breaks', () => {
    expect(run).toHaveLength(DOC.length)
    expect(run.split('\n')).toHaveLength(DOC.split('\n').length)
  })

  it('keeps exactly the evaluated R chunk lines', () => {
    const code = run
      .split('\n')
      .filter(l => l.trim() !== '')
      .map(l => l.trim())
    expect(code).toEqual(['library(stats)', 'summary(iris)', 'plot(1:3)'])
  })
})
