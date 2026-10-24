// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactElement, ReactNode } from 'react'
export const SaveIcon = (
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M13 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h8l3 3v8a1 1 0 0 1-1 1z" />
    <path d="M5 2v4h5V2" />
    <path d="M5 14v-4h6v4" />
  </svg>
)

export const TagIcon = (
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 1.5H2.5a1 1 0 0 0-1 1V7l7 7 5.5-5.5-7-7z" />
    <circle cx="4.5" cy="4.5" r="1" fill="currentColor" stroke="none" />
  </svg>
)

// --- Özelleştirme modu ikonları ---

// Çark (ayar) ikonu — mekanik dişli çark ⚙️ (Lucide settings standart).
export const GearIcon = (
  <svg
    viewBox="0 0 24 24"
    width="1.1em"
    height="1.1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

// Yuvarlak içinde + ikonu (gizli ikonları ekle).
export const AddPlusIcon = (
  <svg
    viewBox="0 0 24 24"
    width="1.1em"
    height="1.1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)

// Düzenleme modunda ikon köşesindeki kırmızı × (kaldırma rozeti).
export const RemoveXGlyph = (
  <svg
    viewBox="0 0 12 12"
    width="10"
    height="10"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
  >
    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
  </svg>
)

// Ekleme popover'ında gizli ikonların köşesindeki yeşil + rozeti.
export const AddSmallPlusGlyph = (
  <svg
    viewBox="0 0 12 12"
    width="10"
    height="10"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
  >
    <path d="M6 2v8M2 6h8" />
  </svg>
)

// İki-satır toggle ikonu: katlı çift-bar (Lucide layout).
export const TwoRowsIcon = (
  <svg
    viewBox="0 0 24 24"
    width="1.1em"
    height="1.1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
  </svg>
)

// --- Düzen / biçim ikonları ---
// Hepsi aynı ızgarada (16×16, 1.4 çizgi, currentColor) — SaveIcon/TagIcon ile
// aynı dil. Renk düğmelerinin altındaki renk çubuğunu ColorDropdown kendisi
// çizer (colorIndicatorBar), bu yüzden FontColorIcon/FillColorIcon yalnız glif.
const icon16 = (children: ReactNode): ReactElement => (
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

export const UndoIcon = icon16(
  <>
    <path d="M5.5 9 2.5 6l3-3" />
    <path d="M2.5 6h7a3.75 3.75 0 0 1 0 7.5H7" />
  </>
)

export const RedoIcon = icon16(
  <>
    <path d="m10.5 9 3-3-3-3" />
    <path d="M13.5 6h-7a3.75 3.75 0 0 0 0 7.5H9" />
  </>
)

export const BoldIcon = icon16(
  <path
    d="M4.5 2.5h4a2.75 2.75 0 0 1 0 5.5h-4zM4.5 8h4.75a2.75 2.75 0 0 1 0 5.5H4.5z"
    strokeWidth="1.8"
  />
)

export const ItalicIcon = icon16(
  <>
    <path d="M12 2.5H7M9 13.5H4" />
    <path d="M9.5 2.5 6.5 13.5" />
  </>
)

export const UnderlineIcon = icon16(
  <>
    <path d="M4.5 2.5v4.5a3.5 3.5 0 0 0 7 0V2.5" />
    <path d="M3.5 14h9" />
  </>
)

export const AlignLeftIcon = icon16(<path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7" />)

export const AlignCenterIcon = icon16(<path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7" />)

export const AlignRightIcon = icon16(<path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7" />)

// "A" harfi — alttaki renk çubuğuna yer bırakmak için biraz yukarıda.
export const FontColorIcon = icon16(
  <>
    <path d="M4 12.5 8 2.5l4 10" />
    <path d="M5.4 9h5.2" />
  </>
)

// Eğik boya kovası + damla.
export const FillColorIcon = icon16(
  <>
    <path d="M7 3.5 2.6 7.9a1 1 0 0 0 0 1.4l3.1 3.1a1 1 0 0 0 1.4 0L11.5 8z" />
    <path d="M5 1.5 7 3.5M3 8.5h8" />
    <path
      d="M14 11.6a1 1 0 0 1-2 0c0-.8 1-2.1 1-2.1s1 1.3 1 2.1z"
      fill="currentColor"
      stroke="none"
    />
  </>
)

export const FilterIcon = icon16(<path d="M2 3h12L9.5 8.5v4.5l-3-1.5v-3z" />)

export const SearchIcon = icon16(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </>
)

// Saat + geri ok: "son kullanılanları geri çağır".
export const HistoryIcon = icon16(
  <>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2.5 5.7" />
    <path d="M2.5 2.5v3.2h3.2" />
    <path d="M8 5v3l2 1.5" />
  </>
)
