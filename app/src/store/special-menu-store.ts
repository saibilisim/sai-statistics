// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * special-menu-store.ts — Value-label clipboard + transient feedback for the
 * Data View's "Değer etiketlerini kopyala / yapıştır" context-menu items.
 *
 * Those items live inside DataView's own context menu (built in
 * DataView.tsx's buildContextMenuItems), so there's no custom popup — the
 * backing commands run directly. This store carries the copied value-label dictionary
 * between the copy and paste commands, plus a feedback message the DataView
 * surfaces via its cell-warning banner. Kept out of ui-store, which is wrapped
 * in zundo `temporal` — this ephemeral state must never enter undo history.
 */
import { create } from 'zustand'

/** A snapshot of one column's value-label dictionary, copied for later paste. */
export interface ValueLabelClipboard {
  sourceColId: string
  sourceName: string
  valueLabels: Record<string, string>
}

interface SpecialMenuState {
  /** Value labels copied via "Değer etiketlerini kopyala", or null. */
  labelClipboard: ValueLabelClipboard | null
  /** Last status message; `nonce` bumps so repeats still re-trigger the banner. */
  feedback: { message: string; nonce: number } | null
}

interface SpecialMenuActions {
  setLabelClipboard: (clip: ValueLabelClipboard) => void
  pushFeedback: (message: string) => void
}

export const useSpecialMenuStore = create<SpecialMenuState & SpecialMenuActions>(set => ({
  labelClipboard: null,
  feedback: null,

  setLabelClipboard: clip => {
    set({ labelClipboard: clip })
  },
  pushFeedback: message => {
    set(s => ({ feedback: { message, nonce: (s.feedback?.nonce ?? 0) + 1 } }))
  }
}))
