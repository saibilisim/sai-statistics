// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'
import styles from './VariableView.module.css'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

interface CustomCellDropdownProps<T extends string> {
  value: T
  options: DropdownOption<T>[]
  onChange: (newValue: T) => void | Promise<void>
}

export function CustomCellDropdown<T extends string>({
  value,
  options,
  onChange
}: CustomCellDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; minWidth: number }>({
    top: 0,
    left: 0,
    minWidth: 120
  })
  const containerRef = useRef<HTMLDivElement>(null)

  // React 19's useId — the old `useRef(Math.random())` both called an impure
  // function and read a ref during render (denetim raporu §4.4).
  const id = useId()

  const selectedOpt = options.find(o => o.value === value) ?? options[0]

  const updateMenuPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setMenuStyle({
        top: rect.bottom + 2,
        left: rect.left,
        minWidth: Math.max(rect.width, 130)
      })
    }
  }, [])

  useEffect(() => {
    const handleCloseOthers = (e: Event) => {
      const customEvent = e as CustomEvent<string>
      if (customEvent.detail !== id) {
        setIsOpen(false)
      }
    }
    window.addEventListener('close-cell-dropdowns', handleCloseOthers)
    return () => {
      window.removeEventListener('close-cell-dropdowns', handleCloseOthers)
    }
  }, [id])

  useEffect(() => {
    if (!isOpen) return

    updateMenuPosition()

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    const handleScrollOrResize = () => {
      setIsOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen, updateMenuPosition])

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOpen) {
      window.dispatchEvent(new CustomEvent('close-cell-dropdowns', { detail: id }))
      updateMenuPosition()
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  const handleSelect = (val: T, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    if (val !== value) {
      void onChange(val)
    }
  }

  const portalMenu = isOpen
    ? createPortal(
        <div
          className={styles.dropdownMenuPortal}
          // Position comes from the clicked cell at runtime — cannot be a class.
          style={{
            top: `${String(menuStyle.top)}px`,
            left: `${String(menuStyle.left)}px`,
            minWidth: `${String(menuStyle.minWidth)}px`
          }}
          onMouseDown={e => {
            e.stopPropagation()
          }}
        >
          {options.map(opt => {
            const isSelected = opt.value === value
            return (
              <div
                key={opt.value}
                onClick={e => {
                  handleSelect(opt.value, e)
                }}
                className={cx(styles.dropdownItem, isSelected && styles.dropdownItemSelected)}
              >
                {opt.icon && <span className={styles.dropdownIcon}>{opt.icon}</span>}
                <span>{opt.label}</span>
              </div>
            )
          })}
        </div>,
        document.body
      )
    : null

  return (
    <div
      ref={containerRef}
      className={styles.dropdownContainer}
      onMouseDown={e => {
        e.stopPropagation()
      }}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className={cx(styles.dropdownTrigger, isOpen && styles.dropdownTriggerOpen)}
      >
        <div className={styles.dropdownValue}>
          {selectedOpt?.icon && <span className={styles.dropdownIcon}>{selectedOpt.icon}</span>}
          <span>{selectedOpt?.label}</span>
        </div>
        <svg
          className={cx(styles.dropdownArrow, isOpen && styles.dropdownArrowOpen)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {portalMenu}
    </div>
  )
}
