// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Guards the other half of CLAUDE.md §6: i18n-locale-parity.test.ts proves the
 * locales agree WITH EACH OTHER, but nothing checked that a key the code emits
 * actually exists in them. A key missing from all six locales at once passes
 * parity perfectly and still shows the user the raw key.
 *
 * That is not hypothetical: the SPSS-syntax terminal shipped emitting eight
 * `terminal.log.*` keys (VARIABLE LABELS / VALUE LABELS / MISSING VALUES
 * results, plus the weight- and split-scope notes) that existed in no locale,
 * so running `WEIGHT BY income` printed the literal text
 * "terminal.log.weightScopeNote" into the console. Found by an e2e run, not by
 * the unit suite — hence this test.
 *
 * Scope: statically-written literal keys in the dispatcher, which is where the
 * pattern is dense and uniform. Keys built at runtime by string concatenation
 * (the `output.*` family that R scripts emit, e.g. "output.stat.pct" + n) are
 * deliberately out of scope — they cannot be recovered by reading source text.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { SUPPORTED_LANGUAGES } from '../../shared/languages'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '../..')

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue }

const localeModules = import.meta.glob<{ default: JsonValue }>('../../src/i18n/locales/*/*.json', {
  eager: true
})

function lookup(obj: JsonValue, path: string[]): JsonValue | undefined {
  let cur: JsonValue | undefined = obj
  for (const part of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

/** Source files scanned, paired with the namespace their keys resolve against. */
const SOURCES = [
  { file: 'src/lib/spss-syntax.ts', ns: 'analysis', prefix: 'terminal.log' }
] as const

describe('i18n keys emitted by the code exist in every locale', () => {
  for (const { file, ns, prefix } of SOURCES) {
    const source = readFileSync(resolve(appRoot, file), 'utf-8')
    const pattern = new RegExp(`${prefix.replace(/\./g, '\\.')}\\.([A-Za-z][A-Za-z0-9]*)`, 'g')
    const used = [...new Set(Array.from(source.matchAll(pattern), m => m[1] as string))].sort()

    it(`${file}: finds ${prefix}.* keys to check`, () => {
      // A refactor that renames the prefix would otherwise silently make this
      // whole file test nothing at all.
      expect(used.length).toBeGreaterThan(0)
    })

    for (const lang of SUPPORTED_LANGUAGES) {
      it(`${file}: every ${prefix}.* key exists in ${lang}/${ns}.json`, () => {
        const mod = localeModules[`../../src/i18n/locales/${lang}/${ns}.json`]
        if (!mod) throw new Error(`Missing locale module: ${lang}/${ns}.json`)
        const missing = used.filter(
          key => typeof lookup(mod.default, [...prefix.split('.'), key]) !== 'string'
        )
        expect(
          missing,
          `keys used in ${file} but missing from ${lang}/${ns}.json (users would see the raw key)`
        ).toEqual([])
      })
    }
  }
})
