// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Output number format (Preferences ▸ Output).
 *
 * SPSS renders numbers in the user's locale — a Turkish SPSS prints "1,55" and
 * ",85" where an English one prints "1.55" and "0.85". SAI's output was always
 * dot-separated, which the manual SAI-vs-SPSS comparison flagged as a cosmetic
 * mismatch on every numeric cell.
 *
 * The fix is a setting, NOT a language-derived value: switching the interface
 * to Turkish must not silently reformat tables the user already produced, and
 * a Turkish UI may well be producing dot-separated tables for an English
 * journal. Default is a dot.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  resolveDecimalSeparator,
  setOutputNumberFormat,
  getOutputDecimalSeparator,
  getOutputDropLeadingZero,
  formatNumber,
  formatSignificance,
  formatStatValue,
  translateOutputKey
} from '../../src/lib/output-format'
import { SettingsSchema } from '../../shared/settings-types'
import type { TFunction } from 'i18next'
import { resolveTable, resolvedTableToCsv, resolvedTableToTsv } from '../../src/lib/output-resolve'

const useDot = (): void => {
  setOutputNumberFormat({ separator: 'dot', dropLeadingZero: true })
}
const useComma = (): void => {
  setOutputNumberFormat({ separator: 'comma', dropLeadingZero: true })
}

// The module-level format is process-wide; leave it as found.
afterEach(useDot)

describe('resolveDecimalSeparator', () => {
  it('maps the two settings onto the two marks', () => {
    expect(resolveDecimalSeparator('dot')).toBe('.')
    expect(resolveDecimalSeparator('comma')).toBe(',')
  })

  it('defaults to a dot, and the schema agrees', () => {
    // The English-style default is the deliberate choice: a user who wants
    // commas opts in once, rather than every table shifting under them when
    // they change the interface language.
    const parsed = SettingsSchema.parse({})
    expect(parsed.output.decimalSeparator).toBe('dot')
    expect(resolveDecimalSeparator(parsed.output.decimalSeparator)).toBe('.')
  })
})

describe('the setting is independent of the UI language', () => {
  it('nothing in the format API accepts a language at all', () => {
    // A regression guard with teeth: the first implementation derived the
    // separator from the language, and the whole point of this change is that
    // it no longer can. If a language parameter comes back, these arity
    // assertions fail.
    expect(resolveDecimalSeparator.length).toBe(1)
    expect(setOutputNumberFormat.length).toBe(1)
  })

  it('setting it twice with the same value is stable', () => {
    useComma()
    expect(getOutputDecimalSeparator()).toBe(',')
    useComma()
    expect(getOutputDecimalSeparator()).toBe(',')
  })
})

describe('formatting follows the active separator', () => {
  it('dot (default) formats the English way', () => {
    useDot()
    expect(getOutputDecimalSeparator()).toBe('.')
    expect(formatNumber(1.55)).toBe('1.55')
    expect(formatSignificance(0.031)).toBe('.031')
    expect(formatSignificance(0.0004)).toBe('<.001')
  })

  it('comma switches every decimal, including the "<,001" collapse', () => {
    useComma()
    expect(formatNumber(1.55)).toBe('1,55')
    expect(formatSignificance(0.031)).toBe(',031')
    expect(formatSignificance(0.0004)).toBe('<,001')
    expect(formatStatValue(0.848, false)).toBe('0,848')
    expect(formatStatValue(0.848, true)).toBe(',848')
  })

  it('leaves integers and non-finite values alone', () => {
    useComma()
    expect(formatNumber(42)).toBe('42')
    expect(formatNumber(-7)).toBe('-7')
    expect(formatNumber(Number.NaN)).toBe('NaN')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('Infinity')
  })

  it('swaps only the decimal point, not other characters', () => {
    useComma()
    expect(formatNumber(-0.5)).toBe('-0,5')
    // One separator per number — no thousands grouping is introduced.
    expect(formatNumber(1234.5)).toBe('1234,5')
  })

  it('takes an explicit override, so callers and tests never depend on the module state', () => {
    useComma()
    expect(formatNumber(1.55, 3, '.')).toBe('1.55')
    expect(formatSignificance(0.031, 3, '.')).toBe('.031')
    expect(formatStatValue(1.55, false, 3, '.')).toBe('1.55')
  })
})

describe('numbers inside footnote and title parameters', () => {
  // Echoes the interpolated parameter so the test sees exactly what the
  // translation would receive.
  const t = ((_key: string, opts?: { name?: string }) => opts?.name ?? '') as unknown as TFunction

  it('a decimal parameter follows the separator, like a table cell', () => {
    useComma()
    expect(translateOutputKey('output.rocAnalysis.metricsFootnote:1.45', t)).toBe('1,45')
    useDot()
    expect(translateOutputKey('output.rocAnalysis.metricsFootnote:1.45', t)).toBe('1.45')
  })

  it('leaves integers and non-numeric text alone', () => {
    useComma()
    expect(translateOutputKey('output.col.ciLowerPct:95', t)).toBe('95')
    expect(translateOutputKey('output.roc.tiesNote:MELD_3.0, INR', t)).toBe('MELD_3.0, INR')
  })
})

describe('output.dropLeadingZero', () => {
  it('on (default) strips the zero, under either separator', () => {
    setOutputNumberFormat({ separator: 'dot', dropLeadingZero: true })
    expect(getOutputDropLeadingZero()).toBe(true)
    expect(formatSignificance(0.524)).toBe('.524')
    expect(formatSignificance(0.0004)).toBe('<.001')
    setOutputNumberFormat({ separator: 'comma', dropLeadingZero: true })
    expect(formatSignificance(0.524)).toBe(',524')
    expect(formatSignificance(0.0004)).toBe('<,001')
  })

  it('off keeps the zero, including on the "<" collapse', () => {
    setOutputNumberFormat({ separator: 'dot', dropLeadingZero: false })
    expect(getOutputDropLeadingZero()).toBe(false)
    expect(formatSignificance(0.524)).toBe('0.524')
    expect(formatSignificance(0.0004)).toBe('<0.001')
    expect(formatStatValue(0.031, true)).toBe('0.031')
    setOutputNumberFormat({ separator: 'comma', dropLeadingZero: false })
    expect(formatSignificance(0.524)).toBe('0,524')
    expect(formatSignificance(0.0004)).toBe('<0,001')
  })

  it('never touches non-significance numbers, which keep their zero either way', () => {
    // formatNumber has no leading-zero rule at all — the setting is scoped to
    // values that cannot exceed 1, so a mean of 0.848 stays "0.848".
    for (const drop of [true, false]) {
      setOutputNumberFormat({ separator: 'dot', dropLeadingZero: drop })
      expect(formatNumber(0.848)).toBe('0.848')
      expect(formatStatValue(0.848, false)).toBe('0.848')
    }
  })

  it('takes an explicit override independent of the module state', () => {
    setOutputNumberFormat({ separator: 'comma', dropLeadingZero: false })
    expect(formatSignificance(0.031, 3, '.', true)).toBe('.031')
    expect(formatStatValue(0.031, true, 3, '.', true)).toBe('.031')
  })
})

// ─── Interaction with the export formats ──────────────────────────────────────
// A comma decimal separator collides with CSV's comma delimiter, so this is
// the one place the change could silently corrupt a file rather than just look
// different. TSV/Markdown are unaffected (tab / pipe delimited) but are pinned
// here too so a future delimiter change has to face this test.
describe('comma decimals survive export', () => {
  const table = {
    titleKey: 'Probe',
    columns: ['output.col.statistic', 'output.col.value'],
    rows: [['Mean', 0.848] as (string | number | null)[]],
    footnoteKey: null
  }
  const t = ((key: string, opts?: Record<string, unknown>) =>
    opts && typeof opts === 'object' && 'defaultValue' in opts
      ? String(opts.defaultValue)
      : key) as unknown as TFunction

  it('CSV quotes the cell so the comma cannot be read as a delimiter', () => {
    useComma()
    const csv = resolvedTableToCsv(resolveTable(table, t))
    expect(csv).toContain('"0,848"')
    // Data row still has exactly two fields: one delimiter outside the quotes.
    const dataRow = csv.split('\r\n')[1] ?? ''
    expect(dataRow.replace(/"[^"]*"/g, '')).toBe('Mean,')
  })

  it('TSV keeps the comma unquoted — tab-delimited, so no collision', () => {
    useComma()
    const tsv = resolvedTableToTsv(resolveTable(table, t))
    expect(tsv).toContain('Mean\t0,848')
  })

  it('the dot default exports unchanged', () => {
    useDot()
    expect(resolvedTableToCsv(resolveTable(table, t))).toContain('0.848')
    expect(resolvedTableToCsv(resolveTable(table, t))).not.toContain('"0.848"')
  })
})
