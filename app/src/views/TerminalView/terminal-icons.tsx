// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TerminalView icon set — same stroke-icon language as AIPanel/ContextMenu
 * (`stroke="currentColor"`, single-color line icons), so the Syntax/Terminal
 * tab doesn't fall back to raw text buttons while the rest of the app uses
 * icon buttons.
 */
import type { SVGProps } from 'react'

export interface TerminalIconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

const base = (size = 14) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export function PlayIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StopIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function TrashIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export function RefreshIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

export function RestartIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 3 3 9 9 9" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function CopyIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function HelpIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function FolderOpenIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

export function SaveIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

export function ListIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

export function ImageIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

export function SendIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

export function CloseIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function PlusIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function AlertIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function TableIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="9" y1="10" x2="9" y2="20" />
    </svg>
  )
}

export function PlayAllIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polygon points="3 4 12 12 3 20 3 4" fill="currentColor" stroke="none" />
      <polygon points="12 4 21 12 12 20 12 4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function CodeIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="8 6 2 12 8 18" />
      <polyline points="16 6 22 12 16 18" />
    </svg>
  )
}

export function PanelRightIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  )
}

/** Debugger: step over (an arc jumping to the next line). */
export function StepOverIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M4 13a8 8 0 0 1 15-3.5" />
      <polyline points="20 4 20 10 14 10" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Debugger: step into (an arrow down into a call). */
export function StepIntoIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="12" y1="3" x2="12" y2="14" />
      <polyline points="7 9 12 14 17 9" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Debugger: step out / finish the function (an arrow up out of it). */
export function StepOutIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="12" y1="15" x2="12" y2="4" />
      <polyline points="7 9 12 4 17 9" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Debugger: continue (play after a bar). */
export function ContinueIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="5" y1="4" x2="5" y2="20" />
      <polygon points="9 4 20 12 9 20 9 4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** R report (a page with text lines). */
export function ReportIcon({ size = 14, className, ...props }: TerminalIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  )
}
