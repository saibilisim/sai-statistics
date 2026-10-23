// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore, type ActiveTab } from '../../store/ui-store'
import { cx } from '../../lib/cx'
import styles from './TabBar.module.css'
import {
  DataViewIcon,
  VariableViewIcon,
  OutputViewIcon,
  NormalityViewIcon,
  TerminalViewIcon,
  AiTabIcon
} from './TabIcons'

const TABS: {
  id: ActiveTab
  key: string
  shortcut: string
  Icon: React.ComponentType<{ size?: number; className?: string }>
}[] = [
  { id: 'data', key: 'tabs.dataView', shortcut: 'Ctrl+1', Icon: DataViewIcon },
  { id: 'variable', key: 'tabs.variableView', shortcut: 'Ctrl+2', Icon: VariableViewIcon },
  { id: 'output', key: 'tabs.outputView', shortcut: 'Ctrl+3', Icon: OutputViewIcon },
  { id: 'normality', key: 'tabs.normalityView', shortcut: 'Ctrl+4', Icon: NormalityViewIcon },
  { id: 'terminal', key: 'tabs.terminalView', shortcut: 'Ctrl+5', Icon: TerminalViewIcon }
]

export function TabBar() {
  const { t } = useTranslation(['common', 'menu', 'analysis', 'dialogs'])
  const activeTab = useUIStore(s => s.activeTab)
  const setActiveTab = useUIStore(s => s.setActiveTab)
  const aiPanelOpen = useUIStore(s => s.aiPanelOpen)
  const toggleAiPanel = useUIStore(s => s.toggleAiPanel)

  return (
    <div className={styles.tabbar} role="tablist">
      {TABS.map(tab => {
        const IconComponent = tab.Icon
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cx(styles.tab, activeTab === tab.id && styles.active)}
            onClick={() => {
              setActiveTab(tab.id)
            }}
            title={`${String(t(tab.key as never))} (${tab.shortcut})`}
          >
            <span className={styles.tabIcon}>
              <IconComponent size={14} />
            </span>
            <span className={styles.tabLabel}>{t(tab.key as never)}</span>
          </button>
        )
      })}
      {/* AI (spec §5.1): tam-görünüm sekme DEĞİL — sağ dock paneli toggler;
          "aktif" görünümünü aiPanelOpen'dan alır, mevcut sekme değişmez. */}
      <button
        role="tab"
        aria-selected={aiPanelOpen}
        className={cx(styles.tab, aiPanelOpen && styles.active)}
        onClick={toggleAiPanel}
        title={`${t('ai.tab')} (Ctrl+6)`}
      >
        <span className={styles.tabIcon}>
          <AiTabIcon size={14} />
        </span>
        <span className={styles.tabLabel}>{t('ai.tab')}</span>
      </button>
    </div>
  )
}
