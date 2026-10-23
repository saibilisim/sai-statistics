// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  /** Discriminant against ContextMenuIconRow (optional — plain items omit it). */
  type?: 'item'
  key: string
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

export interface ContextMenuIconButton {
  key: string
  icon: React.ReactNode
  /** Native tooltip shown on hover (no visible label). */
  title: string
  onClick: () => void
  disabled?: boolean
}

/** A horizontal toolbar of icon-only buttons (no labels) — used for the
 *  cut/copy/paste and paste-special rows at the top of the DataView menu. */
export interface ContextMenuIconRow {
  type: 'iconRow'
  key: string
  buttons: ContextMenuIconButton[]
}

export type ContextMenuEntry = ContextMenuItem | 'separator' | ContextMenuIconRow

export interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    setPos({ left: Math.max(4, left), top: Math.max(4, top) })
  }, [x, y])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onClose}
      onMouseDown={e => {
        e.stopPropagation()
      }}
      onContextMenu={e => {
        e.preventDefault()
      }}
    >
      <div
        ref={menuRef}
        className={styles.menu}
        style={{ left: `${String(pos.left)}px`, top: `${String(pos.top)}px` }}
        onClick={e => {
          e.stopPropagation()
        }}
        role="menu"
      >
        {items.map((item, i) => {
          if (item === 'separator') {
            return <div key={`sep-${String(i)}`} className={styles.separator} />
          }
          if ('type' in item && item.type === 'iconRow') {
            return (
              <div key={item.key} className={styles.iconRow} role="group">
                {item.buttons.map(btn => (
                  <button
                    key={btn.key}
                    type="button"
                    role="menuitem"
                    className={styles.iconBtn}
                    title={btn.title}
                    aria-label={btn.title}
                    disabled={btn.disabled}
                    onClick={() => {
                      btn.onClick()
                      onClose()
                    }}
                  >
                    {btn.icon}
                  </button>
                ))}
              </div>
            )
          }
          return (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={cx(styles.item, item.danger && styles.danger)}
              disabled={item.disabled}
              onClick={() => {
                item.onClick()
                onClose()
              }}
            >
              {item.icon && <span className={styles.icon}>{item.icon}</span>}
              <span className={styles.label}>{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>,
    document.body
  )
}
