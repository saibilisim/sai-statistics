// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LoginWindow } from './windows/LoginWindow'
import './i18n'
import './theme/global.css'
import { useDatasetStore } from './store/dataset-store'
import { useUIStore } from './store/ui-store'
import { useSpecialMenuStore } from './store/special-menu-store'
import { useOutputStore } from './store/output-store'
import { useNormalityStore } from './store/normality-store'
import { useTerminalStore } from './store/terminal-store'
import { useGridBridgeStore } from './store/grid-bridge-store'
import { useSettingsStore } from './store/settings-store'
import { useChatStore } from './store/chat-store'
import { restoreTerminalDrafts, startTerminalDraftAutosave } from './lib/terminal-drafts'

// E2E (Playwright) testlerinin store'lara erişebilmesi için debug kancası.
// Renderer'ın kendi context'i dışında bir yetki vermez.
;(window as unknown as Record<string, unknown>).__SAI_TEST__ = {
  useDatasetStore,
  useUIStore,
  useSpecialMenuStore,
  useOutputStore,
  useNormalityStore,
  useTerminalStore,
  // AG Grid geçişi (aggrid-gecis-roadmap.md G8): canlı gridApi buradan
  // okunur (getColumn/applyTransaction/ensureIndexVisible vb.).
  useGridBridgeStore,
  // Dil/tema gibi ayarları sürükleyen e2e'ler için (ör. çıktı ondalık
  // ayracının dile göre değişmesi).
  useSettingsStore,
  // AI paneli: sağlayıcıya gitmeden mesaj enjekte edip markdown/tablo/kod
  // sunumunu doğrulamak için (e2e-ai-markdown).
  useChatStore
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

// Ayrı giriş penceresi (main.ts openLoginWindow) aynı index.html'i
// ?window=login query'siyle yükler — App yerine küçük, bağımsız
// LoginWindow'u render eder (2026-08-02).
const isLoginWindow = new URLSearchParams(window.location.search).get('window') === 'login'

// Unsaved R scripts / SPSS syntax carry over to the next start. E2E runs share
// one userData dir, so they start clean instead of inheriting the last test's.
if (!isLoginWindow && !window.api.isE2E) {
  restoreTerminalDrafts()
  startTerminalDraftAutosave()
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Suspense fallback={null}>{isLoginWindow ? <LoginWindow /> : <App />}</Suspense>
  </React.StrictMode>
)
