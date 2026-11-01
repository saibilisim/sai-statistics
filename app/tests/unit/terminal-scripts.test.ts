// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * terminal-scripts.test.ts — R script tabs (2026-10-21) and the Code tab as
 * part of the project (2026-11-01): saved in the .sdf, guarded when unsaved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTerminalStore, isScriptDirty, type RScriptTab } from '../../src/store/terminal-store'
import {
  currentProjectCode,
  isCodeModified,
  loadProjectCode,
  markCodeSaved,
  startCodeDirtyTracking
} from '../../src/lib/project-code'
import { ProjectCodeSchema } from '../../shared/project-code'

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

describe('code as part of the project (.sdf code.json)', () => {
  const setDirty = vi.fn()

  beforeEach(() => {
    setDirty.mockClear()
    vi.stubGlobal('window', { api: { app: { setOutputDirty: setDirty } } })
    loadProjectCode(null)
  })

  it('an untouched Code tab stores nothing', () => {
    expect(currentProjectCode()).toBeNull()
    expect(isCodeModified()).toBe(false)
  })

  it('round-trips every tab, the active one, the SPSS buffer and unsaved marks', () => {
    s().setRSource('x <- 1')
    s().newRScript()
    s().setRSource('y <- 2')
    s().setSource('FREQUENCIES age.')
    const code = currentProjectCode()
    expect(ProjectCodeSchema.safeParse(code).success).toBe(true)

    loadProjectCode(null)
    expect(s().rSource).toBe('')
    expect(s().source).toBe('')

    loadProjectCode(code)
    expect(s().rScripts.map(t => t.source)).toEqual(['x <- 1', 'y <- 2'])
    expect(s().rSource).toBe('y <- 2')
    expect(s().source).toBe('FREQUENCIES age.')
    expect(isScriptDirty(active(), s().rSource)).toBe(true)
    // just loaded = what the project holds
    expect(isCodeModified()).toBe(false)
  })

  it('typing makes the project unsaved until it is saved', () => {
    s().setSource('DESCRIPTIVES age.')
    expect(isCodeModified()).toBe(true)
    markCodeSaved()
    expect(isCodeModified()).toBe(false)
  })

  it('a script saved to its own .R file is not unsaved project work', () => {
    s().openRScript('a.R', 'a()', 'C:\w\a.R')
    expect(isCodeModified()).toBe(false)
    s().setRSource('a(1)')
    expect(isCodeModified()).toBe(true)
  })

  it('tells the close guard only when the state flips', () => {
    const stop = startCodeDirtyTracking()
    s().setSource('A.')
    s().setSource('AB.')
    s().setSource('')
    stop()
    expect(setDirty.mock.calls).toEqual([[true], [false]])
  })

  it('rejects a corrupt code.json', () => {
    expect(ProjectCodeSchema.safeParse({ syntax: 1, scripts: [] }).success).toBe(false)
  })
})
