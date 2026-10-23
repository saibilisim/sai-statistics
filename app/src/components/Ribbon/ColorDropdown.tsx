// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { type ReactNode, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './Ribbon.module.css'

const PALETTE_COLORS: string[][] = [
  [
    '#ffffff',
    '#000000',
    '#e7e6e6',
    '#44546a',
    '#418ab3',
    '#e46c0a',
    '#a5a5a5',
    '#ffc000',
    '#5b9bd5',
    '#70ad47'
  ],
  [
    '#f2f2f2',
    '#7f7f7f',
    '#d2d2d2',
    '#d6dce4',
    '#d2ebf7',
    '#fdeada',
    '#ededed',
    '#fff2cc',
    '#ddebf7',
    '#e2efda'
  ],
  [
    '#d9d9d9',
    '#595959',
    '#aeaeae',
    '#acb9ca',
    '#a4d6f0',
    '#fbd5b5',
    '#dbdbdb',
    '#ffe599',
    '#bdd7ee',
    '#c6e0b4'
  ],
  [
    '#bfbfbf',
    '#3f3f3f',
    '#777777',
    '#8497b0',
    '#4fa7d6',
    '#f8bc8c',
    '#c2c2c2',
    '#ffd966',
    '#9bc2e6',
    '#a9d08e'
  ],
  [
    '#a6a6a6',
    '#262626',
    '#3f3f3f',
    '#305496',
    '#1f4e78',
    '#c65911',
    '#7f7f7f',
    '#bf8f00',
    '#2f5597',
    '#375623'
  ],
  [
    '#7f7f7f',
    '#0c0c0c',
    '#171717',
    '#203764',
    '#16365c',
    '#833c0c',
    '#595959',
    '#806000',
    '#1f4e78',
    '#223715'
  ],
  [
    '#c00000',
    '#ff0000',
    '#ffc000',
    '#ffff00',
    '#92d050',
    '#00b050',
    '#00b0f0',
    '#0070c0',
    '#002060',
    '#7030a0'
  ]
] as const

interface ColorDropdownProps {
  icon: ReactNode
  title: string
  color?: string
  onSelectColor: (color: string) => void
  onReset: () => void
  resetLabel: string
  disabled?: boolean
}

export function ColorDropdown({
  icon,
  title,
  color,
  onSelectColor,
  onReset,
  resetLabel,
  disabled = false
}: ColorDropdownProps) {
  const { t } = useTranslation('common')
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

  return (
    <div className={styles.dropdownContainer} ref={containerRef}>
      <button
        type="button"
        className={[styles.btn, isOpen ? styles.dropdownActive : ''].filter(Boolean).join(' ')}
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
        <span className={styles.colorBtnIconWrapper}>
          <span className={styles.btnIcon}>{icon}</span>
          <span
            className={styles.colorIndicatorBar}
            style={{ backgroundColor: color || 'currentColor' }}
          />
        </span>
        <span className={styles.dropdownArrow}>▼</span>
      </button>
      {isOpen && !disabled && (
        <div className={styles.colorPalettePopover}>
          <button
            type="button"
            className={styles.resetColorButton}
            onClick={() => {
              onReset()
              setIsOpen(false)
            }}
          >
            {resetLabel}
          </button>

          <div className={styles.colorGridLabel}>{t('ribbon.themeColors')}</div>
          <div className={styles.colorGrid}>
            {PALETTE_COLORS.slice(0, 6).flatMap((row, rIdx) =>
              row.map((color, cIdx) => (
                <button
                  key={'theme-' + String(rIdx) + '-' + String(cIdx)}
                  type="button"
                  className={styles.colorCell}
                  style={{ backgroundColor: color }}
                  title={color}
                  onClick={() => {
                    onSelectColor(color)
                    setIsOpen(false)
                  }}
                />
              ))
            )}
          </div>

          <div className={styles.colorGridLabel}>{t('ribbon.standardColors')}</div>
          <div className={styles.colorGrid}>
            {(PALETTE_COLORS[6] ?? []).map((color: string, idx: number) => (
              <button
                key={'standard-' + String(idx)}
                type="button"
                className={styles.colorCell}
                style={{ backgroundColor: color }}
                title={color}
                onClick={() => {
                  onSelectColor(color)
                  setIsOpen(false)
                }}
              />
            ))}
          </div>

          <div className={styles.customColorContainer}>
            <label className={styles.customColorLabel}>
              Custom Color:
              <input
                type="color"
                className={styles.customColorInput}
                onChange={e => {
                  onSelectColor(e.target.value)
                }}
                onBlur={() => {
                  setIsOpen(false)
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
