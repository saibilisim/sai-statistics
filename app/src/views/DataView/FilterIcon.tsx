// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/** FilterIcon.tsx — Funnel SVG icon for the column filter overlay. */

interface FilterIconProps {
  active: boolean
  className?: string
}

export function FilterIcon({ active, className }: FilterIconProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      style={{
        width: '12px',
        height: '12px',
        fill: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'fill 0.15s, transform 0.1s'
      }}
    >
      <path d="M816 64H204.8C144 64 96 112 96 172.8c0 25.6 9.6 51.2 25.6 70.4 0 3.2 3.2 3.2 3.2 6.4l240 240v252.8c0 9.6 3.2 16 9.6 22.4L592 950.4c6.4 3.2 12.8 6.4 19.2 6.4 9.6 0 16-3.2 22.4-9.6 6.4-6.4 6.4-16 6.4-22.4V499.2l256-249.6 3.2-3.2c16-19.2 25.6-44.8 25.6-70.4 0-64-48-112-108.8-112z m35.2 140.8s-3.2 3.2 0 0L592 464c-6.4 6.4-9.6 12.8-9.6 22.4V864L425.6 732.8V480c0-9.6-3.2-16-9.6-22.4L172.8 208l-3.2-3.2c-9.6-9.6-12.8-19.2-12.8-32 0-25.6 22.4-48 48-48H816c25.6 0 48 22.4 48 48 0 12.8-6.4 22.4-12.8 32z" />
    </svg>
  )
}
