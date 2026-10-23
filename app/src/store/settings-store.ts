// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { SettingsSchema, type AppSettings } from '@shared/settings-types'

interface SettingsState {
  settings: AppSettings
  isLoaded: boolean
}

interface SettingsActions {
  loadSettings: (raw: unknown) => void
  setTheme: (theme: AppSettings['appearance']['theme']) => void
  setLanguage: (lang: AppSettings['appearance']['language']) => void
  setFontSize: (size: number) => void
  setSetting: <K extends Exclude<keyof AppSettings, 'recentFiles'>>(
    section: K,
    values: Partial<AppSettings[K]>
  ) => void
  addRecentFile: (path: string) => void
  clearRecentFiles: () => void
  resetAllShortcuts: () => void
  toggleRibbonHidden: (id: string) => void
  addRibbonItem: (id: string) => void
  setRibbonOrder: (order: string[]) => void
  toggleRibbonTwoRows: () => void
  isRibbonHidden: (id: string) => boolean
}

const defaults = SettingsSchema.parse({})

export const useSettingsStore = create<SettingsState & SettingsActions>()((set, get) => ({
  settings: defaults,
  isLoaded: false,

  loadSettings: raw => {
    const parsed = SettingsSchema.safeParse(raw)
    set({ settings: parsed.success ? parsed.data : defaults, isLoaded: true })
  },

  setTheme: theme => {
    set(s => {
      const nextSettings = { ...s.settings, appearance: { ...s.settings.appearance, theme } }
      void window.api.settings.set({ path: 'appearance.theme', value: theme })
      return { settings: nextSettings }
    })
  },

  setLanguage: language => {
    set(s => {
      const nextSettings = { ...s.settings, appearance: { ...s.settings.appearance, language } }
      void window.api.settings.set({ path: 'appearance.language', value: language })
      return { settings: nextSettings }
    })
  },

  setFontSize: fontSize => {
    set(s => {
      const nextSettings = { ...s.settings, appearance: { ...s.settings.appearance, fontSize } }
      void window.api.settings.set({ path: 'appearance.fontSize', value: fontSize })
      return { settings: nextSettings }
    })
  },

  setSetting: (section, values) => {
    set(s => {
      const currentSection = s.settings[section]
      const nextSection = { ...currentSection, ...values }
      const nextSettings = { ...s.settings, [section]: nextSection }
      for (const [key, val] of Object.entries(values)) {
        void window.api.settings.set({ path: `${section}.${key}`, value: val })
      }
      return { settings: nextSettings }
    })
  },

  addRecentFile: path => {
    set(s => {
      const filtered = s.settings.recentFiles.filter(f => f !== path)
      const nextRecent = [path, ...filtered].slice(0, 20)
      void window.api.settings.set({ path: 'recentFiles', value: nextRecent })
      return {
        settings: {
          ...s.settings,
          recentFiles: nextRecent
        }
      }
    })
  },

  clearRecentFiles: () => {
    set(s => {
      void window.api.settings.set({ path: 'recentFiles', value: [] })
      return { settings: { ...s.settings, recentFiles: [] } }
    })
  },

  // Full-section replace, not a merge — setSetting('shortcuts', {...}) can
  // only ever add/overwrite keys, never clear the whole override map back to
  // "everything is default".
  resetAllShortcuts: () => {
    set(s => {
      void window.api.settings.set({ path: 'shortcuts', value: {} })
      return { settings: { ...s.settings, shortcuts: {} } }
    })
  },

  toggleRibbonHidden: id => {
    set(s => {
      const cur = s.settings.ribbon.hidden
      const nextHidden = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      void window.api.settings.set({ path: 'ribbon.hidden', value: nextHidden })
      return { settings: { ...s.settings, ribbon: { ...s.settings.ribbon, hidden: nextHidden } } }
    })
  },

  addRibbonItem: id => {
    set(s => {
      const nextHidden = s.settings.ribbon.hidden.filter(x => x !== id)
      void window.api.settings.set({ path: 'ribbon.hidden', value: nextHidden })
      return { settings: { ...s.settings, ribbon: { ...s.settings.ribbon, hidden: nextHidden } } }
    })
  },

  setRibbonOrder: order => {
    set(s => {
      void window.api.settings.set({ path: 'ribbon.order', value: order })
      return { settings: { ...s.settings, ribbon: { ...s.settings.ribbon, order } } }
    })
  },

  toggleRibbonTwoRows: () => {
    set(s => {
      const next = !s.settings.ribbon.twoRows
      void window.api.settings.set({ path: 'ribbon.twoRows', value: next })
      return { settings: { ...s.settings, ribbon: { ...s.settings.ribbon, twoRows: next } } }
    })
  },

  // `get()`, not `useSettingsStore.getState()`: referring to the store from
  // inside its own creator makes its type circular, and TypeScript falls back
  // to `any` — which then leaked into every consumer (Ribbon, PreferencesDialog)
  // as ~140 no-unsafe-* lint errors (denetim raporu §4.4).
  isRibbonHidden: id => {
    return get().settings.ribbon.hidden.includes(id)
  }
}))
