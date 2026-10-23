// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * useAppEffects — the App root's lifecycle subscriptions (settings load,
 * default-dataset bootstrap, language sync, R status, job results, quit
 * guards, menu/keyboard/chat listeners). Moved verbatim out of App.tsx in
 * their original order (effect execution order is declaration order); the
 * only edits are mechanical: values that used to be component-scope locals
 * now arrive as parameters.
 */

import { useEffect, useRef } from 'react'
import type { i18n as I18nInstance } from 'i18next'
import type { AppSettings } from '@shared/settings-types'
import type { RStatus } from '@shared/ipc-contracts'
import type { PreferencesCategory } from '../components/Dialogs/PreferencesDialog'
import { initChatListeners } from '../store/chat-store'
import { useSettingsStore } from '../store/settings-store'
import { useUIStore } from '../store/ui-store'
import { setOutputNumberFormat } from './output-format'
import { setDataViewDecimalSeparator } from './aggrid-data'
import { useDatasetStore } from '../store/dataset-store'
import { useOutputStore } from '../store/output-store'
import { useNormalityStore } from '../store/normality-store'
import { saveCurrentDataset, hasUnsavedChanges } from './file-actions'
import { setMenuDispatch } from './menu-dispatch'
import { applyCaseVars } from './apply-case-vars'
import type { MenuCommandDispatcher } from './use-menu-commands'
import type { DialogActions } from './use-dialog-state'

interface AppEffectsOptions {
  language: AppSettings['appearance']['language']
  i18n: I18nInstance
  setSetupResult: DialogActions['setSetupResult']
  setPreferencesCategory: DialogActions['setPreferencesCategory']
  setShowPreferencesDialog: DialogActions['setShowPreferencesDialog']
  dispatchMenuCommand: MenuCommandDispatcher
}

export function useAppEffects({
  language,
  i18n,
  setSetupResult,
  setPreferencesCategory,
  setShowPreferencesDialog,
  dispatchMenuCommand
}: AppEffectsOptions): void {
  const loadSettings = useSettingsStore(s => s.loadSettings)
  const outputDecimalSeparator = useSettingsStore(s => s.settings.output.decimalSeparator)
  const dropLeadingZero = useSettingsStore(s => s.settings.output.dropLeadingZero)
  const dataViewDecimalSeparator = useSettingsStore(s => s.settings.editor.decimalSeparator)
  const setRStatus = useUIStore(s => s.setRStatus)
  const hasInitializedRef = useRef(false)
  const datasetName = useDatasetStore(s => s.datasetName)
  const datasetFilePath = useDatasetStore(s => s.filePath)
  const isDatasetModified = useDatasetStore(s => s.isModified)
  const isOutputDirty = useOutputStore(s => s.dirty)

  // Window title: "SAI Statistics — <open file>" (+ "*" while unsaved — data
  // or Output, since the Output tab is saved inside the .sdf).
  // Electron mirrors document.title onto the native BrowserWindow title
  // (main.ts doesn't intercept 'page-title-updated').
  useEffect(() => {
    const fileName = datasetFilePath?.split(/[/\\]/).pop() || datasetName
    document.title = fileName
      ? `SAI Statistics — ${fileName}${isDatasetModified || isOutputDirty ? ' *' : ''}`
      : 'SAI Statistics'
  }, [datasetName, datasetFilePath, isDatasetModified, isOutputDirty])

  // Main owns the dataset's dirty flag (every mutating handler sets it) and
  // pushes each change — grid edits, paste, row/column ops, undo, saves —
  // so the title "*" and the New/Open/Import guard see them all. A push for
  // a dataset that's no longer active is stale and ignored.
  useEffect(() => {
    const unsub = window.api.on.datasetModified(({ datasetId, modified }) => {
      const ds = useDatasetStore.getState()
      if (datasetId !== ds.datasetId) return
      if (ds.isModified !== modified) ds.setModified(modified)
      if (modified) ds.bumpContentVersion()
    })
    return () => {
      unsub()
    }
  }, [])

  // Load settings from Main on startup
  useEffect(() => {
    void window.api.settings.get().then(loadSettings)
  }, [loadSettings])

  // Open a default empty dataset on startup so the Data View shows an
  // SPSS-style blank grid instead of a placeholder.
  // (In dev mode the main process intercepts file:new and auto-imports the
  // test dataset from the Desktop — App.tsx stays clean either way.)
  useEffect(() => {
    if (useDatasetStore.getState().datasetId || hasInitializedRef.current) return
    hasInitializedRef.current = true
    void window.api.file
      .new()
      .then(result => {
        // Guard against a race where another dataset was opened meanwhile.
        if (useDatasetStore.getState().datasetId) return
        useDatasetStore
          .getState()
          .setDataset(
            result.dataset.id,
            result.dataset.name,
            result.dataset.filePath,
            result.variables,
            result.dataset.rowCount,
            result.styles
          )
      })
      .catch((err: unknown) => {
        console.error('Failed to create default dataset:', err)
      })
  }, [])

  useEffect(() => {
    void i18n.changeLanguage(language)
  }, [language, i18n])

  // Push the output number format to the formatters, which run per cell from
  // render/export paths that have no settings in hand. Both are explicit
  // Preferences settings — deliberately independent of `language`, so changing
  // the interface language never reformats existing output.
  useEffect(() => {
    setOutputNumberFormat({ separator: outputDecimalSeparator, dropLeadingZero })
  }, [outputDecimalSeparator, dropLeadingZero])

  // Data View's own decimal separator (distinct from output's above) — read
  // by find-replace matching, cell-selection copy, and the autocomplete list
  // in use-data-view-shortcuts.ts, none of which have Preferences in hand.
  useEffect(() => {
    setDataViewDecimalSeparator(dataViewDecimalSeparator)
  }, [dataViewDecimalSeparator])

  // Listen for R status events. Once detection settles (ready or not-found —
  // never re-fires "starting"), run the P0.4 first-run setup check once so a
  // user with no R background isn't left guessing why analyses silently fail.
  //
  // Detection in Main can finish before this effect mounts and subscribes —
  // the push-only 'r:status' event fired into that gap is lost forever,
  // leaving the UI on "starting" indefinitely. `r.getStatus()` is a pull that
  // always returns the true current value regardless of that race; call it
  // once up front, then subscribe for any status changes that happen later.
  useEffect(() => {
    let checked = false
    const handleStatus = (status: RStatus, version?: string): void => {
      setRStatus(status, version)
      if (!checked && status !== 'starting') {
        checked = true
        window.api.rPackages
          .checkRequiredSetup()
          .then(result => {
            if (!result.rFound || result.missingRequired.length > 0) {
              setSetupResult(result)
            }
          })
          .catch((err: unknown) => {
            console.error('checkRequiredSetup failed:', err)
          })
      }
    }

    void window.api.r
      .getStatus()
      .then(({ status, version }) => {
        handleStatus(status, version)
      })
      .catch((err: unknown) => {
        console.error('r.getStatus failed:', err)
      })

    const unsub = window.api.on.rStatus(({ status, version }) => {
      handleStatus(status, version)
    })
    return () => {
      unsub()
    }
  }, [setRStatus, setSetupResult])

  // Global analysis-result subscription — MUST live here (always mounted), not in
  // OutputView (mounted only when its tab is active), so results land in the
  // Output store no matter which tab launched them (e.g. the Syntax/Terminal tab).
  // OutputView still tracks its own in-progress indicator; it no longer adds blocks.
  useEffect(() => {
    const unsubComplete = window.api.on.jobComplete(payload => {
      // Normality View owns its own result rendering (4th tab). Parked here,
      // not in NormalityView (mounted only while its tab is active), so a run
      // that finishes after the user switched tabs isn't lost and the tab
      // isn't left spinning forever. AI-triggered runs (ai-bridge.ts) may
      // target an AI-chosen subset of variables — never let them silently
      // overwrite what the tab is showing.
      if (payload.analysisId === 'normality') {
        if (payload.source !== 'ai') {
          const dsId = useDatasetStore.getState().datasetId ?? ''
          useNormalityStore.getState().setResult(dsId, payload.result)
        }
        return
      }
      // New variables (roadmap ★11) are written before the block is added so
      // the block can report what happened to the dataset. applyCaseVars()
      // returns the payload untouched for the analyses that produce none, so
      // this costs nothing for the other ~50.
      void applyCaseVars(payload.result, i18n.t.bind(i18n)).then(result => {
        useOutputStore.getState().addBlock({
          id: payload.jobId,
          analysisId: payload.analysisId,
          titleKey: `analysis.${payload.analysisId}.title`,
          timestamp: new Date().toISOString(),
          datasetName: useDatasetStore.getState().datasetName,
          result,
          summary: payload.summary,
          syntax: payload.syntax
        })
      })
    })
    const unsubError = window.api.on.jobError(payload => {
      // Job errors aren't tagged with analysisId; a running normality job is
      // the only one that leaves a spinner to clear.
      if (useNormalityStore.getState().status === 'running') {
        useNormalityStore.getState().setError(payload.errorKey)
      }
      useOutputStore.getState().addBlock({
        id: payload.jobId,
        analysisId: 'error',
        titleKey: 'output.errorBlock',
        timestamp: new Date().toISOString(),
        datasetName: useDatasetStore.getState().datasetName,
        result: {
          success: false,
          tables: [],
          plots: [],
          caseVars: [],
          // Cast required by tsc for the dynamic i18next key; eslint's type-aware
          // pass resolves the overload differently (see OutputPlotView.tsx's pe()).
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          warnings: [payload.details ?? i18n.t(payload.errorKey as never)],
          notes: []
        }
      })
    })
    return () => {
      unsubComplete()
      unsubError()
    }
  }, [i18n])

  // The close guard chose "Save": run the save pipeline, then quit only if it
  // actually persisted (a cancelled Save dialog leaves the dirty flags set →
  // stay). One .sdf save covers both the data and the Output tab.
  useEffect(() => {
    const unsub = window.api.on.saveAndQuit(() => {
      void (async () => {
        await saveCurrentDataset()
        if (!hasUnsavedChanges()) {
          await window.api.app.quitAfterSave()
        }
      })()
    })
    return () => {
      unsub()
    }
  }, [])

  // Listen for native menu commands
  useEffect(() => {
    const unsub = window.api.on.menuCommand(dispatchMenuCommand)
    return () => {
      unsub()
    }
  }, [dispatchMenuCommand])

  // AI sohbet streaming aboneliği (Faz F1) — turnId namespaced, job:* akışından ayrı.
  useEffect(() => {
    const unsub = initChatListeners()
    return () => {
      unsub()
    }
  }, [])

  // AI paneli dişli düğmesi + hata bannerı "Ayarları Aç" butonu (AIPanel /
  // ChatMessageList) buradan Preferences diyaloğunu açtırır — menü dışı tek
  // giriş noktası. Her ikisi de detail.category:'ai' gönderir, doğrudan AI
  // sekmesi açılsın diye (CustomEvent olduğundan detail tipi bilinmiyor,
  // burada daraltılır).
  useEffect(() => {
    const open = (e: Event): void => {
      const category = (e as CustomEvent<{ category?: PreferencesCategory }>).detail.category
      setPreferencesCategory(category)
      setShowPreferencesDialog(true)
    }
    window.addEventListener('sai:open-preferences', open)
    return () => {
      window.removeEventListener('sai:open-preferences', open)
    }
  }, [setPreferencesCategory, setShowPreferencesDialog])

  // Dialog Recall: let the Ribbon reopen a dialog via the same dispatcher
  // (see src/lib/menu-dispatch.ts for why this isn't a prop).
  useEffect(() => {
    setMenuDispatch(dispatchMenuCommand)
  }, [dispatchMenuCommand])

  // Keyboard shortcuts for tab switching
  useEffect(() => {
    const setTab = useUIStore.getState().setActiveTab
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '1') {
          e.preventDefault()
          setTab('data')
        }
        if (e.key === '2') {
          e.preventDefault()
          setTab('variable')
        }
        if (e.key === '3') {
          e.preventDefault()
          setTab('output')
        }
        if (e.key === '4') {
          e.preventDefault()
          setTab('normality')
        }
        if (e.key === '5') {
          e.preventDefault()
          setTab('terminal')
        }
        if (e.key === '6') {
          e.preventDefault()
          useUIStore.getState().toggleAiPanel()
        }
        if (e.key === 'l') {
          e.preventDefault()
          useUIStore.getState().toggleValueLabels()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])
}
