// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import type { TokenName } from './tokens'
import { TOKEN_NAMES } from './tokens'

type ThemeValues = Record<TokenName, string>

// Values that don't change across light/dark/high-contrast — spacing, type
// scale, radii, motion, z-index, control sizing. Spread into each theme below
// so only genuinely theme-dependent values (color, shadow) are repeated.
const base = {
  // Spacing
  'space-xs': '4px',
  'space-sm': '8px',
  'space-md': '12px',
  'space-lg': '16px',
  'space-xl': '24px',

  // Typography
  'font-family-ui': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  'font-family-mono': '"Cascadia Code", "Fira Code", "Consolas", monospace',
  'font-size-xs': '11px',
  'font-size-sm': '12px',
  'font-size-body': '13px',
  'font-size-lg': '14px',
  'font-size-xl': '16px',
  'font-weight-normal': '400',
  'font-weight-medium': '500',
  'font-weight-semibold': '600',
  'font-weight-bold': '700',
  'line-height-tight': '1.2',
  'line-height-normal': '1.5',
  'line-height-relaxed': '1.6',

  // Radius
  'radius-sm': '2px',
  'radius-md': '4px',
  'radius-lg': '6px',
  'radius-xl': '10px',
  // Büyük pencereler (analiz diyalogları, karşılama) — tek kaynak.
  'radius-dialog': '14px',
  // Diyalog içi: alt pencere (Seçenekler…), düğme/giriş kutusu, liste/hedef kutusu.
  'radius-subdialog': '12px',
  'radius-control': '8px',
  'radius-field': '10px',

  // Diyalog çerçevesi boşlukları — tüm diyaloglar (analiz, veri, değişken görünümü).
  'dialog-pad-x': '20px',
  'dialog-header-pad-y': '14px',
  'dialog-body-pad-y': '18px',
  'dialog-footer-pad-y': '12px',
  // Diyalog değişken listesi satırı
  'list-item-pad': '7px 10px',
  // Veri diyaloglarının değişken listesi yüksekliği
  'picker-list-min': '180px',
  'picker-list-max': '260px',
  // "Etiket: [giriş]" satırlarında etiket sütunu
  'form-label-width': '80px',
  'form-label-width-lg': '200px',
  // Satır içi sayı/açılır alan genişlikleri (global .numField ailesi)
  'field-width-xs': '60px',
  'field-width-sm': '5rem',
  'field-width-md': '6rem',
  'field-width-lg': '8rem',
  'field-width-select': '140px',
  // Satır sil (×) gibi kare simge düğmesi
  'icon-btn-size': '28px',
  // Diyalog düğmesi (Tamam/İptal…) ve pencere kapat (×)
  'btn-pad-y': '7px',
  // Görünüm (Variable View) araç / durum çubuğu, açılır liste satırı, arama kutusu
  'view-toolbar-height': '52px',
  'view-statusbar-height': '28px',
  'menu-item-pad': '6px 12px',
  'search-width-min': '200px',
  'search-width-max': '340px',
  // Etkin öğenin solundaki vurgu çizgisi (arama eşleşmesi gibi)
  'accent-bar-width': '3px',
  // Sözdizimi sekmesi: değişken paneli, R grafik paneli, Komutlar menüsü
  'terminal-side-width': '200px',
  'terminal-plot-width': '320px',
  'terminal-menu-width': '420px',
  'btn-min-width': '62px',
  'font-size-close': '20px',

  // Borders & controls
  'border-width-thin': '1px',
  'border-width-thick': '1.5px',
  'control-height-sm': '26px',
  'control-height-md': '30px',
  'control-height-lg': '34px',

  // Focus ring
  'focus-ring-width': '2px',
  'focus-ring-offset': '1px',
  'focus-halo': '0 0 0 3px color-mix(in srgb, var(--color-accent) 15%, transparent)',

  // Disabled state
  'opacity-disabled': '0.5',

  // Motion
  'duration-fast': '120ms',
  'duration-base': '180ms',
  'duration-slow': '240ms',
  'easing-standard': 'cubic-bezier(0.16, 1, 0.3, 1)',

  // Z-index scale (documented order, lowest → highest)
  'z-dropdown': '100',
  'z-sticky': '200',
  'z-modal-scrim': '1000',
  'z-popover': '2000',
  'z-context-menu': '9000',
  'z-tooltip': '9500',

  // Layout
  'toolbar-height': '36px',
  'tabbar-height': '28px',
  'statusbar-height': '22px',
  // Diyalog genişlikleri — onay < veri diyaloğu < analiz diyaloğu
  'dialog-width-xs': '360px',
  'dialog-width-confirm': '440px',
  'dialog-width-sm': '480px',
  'dialog-width-md': '720px',
  'dialog-width-lg': '680px',
  'dialog-width-analysis-min': '580px',
  'dialog-width-analysis': '700px',
  'dialog-width-analysis-max': '840px',
  'subdialog-width-min': '300px',
  'subdialog-width-max': '460px'
} satisfies Partial<ThemeValues>

const light: ThemeValues = {
  ...base,
  // Background
  'color-bg-base': '#f0f0f0',
  'color-bg-surface': '#ffffff',
  'color-bg-overlay': '#ffffff',
  'color-bg-hover': '#e8e8e8',
  'color-bg-selected': '#cce5ff',
  'color-bg-header': '#e0e0e0',
  'color-bg-toolbar': '#ececec',
  'color-bg-statusbar': '#d4d4d4',
  'color-bg-tabbar': '#dcdcdc',
  'color-bg-alt': 'rgba(0, 0, 0, 0.015)',
  'color-bg-focus-cross': 'rgba(29, 78, 216, 0.06)',

  // Text
  'color-text-primary': '#1a1a1a',
  'color-text-secondary': '#555555',
  'color-text-disabled': '#aaaaaa',
  'color-text-inverse': '#ffffff',
  'color-text-link': '#0066cc',
  'color-text-statusbar': '#1a1a1a',

  // Border
  'color-border': '#c0c0c0',
  'color-border-strong': '#888888',
  'color-border-focus': '#0066cc',

  // Accent
  'color-accent': '#0066cc',
  'color-accent-hover': '#0052a3',
  'color-accent-text': '#ffffff',

  // Semantic
  'color-success': '#1a7f37',
  'color-warning': '#9a6700',
  'color-error': '#cf222e',
  'color-error-bg': '#fff0f0',
  'color-error-border': '#f5c6cb',
  'color-info': '#0969da',

  // Modal scrim / backdrop
  'color-scrim': 'rgba(15, 15, 15, 0.4)',
  'blur-modal': '8px',

  // Code / syntax highlighting
  'color-bg-code': '#f6f8fa',
  'color-code-keyword': '#cf222e',
  'color-code-string': '#0a3069',
  'color-code-comment': '#6e7781',
  'color-code-number': '#0550ae',
  'color-code-function': '#8250df',
  'color-code-operator': '#57606a',

  // Significance
  'color-sig-p05': '#1a7f37',
  'color-sig-p01': '#0969da',
  'color-sig-p001': '#8250df',

  // Shadow
  'shadow-sm': '0 1px 2px rgba(0,0,0,0.1)',
  'shadow-md': '0 2px 8px rgba(0,0,0,0.15)',
  'shadow-lg': '0 10px 30px rgba(0,0,0,0.15)',
  'shadow-popover': '0 4px 12px rgba(0,0,0,0.15)',
  'shadow-dialog':
    '0 24px 48px rgba(0,0,0,0.25), 0 8px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
  'shadow-subdialog': '0 20px 40px rgba(0,0,0,0.2), 0 6px 12px rgba(0,0,0,0.1)'
}

const dark: ThemeValues = {
  ...base,
  // Background
  'color-bg-base': '#1e1e1e',
  'color-bg-surface': '#252526',
  'color-bg-overlay': '#2d2d30',
  'color-bg-hover': '#2a2d2e',
  'color-bg-selected': '#094771',
  'color-bg-header': '#333333',
  'color-bg-toolbar': '#2d2d2d',
  'color-bg-statusbar': '#007acc',
  'color-bg-tabbar': '#2d2d2d',
  'color-bg-alt': 'rgba(255, 255, 255, 0.03)',
  'color-bg-focus-cross': 'rgba(77, 170, 252, 0.1)',

  // Text
  'color-text-primary': '#cccccc',
  'color-text-secondary': '#9d9d9d',
  'color-text-disabled': '#555555',
  'color-text-inverse': '#1e1e1e',
  'color-text-link': '#4daafc',
  'color-text-statusbar': '#ffffff',

  // Border
  'color-border': '#404040',
  'color-border-strong': '#606060',
  'color-border-focus': '#007acc',

  // Accent
  'color-accent': '#007acc',
  'color-accent-hover': '#1a8fe0',
  'color-accent-text': '#ffffff',

  // Semantic
  'color-success': '#4ec9b0',
  'color-warning': '#ddb100',
  'color-error': '#f48771',
  'color-error-bg': 'rgba(244, 135, 113, 0.12)',
  'color-error-border': 'rgba(244, 135, 113, 0.35)',
  'color-info': '#4daafc',

  // Modal scrim / backdrop
  'color-scrim': 'rgba(0, 0, 0, 0.55)',
  'blur-modal': '6px',

  // Code / syntax highlighting (VS Code Dark+ ailesi)
  'color-bg-code': '#1b1b1d',
  'color-code-keyword': '#569cd6',
  'color-code-string': '#ce9178',
  'color-code-comment': '#6a9955',
  'color-code-number': '#b5cea8',
  'color-code-function': '#dcdcaa',
  'color-code-operator': '#d4d4d4',

  // Significance
  'color-sig-p05': '#4ec9b0',
  'color-sig-p01': '#4daafc',
  'color-sig-p001': '#c586c0',

  // Shadow
  'shadow-sm': '0 1px 2px rgba(0,0,0,0.3)',
  'shadow-md': '0 2px 8px rgba(0,0,0,0.5)',
  'shadow-lg': '0 10px 30px rgba(0,0,0,0.4)',
  'shadow-popover': '0 4px 12px rgba(0,0,0,0.4)',
  'shadow-dialog':
    '0 24px 48px rgba(0,0,0,0.25), 0 8px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
  'shadow-subdialog': '0 20px 40px rgba(0,0,0,0.2), 0 6px 12px rgba(0,0,0,0.1)'
}

// AAA-contrast theme: pure black/white surfaces, strong borders, high-contrast
// focus ring — for K1's keyboard focus trap and low-vision users generally.
// Not derived from dark/light (WCAG AAA text ≥ 7:1 needs deliberate pairs,
// not just "dark but more so").
const highContrast: ThemeValues = {
  ...base,
  // Background
  'color-bg-base': '#000000',
  'color-bg-surface': '#000000',
  'color-bg-overlay': '#000000',
  'color-bg-hover': '#2a2a2a',
  'color-bg-selected': '#004d99',
  'color-bg-header': '#000000',
  'color-bg-toolbar': '#000000',
  'color-bg-statusbar': '#000000',
  'color-bg-tabbar': '#000000',
  'color-bg-alt': 'rgba(255, 255, 255, 0.06)',
  'color-bg-focus-cross': 'rgba(255, 214, 10, 0.12)',

  // Text — #ffffff on #000000 = 21:1 (AAA)
  'color-text-primary': '#ffffff',
  'color-text-secondary': '#e0e0e0',
  'color-text-disabled': '#8a8a8a',
  'color-text-inverse': '#000000',
  'color-text-link': '#66b3ff',
  'color-text-statusbar': '#ffffff',

  // Border — strong, always visible against pure black
  'color-border': '#ffffff',
  'color-border-strong': '#ffffff',
  'color-border-focus': '#ffd60a',

  // Accent — #ffd60a on #000000 = 17.4:1 (AAA)
  'color-accent': '#ffd60a',
  'color-accent-hover': '#ffe670',
  'color-accent-text': '#000000',

  // Semantic — chosen for ≥ 7:1 against #000000
  'color-success': '#3dd68c',
  'color-warning': '#ffd60a',
  'color-error': '#ff6b6b',
  'color-error-bg': 'rgba(255, 107, 107, 0.15)',
  'color-error-border': '#ff6b6b',
  'color-info': '#66b3ff',

  // Modal scrim / backdrop — no blur, keeps text crisp for low-vision users
  'color-scrim': 'rgba(0, 0, 0, 0.75)',
  'blur-modal': '0px',

  // Code / syntax highlighting — hepsi #000000 üzerinde ≥ 7:1
  'color-bg-code': '#000000',
  'color-code-keyword': '#ffd60a',
  'color-code-string': '#3dd68c',
  'color-code-comment': '#b8b8b8',
  'color-code-number': '#66b3ff',
  'color-code-function': '#d9a8ff',
  'color-code-operator': '#ffffff',

  // Significance
  'color-sig-p05': '#3dd68c',
  'color-sig-p01': '#66b3ff',
  'color-sig-p001': '#d9a8ff',

  // No soft shadows — a shadow implies a mid-gray gradient, which undermines
  // the pure-contrast intent; borders carry the depth cue instead.
  'shadow-sm': 'none',
  'shadow-md': 'none',
  'shadow-lg': 'none',
  'shadow-popover': 'none',
  'shadow-dialog': 'none',
  'shadow-subdialog': 'none'
}

export const THEMES = { light, dark, 'high-contrast': highContrast } as const
export type ThemeName = keyof typeof THEMES

export function applyTheme(name: ThemeName): void {
  const resolved: ThemeName = name in THEMES ? name : 'light'
  const values = THEMES[resolved]
  const root = document.documentElement
  for (const [token, cssVar] of Object.entries(TOKEN_NAMES)) {
    root.style.setProperty(cssVar, values[token as TokenName])
  }
  root.setAttribute('data-theme', resolved)
}
