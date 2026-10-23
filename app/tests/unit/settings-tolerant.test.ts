// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { parseSettingsTolerant, SettingsSchema } from '../../shared/settings-types'

describe('parseSettingsTolerant', () => {
  it('maps legacy decimal marks', () => {
    const r = SettingsSchema.parse({
      editor: { decimalSeparator: ',' },
      output: { decimalSeparator: '.' }
    })
    expect(r.editor.decimalSeparator).toBe('comma')
    expect(r.output.decimalSeparator).toBe('dot')
  })
  it('keeps valid fields when another field is invalid', () => {
    const r = parseSettingsTolerant({
      appearance: { language: 'es', theme: 'dark' },
      editor: { decimalSeparator: 'garbage' }
    })
    expect(r.appearance.language).toBe('es')
    expect(r.appearance.theme).toBe('dark')
    expect(r.editor.decimalSeparator).toBe('comma')
  })
  it('defaults to English and survives non-object input', () => {
    expect(parseSettingsTolerant(null).appearance.language).toBe('en')
    expect(parseSettingsTolerant({ appearance: 5 }).appearance.language).toBe('en')
  })
})
