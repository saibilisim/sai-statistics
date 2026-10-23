// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import { SettingsSchema } from '@shared/settings-types'

describe('SettingsSchema', () => {
  it('should parse empty object into correct defaults', () => {
    const result = SettingsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.appearance.theme).toBe('system')
      expect(result.data.appearance.fontSize).toBe(13)
      expect(result.data.appearance.language).toBe('en')
      expect(result.data.output.decimalSeparator).toBe('dot')
      expect(result.data.output.dropLeadingZero).toBe(true)
      expect(result.data.r.timeout).toBe(120)
      expect(result.data.dataImport.categoricalMaxDistinct).toBe(24)
      expect(result.data.recentFiles).toEqual([])
    }
  })

  it('should fail parsing invalid values', () => {
    const result = SettingsSchema.safeParse({
      appearance: {
        theme: 'invalid-theme'
      }
    })
    expect(result.success).toBe(false)
  })
})
