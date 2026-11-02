// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Graphs-menu blocks are titled `analysis.chart-<type>.title`; the locale
 * keeps those titles as chart.<type>Title. Before this mapping every chart
 * block in Output showed the raw key as its heading.
 */
import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { translateOutputKey } from '../../src/lib/output-format'
import trAnalysis from '../../src/i18n/locales/tr/analysis.json'

const t = ((key: string, opts?: { defaultValue?: string }) => {
  const path = key.replace(/^analysis:/, '').split('.')
  const v = path.reduce<unknown>(
    (o, k) => (o as Record<string, unknown> | undefined)?.[k],
    trAnalysis
  )
  return typeof v === 'string' ? v : (opts?.defaultValue ?? key)
}) as unknown as TFunction

describe('chart block titles', () => {
  it.each(['scatter', 'bar', 'line', 'histogram', 'boxplot', 'pp', 'qq'])(
    '%s has a translated title',
    type => {
      const title = translateOutputKey(`analysis.chart-${type}.title`, t)
      expect(title).not.toContain('analysis')
      expect(title).toBe(trAnalysis.chart[`${type}Title` as keyof typeof trAnalysis.chart])
    }
  )

  it('other analysis titles are unchanged', () => {
    expect(translateOutputKey('analysis.descriptives.title', t)).toBe(trAnalysis.descriptives.title)
  })
})
