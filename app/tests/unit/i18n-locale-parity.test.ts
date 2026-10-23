// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Guards CLAUDE.md §6: every i18n key added to the tr/ (reference) locale must
 * have a counterpart in every other SUPPORTED_LANGUAGES locale, and vice
 * versa. Without this test the parity that the 2026-07-02 audit observed
 * (1305/1305 keys matching) is accidental discipline, not a guarantee — a
 * future PR could add a tr-only key and pass CI silently, leaving users of
 * other languages with a raw key or fallback string.
 *
 * Loops over SUPPORTED_LANGUAGES (K4.1) instead of hardcoded tr/en imports —
 * adding a new language's 4 locale files is automatically covered here, no
 * test edit needed.
 */
import { describe, it, expect } from 'vitest'
import { SUPPORTED_LANGUAGES } from '../../shared/languages'

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue }

const NAMESPACES = ['common', 'menu', 'analysis', 'dialogs'] as const

const localeModules = import.meta.glob<{ default: JsonValue }>('../../src/i18n/locales/*/*.json', {
  eager: true
})

function loadLocale(lang: string, ns: string): JsonValue {
  const path = `../../src/i18n/locales/${lang}/${ns}.json`
  const mod = localeModules[path]
  if (!mod) throw new Error(`Missing locale module: ${path}`)
  return mod.default
}

/** Flattens nested keys to dot paths, e.g. { a: { b: 1 } } -> ["a.b"]. */
function flattenKeys(obj: JsonValue, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key)
  )
}

const referenceLang = 'tr'
const otherLangs = SUPPORTED_LANGUAGES.filter(l => l !== referenceLang)

describe('i18n locale key parity (tr <-> every SUPPORTED_LANGUAGES entry)', () => {
  for (const ns of NAMESPACES) {
    const refKeys = new Set(flattenKeys(loadLocale(referenceLang, ns)))

    for (const lang of otherLangs) {
      it(`${ns}.json: every ${referenceLang} key has a ${lang} counterpart and vice versa`, () => {
        const langKeys = new Set(flattenKeys(loadLocale(lang, ns)))

        const refOnly = [...refKeys].filter(k => !langKeys.has(k))
        const langOnly = [...langKeys].filter(k => !refKeys.has(k))

        expect(
          refOnly,
          `keys present in ${referenceLang}/${ns}.json but missing from ${lang}/${ns}.json`
        ).toEqual([])
        expect(
          langOnly,
          `keys present in ${lang}/${ns}.json but missing from ${referenceLang}/${ns}.json`
        ).toEqual([])
      })
    }
  }
})
