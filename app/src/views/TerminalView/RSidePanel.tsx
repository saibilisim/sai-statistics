// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RSidePanel — the R console's right-hand panel (Faz T3), RStudio-style tabs:
 *   • Environment — objects in the session's global environment (refreshed
 *     after every command; while the debugger waits, the browsed frame's
 *     variables instead); data frames open in the View() grid.
 *   • Plots — RPlotPanel.
 *   • Help — the last `?topic` / F1 page, as plain text.
 *   • Packages — installed packages (load/unload) + install from the app's
 *     dated package snapshot into the user library.
 *   • Files — the session's working directory (2026-10-21): change it, open
 *     scripts in the editor, write the code that reads a data file.
 *   • History — commands run this session: click writes one to the console
 *     input, double-click runs it.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalREnvItem } from '@shared/ipc-contracts'
import { useTerminalStore } from '../../store/terminal-store'
import { cx } from '../../lib/cx'
import { useWidthResizer } from '../../lib/use-width-resizer'
import { WidthHandle } from '../../components/WidthHandle/WidthHandle'
import {
  CloseIcon,
  CodeIcon,
  FolderOpenIcon,
  ListIcon,
  RefreshIcon,
  TableIcon
} from './terminal-icons'
import { RPlotPanel } from './RPlotPanel'
import { readCodeFor, rString, SCRIPT_RE } from './r-files'
import styles from './TerminalView.module.css'

export type RSideTab = 'env' | 'files' | 'history' | 'plots' | 'help' | 'packages'
const TABS: RSideTab[] = ['env', 'files', 'history', 'plots', 'help', 'packages']
/** Panel width bounds while dragging its edge (px). */
const SIDE_MIN_PX = 220
const SIDE_MIN_REST_PX = 320

interface RSidePanelProps {
  tab: RSideTab
  onTabChange: (tab: RSideTab) => void
  onHide: () => void
  onSendPlotToOutput: (png: string) => void
  /** Insert an object's name where the user is typing. */
  onInsertName: (name: string) => void
  /** Open a data object in the View() grid. */
  onView: (name: string) => void
  /** library() / detach() a package. */
  onTogglePackage: (name: string, attach: boolean) => void
  /** Run code in the console, echoed like typed code (setwd(), history). */
  onRunCode: (code: string) => void
  /** Put code in the console input without running it. */
  onWriteToConsole: (code: string) => void
  /** Open a script listed in the working directory in an editor tab. */
  onOpenScript: (name: string) => void
  /** Folder of the active script's file, if it has one (Files ▸ script folder). */
  scriptDir: string | null
}

export function RSidePanel({
  tab,
  onTabChange,
  onHide,
  onSendPlotToOutput,
  onInsertName,
  onView,
  onTogglePackage,
  onRunCode,
  onWriteToConsole,
  onOpenScript,
  scriptDir
}: RSidePanelProps) {
  const { t } = useTranslation(['analysis'])
  const plotCount = useTerminalStore(s => s.rPlots.length)
  const { panelRef, panelStyle, handleProps } = useWidthResizer<HTMLElement>({
    storageKey: 'sai.terminal.rSideWidth',
    edge: 'left',
    minPx: SIDE_MIN_PX,
    minRestPx: SIDE_MIN_REST_PX
  })
  const tabListRef = useRef<HTMLDivElement>(null)

  // A narrow panel scrolls its tab strip — keep the chosen tab in view.
  useEffect(() => {
    tabListRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab])

  return (
    <>
      <WidthHandle label={t('terminal.r.side.resize')} {...handleProps} />
      <aside
        ref={panelRef}
        className={styles.plotPanel}
        style={panelStyle}
        aria-label={t('terminal.r.side.title')}
      >
        <div className={styles.sideTabs}>
          <div
            ref={tabListRef}
            className={styles.sideTabList}
            role="tablist"
            aria-label={t('terminal.r.side.title')}
            onWheel={e => {
              // Mouse wheel scrolls the tab strip sideways.
              if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY
            }}
          >
            {TABS.map(k => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={cx(styles.sideTab, tab === k && styles.sideTabActive)}
                onClick={() => {
                  onTabChange(k)
                }}
              >
                {t(`terminal.r.side.${k}`)}
                {k === 'plots' && plotCount > 0 && (
                  <span className={styles.sideTabCount}>{plotCount}</span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onHide}
            title={t('terminal.r.side.hide')}
            aria-label={t('terminal.r.side.hide')}
          >
            <CloseIcon size={13} />
          </button>
        </div>
        {tab === 'env' && <REnvPane onInsertName={onInsertName} onView={onView} />}
        {tab === 'files' && (
          <RFilesPane
            onRunCode={onRunCode}
            onWriteToConsole={onWriteToConsole}
            onOpenScript={onOpenScript}
            scriptDir={scriptDir}
          />
        )}
        {tab === 'history' && (
          <RHistoryPane onRunCode={onRunCode} onWriteToConsole={onWriteToConsole} />
        )}
        {tab === 'plots' && <RPlotPanel onSendToOutput={onSendPlotToOutput} />}
        {tab === 'help' && <RHelpPane />}
        {tab === 'packages' && <RPackagesPane onToggle={onTogglePackage} />}
      </aside>
    </>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function REnvPane({
  onInsertName,
  onView
}: {
  onInsertName: (name: string) => void
  onView: (name: string) => void
}) {
  const { t } = useTranslation(['analysis'])
  const items = useTerminalStore(s => s.rEnv)
  // Set while the debugger waits: the pane lists that function's frame.
  const frame = useTerminalStore(s => s.rFrame)
  const frameLabel = frame !== null && (
    <div className={styles.envFrame} title={frame}>
      {t('terminal.r.env.frame', { call: frame })}
    </div>
  )
  const groups = useMemo(() => {
    const by: Record<TerminalREnvItem['kind'], TerminalREnvItem[]> = {
      data: [],
      value: [],
      function: []
    }
    for (const it of items) by[it.kind].push(it)
    return (['data', 'value', 'function'] as const)
      .filter(k => by[k].length > 0)
      .map(k => ({
        kind: k,
        items: by[k]
      }))
  }, [items])

  if (items.length === 0) {
    return (
      <div className={styles.sideTabBody}>
        {frameLabel}
        <div className={styles.sideEmpty}>{t('terminal.r.env.empty')}</div>
      </div>
    )
  }

  return (
    <div className={styles.sideTabBody}>
      {frameLabel}
      <div className={styles.envList}>
        {groups.map(g => (
          <section key={g.kind}>
            <h4 className={styles.envGroup}>{t(`terminal.r.env.group.${g.kind}`)}</h4>
            <ul className={styles.varItems}>
              {g.items.map(it => (
                <li key={it.name} className={styles.envRow}>
                  <button
                    type="button"
                    className={styles.varItemBtn}
                    title={`${it.cls} · ${formatBytes(it.size)} — ${t('terminal.vars.insertHint')}`}
                    onMouseDown={e => {
                      // Keep focus (and the caret) in the editor / R input.
                      e.preventDefault()
                    }}
                    onClick={() => {
                      onInsertName(it.name)
                    }}
                  >
                    <span className={styles.varItemName}>{it.name}</span>
                    <span className={styles.varItemLabel}>
                      {it.kind === 'data' && it.dims && it.dims.length >= 2
                        ? t('terminal.r.env.dims', {
                            rows: (it.dims[0] ?? 0).toLocaleString(),
                            cols: (it.dims[1] ?? 0).toLocaleString(),
                            cls: it.cls
                          })
                        : it.desc}
                    </span>
                  </button>
                  {it.kind === 'data' && (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => {
                        onView(it.name)
                      }}
                      title={t('terminal.r.env.view')}
                      aria-label={`${t('terminal.r.env.view')}: ${it.name}`}
                    >
                      <TableIcon size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function RFilesPane({
  onRunCode,
  onWriteToConsole,
  onOpenScript,
  scriptDir
}: {
  onRunCode: (code: string) => void
  onWriteToConsole: (code: string) => void
  onOpenScript: (name: string) => void
  scriptDir: string | null
}) {
  const { t } = useTranslation(['analysis'])
  const wd = useTerminalStore(s => s.rWd)
  const entries = useMemo(
    () =>
      wd
        ? [...wd.files].sort((a, b) =>
            a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1
          )
        : [],
    [wd]
  )

  if (!wd) {
    return (
      <div className={styles.sideTabBody}>
        <div className={styles.sideEmpty}>{t('terminal.r.files.waiting')}</div>
      </div>
    )
  }

  const chooseDir = () => {
    void window.api.terminal.rChooseDir().then(dir => {
      if (dir) onRunCode(`setwd(${rString(dir)})`)
    })
  }

  return (
    <div className={styles.sideTabBody}>
      <div className={styles.wdPath} title={wd.wd}>
        <span className={styles.wdLabel}>{t('terminal.r.files.wdLabel')}</span>
        {wd.wd}
      </div>
      <div className={styles.pkgFilterRow}>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            onRunCode('setwd("..")')
          }}
          title={t('terminal.r.files.up')}
          aria-label={t('terminal.r.files.up')}
        >
          ..
        </button>
        <button type="button" className={styles.button} onClick={chooseDir}>
          <FolderOpenIcon size={12} />
          {t('terminal.r.files.chooseDir')}
        </button>
        <button
          type="button"
          className={styles.button}
          disabled={scriptDir === null}
          onClick={() => {
            if (scriptDir) onRunCode(`setwd(${rString(scriptDir)})`)
          }}
        >
          {t('terminal.r.files.scriptDir')}
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.iconBtn}
          // Not echoed: a refresh is not something the user ran.
          onClick={() => void window.api.terminal.rWrite({ code: '.sai_emit_wd(TRUE)' })}
          title={t('terminal.r.files.refresh')}
          aria-label={t('terminal.r.files.refresh')}
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      {entries.length === 0 ? (
        <div className={styles.sideEmpty}>{t('terminal.r.files.empty')}</div>
      ) : (
        <ul className={styles.varItems} aria-label={t('terminal.r.side.files')}>
          {entries.map(e => {
            const read = e.dir ? null : readCodeFor(e.name)
            const script = !e.dir && SCRIPT_RE.test(e.name)
            const act = e.dir
              ? () => {
                  onRunCode(`setwd(${rString(`${wd.wd}/${e.name}`)})`)
                }
              : script
                ? () => {
                    onOpenScript(e.name)
                  }
                : read
                  ? () => {
                      onWriteToConsole(read)
                    }
                  : null
            const hint = e.dir
              ? t('terminal.r.files.enterHint')
              : script
                ? t('terminal.r.files.openHint')
                : read
                  ? t('terminal.r.files.readHint')
                  : undefined
            return (
              <li key={e.name} className={styles.envRow}>
                <button
                  type="button"
                  className={styles.varItemBtn}
                  disabled={act === null}
                  onClick={act ?? undefined}
                  title={hint ? `${e.name} — ${hint}` : e.name}
                >
                  <span className={styles.fileIcon} aria-hidden="true">
                    {e.dir ? (
                      <FolderOpenIcon size={12} />
                    ) : script ? (
                      <CodeIcon size={12} />
                    ) : read ? (
                      <TableIcon size={12} />
                    ) : (
                      <ListIcon size={12} />
                    )}
                  </span>
                  <span className={styles.varItemName}>{e.name}</span>
                  {!e.dir && <span className={styles.varItemLabel}>{formatBytes(e.size)}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {wd.total > wd.files.length && (
        <div className={styles.sideEmpty}>
          {t('terminal.r.files.truncated', { shown: wd.files.length, total: wd.total })}
        </div>
      )}
    </div>
  )
}

function RHistoryPane({
  onRunCode,
  onWriteToConsole
}: {
  onRunCode: (code: string) => void
  onWriteToConsole: (code: string) => void
}) {
  const { t } = useTranslation(['analysis'])
  const history = useTerminalStore(s => s.rHistory)
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const newestFirst = [...history].reverse()
    return q === '' ? newestFirst : newestFirst.filter(c => c.toLowerCase().includes(q))
  }, [history, query])

  return (
    <div className={styles.sideTabBody}>
      <div className={styles.pkgFilterRow}>
        <input
          type="search"
          className={styles.varSearch}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
          }}
          placeholder={t('terminal.r.history.search')}
          aria-label={t('terminal.r.history.search')}
        />
      </div>
      {history.length === 0 ? (
        <div className={styles.sideEmpty}>{t('terminal.r.history.empty')}</div>
      ) : (
        <ul className={styles.varItems} aria-label={t('terminal.r.side.history')}>
          {shown.map((code, i) => (
            <li key={`${String(i)}-${code}`} className={styles.envRow}>
              <button
                type="button"
                className={cx(styles.varItemBtn, styles.historyItem)}
                title={`${code}\n\n${t('terminal.r.history.hint')}`}
                onClick={() => {
                  onWriteToConsole(code)
                }}
                onDoubleClick={() => {
                  onRunCode(code)
                }}
              >
                {code}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RHelpPane() {
  const { t } = useTranslation(['analysis'])
  const help = useTerminalStore(s => s.rHelp)
  const [query, setQuery] = useState('')
  return (
    <div className={styles.sideTabBody}>
      <form
        className={styles.helpSearch}
        onSubmit={e => {
          e.preventDefault()
          const topic = query.trim()
          if (topic === '') return
          void window.api.terminal.rWrite({ code: `help(${JSON.stringify(topic)})` })
        }}
      >
        <input
          type="search"
          className={styles.varSearch}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
          }}
          placeholder={t('terminal.r.help.search')}
          aria-label={t('terminal.r.help.search')}
        />
      </form>
      {help ? (
        <pre className={styles.helpText} tabIndex={0} aria-label={help.title}>
          {help.text}
        </pre>
      ) : (
        <div className={styles.sideEmpty}>{t('terminal.r.help.empty')}</div>
      )}
    </div>
  )
}

/** Same rule as the IPC schema (strict R package name). */
const PKG_NAME_RE = /^[A-Za-z][A-Za-z0-9.]*[A-Za-z0-9]$/

function RPackagesPane({ onToggle }: { onToggle: (name: string, attach: boolean) => void }) {
  const { t } = useTranslation(['analysis'])
  const items = useTerminalStore(s => s.rPackages)
  const [query, setQuery] = useState('')
  const [installName, setInstallName] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; name: string } | null>(null)

  // First visit (or after a restart): ask the session for its list.
  useEffect(() => {
    if (items === null) void window.api.terminal.rPkgsRefresh()
  }, [items])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = items ?? []
    return q === '' ? all : all.filter(p => p.name.toLowerCase().includes(q))
  }, [items, query])

  const install = () => {
    const name = installName.trim()
    if (!PKG_NAME_RE.test(name) || installing) return
    setInstalling(name)
    setResult(null)
    window.api.terminal
      .rPkgInstall({ name })
      .then(r => {
        setResult({ ok: r.success, name })
        if (r.success) setInstallName('')
      })
      .catch(() => {
        setResult({ ok: false, name })
      })
      .finally(() => {
        setInstalling(null)
      })
  }

  return (
    <div className={styles.sideTabBody}>
      <form
        className={styles.pkgInstall}
        onSubmit={e => {
          e.preventDefault()
          install()
        }}
      >
        <input
          type="text"
          className={styles.varSearch}
          value={installName}
          onChange={e => {
            setInstallName(e.target.value)
          }}
          placeholder={t('terminal.r.pkgs.installPlaceholder')}
          aria-label={t('terminal.r.pkgs.installPlaceholder')}
          spellCheck={false}
          disabled={installing !== null}
        />
        <button
          type="submit"
          className={styles.button}
          disabled={installing !== null || !PKG_NAME_RE.test(installName.trim())}
        >
          {installing ? t('terminal.r.pkgs.installing') : t('terminal.r.pkgs.install')}
        </button>
      </form>
      {installing && (
        <div className={styles.pkgStatus} role="status">
          {t('terminal.r.pkgs.installingHint', { name: installing })}
        </div>
      )}
      {result && !installing && (
        <div className={cx(styles.pkgStatus, !result.ok && styles.error)} role="status">
          {t(result.ok ? 'terminal.r.pkgs.installed' : 'terminal.r.pkgs.installFailed', {
            name: result.name
          })}
        </div>
      )}
      <div className={styles.pkgFilterRow}>
        <input
          type="search"
          className={styles.varSearch}
          value={query}
          onChange={e => {
            setQuery(e.target.value)
          }}
          placeholder={t('terminal.r.pkgs.search')}
          aria-label={t('terminal.r.pkgs.search')}
        />
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void window.api.terminal.rPkgsRefresh()}
          title={t('terminal.r.pkgs.refresh')}
          aria-label={t('terminal.r.pkgs.refresh')}
        >
          <RefreshIcon size={13} />
        </button>
      </div>
      {items === null ? (
        <div className={styles.sideEmpty}>{t('terminal.r.pkgs.loading')}</div>
      ) : (
        <ul className={styles.pkgList} aria-label={t('terminal.r.side.packages')}>
          {shown.map(p => (
            <li key={p.name} className={styles.pkgRow}>
              <label className={styles.pkgLabel} title={t('terminal.r.pkgs.toggleHint')}>
                <input
                  type="checkbox"
                  checked={p.attached}
                  onChange={e => {
                    onToggle(p.name, e.target.checked)
                  }}
                />
                <span className={styles.varItemName}>{p.name}</span>
              </label>
              <span className={styles.pkgVersion}>{p.version}</span>
              {p.user && <span className={styles.pkgBadge}>{t('terminal.r.pkgs.userLib')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
