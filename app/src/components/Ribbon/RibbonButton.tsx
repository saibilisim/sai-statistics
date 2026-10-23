// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { MouseEvent, ReactNode } from 'react'
import styles from './Ribbon.module.css'

export interface RibbonButtonProps {
  /** Leading icon (unicode glyph or small element). */
  icon?: ReactNode
  /** Optional text label rendered next to the icon. */
  label?: ReactNode
  /** Accessible label / native tooltip. */
  title: string
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  /** Toggle/pressed state — paints the accent treatment. */
  active?: boolean
  /** Visual intent. `danger` is used for destructive actions. */
  variant?: 'default' | 'primary' | 'danger'
}

/**
 * Shared ribbon button — the single source of truth for action-button styling
 * across the app (top ribbon + Variable View toolbar). All visuals come from
 * Ribbon.module.css design tokens; no inline colors.
 */
export function RibbonButton({
  icon,
  label,
  title,
  onClick,
  disabled = false,
  active = false,
  variant = 'default'
}: RibbonButtonProps) {
  const classNames = [
    styles.btn,
    active ? styles.btnActive : '',
    variant === 'primary' ? styles.btnPrimary : '',
    variant === 'danger' ? styles.btnDanger : '',
    label ? styles.btnWithLabel : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classNames}
      onClick={onClick}
      // Keep the spreadsheet's cell selection intact: a normal button click
      // would move DOM focus off the grid, so format commands would
      // act on nothing. Preventing mousedown default suppresses the focus shift
      // while still firing onClick.
      onMouseDown={e => {
        e.preventDefault()
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {icon != null && <span className={styles.btnIcon}>{icon}</span>}
      {label != null && <span className={styles.btnLabel}>{label}</span>}
    </button>
  )
}

/** Thin vertical separator between ribbon groups. */
export function RibbonDivider() {
  return <span className={styles.divider} role="separator" aria-orientation="vertical" />
}
