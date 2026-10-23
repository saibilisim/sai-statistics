// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { applyTheme, type ThemeName } from './themes'
import { useSettingsStore } from '../store/settings-store'
import type { AppTheme } from '@shared/settings-types'

interface ThemeProviderProps {
  theme: AppTheme
  children: React.ReactNode
}

function resolveTheme(theme: AppTheme): ThemeName {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  useEffect(() => {
    const resolved = resolveTheme(theme)
    applyTheme(resolved)

    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      applyTheme(resolveTheme('system'))
    }
    mq.addEventListener('change', handler)
    return () => {
      mq.removeEventListener('change', handler)
    }
  }, [theme])

  return <>{children}</>
}

/**
 * The app's actually-applied theme (`light` | `dark` | `high-contrast`),
 * following `appearance.theme` including "system" resolution and live OS
 * scheme changes. Third-party widgets (AG Grid) that pick their own CSS
 * class per theme should read this instead of polling `matchMedia`
 * themselves — a raw `matchMedia` check only sees light/dark and silently
 * ignores the user's "system" vs. explicit choice and the high-contrast mode.
 */
export function useResolvedTheme(): ThemeName {
  const appTheme = useSettingsStore(s => s.settings.appearance.theme)
  // Forces a re-render on OS scheme change; resolveTheme() re-reads matchMedia
  // fresh each render, so no separate "resolved" state needs to shadow it.
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    if (appTheme !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      forceUpdate(n => n + 1)
    }
    mq.addEventListener('change', handler)
    return () => {
      mq.removeEventListener('change', handler)
    }
  }, [appTheme])

  return resolveTheme(appTheme)
}
