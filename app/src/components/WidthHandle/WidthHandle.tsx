// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WidthHandle — the vertical drag handle beside a resizable side panel
 * (`useWidthResizer`). It overlaps the panel's border, so the layout keeps
 * the same thin line until the pointer is over it.
 */
import type { useWidthResizer } from '../../lib/use-width-resizer'
import styles from './WidthHandle.module.css'

type HandleProps = ReturnType<typeof useWidthResizer>['handleProps']

export function WidthHandle({ label, ...handleProps }: HandleProps & { label: string }) {
  return (
    <div
      className={styles.handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      tabIndex={0}
      {...handleProps}
    />
  )
}
