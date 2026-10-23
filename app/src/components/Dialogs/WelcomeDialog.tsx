// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WelcomeDialog — start-up chooser (SPSS "Welcome" / VS Code "Start" page).
 *
 * Shown once per launch when the app is started plainly (shortcut / Start
 * menu): New / Open / Import on the left, Recent files and the bundled sample
 * datasets on the right. Not shown when this launch already opens a file
 * (double-clicked .sdf, crash-recovery copy — Main reports that via
 * app:get-startup-info), when the user turned it off ("don't show again" or
 * Preferences ▸ General), or once any file-backed dataset has been opened.
 * Closing it just leaves the default blank dataset — nothing is blocked.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StartupInfo } from '@shared/ipc-contracts'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import { dispatchMenu } from '../../lib/menu-dispatch'
import { importDataset } from '../../lib/file-actions'
import { useSettingsStore } from '../../store/settings-store'
import { useDatasetStore } from '../../store/dataset-store'
import styles from './WelcomeDialog.module.css'

type ListTab = 'recent' | 'samples'

interface ListEntry {
  id: string
  title: string
  detail: string
  disabled: boolean
  open: () => void
}

function splitPath(filePath: string): { name: string; dir: string } {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return idx === -1
    ? { name: filePath, dir: '' }
    : { name: filePath.slice(idx + 1), dir: filePath.slice(0, idx) }
}

function reportError(err: unknown): void {
  console.error('Welcome dialog action failed:', err)
}

interface WelcomeDialogProps {
  info: StartupInfo
  onClose: () => void
}

export function WelcomeDialog({ info, onClose }: WelcomeDialogProps) {
  const { t } = useTranslation(['dialogs', 'common'])
  const setSetting = useSettingsStore(s => s.setSetting)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Selectable (existing) entry ids per tab, in list order — the first one is
  // preselected like SPSS's Recent Files list, so Enter reopens the last file.
  const selectableIds = (which: ListTab): string[] =>
    which === 'recent'
      ? info.recentFiles.filter(f => f.exists).map(f => `recent:${f.path}`)
      : info.sampleFiles.map(f => `sample:${f.path}`)
  const initialTab: ListTab = selectableIds('recent').length > 0 ? 'recent' : 'samples'
  const [tab, setTab] = useState<ListTab>(initialTab)
  const [selectedId, setSelectedId] = useState<string | null>(selectableIds(initialTab)[0] ?? null)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const close = (): void => {
    if (dontShowAgain) setSetting('startup', { showWelcome: false })
    onClose()
  }

  // Every action closes the dialog first, then runs — the target flows (open
  // dialog, import wizard, unsaved guard) are ordinary app flows, not nested
  // inside this modal.
  const run = (action: () => void) => (): void => {
    close()
    action()
  }

  const recentEntries: ListEntry[] = info.recentFiles.map(f => {
    const { name, dir } = splitPath(f.path)
    return {
      id: `recent:${f.path}`,
      title: name,
      detail: dir,
      disabled: !f.exists,
      open: run(() => {
        dispatchMenu('menu:file:open', f.path)
      })
    }
  })
  const sampleEntries: ListEntry[] = info.sampleFiles.map(f => ({
    id: `sample:${f.path}`,
    title: f.name,
    detail: splitPath(f.path).name,
    disabled: false,
    open: run(() => {
      importDataset({ fileType: 'csv', filePath: f.path }).catch(reportError)
    })
  }))
  const entries = tab === 'recent' ? recentEntries : sampleEntries
  const selected = entries.find(e => e.id === selectedId && !e.disabled)

  // Start with keyboard focus on the file list (not the × button, which
  // useDialogKeyboard would pick as the first focusable). Declared before the
  // hook so its effect runs first and the hook sees focus already inside.
  useEffect(() => {
    listRef.current?.focus()
  }, [])

  useDialogKeyboard({
    containerRef: dialogRef,
    onCancel: close,
    onSubmit: () => selected?.open(),
    submitDisabled: !selected
  })

  const moveSelection = (delta: number): void => {
    const enabled = entries.filter(e => !e.disabled)
    if (enabled.length === 0) return
    const idx = enabled.findIndex(e => e.id === selectedId)
    const next = enabled[Math.min(Math.max(idx + delta, 0), enabled.length - 1)] ?? enabled[0]
    if (next) setSelectedId(next.id)
  }

  const startActions: { key: string; label: string; onClick: () => void }[] = [
    {
      key: 'new',
      label: t('dialogs:welcome.newDataset'),
      onClick: run(() => {
        dispatchMenu('menu:file:new')
      })
    },
    {
      key: 'open',
      label: t('dialogs:welcome.openData'),
      onClick: run(() => {
        dispatchMenu('menu:file:open')
      })
    }
  ]
  const importActions: { key: string; label: string; channel: string }[] = [
    { key: 'csv', label: t('dialogs:welcome.importCsv'), channel: 'menu:file:import:csv' },
    { key: 'excel', label: t('dialogs:welcome.importExcel'), channel: 'menu:file:import:excel' },
    { key: 'spss', label: t('dialogs:welcome.importSpss'), channel: 'menu:file:import:spss' }
  ]

  const tabs: { id: ListTab; label: string }[] = [
    { id: 'recent', label: t('dialogs:welcome.recentTab') },
    { id: 'samples', label: t('dialogs:welcome.samplesTab') }
  ]
  const emptyText =
    tab === 'recent' ? t('dialogs:welcome.noRecent') : t('dialogs:welcome.noSamples')

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className={styles.dialog} ref={dialogRef}>
        <div className={styles.hero}>
          <div>
            <h1 id="welcome-title" className={styles.title}>
              {t('dialogs:welcome.title')}
            </h1>
            <p className={styles.subtitle}>{t('dialogs:welcome.subtitle')}</p>
          </div>
          <button className={styles.closeBtn} onClick={close} aria-label={t('common:common.close')}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          <nav className={styles.start} aria-labelledby="welcome-start">
            <h2 id="welcome-start" className={styles.sectionTitle}>
              {t('dialogs:welcome.start')}
            </h2>
            {startActions.map(a => (
              <button key={a.key} type="button" className={styles.action} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
            <h3 className={styles.groupTitle}>{t('dialogs:welcome.importGroup')}</h3>
            {importActions.map(a => (
              <button
                key={a.key}
                type="button"
                className={styles.action}
                onClick={run(() => {
                  dispatchMenu(a.channel)
                })}
              >
                {a.label}
              </button>
            ))}
          </nav>

          <section className={styles.files}>
            <div className={styles.tabs} role="tablist">
              {tabs.map(x => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  id={`welcome-tab-${x.id}`}
                  aria-selected={tab === x.id}
                  aria-controls="welcome-list"
                  className={`${styles.tab ?? ''} ${tab === x.id ? (styles.tabActive ?? '') : ''}`}
                  onClick={() => {
                    setTab(x.id)
                    setSelectedId(selectableIds(x.id)[0] ?? null)
                  }}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <div
              id="welcome-list"
              ref={listRef}
              className={styles.list}
              role="listbox"
              tabIndex={0}
              aria-labelledby={`welcome-tab-${tab}`}
              aria-activedescendant={selected ? `welcome-opt-${selected.id}` : undefined}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  moveSelection(e.key === 'ArrowDown' ? 1 : -1)
                }
              }}
            >
              {entries.length === 0 ? (
                <p className={styles.empty}>{emptyText}</p>
              ) : (
                entries.map(e => (
                  <div
                    key={e.id}
                    id={`welcome-opt-${e.id}`}
                    role="option"
                    aria-selected={e.id === selectedId}
                    aria-disabled={e.disabled}
                    title={e.disabled ? t('dialogs:welcome.missing') : e.detail}
                    className={[
                      styles.item,
                      e.id === selectedId ? styles.itemSelected : '',
                      e.disabled ? styles.itemDisabled : ''
                    ].join(' ')}
                    onClick={() => {
                      if (!e.disabled) setSelectedId(e.id)
                    }}
                    onDoubleClick={() => {
                      if (!e.disabled) e.open()
                    }}
                  >
                    <span className={styles.itemTitle}>{e.title}</span>
                    <span className={styles.itemDetail}>
                      {e.disabled ? t('dialogs:welcome.missing') : e.detail}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className={styles.footer}>
          <label className={styles.dontShow}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={e => {
                setDontShowAgain(e.target.checked)
              }}
            />
            {t('dialogs:welcome.dontShowAgain')}
          </label>
          <div className={styles.footerRight}>
            <button
              type="button"
              className={`${styles.btn ?? ''} ${styles.primary ?? ''}`}
              disabled={!selected}
              onClick={() => selected?.open()}
            >
              {t('dialogs:welcome.open')}
            </button>
            <button type="button" className={styles.btn} onClick={close}>
              {t('dialogs:welcome.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Decides whether the welcome dialog shows this launch and hosts it.
 * `blocked` — another start-up modal (R setup guidance) is up; the welcome
 * waits behind it instead of stacking on top.
 */
export function WelcomeGate({ blocked }: { blocked: boolean }) {
  const isLoaded = useSettingsStore(s => s.isLoaded)
  const [info, setInfo] = useState<StartupInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (!isLoaded || checkedRef.current) return
    checkedRef.current = true
    const { settings } = useSettingsStore.getState()
    if (!settings.startup.showWelcome) return
    window.api.app
      .getStartupInfo(settings.recentFiles)
      .then(result => {
        if (!result.skipWelcome) setInfo(result)
      })
      .catch(reportError)
  }, [isLoaded])

  // A file got opened some other way meanwhile (macOS open-file arriving
  // late, drag-and-drop, File menu) — the chooser is moot for good, even if
  // a later File ▸ New clears filePath again.
  useEffect(
    () =>
      useDatasetStore.subscribe(s => {
        if (s.filePath) setDismissed(true)
      }),
    []
  )

  if (!info || dismissed || blocked) return null
  return (
    <WelcomeDialog
      info={info}
      onClose={() => {
        setDismissed(true)
      }}
    />
  )
}
