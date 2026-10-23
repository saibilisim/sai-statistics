// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * fill-handle.ts — the fill handle's hit-test and drag geometry, extracted
 * from use-cell-selection.ts. Framework-free (no React / AG Grid), so it's
 * unit-testable like cell-selection.ts. The handle itself is the `::after`
 * square drawn by `.fillHandleAnchor` in DataView.module.css.
 */
import type { RangeRect } from './cell-selection-types'

/** Fill-handle hit-zone size in CSS pixels (matches the `::after` square
 *  drawn by `.fillHandleAnchor` in DataView.module.css — must stay in sync). */
export const FILL_HANDLE_HITZONE_PX = 8

/** True if a mousedown landed within the fill-handle's small hit-zone at
 *  the given cell's bottom-right corner (raw-DOM check — AG Grid's event
 *  gives us the cell's real element via `event.target`, so this needs no
 *  separate position tracking of its own). */
export function hitsFillHandle(mouseEvent: MouseEvent): boolean {
  const target = mouseEvent.target as HTMLElement | null
  const cellEl = target?.closest<HTMLElement>('.ag-cell')
  if (!cellEl) return false
  const rect = cellEl.getBoundingClientRect()
  const dx = rect.right - mouseEvent.clientX
  const dy = rect.bottom - mouseEvent.clientY
  return dx >= 0 && dx <= FILL_HANDLE_HITZONE_PX && dy >= 0 && dy <= FILL_HANDLE_HITZONE_PX
}

/** Fill-drag preview: extends the SOURCE range in whichever of the four
 *  directions the cursor has overflowed the most (Excel constrains the fill
 *  to one axis based on the dominant drag direction). */
export function computeFillPreviewRect(
  src: RangeRect,
  hoverRow: number,
  hoverCol: number
): RangeRect {
  const down = hoverRow - src.bottom
  const up = src.top - hoverRow
  const right = hoverCol - src.right
  const left = src.left - hoverCol
  const vOver = Math.max(down, up)
  const hOver = Math.max(right, left)
  let rect = { top: src.top, bottom: src.bottom, left: src.left, right: src.right }
  if (vOver > 0 && vOver >= hOver) {
    rect = down > 0 ? { ...rect, bottom: hoverRow } : { ...rect, top: hoverRow }
  } else if (hOver > 0) {
    rect = right > 0 ? { ...rect, right: hoverCol } : { ...rect, left: hoverCol }
  }
  return rect
}

export type FillDirection = 'down' | 'up' | 'right' | 'left'

/** Which single axis/direction a completed fill drag extended the source
 *  along (the preview only ever extends one — see computeFillPreviewRect).
 *  null when the drag ended back inside the source: nothing to fill. */
export function computeFillDirection(src: RangeRect, dst: RangeRect): FillDirection | null {
  return dst.bottom > src.bottom
    ? 'down'
    : dst.top < src.top
      ? 'up'
      : dst.right > src.right
        ? 'right'
        : dst.left < src.left
          ? 'left'
          : null
}
