// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * i18n.ts — Main-process translation access. Native dialogs/menus read the
 * user's language from the persisted settings store and return the matching
 * locale bundle (same source files the renderer's react-i18next uses).
 *
 * The Store instance is created once at module load time and reused for all
 * subsequent calls, avoiding repeated disk reads on every native dialog open.
 */
import { app } from 'electron'
import Store from 'electron-store'
import { parseSettingsTolerant, type AppSettings } from '../shared/settings-types'
import trDialogs from '../src/i18n/locales/tr/dialogs.json'
import enDialogs from '../src/i18n/locales/en/dialogs.json'
import esDialogs from '../src/i18n/locales/es/dialogs.json'
import frDialogs from '../src/i18n/locales/fr/dialogs.json'
import ptDialogs from '../src/i18n/locales/pt/dialogs.json'
import itDialogs from '../src/i18n/locales/it/dialogs.json'

// Cached at module level — one disk read per process lifetime.
// electron-store normally obtains this directory internally from Electron.
// Supplying it explicitly keeps startup reliable with Electron 43, where its
// main-process detection can run before the IPC bridge is exposed.
const settingsStore = new Store<AppSettings>({ name: 'settings', cwd: app.getPath('userData') })

// Same static-import constraint as menu-builder.ts's MENU_TRANSLATIONS — see
// shared/languages.ts doc comment.
const DIALOG_TRANSLATIONS: Record<AppSettings['appearance']['language'], typeof trDialogs> = {
  tr: trDialogs,
  en: enDialogs,
  es: esDialogs,
  fr: frDialogs,
  pt: ptDialogs,
  it: itDialogs
}

/** Returns the dialogs locale bundle for the user's selected language. */
export function dialogStrings(): typeof trDialogs {
  return DIALOG_TRANSLATIONS[parseSettingsTolerant(settingsStore.store).appearance.language]
}
