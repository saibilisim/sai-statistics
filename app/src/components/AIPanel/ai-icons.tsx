// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AIPanel ikon seti — tüm sohbet arayüzü tek bir çizgi-ikon dilinden
 * (ContextMenuIcons ile aynı `stroke="currentColor"` deseni) beslenir.
 * Önceden burada renkli emoji (📋 🔍 🗑️ ⚙️ ⏳) kullanılıyordu; bunlar
 * platforma göre renkli/dolgulu render edildiği için uygulamanın geri
 * kalanındaki (Ribbon/ContextMenu) tek-renk SVG ikon diliyle çelişiyordu.
 */
import type { SVGProps } from 'react'

export interface AiIconProps extends SVGProps<SVGSVGElement> {
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

export function CopyIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** Kalem — onay kartındaki syntax'ı yerinde düzenleme. */
export function EditIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

/** Kutudan çıkan ok — syntax'ı Sözdizimi (Terminal) sekmesine aktarma. */
export function ExternalIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

/** Tablo — markdown tablosunu panoya (TSV) kopyalama düğmesi. */
export function TableIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="21" />
    </svg>
  )
}

export function CheckIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export function XIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export function SearchIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

export function TrashIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export function GearIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** Küçük dönen halka — tool/analiz çalışırken (emoji ⏳ yerine). */
export function SpinnerIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function AlertIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

export function SparkleIcon({ size = 13, className, ...props }: AiIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
    </svg>
  )
}

/** Dolar — model kartındaki maliyet satırı. */
export function DollarIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

/** Şimşek — model kartındaki hız satırı. */
export function BoltIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}

export function SendIcon({ size = 15, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  )
}

/** Dairesel ok — asistan yanıtını yeniden oluşturma (regenerate). */
export function RefreshIcon({ size = 14, className, ...props }: AiIconProps) {
  return (
    <svg {...base(size)} className={className} {...props}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

export function StopIcon({ size = 12, className, ...props }: AiIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  )
}
