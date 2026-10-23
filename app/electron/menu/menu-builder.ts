// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { Menu, BrowserWindow, app, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { approvePath } from '../ipc/approved-paths'
import { existsSync } from 'fs'
import Store from 'electron-store'
import { SettingsSchema, parseSettingsTolerant, type AppSettings } from '@shared/settings-types'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, type SupportedLanguage } from '@shared/languages'
import { resolveShortcuts } from '@shared/shortcuts'
import { checkForUpdatesManually, UPDATER_ENABLED } from '../ipc/updater-handler'
import trMenu from '../../src/i18n/locales/tr/menu.json'
import enMenu from '../../src/i18n/locales/en/menu.json'
import esMenu from '../../src/i18n/locales/es/menu.json'
import frMenu from '../../src/i18n/locales/fr/menu.json'
import ptMenu from '../../src/i18n/locales/pt/menu.json'
import itMenu from '../../src/i18n/locales/it/menu.json'

// Native menu needs its strings synchronously at startup, before
// react-i18next's dynamic backend is ready — so these stay static imports
// (K4.1: SUPPORTED_LANGUAGES is the single source of truth for which
// languages exist; this map is the one place per-language wiring is still
// needed, see shared/languages.ts doc comment).
const MENU_TRANSLATIONS: Record<SupportedLanguage, typeof trMenu> = {
  tr: trMenu,
  en: enMenu,
  es: esMenu,
  fr: frMenu,
  pt: ptMenu,
  it: itMenu
}

// registerSettingsHandlers() runs *after* the first buildMenu() call in
// main.ts (menu needs to exist before the window shows), so on a genuinely
// fresh install (no settings.json on disk yet) a bare `new Store()` here
// returns `undefined` for every key instead of the zod schema's defaults —
// crashes buildMenu ("Cannot read properties of undefined (reading 'file')"
// from MENU_TRANSLATIONS[undefined]). settings-handler.ts's own store avoids
// this by always reading through SettingsSchema.parse(store.store); mirror
// that here via the `defaults` constructor option so every .get() already
// falls back to the schema default instead of `undefined`.
function openSettingsStore(): Store<AppSettings> {
  return new Store<AppSettings>({
    name: 'settings',
    cwd: app.getPath('userData'),
    defaults: SettingsSchema.parse({})
  })
}

// Native menu translations based on selected language
function getTranslations(): typeof trMenu {
  const store = openSettingsStore()
  return MENU_TRANSLATIONS[parseSettingsTolerant(store.store).appearance.language]
}

// K6.1 (faz8-kalite-roadmap.md): docs are self-contained HTML, opened in the
// user's default browser (shell.openPath) rather than a new BrowserWindow —
// no window-management/CSP work needed, and it's just documentation, not
// app UI. All six SUPPORTED_LANGUAGES have a docs folder since 2026-10-10; a
// language added later without one falls back to en rather than 404ing on a
// folder that doesn't exist.
function getDocsDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'docs')
  // Two possible unpackaged layouts, same split as analysis-handler.ts's
  // getRScriptsDir(): `electron out/main/main.cjs` (built-unpackaged, e.g.
  // the e2e harness) resolves app.getAppPath() to out/main, where
  // copy-docs.cjs mirrors resources/docs/ post-build; real `pnpm dev`
  // resolves it to the app/ project root, where resources/docs/ already is.
  const builtUnpackaged = join(app.getAppPath(), 'docs')
  return existsSync(builtUnpackaged) ? builtUnpackaged : join(app.getAppPath(), 'resources', 'docs')
}

function openDoc(fileName: 'user-guide.html' | 'statistics-guide.html'): void {
  const store = openSettingsStore()
  const lang = parseSettingsTolerant(store.store).appearance.language
  const docsDir = getDocsDir()
  const langDir = existsSync(join(docsDir, lang)) ? lang : 'en'
  void shell.openPath(join(docsDir, langDir, fileName))
}

function getRecentFiles(): string[] {
  const store = openSettingsStore()
  return store.get('recentFiles')
}

// Preferences ▸ Keyboard Shortcuts (shared/shortcuts.ts) — user overrides on
// top of the hardcoded defaults below; ids not in the registry (Cut/Copy/
// Paste, which stay OS `role:`-driven — Undo/Redo do NOT, see the Edit menu
// comment above) keep their fixed accelerator.
function getShortcuts(): Record<string, string> {
  const store = openSettingsStore()
  return resolveShortcuts(store.get('shortcuts'))
}

function baseName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

/**
 * Windows/Linux treat `&` in a menu label as the mnemonic (underlined access
 * key) marker and swallow it — "Find & Replace" rendered as "Find  Replace".
 * No label here uses intentional mnemonics, so every `&` (translations,
 * recent-file names like "R&D.sav") is escaped to the literal `&&`, once, over
 * the finished template. macOS has no mnemonics and would show `&&` verbatim.
 */
function escapeMnemonics(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  if (process.platform === 'darwin') return items
  return items.map(item => ({
    ...item,
    ...(item.label !== undefined ? { label: item.label.replace(/&/g, '&&') } : {}),
    ...(Array.isArray(item.submenu) ? { submenu: escapeMnemonics(item.submenu) } : {})
  }))
}

export function buildMenu(win: BrowserWindow): void {
  const send =
    (channel: string, ...args: unknown[]) =>
    () => {
      win.webContents.send(channel, ...args)
    }

  const t = getTranslations()
  const sc = getShortcuts()

  const template: MenuItemConstructorOptions[] = [
    {
      label: t.file.label,
      submenu: [
        {
          label: t.file.newDataset,
          accelerator: sc.fileNew,
          click: () => {
            win.webContents.send('menu:file:new')
          }
        },
        {
          label: t.file.openDataFile,
          accelerator: sc.fileOpen,
          click: () => {
            win.webContents.send('menu:file:open')
          }
        },
        {
          label: t.file.recentFiles,
          submenu:
            getRecentFiles().length === 0
              ? [{ label: t.file.noRecentFiles, enabled: false }]
              : [
                  ...getRecentFiles().map(
                    (filePath): MenuItemConstructorOptions => ({
                      label: baseName(filePath),
                      click: () => {
                        approvePath(filePath)
                        win.webContents.send('menu:file:open', filePath)
                      }
                    })
                  ),
                  { type: 'separator' },
                  {
                    label: t.file.clearRecent,
                    click: () => {
                      win.webContents.send('menu:file:clear-recent')
                    }
                  }
                ]
        },
        { type: 'separator' },
        {
          label: t.file.save,
          accelerator: sc.fileSave,
          click: () => {
            win.webContents.send('menu:file:save')
          }
        },
        {
          label: t.file.saveAs,
          accelerator: sc.fileSaveAs,
          click: () => {
            win.webContents.send('menu:file:save-as')
          }
        },
        {
          label: t.file.saveOutput,
          click: () => {
            win.webContents.send('menu:file:save-output')
          }
        },
        {
          label: t.file.exportOutput,
          click: () => {
            win.webContents.send('menu:file:export-output')
          }
        },
        { type: 'separator' },
        {
          label: t.file.importData,
          submenu: [
            {
              label: t.file.fromCSV,
              click: () => {
                win.webContents.send('menu:file:import:csv')
              }
            },
            {
              label: t.file.fromExcel,
              click: () => {
                win.webContents.send('menu:file:import:excel')
              }
            },
            {
              label: t.file.fromSPSS,
              click: () => {
                win.webContents.send('menu:file:import:spss')
              }
            },
            {
              label: t.file.fromStata,
              click: () => {
                win.webContents.send('menu:file:import:stata')
              }
            },
            {
              label: t.file.fromSAS,
              click: () => {
                win.webContents.send('menu:file:import:sas')
              }
            }
          ]
        },
        {
          label: t.file.exportData,
          submenu: [
            {
              label: t.file.toCSV,
              click: () => {
                win.webContents.send('menu:file:export:csv')
              }
            },
            {
              label: t.file.toExcel,
              click: () => {
                win.webContents.send('menu:file:export:excel')
              }
            },
            {
              label: t.file.toSPSS,
              click: () => {
                win.webContents.send('menu:file:export:spss')
              }
            }
          ]
        },
        { type: 'separator' },
        {
          label: t.file.print,
          accelerator: sc.filePrint,
          click: () => {
            // Prints whatever view is currently active (Data/Variable/Output)
            // via the OS native print dialog — Electron's own
            // webContents.print(), no serialization/IPC round-trip needed.
            win.webContents.print({ silent: false, printBackground: true })
          }
        },
        { type: 'separator' },
        {
          label: t.file.exit,
          accelerator: sc.fileExit,
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: t.edit.label,
      submenu: [
        // NOT `role: 'undo'/'redo'` — that binds the accelerator to Chromium's
        // native document-undo (webContents.undo()), which only affects a
        // focused <input>/<textarea>/contentEditable, never our own undo
        // chain (dataset-undo.ts's performUndoRedo). And NO `accelerator`
        // here at all (unlike every other Edit item) — registering
        // 'CmdOrCtrl+Z'/'CmdOrCtrl+Y' as a real Electron/GTK accelerator on
        // Linux swallows the keypress before this item's own `click` ever
        // fires (confirmed empirically: a real OS-level Ctrl+Z never once
        // reached this send() call, while every other accelerator in this
        // menu did). Ctrl+Z/Ctrl+Y are instead handled as a plain renderer
        // keydown in use-cell-selection.ts's handleSharedAccelerators — the
        // same architecture every other in-app shortcut here already uses
        // (Ctrl+D/R/;/', Delete, Ctrl+C/X/V never touch the native menu
        // either). `click:` still backs the menu item for an actual mouse
        // click on Edit ▸ Undo/Redo.
        { label: t.edit.undo, click: send('menu:edit:undo') },
        { label: t.edit.redo, click: send('menu:edit:redo') },
        { type: 'separator' },
        { label: t.edit.cut, accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: t.edit.copy, accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: t.edit.paste, accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        {
          label: t.edit.find,
          accelerator: sc.editFind,
          click: send('menu:edit:find')
        },
        {
          label: t.edit.findReplace,
          accelerator: sc.editFindReplace,
          click: send('menu:edit:find-replace')
        },
        { type: 'separator' },
        {
          label: t.edit.preferences,
          accelerator: sc.editPreferences,
          click: send('menu:preferences')
        }
      ]
    },
    {
      label: t.view.label,
      submenu: [
        {
          label: t.view.dataView,
          accelerator: sc.viewDataView,
          click: send('menu:view:tab', 'data')
        },
        {
          label: t.view.variableView,
          accelerator: sc.viewVariableView,
          click: send('menu:view:tab', 'variable')
        },
        {
          label: t.view.outputView,
          accelerator: sc.viewOutputView,
          click: send('menu:view:tab', 'output')
        },
        {
          label: t.view.normalityView,
          accelerator: sc.viewNormalityView,
          click: send('menu:view:tab', 'normality')
        },
        {
          label: t.view.terminalView,
          accelerator: sc.viewTerminalView,
          click: send('menu:view:tab', 'terminal')
        },
        { type: 'separator' },
        {
          label: t.view.valueLabels,
          accelerator: sc.viewValueLabels,
          click: send('menu:view:value-labels')
        },
        {
          label: t.view.gridLines,
          click: send('menu:view:grid-lines')
        },
        {
          label: t.view.focusCell,
          click: send('menu:view:focus-cell')
        },
        { type: 'separator' },
        {
          label: t.view.theme,
          submenu: [
            { label: t.view.light, click: send('menu:theme', 'light') },
            { label: t.view.dark, click: send('menu:theme', 'dark') },
            { label: t.view.highContrast, click: send('menu:theme', 'high-contrast') },
            { label: t.view.system, click: send('menu:theme', 'system') }
          ]
        },
        {
          label: t.view.language,
          submenu: SUPPORTED_LANGUAGES.map(lang => ({
            label: LANGUAGE_LABELS[lang],
            click: send('menu:language', lang)
          }))
        },
        // Developer Tools only in dev builds: in the shipped app it opened a
        // console onto window.api and the renderer bundle (2026-10-10 audit).
        // main.ts also sets webPreferences.devTools: false when packaged.
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              {
                label: t.view.devTools,
                accelerator: sc.viewDevTools,
                click: () => {
                  win.webContents.toggleDevTools()
                }
              }
            ] satisfies MenuItemConstructorOptions[]))
      ]
    },
    {
      label: t.data.label,
      submenu: [
        { label: t.data.sortCases, click: send('menu:data:sort-cases') },
        { label: t.data.sortVariables, click: send('menu:data:sort-variables') },
        { label: t.data.identifyDuplicates, click: send('menu:data:identify-duplicates') },
        { type: 'separator' },
        { label: t.data.selectCases, click: send('menu:data:select-cases') },
        { label: t.data.weightCases, click: send('menu:data:weight-cases') },
        { label: t.data.splitFile, click: send('menu:data:split-file') },
        { type: 'separator' },
        { label: t.data.aggregate, click: send('menu:data:aggregate') },
        { label: t.data.transpose, click: send('menu:data:transpose') },
        { label: t.data.restructure, click: send('menu:data:restructure') },
        { label: t.data.defineVarProps, click: send('menu:data:define-var-props') },
        { type: 'separator' },
        {
          label: t.data.mergeFiles,
          submenu: [
            { label: t.data.mergeAddCases, click: send('menu:data:merge-add-cases') },
            { label: t.data.mergeAddVariables, click: send('menu:data:merge-add-variables') }
          ]
        }
      ]
    },
    {
      label: t.transform.label,
      submenu: [
        {
          label: t.transform.computeVariable,
          accelerator: sc.transformCompute,
          click: send('menu:transform:compute')
        },
        { type: 'separator' },
        {
          label: t.transform.recodeSame,
          click: send('menu:transform:recode-same')
        },
        {
          label: t.transform.recodeDifferent,
          click: send('menu:transform:recode-different')
        },
        {
          label: t.transform.autoRecode,
          click: send('menu:transform:auto-recode')
        },
        { type: 'separator' },
        {
          label: t.transform.countValues,
          click: send('menu:transform:count-values')
        },
        {
          label: t.transform.rankCases,
          click: send('menu:transform:rank-cases')
        },
        {
          label: t.transform.visualBinning,
          click: send('menu:transform:visual-binning')
        },
        {
          label: t.transform.shiftValues,
          click: send('menu:transform:shift-values')
        },
        { type: 'separator' },
        {
          label: t.transform.replaceMissing,
          click: send('menu:transform:replace-missing')
        }
      ]
    },
    {
      label: t.analyze.label,
      submenu: [
        {
          label: t.analyze.reports,
          submenu: [
            {
              label: t.analyze.caseSummaries,
              click: () => {
                win.webContents.send('menu:analyze:case-summaries')
              }
            },
            {
              label: t.analyze.olapCubes,
              click: () => {
                win.webContents.send('menu:analyze:olap-cubes')
              }
            },
            {
              label: t.analyze.reportSummaries,
              click: () => {
                win.webContents.send('menu:analyze:report-summaries')
              }
            },
            {
              label: t.analyze.reportColumns,
              click: () => {
                win.webContents.send('menu:analyze:report-columns')
              }
            }
          ]
        },
        {
          label: t.analyze.descriptiveStatistics,
          submenu: [
            {
              label: t.analyze.frequencies,
              click: () => {
                win.webContents.send('menu:analyze:frequencies')
              }
            },
            {
              label: t.analyze.descriptives,
              click: () => {
                win.webContents.send('menu:analyze:descriptives')
              }
            },
            {
              label: t.analyze.explore,
              click: () => {
                win.webContents.send('menu:analyze:explore')
              }
            },
            {
              label: t.analyze.crosstabs,
              click: () => {
                win.webContents.send('menu:analyze:crosstabs')
              }
            },
            {
              label: t.analyze.ratio,
              click: () => {
                win.webContents.send('menu:analyze:ratio')
              }
            }
          ]
        },
        {
          label: t.analyze.compareMeans,
          submenu: [
            {
              label: t.analyze.means,
              click: () => {
                win.webContents.send('menu:analyze:means')
              }
            },
            {
              label: t.analyze.oneSampleTTest,
              click: () => {
                win.webContents.send('menu:analyze:onesample-ttest')
              }
            },
            {
              label: t.analyze.independentTTest,
              click: () => {
                win.webContents.send('menu:analyze:independent-ttest')
              }
            },
            {
              label: t.analyze.pairedTTest,
              click: () => {
                win.webContents.send('menu:analyze:paired-ttest')
              }
            },
            {
              label: t.analyze.oneWayAnova,
              click: () => {
                win.webContents.send('menu:analyze:oneway-anova')
              }
            },
            { type: 'separator' },
            {
              label: t.analyze.oneSampleProportions,
              click: () => {
                win.webContents.send('menu:analyze:proportions-one')
              }
            },
            {
              label: t.analyze.independentProportions,
              click: () => {
                win.webContents.send('menu:analyze:proportions-independent')
              }
            },
            {
              label: t.analyze.pairedProportions,
              click: () => {
                win.webContents.send('menu:analyze:proportions-paired')
              }
            }
          ]
        },
        {
          label: t.analyze.generalLinearModel,
          submenu: [
            {
              label: t.analyze.glmUnivariate,
              click: () => {
                win.webContents.send('menu:analyze:glm-univariate')
              }
            },
            {
              label: t.analyze.glmMultivariate,
              click: () => {
                win.webContents.send('menu:analyze:glm-multivariate')
              }
            },
            {
              label: t.analyze.glmRepeated,
              click: () => {
                win.webContents.send('menu:analyze:glm-repeated')
              }
            }
          ]
        },
        {
          label: t.analyze.mixedModels,
          submenu: [
            {
              label: t.analyze.mixedLinear,
              click: () => {
                win.webContents.send('menu:analyze:mixed-models')
              }
            },
            {
              label: t.analyze.mixedGeneralized,
              click: () => {
                win.webContents.send('menu:analyze:glmm')
              }
            }
          ]
        },
        {
          label: t.analyze.generalizedLinearModels,
          submenu: [
            {
              label: t.analyze.genlin,
              click: () => {
                win.webContents.send('menu:analyze:genlin')
              }
            },
            {
              label: t.analyze.gee,
              click: () => {
                win.webContents.send('menu:analyze:gee')
              }
            }
          ]
        },
        {
          label: t.analyze.classify,
          submenu: [
            {
              label: t.analyze.kMeansCluster,
              click: () => {
                win.webContents.send('menu:analyze:kmeans')
              }
            },
            {
              label: t.analyze.hierarchicalCluster,
              click: () => {
                win.webContents.send('menu:analyze:hierarchical')
              }
            },
            {
              label: t.analyze.discriminant,
              click: () => {
                win.webContents.send('menu:analyze:discriminant')
              }
            },
            {
              label: t.analyze.knn,
              click: () => {
                win.webContents.send('menu:analyze:knn')
              }
            },
            {
              label: t.analyze.tree,
              click: () => {
                win.webContents.send('menu:analyze:tree')
              }
            },
            {
              label: t.analyze.rocCurve,
              click: () => {
                win.webContents.send('menu:analyze:roc')
              }
            },
            {
              label: t.analyze.rocAnalysis,
              click: () => {
                win.webContents.send('menu:analyze:roc-analysis')
              }
            }
          ]
        },
        {
          label: t.analyze.dimensionReduction,
          submenu: [
            {
              label: t.analyze.factorAnalysis,
              click: () => {
                win.webContents.send('menu:analyze:factor')
              }
            }
          ]
        },
        {
          label: t.analyze.correlate,
          submenu: [
            {
              label: t.analyze.bivariate,
              click: () => {
                win.webContents.send('menu:analyze:correlate-bivariate')
              }
            },
            {
              label: t.analyze.partial,
              click: () => {
                win.webContents.send('menu:analyze:correlate-partial')
              }
            },
            {
              label: t.analyze.distances,
              click: () => {
                win.webContents.send('menu:analyze:distances')
              }
            }
          ]
        },
        {
          label: t.analyze.regression,
          submenu: [
            {
              label: t.analyze.linear,
              click: () => {
                win.webContents.send('menu:analyze:regression-linear')
              }
            },
            {
              label: t.analyze.binaryLogistic,
              click: () => {
                win.webContents.send('menu:analyze:regression-logistic')
              }
            },
            {
              label: t.analyze.curveEstimation,
              click: () => {
                win.webContents.send('menu:analyze:regression-curve')
              }
            },
            {
              label: t.analyze.multinomialLogistic,
              click: () => {
                win.webContents.send('menu:analyze:regression-multinomial')
              }
            },
            {
              label: t.analyze.ordinalRegression,
              click: () => {
                win.webContents.send('menu:analyze:regression-ordinal')
              }
            },
            {
              label: t.analyze.probit,
              click: () => {
                win.webContents.send('menu:analyze:regression-probit')
              }
            }
          ]
        },
        {
          label: t.analyze.nonparametric,
          submenu: [
            {
              label: t.analyze.twoIndependent,
              click: () => {
                win.webContents.send('menu:analyze:npar-2indep')
              }
            },
            {
              label: t.analyze.kIndependent,
              click: () => {
                win.webContents.send('menu:analyze:npar-kindep')
              }
            },
            {
              label: t.analyze.twoRelated,
              click: () => {
                win.webContents.send('menu:analyze:npar-2related')
              }
            },
            {
              label: t.analyze.kRelated,
              click: () => {
                win.webContents.send('menu:analyze:npar-krelated')
              }
            },
            { type: 'separator' },
            {
              label: t.analyze.nparChiSquare,
              click: () => {
                win.webContents.send('menu:analyze:npar-chisquare')
              }
            },
            {
              label: t.analyze.nparBinomial,
              click: () => {
                win.webContents.send('menu:analyze:npar-binomial')
              }
            },
            {
              label: t.analyze.nparRuns,
              click: () => {
                win.webContents.send('menu:analyze:npar-runs')
              }
            },
            {
              label: t.analyze.nparKS,
              click: () => {
                win.webContents.send('menu:analyze:npar-ks')
              }
            }
          ]
        },
        {
          label: t.analyze.survival,
          submenu: [
            {
              label: t.analyze.kaplanMeier,
              click: () => {
                win.webContents.send('menu:analyze:survival-km')
              }
            },
            {
              label: t.analyze.coxRegression,
              click: () => {
                win.webContents.send('menu:analyze:survival-cox')
              }
            },
            {
              label: t.analyze.lifeTables,
              click: () => {
                win.webContents.send('menu:analyze:life-tables')
              }
            }
          ]
        },
        {
          label: t.analyze.scale,
          submenu: [
            {
              label: t.analyze.reliabilityAnalysis,
              click: () => {
                win.webContents.send('menu:analyze:reliability')
              }
            },
            {
              label: t.analyze.mds,
              click: () => {
                win.webContents.send('menu:analyze:mds')
              }
            }
          ]
        },
        {
          label: t.analyze.bayesianStatistics,
          submenu: [
            {
              label: t.analyze.bayesOneSampleT,
              click: () => {
                win.webContents.send('menu:analyze:bayes-ttest-onesample')
              }
            },
            {
              label: t.analyze.bayesIndependentT,
              click: () => {
                win.webContents.send('menu:analyze:bayes-ttest-independent')
              }
            },
            {
              label: t.analyze.bayesPairedT,
              click: () => {
                win.webContents.send('menu:analyze:bayes-ttest-paired')
              }
            },
            {
              label: t.analyze.bayesAnova,
              click: () => {
                win.webContents.send('menu:analyze:bayes-anova')
              }
            },
            {
              label: t.analyze.bayesRegression,
              click: () => {
                win.webContents.send('menu:analyze:bayes-regression')
              }
            },
            {
              label: t.analyze.bayesCorrelation,
              click: () => {
                win.webContents.send('menu:analyze:bayes-correlation')
              }
            }
          ]
        },
        {
          label: t.analyze.multipleResponse,
          click: () => {
            win.webContents.send('menu:analyze:multiple-response')
          }
        },
        {
          label: t.analyze.missingValues,
          click: () => {
            win.webContents.send('menu:analyze:missing-values')
          }
        },
        {
          label: t.analyze.multipleImputation,
          click: () => {
            win.webContents.send('menu:analyze:mi')
          }
        },
        {
          label: t.analyze.powerAnalysis,
          click: () => {
            win.webContents.send('menu:analyze:power')
          }
        }
      ]
    },
    {
      label: t.graphs.label,
      submenu: [
        { label: t.graphs.chartBuilder, enabled: false },
        { type: 'separator' },
        { label: t.graphs.scatter, click: send('menu:graphs:scatter') },
        { label: t.graphs.bar, click: send('menu:graphs:bar') },
        { label: t.graphs.line, click: send('menu:graphs:line') },
        { label: t.graphs.histogram, click: send('menu:graphs:histogram') },
        { label: t.graphs.boxplot, click: send('menu:graphs:boxplot') },
        { label: t.graphs.ppPlot, click: send('menu:graphs:pp') },
        { label: t.graphs.qqPlot, click: send('menu:graphs:qq') }
      ]
    },
    {
      label: t.utilities.label,
      submenu: [
        // The real R console lives in the Syntax/Terminal tab's "R" mode
        // (Ctrl+5, Faz T2) — this used to be a permanently disabled stub
        // pointing at nothing, misleading users into thinking there's no R
        // console at all.
        { label: t.utilities.rConsole, click: send('menu:view:tab', 'terminal') },
        { label: t.utilities.settings, click: send('menu:preferences') }
      ]
    },
    {
      label: t.help.label,
      submenu: [
        {
          label: t.help.userGuide,
          accelerator: sc.helpUserGuide,
          click: () => {
            openDoc('user-guide.html')
          }
        },
        {
          label: t.help.statisticsGuide,
          click: () => {
            openDoc('statistics-guide.html')
          }
        },
        { label: t.help.shortcuts, click: send('menu:edit:toggle-shortcuts') },
        { type: 'separator' },
        {
          label: t.help.checkUpdates,
          enabled: UPDATER_ENABLED,
          click: () => {
            checkForUpdatesManually({ notify: true })
          }
        },
        { label: t.help.reportBug, click: send('menu:help:report-issue') },
        { type: 'separator' },
        { label: t.help.about, click: send('menu:about') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(escapeMnemonics(template)))
}

export function rebuildMenu(win: BrowserWindow): void {
  buildMenu(win)
}
