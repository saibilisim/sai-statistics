// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'

/**
 * status-notice-store.ts — short-lived confirmation messages shown in the app
 * StatusBar ("Kayıt başarılı" after a save, …), plus the timer that hides
 * them — a small store of its own rather than more fields on ui-store.
 */

export type StatusNoticeTone = 'success' | 'error'

interface StatusNoticeState {
  /** i18n key of the visible notice, or null when nothing is shown. */
  messageKey: string | null
  tone: StatusNoticeTone
  /** Shows a notice for `durationMs`, replacing any notice already visible. */
  show: (messageKey: string, tone?: StatusNoticeTone, durationMs?: number) => void
}

let hideTimer: ReturnType<typeof setTimeout> | null = null

export const useStatusNoticeStore = create<StatusNoticeState>()(set => ({
  messageKey: null,
  tone: 'success',

  show: (messageKey, tone = 'success', durationMs = 3000) => {
    if (hideTimer) clearTimeout(hideTimer)
    set({ messageKey, tone })
    hideTimer = setTimeout(() => {
      hideTimer = null
      set({ messageKey: null })
    }, durationMs)
  }
}))
