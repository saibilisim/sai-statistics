// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * use-text-context-menu.tsx — right-click menus for plain-text surfaces that
 * have no menu of their own. Electron shows NO native context menu, so
 * without these a right-click on a console or code editor did nothing.
 *
 *   - useSelectionCopy(ref): read-only text (SPSS/R console output). Ctrl+C
 *     and right-click ▸ Copy share ONE payload — Selection.toString(), which
 *     Chromium serializes layout-aware (block → newline) — written as
 *     text/plain only: console text is code/log, and the browser's default
 *     HTML flavor dragged the theme's colors into Word/Outlook pastes.
 *   - useEditableContextMenu(): textareas (syntax/R editors) — Cut / Copy /
 *     Paste / Select All. Edits go through replaceSelection(), which
 *     dispatches an `input` event so a controlled textarea's onChange fires.
 */

import { useCallback, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, CopyIcon, type ContextMenuEntry } from '../components/ContextMenu'

interface MenuPos {
  x: number
  y: number
}

/** Selection text, only when the selection lies inside `container`. */
function selectionTextIn(container: HTMLElement | null): string {
  const sel = window.getSelection()
  if (!container || !sel || sel.rangeCount === 0 || sel.isCollapsed) return ''
  const range = sel.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return ''
  }
  return sel.toString()
}

export function useSelectionCopy(containerRef: RefObject<HTMLElement | null>): {
  onCopy: (e: React.ClipboardEvent<HTMLElement>) => void
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void
  menu: ReactNode
} {
  const { t } = useTranslation(['common'])
  const [menu, setMenu] = useState<(MenuPos & { text: string }) | null>(null)

  const onCopy = useCallback(
    (e: React.ClipboardEvent<HTMLElement>) => {
      const text = selectionTextIn(containerRef.current)
      if (!text) return
      e.clipboardData.setData('text/plain', text)
      e.preventDefault()
    },
    [containerRef]
  )

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented) return
      e.preventDefault()
      // Captured now: clicking the menu item must not depend on the
      // selection still being there.
      setMenu({ x: e.clientX, y: e.clientY, text: selectionTextIn(containerRef.current) })
    },
    [containerRef]
  )

  const items: ContextMenuEntry[] = menu
    ? [
        {
          key: 'copy',
          label: t('common.copy'),
          icon: <CopyIcon size={14} />,
          disabled: menu.text === '',
          onClick: () => {
            const { text } = menu
            setMenu(null)
            void navigator.clipboard.writeText(text)
          }
        },
        {
          key: 'selectAll',
          label: t('common.selectAll'),
          onClick: () => {
            setMenu(null)
            const el = containerRef.current
            const sel = window.getSelection()
            if (!el || !sel) return
            const range = document.createRange()
            range.selectNodeContents(el)
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }
      ]
    : []

  return {
    onCopy,
    onContextMenu,
    menu: menu ? (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        items={items}
        onClose={() => {
          setMenu(null)
        }}
      />
    ) : null
  }
}

/** Replace the textarea's selection with `text` and notify React: the DOM
 *  value changes first, so React's value tracker sees a real change on the
 *  bubbling `input` event and calls the controlled onChange. */
function replaceSelection(el: HTMLTextAreaElement, text: string): void {
  el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function useEditableContextMenu(): {
  onContextMenu: (e: React.MouseEvent<HTMLTextAreaElement>) => void
  menu: ReactNode
} {
  const { t } = useTranslation(['common'])
  const [menu, setMenu] = useState<(MenuPos & { el: HTMLTextAreaElement }) | null>(null)

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, el: e.currentTarget })
  }, [])

  let items: ContextMenuEntry[] = []
  if (menu) {
    const { el } = menu
    const selected = el.value.slice(el.selectionStart, el.selectionEnd)
    const close = () => {
      setMenu(null)
      el.focus()
    }
    items = [
      {
        key: 'cut',
        label: t('common.cut'),
        disabled: selected === '' || el.readOnly,
        onClick: () => {
          close()
          void navigator.clipboard.writeText(selected)
          replaceSelection(el, '')
        }
      },
      {
        key: 'copy',
        label: t('common.copy'),
        icon: <CopyIcon size={14} />,
        disabled: selected === '',
        onClick: () => {
          close()
          void navigator.clipboard.writeText(selected)
        }
      },
      {
        key: 'paste',
        label: t('common.paste'),
        disabled: el.readOnly,
        onClick: () => {
          close()
          void navigator.clipboard.readText().then(text => {
            el.focus()
            if (text) replaceSelection(el, text)
          })
        }
      },
      'separator',
      {
        key: 'selectAll',
        label: t('common.selectAll'),
        onClick: () => {
          close()
          el.select()
        }
      }
    ]
  }

  return {
    onContextMenu,
    menu: menu ? (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        items={items}
        onClose={() => {
          setMenu(null)
        }}
      />
    ) : null
  }
}
