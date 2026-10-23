// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
// Variable name identity — single source of truth for the rules that govern
// the user-facing `name` field (the identifier used in dialogs and, later, in
// the script/syntax layer). `name` is the machine-friendly handle; `label` is
// free-text display only. Keep this module pure (no IPC/DB) so both Main and
// Renderer — and a future script parser — can share it.

/** Structural rule for a valid variable name (matches VariableSchema.name). */
const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** Transliteration for Turkish letters so sanitized names stay readable
 *  ("Gelir Düzeyi" → "GelirDuzeyi" instead of "Gelir_D_zeyi"). */
const TR_TRANSLITERATION = new Map<string, string>([
  ['ç', 'c'],
  ['Ç', 'C'],
  ['ğ', 'g'],
  ['Ğ', 'G'],
  ['ı', 'i'],
  ['İ', 'I'],
  ['ö', 'o'],
  ['Ö', 'O'],
  ['ş', 's'],
  ['Ş', 'S'],
  ['ü', 'u'],
  ['Ü', 'U']
])

export function isValidVariableName(name: string): boolean {
  return VALID_NAME.test(name)
}

/**
 * Compare two names the way the script layer will resolve them: case-insensitive
 * (SPSS-style — `Yas` and `yas` are the same variable). Display casing is kept
 * by the stored `name`; matching ignores case.
 */
export function namesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Convert an arbitrary string (e.g. a raw CSV/Excel header) into a syntactically
 * valid variable name. Never throws; always returns a non-empty valid name.
 * @param fallbackIndex 1-based position, used to build a name when the input
 *        sanitizes to nothing (e.g. "V3").
 */
export function sanitizeVariableName(raw: string, fallbackIndex = 1): string {
  let s = raw.trim()
  // Transliterate Turkish characters for readability.
  s = s.replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => TR_TRANSLITERATION.get(ch) ?? ch)
  // Any remaining char outside [A-Za-z0-9_] becomes an underscore.
  s = s.replace(/[^a-zA-Z0-9_]/g, '_')
  // Collapse runs of underscores and drop trailing ones (cosmetic).
  s = s.replace(/_{2,}/g, '_').replace(/_+$/g, '')
  if (s === '') return `V${String(fallbackIndex)}`
  // Names must start with a letter or underscore, never a digit.
  if (/^[0-9]/.test(s)) s = `V${s}`
  return s
}

/**
 * Return `candidate` if it does not collide (case-insensitively) with any
 * existing name, otherwise append `_1`, `_2`, … until it is unique.
 */
export function makeUniqueVariableName(candidate: string, existing: Iterable<string>): string {
  const taken = new Set<string>()
  for (const n of existing) taken.add(n.toLowerCase())
  if (!taken.has(candidate.toLowerCase())) return candidate
  let i = 1
  while (taken.has(`${candidate}_${String(i)}`.toLowerCase())) i++
  return `${candidate}_${String(i)}`
}
