// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Drag/keyboard splitter between the script editor (top) and the console
 * (bottom) — shared by the SPSS and R modes of the Syntax tab.
 */
import { useRef, useState } from 'react'

/** Editor height bounds while dragging the splitter (px). */
const MIN_EDITOR_PX = 80
const MIN_CONSOLE_PX = 80
const SPLITTER_KEY_STEP = 24

export function useSplitter() {
  // null = CSS default height; a number once the user drags the splitter.
  const [editorPx, setEditorPx] = useState<number | null>(null)
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const clampEditor = (px: number): number => {
    const total = bodyRef.current?.clientHeight ?? 0
    return Math.max(MIN_EDITOR_PX, Math.min(px, total - MIN_CONSOLE_PX))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return // buttons inside the bar
    const startY = e.clientY
    const startH = editorWrapRef.current?.getBoundingClientRect().height ?? 0
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      setEditorPx(clampEditor(startH + ev.clientY - startY))
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys typed into controls inside the bar (console find) are not for us.
    if (e.target !== e.currentTarget) return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const cur = editorWrapRef.current?.getBoundingClientRect().height ?? 0
    setEditorPx(clampEditor(cur + (e.key === 'ArrowDown' ? SPLITTER_KEY_STEP : -SPLITTER_KEY_STEP)))
  }

  /** Height the user dragged the splitter to — a runtime value. */
  const editorStyle: React.CSSProperties | undefined =
    editorPx !== null ? { flexBasis: `${String(editorPx)}px` } : undefined

  return { editorWrapRef, bodyRef, editorStyle, onPointerDown, onKeyDown }
}
