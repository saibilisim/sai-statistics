// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * R writes chart words like the Frequencies y-axis title as output keys
 * ("output.col.frequency"); localizePlotFigure translates them before a
 * figure is drawn or exported. Before, the axis read "Frequency" in every
 * language.
 */
import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { localizePlotFigure } from '../../src/lib/output-format'
import trAnalysis from '../../src/i18n/locales/tr/analysis.json'

const t = ((key: string, opts?: { defaultValue?: string }) => {
  const path = key.replace(/^analysis:/, '').split('.')
  const v = path.reduce<unknown>(
    (o, k) => (o as Record<string, unknown> | undefined)?.[k],
    trAnalysis
  )
  return typeof v === 'string' ? v : (opts?.defaultValue ?? key)
}) as unknown as TFunction

describe('localizePlotFigure', () => {
  it('translates key axis titles and trace names', () => {
    const fig = {
      data: [{ type: 'histogram', name: 'output.col.frequency' }, { name: 'Normal' }],
      layout: {
        xaxis: { title: { text: 'age' } },
        yaxis: { title: { text: 'output.col.frequency' }, showgrid: true },
        yaxis2: { title: 'output.col.percent' }
      }
    }
    const out = localizePlotFigure(fig, t)
    expect(out.layout.yaxis.title.text).toBe(trAnalysis.col.frequency)
    expect(out.layout.yaxis.showgrid).toBe(true)
    expect(out.layout.yaxis2.title).toBe(trAnalysis.col.percent)
    expect(out.layout.xaxis.title.text).toBe('age')
    expect(out.data[0]?.name).toBe(trAnalysis.col.frequency)
    expect(out.data[1]?.name).toBe('Normal')
    // the stored figure is never mutated
    expect(fig.layout.yaxis.title.text).toBe('output.col.frequency')
  })

  it('returns the same object when nothing is a key', () => {
    const fig = { data: [{ name: 'score' }], layout: { yaxis: { title: { text: 'Count' } } } }
    expect(localizePlotFigure(fig, t)).toBe(fig)
    expect(localizePlotFigure('<svg/>', t)).toBe('<svg/>')
    expect(localizePlotFigure(null, t)).toBe(null)
  })
})
