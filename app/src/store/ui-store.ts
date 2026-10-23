// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { RStatus } from '@shared/ipc-contracts'

export type ActiveTab = 'data' | 'variable' | 'output' | 'normality' | 'terminal'

/** Data View column header display mode: variable names vs. native A/B/C letters. */
export type HeaderMode = 'name' | 'letter'

interface UIState {
  activeTab: ActiveTab
  rStatus: RStatus
  /** Detected Rscript version string (About dialog); null until R is found. */
  rVersion: string | null
  isProcessing: boolean
  processingMessageKey: string
  processingPercent: number
  /** i18next interpolation values for processingMessageKey (chunked-load-
   *  roadmap.md C4 — "{{loaded}} / {{total}} rows loaded"). */
  processingParams: Record<string, string | number>
  showValueLabels: boolean
  headerMode: HeaderMode
  showToolbar: boolean
  showStatusBar: boolean
  showGridLines: boolean
  /** Focus Cell (B5): highlight the active cell's whole row + column as a
   *  crosshair (Excel 2025's "Focus Cell"). */
  focusCellHighlight: boolean
  showColumnFilterIcons: boolean
  /** Ribbon özelleştirme modu: ikonların sağ-üstünde kırmızı X (kaldır) görünür. */
  ribbonEditMode: boolean
  /** AI sohbet paneli (Faz F1, spec §5.1): tam-görünüm sekme DEĞİL, tüm
   *  sekmelerin üstünde yaşayan sağ dock — kullanıcı Data View'a bakarken
   *  sohbet edebilsin diye ayrı panel state'i. */
  aiPanelOpen: boolean
  aiPanelWidth: number
}

interface UIActions {
  setActiveTab: (tab: ActiveTab) => void
  setRStatus: (status: RStatus, version?: string) => void
  setProcessing: (
    processing: boolean,
    messageKey?: string,
    percent?: number,
    params?: Record<string, string | number>
  ) => void
  toggleValueLabels: () => void
  toggleHeaderMode: () => void
  toggleToolbar: () => void
  toggleStatusBar: () => void
  toggleGridLines: () => void
  toggleFocusCellHighlight: () => void
  toggleColumnFilterIcons: () => void
  setColumnFilterIcons: (show: boolean) => void
  setRibbonEditMode: (on: boolean) => void
  toggleRibbonEditMode: () => void
  toggleAiPanel: () => void
  setAiPanelWidth: (width: number) => void
}

/** AI panel genişlik sınırları (spec §5.1). */
export const AI_PANEL_MIN_WIDTH = 280
export const AI_PANEL_MAX_WIDTH = 640

const initialState: UIState = {
  activeTab: 'data',
  rStatus: 'starting',
  rVersion: null,
  isProcessing: false,
  processingMessageKey: '',
  processingPercent: 0,
  processingParams: {},
  showValueLabels: false,
  headerMode: 'name',
  showToolbar: true,
  showStatusBar: true,
  showGridLines: true,
  focusCellHighlight: false,
  showColumnFilterIcons: false,
  ribbonEditMode: false,
  aiPanelOpen: false,
  aiPanelWidth: 360
}

// No zundo `temporal` here: nothing undoes UI state, and wrapping it copied
// the whole store into a history entry on every progress tick and dialog toggle.
export const useUIStore = create<UIState & UIActions>()(set => ({
  ...initialState,

  setActiveTab: tab => {
    set({ activeTab: tab })
  },

  setRStatus: (status, version) => {
    set(version !== undefined ? { rStatus: status, rVersion: version } : { rStatus: status })
  },

  setProcessing: (processing, messageKey = '', percent = 0, params = {}) => {
    set({
      isProcessing: processing,
      processingMessageKey: messageKey,
      processingPercent: percent,
      processingParams: params
    })
  },

  toggleValueLabels: () => {
    set(s => ({ showValueLabels: !s.showValueLabels }))
  },
  toggleHeaderMode: () => {
    set(s => ({ headerMode: s.headerMode === 'name' ? 'letter' : 'name' }))
  },
  toggleToolbar: () => {
    set(s => ({ showToolbar: !s.showToolbar }))
  },
  toggleStatusBar: () => {
    set(s => ({ showStatusBar: !s.showStatusBar }))
  },
  toggleGridLines: () => {
    set(s => ({ showGridLines: !s.showGridLines }))
  },
  toggleFocusCellHighlight: () => {
    set(s => ({ focusCellHighlight: !s.focusCellHighlight }))
  },
  toggleColumnFilterIcons: () => {
    set(s => ({ showColumnFilterIcons: !s.showColumnFilterIcons }))
  },

  // Menu → "Select Cases" (SPSS-familiar entry point): always turns filter
  // icons ON, never toggles off — unlike the Ribbon button, a menu click
  // means "I want to filter now", so silently clearing active filters
  // (the Ribbon's turn-off behavior) would be surprising here.
  setColumnFilterIcons: show => {
    set({ showColumnFilterIcons: show })
  },

  setRibbonEditMode: on => {
    set({ ribbonEditMode: on })
  },
  toggleRibbonEditMode: () => {
    set(s => ({ ribbonEditMode: !s.ribbonEditMode }))
  },

  toggleAiPanel: () => {
    set(s => ({ aiPanelOpen: !s.aiPanelOpen }))
  },
  setAiPanelWidth: width => {
    set({ aiPanelWidth: Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, width)) })
  }
}))
