// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Single source of truth for user-customizable keyboard shortcuts.
 *
 * Menu accelerators that are OS text-editing roles (`role: 'cut'/'copy'/
 * 'paste'`), or that are fixed for the same reason without actually being a
 * role (Undo/Redo — see the Edit menu comment in menu-builder.ts for why
 * those stay `click:`-based instead of `role: 'undo'/'redo'`), are
 * intentionally excluded — these text-field-adjacent shortcuts should stay
 * fixed, remapping them would be confusing more than useful.
 *
 * `menuKey` points at the existing `menu.json` i18n key (same string already
 * shown in the native menu) so shortcut labels never need a second
 * translation entry (CLAUDE.md §6 DRY rule, applied to reuse not duplication).
 */
export interface ShortcutDef {
  id: string
  menuKey: string
  default: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'fileNew', menuKey: 'menu:file.newDataset', default: 'CmdOrCtrl+N' },
  { id: 'fileOpen', menuKey: 'menu:file.openDataFile', default: 'CmdOrCtrl+O' },
  { id: 'fileSave', menuKey: 'menu:file.save', default: 'CmdOrCtrl+S' },
  { id: 'fileSaveAs', menuKey: 'menu:file.saveAs', default: 'CmdOrCtrl+Shift+S' },
  { id: 'filePrint', menuKey: 'menu:file.print', default: 'CmdOrCtrl+P' },
  { id: 'fileExit', menuKey: 'menu:file.exit', default: 'Alt+F4' },
  { id: 'editFind', menuKey: 'menu:edit.find', default: 'CmdOrCtrl+F' },
  { id: 'editFindReplace', menuKey: 'menu:edit.findReplace', default: 'CmdOrCtrl+H' },
  { id: 'editPreferences', menuKey: 'menu:edit.preferences', default: 'CmdOrCtrl+,' },
  { id: 'viewDataView', menuKey: 'menu:view.dataView', default: 'CmdOrCtrl+1' },
  { id: 'viewVariableView', menuKey: 'menu:view.variableView', default: 'CmdOrCtrl+2' },
  { id: 'viewOutputView', menuKey: 'menu:view.outputView', default: 'CmdOrCtrl+3' },
  { id: 'viewNormalityView', menuKey: 'menu:view.normalityView', default: 'CmdOrCtrl+4' },
  { id: 'viewTerminalView', menuKey: 'menu:view.terminalView', default: 'CmdOrCtrl+5' },
  { id: 'viewValueLabels', menuKey: 'menu:view.valueLabels', default: 'CmdOrCtrl+L' },
  { id: 'viewDevTools', menuKey: 'menu:view.devTools', default: 'F12' },
  {
    id: 'transformCompute',
    menuKey: 'menu:transform.computeVariable',
    default: 'CmdOrCtrl+Shift+E'
  },
  { id: 'helpUserGuide', menuKey: 'menu:help.userGuide', default: 'F1' }
]

export const DEFAULT_SHORTCUTS: Record<string, string> = Object.fromEntries(
  SHORTCUT_DEFS.map(d => [d.id, d.default])
)

/** Merges stored overrides on top of the defaults; an empty-string override
 * means "reset to default" (settings-handler.ts has no per-key delete, so
 * resetting a single shortcut just writes back an empty string instead). */
export function resolveShortcuts(overrides: Record<string, string>): Record<string, string> {
  const result = { ...DEFAULT_SHORTCUTS }
  for (const [id, accelerator] of Object.entries(overrides)) {
    if (accelerator) result[id] = accelerator
  }
  return result
}
