// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { app, ipcMain, BrowserWindow, nativeTheme } from 'electron'
import Store from 'electron-store'
import { IPC } from '@shared/ipc-contracts'
import { SettingsSchema, parseSettingsTolerant, type AppSettings } from '@shared/settings-types'
import { SettingsSetRequestSchema } from '@shared/ipc-schemas'
import log from 'electron-log'
import { rebuildMenu } from '../menu/menu-builder'
import { validateSender, handleValidated } from './security'
import { approvePaths, isApprovedPath } from './approved-paths'

// Store, app ready olduktan sonra (registerSettingsHandlers içinde) oluşturulur;
// modül yükleme anında app.getName() henüz hazır olmadığı için lazy init şart.
let store: Store<AppSettings>

/** Native menü/başlık çubuğu Chromium/GTK temasını izler — uygulama temasına eşle. */
function applyNativeTheme(theme: AppSettings['appearance']['theme']): void {
  nativeTheme.themeSource = theme === 'high-contrast' ? 'dark' : theme
}

function readSettings(): AppSettings {
  const strict = SettingsSchema.safeParse(store.store)
  if (strict.success) return strict.data
  log.warn('Settings partly invalid, dropping invalid fields only', strict.error)
  return parseSettingsTolerant(store.store)
}

/**
 * Read-access for other main-process modules that need a setting outside the
 * IPC boundary (e.g. r-session.ts gating the R console on `r.consoleEnabled`,
 * CLAUDE.md §9 rule 1). Only valid after registerSettingsHandlers() has run.
 */
export function getSettings(): AppSettings {
  return readSettings()
}

export function registerSettingsHandlers(): void {
  store = new Store<AppSettings>({ name: 'settings', cwd: app.getPath('userData') })
  // Recent files present at startup were opened by the user in earlier sessions;
  // later renderer edits to this list do not widen what Main will read.
  approvePaths(readSettings().recentFiles)
  applyNativeTheme(readSettings().appearance.theme)

  ipcMain.handle(IPC.SETTINGS_GET, event => {
    validateSender(event)
    return readSettings()
  })

  handleValidated(IPC.SETTINGS_SET, SettingsSetRequestSchema, req => {
    // Simple dot-path setter (one level deep for now)
    const [section, key] = req.path.split('.')
    if (!section) return
    const sectionKey = section as keyof AppSettings
    // recentFiles is re-approved as trusted paths on the next launch, so the
    // renderer may only reorder/prune it or add paths Main already approved
    // (dialog / drop / menu) — never introduce an arbitrary path.
    if (req.path === 'recentFiles') {
      const known = new Set(readSettings().recentFiles)
      const value = req.value
      if (
        !Array.isArray(value) ||
        !value.every(p => typeof p === 'string' && (known.has(p) || isApprovedPath(p)))
      ) {
        throw new Error('recentFiles may only contain paths Main has already approved')
      }
    }
    const current = (store.get(sectionKey) as Record<string, unknown> | undefined) ?? {}

    // Build potential updated section data
    let updatedSectionValue: unknown
    if (key) {
      updatedSectionValue = { ...current, [key]: req.value }
    } else {
      updatedSectionValue = req.value
    }

    // Merge with current store store state to validate the full settings object
    const newStoreData = {
      ...store.store,
      [sectionKey]: updatedSectionValue
    }

    const result = SettingsSchema.safeParse(newStoreData)
    if (!result.success) {
      log.warn('Settings validation failed, rejecting write request:', result.error)
      throw new Error(`Invalid settings: ${result.error.message}`)
    }

    // zod strips unknown keys, so a typo'd path would "succeed" and write
    // nothing: report it instead of silently dropping the value.
    const writtenSection = (result.data as Record<string, unknown>)[sectionKey]
    const known =
      writtenSection !== undefined &&
      (!key ||
        (typeof writtenSection === 'object' && writtenSection !== null && key in writtenSection))
    if (!known) throw new Error(`Unknown setting: ${req.path}`)

    // Validation succeeded, write the verified data
    store.store = result.data

    if (req.path === 'appearance.theme') applyNativeTheme(result.data.appearance.theme)

    if (
      req.path === 'appearance.language' ||
      req.path === 'appearance.theme' ||
      req.path === 'recentFiles' ||
      req.path === 'shortcuts' ||
      req.path.startsWith('shortcuts.')
    ) {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (win) {
        rebuildMenu(win)
      }
    }
  })

  ipcMain.handle(IPC.SETTINGS_RESET, event => {
    validateSender(event)
    store.clear()
  })
}
