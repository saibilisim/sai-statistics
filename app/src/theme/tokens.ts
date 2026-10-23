// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
// Design token definitions — semantic names, technology-agnostic
// Values are set per-theme in themes.ts

export const TOKEN_NAMES = {
  // Background
  'color-bg-base': '--color-bg-base',
  'color-bg-surface': '--color-bg-surface',
  'color-bg-overlay': '--color-bg-overlay',
  'color-bg-hover': '--color-bg-hover',
  'color-bg-selected': '--color-bg-selected',
  'color-bg-header': '--color-bg-header',
  'color-bg-toolbar': '--color-bg-toolbar',
  'color-bg-statusbar': '--color-bg-statusbar',
  'color-bg-tabbar': '--color-bg-tabbar',

  // Text
  'color-text-primary': '--color-text-primary',
  'color-text-secondary': '--color-text-secondary',
  'color-text-disabled': '--color-text-disabled',
  'color-text-inverse': '--color-text-inverse',
  'color-text-link': '--color-text-link',
  'color-text-statusbar': '--color-text-statusbar',

  // Border
  'color-border': '--color-border',
  'color-border-strong': '--color-border-strong',
  'color-border-focus': '--color-border-focus',

  // Brand / accent
  'color-accent': '--color-accent',
  'color-accent-hover': '--color-accent-hover',
  'color-accent-text': '--color-accent-text',

  // Semantic
  'color-success': '--color-success',
  'color-warning': '--color-warning',
  'color-error': '--color-error',
  'color-info': '--color-info',
  'color-error-bg': '--color-error-bg',
  'color-error-border': '--color-error-border',

  // Alternate row / focus-crosshair tints (DataView grid)
  'color-bg-alt': '--color-bg-alt',
  'color-bg-focus-cross': '--color-bg-focus-cross',

  // Modal scrim + popover backdrop blur
  'color-scrim': '--color-scrim',
  'blur-modal': '--blur-modal',

  // Code / syntax highlighting (AI markdown code blocks, syntax proposals)
  'color-bg-code': '--color-bg-code',
  'color-code-keyword': '--color-code-keyword',
  'color-code-string': '--color-code-string',
  'color-code-comment': '--color-code-comment',
  'color-code-number': '--color-code-number',
  'color-code-function': '--color-code-function',
  'color-code-operator': '--color-code-operator',

  // p-value significance highlighting
  'color-sig-p05': '--color-sig-p05', // p < .05
  'color-sig-p01': '--color-sig-p01', // p < .01
  'color-sig-p001': '--color-sig-p001', // p < .001

  // Spacing
  'space-xs': '--space-xs',
  'space-sm': '--space-sm',
  'space-md': '--space-md',
  'space-lg': '--space-lg',
  'space-xl': '--space-xl',

  // Typography
  'font-family-ui': '--font-family-ui',
  'font-family-mono': '--font-family-mono',
  'font-size-xs': '--font-size-xs',
  'font-size-sm': '--font-size-sm',
  'font-size-body': '--font-size-body',
  'font-size-lg': '--font-size-lg',
  'font-size-xl': '--font-size-xl',
  'font-weight-normal': '--font-weight-normal',
  'font-weight-medium': '--font-weight-medium',
  'font-weight-semibold': '--font-weight-semibold',
  'font-weight-bold': '--font-weight-bold',
  'line-height-tight': '--line-height-tight',
  'line-height-normal': '--line-height-normal',
  'line-height-relaxed': '--line-height-relaxed',

  // Radius
  'radius-sm': '--radius-sm',
  'radius-md': '--radius-md',
  'radius-lg': '--radius-lg',
  'radius-xl': '--radius-xl',
  'radius-dialog': '--radius-dialog',
  'radius-subdialog': '--radius-subdialog',
  'radius-control': '--radius-control',
  'radius-field': '--radius-field',

  // Shadow
  'shadow-sm': '--shadow-sm',
  'shadow-md': '--shadow-md',
  'shadow-lg': '--shadow-lg',
  'shadow-popover': '--shadow-popover',
  'shadow-dialog': '--shadow-dialog',
  'shadow-subdialog': '--shadow-subdialog',

  // Dialog frame spacing (header / body / footer)
  'dialog-pad-x': '--dialog-pad-x',
  'dialog-header-pad-y': '--dialog-header-pad-y',
  'dialog-body-pad-y': '--dialog-body-pad-y',
  'dialog-footer-pad-y': '--dialog-footer-pad-y',
  'list-item-pad': '--list-item-pad',
  'picker-list-min': '--picker-list-min',
  'picker-list-max': '--picker-list-max',
  'form-label-width': '--form-label-width',
  'form-label-width-lg': '--form-label-width-lg',
  'field-width-xs': '--field-width-xs',
  'field-width-sm': '--field-width-sm',
  'field-width-md': '--field-width-md',
  'field-width-lg': '--field-width-lg',
  'field-width-select': '--field-width-select',
  'icon-btn-size': '--icon-btn-size',
  'btn-pad-y': '--btn-pad-y',
  'view-toolbar-height': '--view-toolbar-height',
  'view-statusbar-height': '--view-statusbar-height',
  'menu-item-pad': '--menu-item-pad',
  'search-width-min': '--search-width-min',
  'search-width-max': '--search-width-max',
  'accent-bar-width': '--accent-bar-width',
  'terminal-side-width': '--terminal-side-width',
  'terminal-plot-width': '--terminal-plot-width',
  'terminal-menu-width': '--terminal-menu-width',
  'btn-min-width': '--btn-min-width',
  'font-size-close': '--font-size-close',

  // Borders & controls
  'border-width-thin': '--border-width-thin',
  'border-width-thick': '--border-width-thick',
  'control-height-sm': '--control-height-sm',
  'control-height-md': '--control-height-md',
  'control-height-lg': '--control-height-lg',

  // Focus ring
  'focus-ring-width': '--focus-ring-width',
  'focus-ring-offset': '--focus-ring-offset',
  // Soft accent halo around a focused/active field (lists, inputs, target zones)
  'focus-halo': '--focus-halo',

  // Disabled state
  'opacity-disabled': '--opacity-disabled',

  // Motion
  'duration-fast': '--duration-fast',
  'duration-base': '--duration-base',
  'duration-slow': '--duration-slow',
  'easing-standard': '--easing-standard',

  // Z-index scale
  'z-dropdown': '--z-dropdown',
  'z-sticky': '--z-sticky',
  'z-modal-scrim': '--z-modal-scrim',
  'z-popover': '--z-popover',
  'z-context-menu': '--z-context-menu',
  'z-tooltip': '--z-tooltip',

  // Layout
  'toolbar-height': '--toolbar-height',
  'tabbar-height': '--tabbar-height',
  'statusbar-height': '--statusbar-height',
  'dialog-width-xs': '--dialog-width-xs',
  'dialog-width-confirm': '--dialog-width-confirm',
  'dialog-width-sm': '--dialog-width-sm',
  'dialog-width-md': '--dialog-width-md',
  'dialog-width-lg': '--dialog-width-lg',
  'dialog-width-analysis-min': '--dialog-width-analysis-min',
  'dialog-width-analysis': '--dialog-width-analysis',
  'dialog-width-analysis-max': '--dialog-width-analysis-max',
  'subdialog-width-min': '--subdialog-width-min',
  'subdialog-width-max': '--subdialog-width-max'
} as const

export type TokenName = keyof typeof TOKEN_NAMES
export type CSSVar = (typeof TOKEN_NAMES)[TokenName]
