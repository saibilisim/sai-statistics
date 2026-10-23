// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type RefObject } from 'react'

/**
 * Shared modal-dialog keyboard behavior — Escape/Enter/Tab-trap/focus
 * management — for the two dialog shells every SAI dialog is built from
 * (`DialogBase`, `AnalysisDialogShell`, and their nested sub-overlays).
 * See faz8-kalite-roadmap.md K1: touching these two components covers
 * every analysis + data dialog in the app.
 *
 * - Escape closes (calls `onCancel`, stops propagation so a nested overlay's
 *   own instance of this hook doesn't ALSO close its parent on the same
 *   keypress).
 * - Enter submits (`onSubmit`) unless the focused element is a <textarea>
 *   (needs literal newlines — e.g. Recode's multi-row mapping inputs don't
 *   use textareas today, but future ones might), a <button>/<a> (native
 *   Enter-activates-focused-button already fires a click; calling onSubmit
 *   too would double-submit), or carries `data-no-submit` (a field that is
 *   not part of the form being submitted — e.g. the source-list search box,
 *   where Enter running the analysis would be a nasty surprise).
 * - Tab/Shift+Tab wrap focus within the container (focus trap) instead of
 *   escaping to the browser chrome or a hidden element behind the overlay.
 * - On mount: focuses the first focusable element (unless focus is already
 *   inside the container, e.g. an inner field auto-focused itself).
 * - On unmount: restores focus to whatever had it before the dialog opened
 *   (the menu item / button that triggered it), matching desktop-app norms.
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => el.offsetParent !== null
  )
}

export interface UseDialogKeyboardOptions {
  containerRef: RefObject<HTMLElement | null>
  onCancel: () => void
  onSubmit?: () => void
  submitDisabled?: boolean
  /**
   * Skip attaching entirely — e.g. the outer AnalysisDialogShell pauses
   * while a nested sub-overlay (its own hook instance) owns the keyboard.
   */
  paused?: boolean
}

export function useDialogKeyboard({
  containerRef,
  onCancel,
  onSubmit,
  submitDisabled,
  paused
}: UseDialogKeyboardOptions): void {
  // Latest-ref pattern: the keydown listener is attached once per mount (so
  // re-focusing/re-trapping doesn't fight the user mid-Tab), but must always
  // read the CURRENT onCancel/onSubmit/submitDisabled — e.g. submitDisabled
  // flips from true to false as the user fills in a required field, and a
  // stale closure would leave Enter permanently disabled.
  const latest = useRef({ onCancel, onSubmit, submitDisabled })
  useEffect(() => {
    latest.current = { onCancel, onSubmit, submitDisabled }
  })

  useEffect(() => {
    if (paused) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    if (!container.contains(document.activeElement)) {
      const focusables = getFocusable(container)
      focusables[0]?.focus()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        latest.current.onCancel()
        return
      }
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement
        if (
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.hasAttribute('data-no-submit')
        ) {
          return
        }
        const { onSubmit: submit, submitDisabled: disabled } = latest.current
        if (submit && !disabled) {
          e.preventDefault()
          submit()
        }
        return
      }
      if (e.key === 'Tab') {
        const items = getFocusable(container)
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (!first || !last) return
        if (e.shiftKey) {
          if (document.activeElement === first || !container.contains(document.activeElement)) {
            e.preventDefault()
            last.focus()
          }
        } else if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
    // containerRef is a ref object (stable identity) read only for its
    // .current at effect-run time; onCancel/onSubmit/submitDisabled are
    // intentionally excluded — see the latest-ref pattern above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])
}
