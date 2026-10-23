// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
export { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@shared/languages'
export type { SupportedLanguage } from '@shared/languages'

void i18n
  .use(resourcesToBackend((lang: string, ns: string) => import(`./locales/${lang}/${ns}.json`)))
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'menu', 'analysis', 'dialogs'],
    interpolation: { escapeValue: false },
    react: { useSuspense: true }
  })

export default i18n
