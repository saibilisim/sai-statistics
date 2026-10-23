// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * terminal-scripts.test.ts — R script tabs and draft carry-over (2026-10-21).
 * Before: one script buffer, and quitting with unsaved R code lost it silently
 * (the close guard only knows datasets and Output).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTerminalStore, isScriptDirty, type RScriptTab } from '../../src/store/terminal-store'
import { restoreTerminalDrafts, startTerminalDraftAutosave } from '../../src/lib/terminal-drafts'

const s = () => useTerminalStore.getState()
const active = (): RScriptTab => s().rScripts.find(t => t.id === s().activeScriptId) as RScriptTab

function reset(): void {
  useTerminalStore.setState({
    rScripts: [{ id: 'a', name: 'script.R', source: '', saved: '', filePath: null }],
    activeScriptId: 'a',
    rSource: '',
    source: ''
  })
}

beforeEach(reset)

describe('R script tabs', () => {
  it('keeps each tab’s text when switching', () => {
    s().setRSource('x <- 1')
    s().newRScript()
    expect(active().name).toBe('script2.R')
    expect(s().rSource).toBe('')
    s().setRSource('y <- 2')
    s().switchRScript('a')
    expect(s().rSource).toBe('x <- 1')
    const second = s().rScripts[1] as RScriptTab
    s().switchRScript(second.id)
    expect(s().rSource).toBe('y <- 2')
  })

  it('opening a file reuses an empty untitled tab, and switches to an already open one', () => {
    s().openRScript('a.R', 'a()', 'C:\\w\\a.R')
    expect(s().rScripts).toHaveLength(1)
    expect(active()).toMatchObject({ name: 'a.R', saved: 'a()', filePath: 'C:\\w\\a.R' })
    s().openRScript('b.R', 'b()', 'C:\\w\\b.R')
    expect(s().rScripts).toHaveLength(2)
    s().openRScript('a.R', 'stale', 'c:\\W\\A.R')
    expect(s().rScripts).toHaveLength(2)
    expect(s().rSource).toBe('a()')
  })

  it('appendRCode (dialogs, AI) goes to the active tab', () => {
    s().newRScript()
    s().appendRCode('summary(data)')
    s().switchRScript('a')
    expect(s().rSource).toBe('')
  })

  it('closing the active tab shows a neighbour; closing the last leaves an empty one', () => {
    s().setRSource('one')
    s().newRScript()
    s().setRSource('two')
    s().closeRScript(s().activeScriptId)
    expect(s().rSource).toBe('one')
    s().closeRScript('a')
    expect(s().rScripts).toHaveLength(1)
    expect(s().rSource).toBe('')
  })

  it('marks the active tab saved under its new name', () => {
    s().setRSource('z <- 3')
    expect(isScriptDirty(active(), s().rSource)).toBe(true)
    s().markRScriptSaved('analysis.R', 'C:\\w\\analysis.R')
    expect(active()).toMatchObject({ name: 'analysis.R', filePath: 'C:\\w\\analysis.R' })
    expect(isScriptDirty(active(), s().rSource)).toBe(false)
  })

  it('an empty buffer is never "unsaved"', () => {
    expect(isScriptDirty(active(), '   ')).toBe(false)
  })
})

describe('draft carry-over', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = new Map()
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v)
    })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })

  it('saves every tab and the SPSS buffer, and restores them — unsaved marks included', () => {
    const stop = startTerminalDraftAutosave()
    s().setRSource('x <- 1')
    s().newRScript()
    s().setRSource('y <- 2')
    s().setSource('FREQUENCIES age.')
    vi.advanceTimersByTime(1000)
    stop()

    reset()
    restoreTerminalDrafts()
    expect(s().rScripts.map(t => t.source)).toEqual(['x <- 1', 'y <- 2'])
    expect(s().rSource).toBe('y <- 2')
    expect(s().source).toBe('FREQUENCIES age.')
    expect(isScriptDirty(active(), s().rSource)).toBe(true)
  })

  it('ignores a corrupt or foreign value', () => {
    store.set('sai.terminalDrafts.v1', '{"scripts": "nope"}')
    restoreTerminalDrafts()
    expect(s().rScripts).toHaveLength(1)
    store.set('sai.terminalDrafts.v1', 'not json')
    expect(() => {
      restoreTerminalDrafts()
    }).not.toThrow()
  })
})
