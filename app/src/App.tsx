// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useTranslation } from 'react-i18next'
import { ThemeProvider } from './theme/ThemeProvider'
import { Ribbon } from './components/Ribbon/Ribbon'
import { TabBar } from './components/TabBar/TabBar'
import { StatusBar } from './components/StatusBar/StatusBar'
import { DataView } from './views/DataView/DataView'
import { VariableView } from './views/VariableView/VariableView'
import { OutputView } from './views/OutputView/OutputView'
import { NormalityView } from './views/NormalityView/NormalityView'
import { TerminalView } from './views/TerminalView/TerminalView'
import { AIPanel } from './components/AIPanel/AIPanel'
import { AiConsentDialog } from './components/AIPanel/AiConsentDialog'
import { AppDialogs } from './components/AppDialogs'
import { useSettingsStore } from './store/settings-store'
import { useUIStore } from './store/ui-store'
import { useDialogState } from './lib/use-dialog-state'
import { useMenuCommands } from './lib/use-menu-commands'
import { useAppEffects } from './lib/use-app-effects'

export default function App() {
  const { i18n } = useTranslation()
  const settings = useSettingsStore(s => s.settings)
  const activeTab = useUIStore(s => s.activeTab)
  const dialogState = useDialogState()
  const dispatchMenuCommand = useMenuCommands(dialogState.actions)
  useAppEffects({
    language: settings.appearance.language,
    i18n,
    setSetupResult: dialogState.actions.setSetupResult,
    setPreferencesCategory: dialogState.actions.setPreferencesCategory,
    setShowPreferencesDialog: dialogState.actions.setShowPreferencesDialog,
    dispatchMenuCommand
  })

  return (
    <ThemeProvider theme={settings.appearance.theme}>
      <div className="app-layout">
        <div className="app-toolbar">
          <Ribbon />
        </div>

        <div className="app-main-row">
          <div className="app-content">
            {/* DataView stays mounted across tab switches — only hidden — so the
                spreadsheet isn't re-initialized and scroll/selection/edit state
                survives switching to Variable/Output and back. */}
            <div
              className={`view-pane view-pane--data ${
                activeTab === 'data' ? '' : 'view-pane--hidden'
              }`}
            >
              <DataView />
            </div>
            {activeTab === 'variable' && <VariableView />}
            {activeTab === 'output' && <OutputView />}
            {activeTab === 'normality' && <NormalityView />}
            {/* Terminal stays mounted (absolute, hidden) like DataView so the
                syntax editor + console survive switching to Output to view results
                and back — key for the repeat-commands workflow. */}
            <div
              className={`view-pane view-pane--data ${
                activeTab === 'terminal' ? '' : 'view-pane--hidden'
              }`}
            >
              <TerminalView />
            </div>
          </div>
          {/* AI sohbet paneli (spec §5.1): sağ kolon; tüm sekmelerde açık kalır. */}
          <AIPanel />
        </div>

        <div className="app-tabbar">
          <TabBar />
        </div>

        <div className="app-statusbar">
          <StatusBar />
        </div>
      </div>

      <AppDialogs state={dialogState} />
      {/* AI ilk-aktivasyon onayı (spec §4/§6): chat-store sürer; panel kapalıyken
          Output AI aksiyonlarından gelen ensureConsent çağrılarında da açılır.
          AppDialogs'tan SONRA: Tercihler ▸ AI'dan açıldığında onun üstünde kalır. */}
      <AiConsentDialog />
    </ThemeProvider>
  )
}
