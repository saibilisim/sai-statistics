// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState, useRef, useEffect } from 'react'
import styles from './Ribbon.module.css'

interface RibbonDropdownProps {
  icon?: ReactNode
  label?: ReactNode
  title: string
  disabled?: boolean
  active?: boolean
  children: ReactNode
  /** Stacks the popover's children vertically instead of the default row
   *  (used by alignment/color pickers) — Number Format's General/Number/
   *  Currency/Percent/Scientific list, Excel-style. */
  column?: boolean
}

export function RibbonDropdown({
  icon,
  label,
  title,
  disabled = false,
  active = false,
  children,
  column = false
}: RibbonDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const buttonClass = [
    styles.btn,
    active ? styles.btnActive : '',
    isOpen ? styles.dropdownActive : '',
    label ? styles.btnWithLabel : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.dropdownContainer} ref={containerRef}>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen)
        }}
        onMouseDown={e => {
          e.preventDefault()
        }}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {icon != null && <span className={styles.btnIcon}>{icon}</span>}
        {label != null && <span className={styles.btnLabel}>{label}</span>}
        <span className={styles.dropdownArrow}>▼</span>
      </button>
      {isOpen && !disabled && (
        <div
          className={[styles.popover, column ? styles.popoverColumn : ''].filter(Boolean).join(' ')}
          onClick={() => {
            setIsOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
