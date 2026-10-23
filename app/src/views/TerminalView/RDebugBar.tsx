// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RDebugBar — shown while R's browser() waits (debug(), debugonce(),
 * browser()). The buttons type R's own browser commands; Stop leaves the
 * debugger through the session's abort restart (r-session.ts), never Q.
 * Shortcuts follow RStudio: F10 next · Shift+F4 step into · Shift+F6 finish ·
 * Shift+F5 continue · Shift+F8 stop.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ContinueIcon, StepIntoIcon, StepOutIcon, StepOverIcon, StopIcon } from './terminal-icons'
import styles from './TerminalView.module.css'

export type RDebugCommand = 'n' | 's' | 'f' | 'c'

interface Action {
  cmd: RDebugCommand
  key: 'next' | 'step' | 'finish' | 'continue'
  shortcut: string
  Icon: typeof StepOverIcon
  match: (e: KeyboardEvent) => boolean
}

const ACTIONS: Action[] = [
  {
    cmd: 'n',
    key: 'next',
    shortcut: 'F10',
    Icon: StepOverIcon,
    match: e => e.key === 'F10' && !e.shiftKey
  },
  {
    cmd: 's',
    key: 'step',
    shortcut: 'Shift+F4',
    Icon: StepIntoIcon,
    match: e => e.key === 'F4' && e.shiftKey
  },
  {
    cmd: 'f',
    key: 'finish',
    shortcut: 'Shift+F6',
    Icon: StepOutIcon,
    match: e => e.key === 'F6' && e.shiftKey
  },
  {
    cmd: 'c',
    key: 'continue',
    shortcut: 'Shift+F5',
    Icon: ContinueIcon,
    match: e => e.key === 'F5' && e.shiftKey
  }
]
const isStop = (e: KeyboardEvent) => e.key === 'F8' && e.shiftKey

export function RDebugBar({
  level,
  onCommand,
  onStop
}: {
  level: number
  onCommand: (cmd: RDebugCommand) => void
  onStop: () => void
}) {
  const { t } = useTranslation(['analysis'])

  // Mounted only while the debugger waits, so the keys are live only then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (isStop(e)) {
        e.preventDefault()
        onStop()
        return
      }
      const a = ACTIONS.find(x => x.match(e))
      if (a) {
        e.preventDefault()
        onCommand(a.cmd)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onCommand, onStop])

  return (
    <div
      className={styles.debugBar}
      role="toolbar"
      aria-label={t('terminal.r.debug.title', { level })}
    >
      <span className={styles.debugTitle}>{t('terminal.r.debug.title', { level })}</span>
      {ACTIONS.map(({ cmd, key, shortcut, Icon }) => (
        <button
          key={cmd}
          type="button"
          className={styles.button}
          onClick={() => {
            onCommand(cmd)
          }}
          title={`${t(`terminal.r.debug.${key}`)} (${shortcut})`}
          aria-keyshortcuts={shortcut}
        >
          <Icon size={12} />
          {t(`terminal.r.debug.${key}`)}
        </button>
      ))}
      <button
        type="button"
        className={styles.button}
        onClick={onStop}
        title={`${t('terminal.r.debug.stop')} (Shift+F8)`}
        aria-keyshortcuts="Shift+F8"
      >
        <StopIcon size={12} />
        {t('terminal.r.debug.stop')}
      </button>
      <span className={styles.debugHint}>{t('terminal.r.debug.hint')}</span>
    </div>
  )
}
