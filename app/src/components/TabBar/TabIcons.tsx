// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react'

export interface TabIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number
}

const baseProps = (size = 15) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export function DataViewIcon({ size = 15, className, ...props }: TabIconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  )
}

export function VariableViewIcon({ size = 15, className, ...props }: TabIconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="8" cy="6" r="2" fill="currentColor" />
      <circle cx="16" cy="12" r="2" fill="currentColor" />
      <circle cx="10" cy="18" r="2" fill="currentColor" />
    </svg>
  )
}

export function OutputViewIcon({ size = 15, className, ...props }: TabIconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  )
}

export function NormalityViewIcon({ size = 15, className, ...props }: TabIconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M3 20h18" />
      <path d="M3 18c3 0 4-1 6-7 1.5-4.5 2.5-6 3-6s1.5 1.5 3 6c2 6 3 7 6 7" />
    </svg>
  )
}

export function TerminalViewIcon({ size = 15, className, ...props }: TabIconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

export function AiTabIcon({ size = 15, className, ...props }: TabIconProps) {
  return (
    <svg {...baseProps(size)} className={className} {...props}>
      <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" />
      <path d="M19 17l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />
    </svg>
  )
}
