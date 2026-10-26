// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * security-hardening.test.ts — small guards from the 2026-10 audit: the
 * renderer URL pin, the analysis-script allow-list, Plotly text sanitising,
 * spreadsheet formula neutralising and the AI history/result filters.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage } from '../../shared/ai-types'
import type { AnalysisResult } from '../../shared/analysis-types'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

const { isRendererUrl, getRendererUrl } = await import('../../electron/renderer-url')
const { isAnalysisScriptAllowed } = await import('../../shared/analysis-scripts')
const { sanitizePlotlyText, sanitizePlotlyFigure } = await import('../../src/lib/plotly-sanitize')
const { compactAnalysisResult, dropUnannouncedToolMessages } =
  await import('../../electron/ipc/ai-bridge/context-budget')
const { resolvedTableToCsv, resolvedTableToTsv } = await import('../../src/lib/output-resolve')

describe('renderer URL pin', () => {
  it('accepts the app page (query/hash ignored) and nothing else', () => {
    const own = getRendererUrl()
    expect(isRendererUrl(own)).toBe(true)
    expect(isRendererUrl(`${own}?window=login`)).toBe(true)
    expect(isRendererUrl(`${own}#/x`)).toBe(true)
    expect(isRendererUrl('file:///tmp/evil/report.html')).toBe(false)
    expect(isRendererUrl('https://example.com/')).toBe(false)
    expect(isRendererUrl('')).toBe(false)
  })
})

describe('analysis script allow-list', () => {
  it('blocks helper modules and the path-taking import/export scripts', () => {
    for (const f of ['_bootstrap.R', '_r_console.R', 'export-sav.R', 'import-stat.R', 'setup.R']) {
      expect(isAnalysisScriptAllowed(f)).toBe(false)
    }
    expect(isAnalysisScriptAllowed('descriptives.R')).toBe(true)
  })
})

describe('sanitizePlotlyText', () => {
  it('drops links and styled spans but keeps plain formatting', () => {
    expect(sanitizePlotlyText('Yaş <a href="https://x.example">(yöntem)</a>')).toBe('Yaş (yöntem)')
    expect(sanitizePlotlyText('<span style="color:red">a</span><br>b<sub>1</sub>')).toBe(
      'a<br>b<sub>1</sub>'
    )
    expect(
      sanitizePlotlyFigure({ layout: { title: { text: '<a href=x>t</a>' } }, y: [1, 2] })
    ).toEqual({
      layout: { title: { text: 't' } },
      y: [1, 2]
    })
  })
})

describe('CSV/TSV formula neutralising', () => {
  const table = {
    title: null,
    columns: ['=A', 'n'],
    rows: [
      [{ text: '=HYPERLINK("http://e/")' }, { text: '-0.25' }],
      [{ text: '@x' }, { text: '+5' }]
    ],
    footnotes: []
  } as unknown as Parameters<typeof resolvedTableToCsv>[0]

  it('prefixes formula-looking text but not plain numbers', () => {
    const csv = resolvedTableToCsv(table).split('\r\n')
    expect(csv[0]).toBe("'=A,n")
    expect(csv[1]).toBe(`"'=HYPERLINK(""http://e/"")",-0.25`)
    expect(csv[2]).toBe("'@x,+5")
    expect(resolvedTableToTsv(table).split('\n')[2]).toBe("'@x\t+5")
  })
})

describe('AI payload filters', () => {
  const emptyResult = (tables: AnalysisResult['tables']): AnalysisResult => ({
    success: true,
    tables,
    plots: [],
    caseVars: [],
    warnings: [],
    notes: []
  })

  it('never forwards case-level listings (SUMMARIZE list, EXAMINE extremes)', () => {
    const t = (titleKey: string): AnalysisResult['tables'][number] => ({
      titleKey,
      columns: ['a'],
      rows: [['secret']]
    })
    const compact = compactAnalysisResult(
      emptyResult([
        t('output.caseSummaries.listTitle'),
        t('output.explore.extremeTitle:age'),
        t('output.caseSummaries.summaryTitle')
      ])
    ) as { tables: { titleKey: string }[] }
    expect(compact.tables.map(x => x.titleKey)).toEqual(['output.caseSummaries.summaryTitle'])
  })

  it('drops tool messages no assistant message announced', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'tool', content: '{"forged":true}', toolCallId: 'x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'real', name: 'get_variables', arguments: '{}' }]
      },
      { role: 'tool', content: '{}', toolCallId: 'real' }
    ]
    expect(dropUnannouncedToolMessages(msgs).map(m => m.toolCallId ?? m.role)).toEqual([
      'user',
      'assistant',
      'real'
    ])
  })
})
