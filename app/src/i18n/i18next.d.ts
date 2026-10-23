// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * i18next.d.ts — Compile-time type safety for all translation keys.
 *
 * With this file in place, TypeScript will:
 *  - Error on unknown keys:      t('common.typo')         → TS error
 *  - Autocomplete valid keys:    t('common.ok')           → OK
 *  - Enforce namespace usage:    t('frequencies.title', { ns: 'analysis' }) → OK
 *  - Check interpolation vars:   t('status.cases', { count: 5 }) → OK
 *
 * Source of truth: Turkish locale files (tr/). English files must mirror the
 * same key structure — any missing key falls back to Turkish via fallbackLng.
 */

import type commonTr from './locales/tr/common.json'
import type analysisTr from './locales/tr/analysis.json'
import type menuTr from './locales/tr/menu.json'
import type dialogsTr from './locales/tr/dialogs.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof commonTr
      analysis: typeof analysisTr
      menu: typeof menuTr
      dialogs: typeof dialogsTr
    }
  }
}
