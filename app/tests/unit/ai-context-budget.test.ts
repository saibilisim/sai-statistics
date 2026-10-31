// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import type { ChatMessage } from '../../shared/ai-types'
import type { AnalysisResult } from '../../shared/analysis-types'
import {
  compactAnalysisResult,
  elideStaleToolResults,
  trimHistory
} from '../../electron/ipc/ai-bridge/context-budget'

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    success: true,
    tables: [],
    plots: [],
    caseVars: [],
    warnings: [],
    notes: [],
    ...overrides
  }
}

describe('compactAnalysisResult', () => {
  it('grafik verisini, vaka değerlerini ve model XML’ini modele göndermez', () => {
    const compact = compactAnalysisResult(
      result({
        modelXml: '<pmml>…</pmml>',
        plots: [{ titleKey: 'plot.hist', type: 'plotly', data: { huge: 'x'.repeat(10_000) } }],
        caseVars: [
          {
            name: 'RES_1',
            label: '',
            type: 'numeric',
            measure: 'scale',
            decimals: 3,
            values: [1, 2, 3],
            rowIndex: [0, 1, 2]
          }
        ],
        warnings: ['warn.a']
      })
    )
    const json = JSON.stringify(compact)
    expect(json).not.toContain('huge')
    expect(json).not.toContain('pmml')
    expect(compact['plotsShownInOutput']).toEqual(['plot.hist'])
    expect(compact['caseVariablesAvailable']).toEqual(['RES_1'])
    expect(compact['warnings']).toEqual(['warn.a'])
  })

  it('sayıları 6 anlamlı basamağa yuvarlar, küçük p-değerlerini korur, uzun tabloyu kırpar', () => {
    const rows = Array.from({ length: 75 }, (_, i) => [
      `v${String(i)}`,
      0.123456789012,
      1.23456789e-9,
      i
    ])
    const compact = compactAnalysisResult(
      result({ tables: [{ titleKey: 't', columns: ['a', 'b', 'c', 'd'], rows }] })
    )
    const table = (compact['tables'] as { rows: unknown[][]; rowsOmitted?: string }[])[0]
    expect(table?.rows).toHaveLength(60)
    expect(table?.rows[0]).toEqual(['v0', 0.123457, 1.23457e-9, 0])
    expect(table?.rowsOmitted).toMatch(/^15 more rows/)
  })

  it('etiketleri (labels) uygular, ama vaka-düzeyi tabloyu anahtara göre yine atar', () => {
    const compact = compactAnalysisResult(
      result({
        tables: [
          {
            titleKey: 'output.crosstabs.title',
            columns: ['output.col.statistic', 'output.col.value'],
            rows: [['output.col.pearsonChiSq', 0.556]],
            footnoteKey: 'output.foot.x'
          },
          {
            titleKey: 'output.caseSummaries.listTitle',
            columns: ['output.col.value'],
            rows: [['secret-case', 1]]
          }
        ],
        notes: ['output.note.a']
      }),
      {
        'output.crosstabs.title': 'Crosstabulation',
        'output.col.statistic': 'Statistic',
        'output.col.value': 'Value',
        'output.col.pearsonChiSq': 'Pearson Chi-Square',
        'output.foot.x': 'Footnote',
        'output.caseSummaries.listTitle': 'Case Summaries',
        'output.note.a': 'A note'
      }
    )
    expect(compact['tables']).toEqual([
      {
        titleKey: 'Crosstabulation',
        columns: ['Statistic', 'Value'],
        rows: [['Pearson Chi-Square', 0.556]],
        footnoteKey: 'Footnote'
      }
    ])
    expect(JSON.stringify(compact)).not.toContain('secret-case')
    expect(compact['notes']).toEqual(['A note'])
  })
})

describe('elideStaleToolResults', () => {
  const big = JSON.stringify({
    analysisId: 'descriptives',
    status: 'completed',
    pad: 'x'.repeat(2000)
  })
  const history: ChatMessage[] = [
    { role: 'user', content: 'ilk soru' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'old', name: 'run_analysis', arguments: '{}' }]
    },
    { role: 'tool', content: big, toolCallId: 'old' },
    { role: 'assistant', content: 'yorum' },
    { role: 'user', content: 'ikinci soru' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'new', name: 'run_analysis', arguments: '{}' }]
    },
    { role: 'tool', content: big, toolCallId: 'new' },
    { role: 'user', content: 'devam et' }
  ]

  it('eski turun büyük sonucunu özetler, en son tool bloğunu (kesilen tur) tam bırakır', () => {
    const out = elideStaleToolResults(history)
    const oldTool = JSON.parse(out[2]?.content ?? '{}') as Record<string, unknown>
    expect(oldTool['elided']).toBeDefined()
    expect(oldTool['analysisId']).toBe('descriptives')
    expect(out[6]?.content).toBe(big)
    expect(out[6]?.toolCallId).toBe('new')
  })

  it('tool mesajı yoksa geçmişe dokunmaz', () => {
    const plain: ChatMessage[] = [{ role: 'user', content: 'merhaba' }]
    expect(elideStaleToolResults(plain)).toBe(plain)
  })
})

describe('trimHistory', () => {
  it('kesimi bir kullanıcı mesajına kaydırır (yetim tool mesajı kalmaz)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u1' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'a', name: 'get_variables', arguments: '{}' }]
      },
      { role: 'tool', content: '{}', toolCallId: 'a' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'r2' }
    ]
    const out = trimHistory(msgs, 4)
    expect(out[0]).toEqual({ role: 'user', content: 'u2' })
    expect(out).toHaveLength(2)
  })

  it('limit altındaysa aynen döner', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'u' }]
    expect(trimHistory(msgs, 10)).toBe(msgs)
  })
})
