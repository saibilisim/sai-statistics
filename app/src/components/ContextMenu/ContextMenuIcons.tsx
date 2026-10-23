// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react'

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

const baseProps = (size = 18) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export function CopyIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CutIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  )
}

/** Paste-special family: a clipboard body whose CONTENT differs per mode
 *  (lines = values, brush = format, "fx" = formula) so they stay tellable
 *  apart at 16px. */
function clipboardBody() {
  return (
    <>
      <rect x="4" y="4" width="16" height="18" rx="2" />
      <path d="M9 4V2.5h6V4" />
    </>
  )
}

export function PasteValuesIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      {clipboardBody()}
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="16" y2="14" />
      <line x1="8" y1="18" x2="12.5" y2="18" />
    </svg>
  )
}

export function PasteFormatIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      {clipboardBody()}
      {/* paint brush inside the clipboard */}
      <path d="M9 17.5c0-2 1-2.5 2-3.5l3.5-3.5 2 2L13 16c-1 1-1.5 2-3.5 2z" />
      <line x1="14.5" y1="11.5" x2="16.5" y2="13.5" />
    </svg>
  )
}

export function PasteFormulaIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      {clipboardBody()}
      {/* "fx" glyph */}
      <path d="M8.5 18v-5.2c0-1 .6-1.6 1.6-1.6h.8" strokeWidth="1.8" />
      <line x1="7.6" y1="14.4" x2="11" y2="14.4" strokeWidth="1.8" />
      <line x1="13" y1="13.5" x2="17" y2="18" strokeWidth="1.8" />
      <line x1="17" y1="13.5" x2="13" y2="18" strokeWidth="1.8" />
    </svg>
  )
}

export function TransposeIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <line x1="4" y1="7" x2="16" y2="7" />
      <path d="M13 4 l3 3 -3 3" />
      <line x1="7" y1="4" x2="7" y2="16" />
      <path d="M4 13 l3 3 3 -3" />
    </svg>
  )
}

export function PasteIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11v6" />
      <path d="M9 14l3 3 3-3" />
    </svg>
  )
}

export function RowInsertAboveIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="3" y="11" width="18" height="10" rx="1" />
      <line x1="3" y1="16" x2="21" y2="16" />
      <path d="M12 8V2" />
      <path d="M8 5l4-3 4 3" />
    </svg>
  )
}

export function RowInsertBelowIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="3" y="3" width="18" height="10" rx="1" />
      <line x1="3" y1="8" x2="21" y2="8" />
      <path d="M12 16v6" />
      <path d="M8 19l4 3 4-3" />
    </svg>
  )
}

export function ColInsertLeftIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="11" y="3" width="10" height="18" rx="1" />
      <line x1="16" y1="3" x2="16" y2="21" />
      <path d="M8 12H2" />
      <path d="M5 8l-3 4 3 4" />
    </svg>
  )
}

export function ColInsertRightIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="3" y="3" width="10" height="18" rx="1" />
      <line x1="8" y1="3" x2="8" y2="21" />
      <path d="M16 12h6" />
      <path d="M19 8l3 4-3 4" />
    </svg>
  )
}

export function EqualWidthIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="3" y="4" width="6" height="16" rx="1" />
      <rect x="13" y="4" width="6" height="16" rx="1" />
      <path d="M4.5 12h3" />
      <path d="M14.5 12h3" />
      <path d="M21.5 8v8" />
    </svg>
  )
}

export function TrashIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export function SortAscendingIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="m3 16 4 4 4-4" />
      <path d="M7 20V4" />
      <path d="M20 8h-5" />
      <path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10" />
      <path d="M15 14h5l-5 6h5" />
    </svg>
  )
}

export function SortDescendingIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="m3 16 4 4 4-4" />
      <path d="M7 4v16" />
      <path d="M15 4h5l-5 6h5" />
      <path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20" />
      <path d="M20 18h-5" />
    </svg>
  )
}

export function PinIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M12 17v5" />
      <path d="M5 17h14v-2a2 2 0 0 0-.58-1.41l-2.42-2.42V5a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v6.17l-2.42 2.42A2 2 0 0 0 5 15v2z" />
    </svg>
  )
}

export function UnpinIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path d="M12 17v5" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6.17l2.42 2.42A2 2 0 0 1 18 15v2h-3" />
      <path d="M5 17v-2a2 2 0 0 1 .58-1.41L8 11.17" />
    </svg>
  )
}

export function EyeIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function EyeOffIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

export function ScaleIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M12 3v18" />
      <path d="m19 8 3 8a5 5 0 0 1-6 0zV7" />
      <path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" />
      <path d="m5 8 3 8a5 5 0 0 1-6 0zV7" />
      <path d="M7 21h10" />
    </svg>
  )
}

export function SplitIcon({ size = 18, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M12 9.5V5" />
      <path d="M9.5 7L12 4.5 14.5 7" />
      <path d="M12 14.5V19" />
      <path d="M9.5 17l2.5 2.5 2.5-2.5" />
    </svg>
  )
}

export function TagIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}

export function TagCopyIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M12.5 2H2v10.5l8 8a2 2 0 0 0 2.8 0l1.7-1.7" />
      <circle cx="6" cy="6" r="1" />
      <rect x="13" y="9" width="9" height="9" rx="1.5" />
      <path d="M17 6h2a2 2 0 0 1 2 2" />
    </svg>
  )
}

export function TagPasteIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M12 2H2v10l8.5 8.5a2 2 0 0 0 2.8 0l7.4-7.4a2 2 0 0 0 0-2.8L12 2z" />
      <circle cx="6" cy="6" r="1" />
      <path d="M12 11v6" />
      <path d="M9 14l3 3 3-3" />
    </svg>
  )
}

export function PlusIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

/** Floppy disk (Lucide "save") — Output toolbar "Save" split-button. */
export function SaveIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

/** Box with an up-arrow leaving it (Lucide "share"/upload) — Output toolbar
 *  "Export" split-button. */
export function ExportIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  )
}

/** Circular arrow (Lucide "refresh-cw") — "re-run this analysis" on an
 *  Output block header. */
export function RerunIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

/** Magnifying glass (Lucide "search") — Output navigator search box. */
export function SearchIcon({ size = 16, className, ...props }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}
