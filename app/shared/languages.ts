// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Single source of truth for supported UI languages (CLAUDE.md §6 / K4.1).
 * Lives in shared/ (not src/i18n/) so it can be imported by shared/
 * settings-types.ts (the AppLanguage zod enum) without reversing the
 * dependency direction described in CLAUDE.md §3 — shared/ is the layer both
 * electron/ and src/ are allowed to depend on, never the other way around.
 *
 * Adding a language: drop the 4 locale JSON files under src/i18n/locales/<lang>/,
 * add one entry to LANGUAGE_LABELS below, and add the matching static import +
 * map entry in electron/menu/menu-builder.ts and electron/i18n.ts (those two
 * stay static imports on purpose — the native menu needs the strings
 * synchronously at startup, before react-i18next's dynamic backend is
 * available).
 */
export const SUPPORTED_LANGUAGES = ['tr', 'en', 'es', 'fr', 'pt', 'it'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  tr: 'Türkçe',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  it: 'Italiano'
}
