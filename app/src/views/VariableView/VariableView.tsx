// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AgGridReact, type CustomHeaderProps } from 'ag-grid-react'
import { ModuleRegistry } from 'ag-grid-community'
import { AllCommunityModule } from 'ag-grid-community'
import type {
  ColDef,
  CellValueChangedEvent,
  CellClickedEvent,
  ICellRendererParams,
  ValueFormatterParams,
  ValueSetterParams,
  RowDragEndEvent,
  CellContextMenuEvent,
  CellKeyDownEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
  GridApi,
  IRowNode,
  RowClassRules
} from 'ag-grid-community'
import { useDatasetStore } from '../../store/dataset-store'
import { useResolvedTheme } from '../../theme/ThemeProvider'
import { useSpecialMenuStore } from '../../store/special-menu-store'
import { RibbonButton, RibbonDivider } from '../../components/Ribbon/RibbonButton'
import { cx } from '../../lib/cx'
import type { Variable, MissingValues } from '@shared/data-types'
import { isValidVariableName, namesEqual } from '@shared/variable-name'
import { makeUniqueVarName } from '../../lib/data-grid'
import {
  ContextMenu,
  type ContextMenuEntry,
  PlusIcon,
  TrashIcon,
  TagCopyIcon,
  TagPasteIcon,
  TagIcon,
  SearchIcon,
  CopyIcon
} from '../../components/ContextMenu'
import { formatVariablesForCopy, type VariableCopyFormat } from '../../lib/variable-copy'
import { localizeError } from './localize-error'
import { CustomCellDropdown, type DropdownOption } from './CustomCellDropdown'
import { ValueLabelsModal } from './ValueLabelsModal'
import { MissingValuesModal } from './MissingValuesModal'

ModuleRegistry.registerModules([AllCommunityModule])

import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import styles from './VariableView.module.css'

export function VariableView() {
  const { t } = useTranslation(['dialogs', 'common'])

  const datasetId = useDatasetStore(s => s.datasetId)
  const variables = useDatasetStore(s => s.variables)
  const resolvedTheme = useResolvedTheme()
  const isDarkMode = resolvedTheme !== 'light'

  const [selectedCount, setSelectedCount] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Brief "N names copied" confirmation in the status bar.
  const [copiedCount, setCopiedCount] = useState<number | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    []
  )

  // Modals state
  const [activeValueLabelEdit, setActiveValueLabelEdit] = useState<{
    index: number
    variable: Variable
  } | null>(null)
  const [activeMissingEdit, setActiveMissingEdit] = useState<{
    index: number
    variable: Variable
  } | null>(null)

  const gridRef = useRef<AgGridReact<Variable>>(null)

  // ── Variable search ────────────────────────────────────────────
  // Jumps to matches instead of filtering them away: the grid's row order IS
  // the dataset's column order (row drag reorders it, `#` shows the position),
  // so hiding rows would make both meaningless. Typing scrolls to the first
  // hit and highlights every match; Enter / the arrow buttons walk the rest.
  const [searchQuery, setSearchQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)

  const matchIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return variables.reduce<number[]>((acc, v, idx) => {
      if (v.name.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)) {
        acc.push(idx)
      }
      return acc
    }, [])
  }, [variables, searchQuery])

  // Clamped while rendering rather than reset in an effect, so a shrinking
  // match list (a variable renamed or deleted with a search still active)
  // can't leave the cursor pointing past the end.
  const activeCursor =
    matchIndices.length === 0 ? 0 : Math.min(matchCursor, matchIndices.length - 1)
  const currentMatch = matchIndices[activeCursor]

  // A new query restarts at the first hit.
  const updateSearch = useCallback((value: string) => {
    setSearchQuery(value)
    setMatchCursor(0)
  }, [])

  const goToMatch = useCallback(
    (delta: number) => {
      const total = matchIndices.length
      if (total === 0) return
      setMatchCursor((activeCursor + delta + total) % total)
    },
    [matchIndices.length, activeCursor]
  )

  // Scroll to the active match and repaint the highlight rules.
  useEffect(() => {
    const api = gridRef.current?.api
    if (!api) return
    api.redrawRows()
    if (currentMatch !== undefined) api.ensureIndexVisible(currentMatch, 'middle')
  }, [matchIndices, currentMatch])

  // Built imperatively rather than as an object literal: CSS-module classes are
  // typed `string | undefined`, which is not a valid computed key.
  const rowClassRules = useMemo<RowClassRules<Variable>>(() => {
    const rules: RowClassRules<Variable> = {}
    const { searchMatch, searchCurrent } = styles
    if (searchMatch) {
      rules[searchMatch] = p => p.node.rowIndex !== null && matchIndices.includes(p.node.rowIndex)
    }
    if (searchCurrent) {
      rules[searchCurrent] = p => p.node.rowIndex !== null && p.node.rowIndex === currentMatch
    }
    return rules
  }, [matchIndices, currentMatch])

  // Custom cell values formatters
  const valuesFormatter = useCallback(
    (params: ValueFormatterParams<Variable>): string => {
      const val = params.value as Record<string, string> | null | undefined
      if (!val || Object.keys(val).length === 0) return t('dialogs:variableView.none')
      return Object.entries(val)
        .map(([k, v]) => `${k} = "${v}"`)
        .join(', ')
    },
    [t]
  )

  const missingFormatter = useCallback(
    (params: ValueFormatterParams<Variable>): string => {
      const val = params.value as MissingValues | null
      if (!val) return t('dialogs:variableView.none')
      if (val.type === 'discrete') {
        return val.discrete
          ? `${t('dialogs:variableView.discrete')}: ${val.discrete.join(', ')}`
          : t('dialogs:variableView.none')
      }
      const low = String(val.rangeLow ?? '-inf')
      const high = String(val.rangeHigh ?? 'inf')
      if (val.type === 'range') {
        return `${t('dialogs:variableView.range')}: [${low}, ${high}]`
      }
      // range+discrete (the only remaining variant)
      return `${t('dialogs:variableView.range')}: [${low}, ${high}] + ${String(val.discrete?.[0] ?? '')}`
    },
    [t]
  )

  // Icon component matching Ribbon tag/values icon
  const TagPlusIcon = () => (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.cellIcon}
    >
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l4.58-4.58c.94-.94.94-2.48 0-3.42L12 2Z" />
      <line x1="6" y1="7" x2="10" y2="7" />
      <line x1="8" y1="5" x2="8" y2="9" />
    </svg>
  )

  // Custom Cell Renderers containing "..." buttons
  const ValuesCellRenderer = useCallback(
    (params: ICellRendererParams<Variable>) => {
      const onClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (params.node.rowIndex === null || !params.data) return
        setActiveValueLabelEdit({ index: params.node.rowIndex, variable: params.data })
      }
      const formatted = params.valueFormatted ?? t('dialogs:variableView.none')
      return (
        <div className={styles.editCell}>
          <TagPlusIcon />
          <span className={styles.editCellText}>{formatted}</span>
          <button
            className={styles.editCellBtn}
            onClick={onClick}
            aria-label={t('dialogs:variableView.valueLabelsTitle')}
            title={t('dialogs:variableView.valueLabelsTitle')}
          >
            ...
          </button>
        </div>
      )
    },
    [t]
  )

  const MissingCellRenderer = useCallback(
    (params: ICellRendererParams<Variable>) => {
      const onClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (params.node.rowIndex === null || !params.data) return
        setActiveMissingEdit({ index: params.node.rowIndex, variable: params.data })
      }
      const formatted = params.valueFormatted ?? t('dialogs:variableView.none')
      return (
        <div className={styles.editCell}>
          <span className={styles.editCellText}>{formatted}</span>
          <button
            className={styles.editCellBtn}
            onClick={onClick}
            aria-label={t('dialogs:variableView.missingValuesTitle')}
            title={t('dialogs:variableView.missingValuesTitle')}
          >
            ...
          </button>
        </div>
      )
    },
    [t]
  )

  const NumericSpinnerCellRenderer = useCallback(
    (params: ICellRendererParams<Variable>) => {
      const isDecimals = params.column?.getId() === 'decimals'
      const value = (params.value as number | null) ?? 0

      const updateVal = async (newVal: number) => {
        if (newVal < 0) return
        const variable = params.data
        if (!variable) return
        if (isDecimals && variable.type !== 'numeric') return

        const rowIndex = params.node.rowIndex
        if (rowIndex === null || !datasetId) return

        const updates: Partial<Variable> = {}
        if (isDecimals) {
          updates.decimals = newVal
          updates.numfmtPattern = newVal > 0 ? `0.${'0'.repeat(newVal)}` : '0'
        } else {
          updates.width = newVal
        }

        try {
          await window.api.variable.update({
            datasetId,
            colId: variable.colId,
            updates
          })
          useDatasetStore.getState().updateVariable(rowIndex, updates)
          params.api.refreshCells({ rowNodes: [params.node], force: true })
        } catch (err) {
          console.error('Failed to update spinner value:', err)
        }
      }

      // Stop pointer/mousedown/click events natively so ag-grid never sees them
      // and we don't enter edit mode when clicking on the spinner buttons.
      const incBtnRef = (el: HTMLButtonElement | null) => {
        if (!el) return
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        el.setAttribute('aria-label', t('common:increaseValue' as never))
        el.onmousedown = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.onpointerdown = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.onmouseup = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.ondblclick = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.onclick = e => {
          e.stopPropagation()
          e.preventDefault()
          void updateVal(value + 1)
        }
      }

      const decBtnRef = (el: HTMLButtonElement | null) => {
        if (!el) return
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        el.setAttribute('aria-label', t('common:decreaseValue' as never))
        el.onmousedown = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.onpointerdown = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.onmouseup = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.ondblclick = e => {
          e.stopPropagation()
          e.preventDefault()
        }
        el.onclick = e => {
          e.stopPropagation()
          e.preventDefault()
          void updateVal(Math.max(0, value - 1))
        }
      }

      const isDisabled = isDecimals && params.data?.type !== 'numeric'

      return (
        <div className={styles.spinnerCell}>
          <span>{isDisabled ? '' : value}</span>
          {!isDisabled && (
            <div className={styles.spinnerBtns}>
              <button ref={incBtnRef} className={styles.spinnerBtn}>
                ▲
              </button>
              <button ref={decBtnRef} className={styles.spinnerBtn}>
                ▼
              </button>
            </div>
          )}
        </div>
      )
    },
    [datasetId, t]
  )

  const MeasureCellRenderer = useCallback(
    (params: ICellRendererParams<Variable>) => {
      const val = (params.value as 'nominal' | 'ordinal' | 'scale' | null) || 'scale'

      const onChange = async (newVal: 'nominal' | 'ordinal' | 'scale') => {
        const variable = params.data
        if (!variable || !datasetId) return
        const rowIndex = params.node.rowIndex
        if (rowIndex === null) return

        const updates = { measure: newVal }
        try {
          await window.api.variable.update({
            datasetId,
            colId: variable.colId,
            updates
          })
          params.node.setData({ ...variable, ...updates })
          useDatasetStore.getState().updateVariable(rowIndex, updates)
          params.api.refreshCells({ rowNodes: [params.node], force: true })
        } catch (err) {
          console.error('Failed to update measure:', err)
        }
      }

      const scaleIcon = (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={styles.iconInfo}
        >
          <rect x="1" y="4" width="14" height="8" rx="1" />
          <line x1="4" y1="4" x2="4" y2="8" />
          <line x1="7" y1="4" x2="7" y2="7" />
          <line x1="10" y1="4" x2="10" y2="8" />
          <line x1="13" y1="4" x2="13" y2="7" />
        </svg>
      )

      const ordinalIcon = (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="currentColor"
          className={styles.iconWarning}
        >
          <rect x="2" y="10" width="3" height="4" rx="0.5" />
          <rect x="6" y="6" width="3" height="8" rx="0.5" />
          <rect x="10" y="2" width="3" height="12" rx="0.5" />
        </svg>
      )

      const nominalIcon = (
        <svg viewBox="0 0 16 16" width="13" height="13">
          <circle cx="8" cy="5" r="3.5" fill="var(--color-error)" opacity="0.85" />
          <circle cx="5" cy="11" r="3.5" fill="var(--color-success)" opacity="0.85" />
          <circle cx="11" cy="11" r="3.5" fill="var(--color-info)" opacity="0.85" />
        </svg>
      )

      const options: DropdownOption<'nominal' | 'ordinal' | 'scale'>[] = [
        { value: 'scale', label: t('dialogs:variableView.scale'), icon: scaleIcon },
        { value: 'ordinal', label: t('dialogs:variableView.ordinal'), icon: ordinalIcon },
        { value: 'nominal', label: t('dialogs:variableView.nominal'), icon: nominalIcon }
      ]

      return <CustomCellDropdown value={val} options={options} onChange={onChange} />
    },
    [t, datasetId]
  )

  const TypeCellRenderer = useCallback(
    (params: ICellRendererParams<Variable>) => {
      const val = (params.value as 'numeric' | 'string' | 'date' | null) || 'numeric'

      const onChange = async (newVal: 'numeric' | 'string' | 'date') => {
        const variable = params.data
        if (!variable || !datasetId) return
        const rowIndex = params.node.rowIndex
        if (rowIndex === null) return

        const updates: Partial<Variable> = {
          type: newVal,
          numfmtPattern: newVal === 'numeric' ? '0.00' : undefined
        }
        if (newVal !== 'numeric') {
          updates.decimals = 0
        }

        try {
          await window.api.variable.update({
            datasetId,
            colId: variable.colId,
            updates
          })
          params.node.setData({ ...variable, ...updates })
          useDatasetStore.getState().updateVariable(rowIndex, updates)
          params.api.refreshCells({ rowNodes: [params.node], force: true })
        } catch (err) {
          console.error('Failed to update type:', err)
        }
      }

      const numericIcon = (
        <svg viewBox="0 0 20 14" width="16" height="12" className={styles.iconNoShrink}>
          <text
            x="0"
            y="11"
            fill="var(--color-success)"
            fontSize="11"
            fontWeight="700"
            fontFamily="var(--font-family-ui, system-ui, sans-serif)"
            letterSpacing="-0.5px"
          >
            123
          </text>
        </svg>
      )

      const stringIcon = (
        <svg viewBox="0 0 24 14" width="18" height="12" className={styles.iconNoShrink}>
          <text
            x="0"
            y="11"
            fill="var(--color-info)"
            fontSize="11"
            fontWeight="700"
            fontFamily="var(--font-family-ui, system-ui, sans-serif)"
            letterSpacing="-0.3px"
          >
            ABC
          </text>
        </svg>
      )

      const dateIcon = (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.iconWarning}
        >
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <line x1="5" y1="1" x2="5" y2="4" />
          <line x1="11" y1="1" x2="11" y2="4" />
          <line x1="2" y1="7" x2="14" y2="7" />
        </svg>
      )

      const options: DropdownOption<'numeric' | 'string' | 'date'>[] = [
        { value: 'numeric', label: t('dialogs:variableView.typeNumeric'), icon: numericIcon },
        { value: 'string', label: t('dialogs:variableView.typeString'), icon: stringIcon },
        { value: 'date', label: t('dialogs:variableView.typeDate'), icon: dateIcon }
      ]

      return <CustomCellDropdown value={val} options={options} onChange={onChange} />
    },
    [datasetId, t]
  )

  const RoleCellRenderer = useCallback(
    (params: ICellRendererParams<Variable>) => {
      type RoleType = 'input' | 'target' | 'both' | 'none' | 'partition' | 'split'
      const val = (params.value as RoleType | null) || 'both'

      const onChange = async (newVal: RoleType) => {
        const variable = params.data
        if (!variable || !datasetId) return
        const rowIndex = params.node.rowIndex
        if (rowIndex === null) return

        const updates = { role: newVal }
        try {
          await window.api.variable.update({
            datasetId,
            colId: variable.colId,
            updates
          })
          params.node.setData({ ...variable, ...updates })
          useDatasetStore.getState().updateVariable(rowIndex, updates)
          params.api.refreshCells({ rowNodes: [params.node], force: true })
        } catch (err) {
          console.error('Failed to update role:', err)
        }
      }

      const options: DropdownOption<RoleType>[] = [
        { value: 'input', label: t('dialogs:variableView.roleInput') },
        { value: 'target', label: t('dialogs:variableView.roleTarget') },
        { value: 'both', label: t('dialogs:variableView.roleBoth') },
        { value: 'none', label: t('dialogs:variableView.none') },
        { value: 'partition', label: t('dialogs:variableView.rolePartition') },
        { value: 'split', label: t('dialogs:variableView.roleSplit') }
      ]

      return <CustomCellDropdown value={val} options={options} onChange={onChange} />
    },
    [datasetId, t]
  )

  const onRowDragEnd = useCallback(
    async (event: RowDragEndEvent<Variable>) => {
      if (!datasetId) return
      const newVars: Variable[] = []
      event.api.forEachNode((node: IRowNode<Variable>) => {
        if (node.data) {
          newVars.push(node.data)
        }
      })

      useDatasetStore.getState().setVariables(newVars)

      try {
        const colIds = newVars.map(v => v.colId)
        await window.api.variable.reorder({ datasetId, colIds })
      } catch (err) {
        console.error('Failed to save reordered variables:', err)
        setErrorMessage(localizeError(err, t))
        const refreshed = await window.api.variable.getAll({ datasetId })
        useDatasetStore.getState().setVariables(refreshed)
      }
    },
    [datasetId, t]
  )

  // Grid Selection change callback
  const onSelectionChanged = useCallback(() => {
    const nodes = gridRef.current?.api.getSelectedNodes()
    setSelectedCount(nodes?.length ?? 0)
  }, [])

  const lastSelectedRowIndexRef = useRef<number | null>(null)
  // Row index where a drag-select over the Name column started (null = no drag).
  const dragAnchorRef = useRef<number | null>(null)

  useEffect(() => {
    const endDrag = () => {
      dragAnchorRef.current = null
    }
    document.addEventListener('mouseup', endDrag)
    return () => {
      document.removeEventListener('mouseup', endDrag)
    }
  }, [])

  /** Selected variables in grid (= dataset column) order. */
  const getSelectedVariables = useCallback((): Variable[] => {
    const nodes = gridRef.current?.api.getSelectedNodes() ?? []
    return [...nodes]
      .sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0))
      .map(n => n.data)
      .filter((v): v is Variable => Boolean(v))
  }, [])

  const copyVariables = useCallback((vars: Variable[], format: VariableCopyFormat) => {
    if (vars.length === 0) return
    void navigator.clipboard.writeText(formatVariablesForCopy(vars, format))
    setCopiedCount(vars.length)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      setCopiedCount(null)
    }, 2500)
  }, [])

  /** Select exactly rows [from..to] (inclusive, either order). */
  const selectRowRange = (api: GridApi<Variable>, from: number, to: number) => {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    api.forEachNode(node => {
      const i = node.rowIndex
      node.setSelected(i !== null && i >= start && i <= end, false)
    })
  }

  // Drag over the Name column selects a range of variables (like the '#'
  // column's shift-click, but with the mouse held down).
  const onCellMouseDown = useCallback((params: CellMouseDownEvent<Variable>) => {
    const evt = params.event as MouseEvent | null
    if (params.column.getId() !== 'name' || !evt || evt.button !== 0) return
    if (evt.shiftKey || evt.ctrlKey || evt.metaKey) return
    dragAnchorRef.current = params.rowIndex
  }, [])

  const onCellMouseOver = useCallback((params: CellMouseOverEvent<Variable>) => {
    const anchor = dragAnchorRef.current
    const evt = params.event as MouseEvent | null
    if (anchor === null || params.rowIndex === null || !evt || (evt.buttons & 1) === 0) return
    if (params.column.getId() !== 'name') return
    selectRowRange(params.api, anchor, params.rowIndex)
    lastSelectedRowIndexRef.current = anchor
  }, [])

  // Ctrl+C copies the selected variable names (or the focused cell's name /
  // value when nothing is selected); Ctrl+A selects every variable. Ignored
  // while a cell editor is open — the editor's own copy/select-all win there.
  const onCellKeyDown = useCallback(
    (params: CellKeyDownEvent<Variable>) => {
      const evt = params.event as KeyboardEvent | null
      if (!evt || !(evt.ctrlKey || evt.metaKey)) return
      if (params.api.getEditingCells().length > 0) return
      const key = evt.key.toLowerCase()
      if (key === 'a') {
        evt.preventDefault()
        params.api.selectAll()
        return
      }
      if (key !== 'c') return
      evt.preventDefault()
      const selected = getSelectedVariables()
      if (selected.length > 0) {
        copyVariables(selected, 'lines')
        return
      }
      const colId = params.column.getId()
      if ((colId === 'name' || colId === '#') && params.data) {
        copyVariables([params.data], 'lines')
      } else if (typeof params.value === 'string' || typeof params.value === 'number') {
        void navigator.clipboard.writeText(String(params.value))
      }
    },
    [getSelectedVariables, copyVariables]
  )

  // Cell click handler: clicking the '#' or Name column selects the variable
  // (Ctrl = toggle, Shift = range); clicking any other cell focuses/edits it
  // and clears the row selection.
  const onCellClicked = useCallback((params: CellClickedEvent<Variable>) => {
    const colId = params.column.getId()
    if (colId === '#' || colId === 'name') {
      const mouseEvt = params.event as MouseEvent | undefined
      const clickedIndex = params.node.rowIndex

      if (clickedIndex === null) return

      if (mouseEvt?.shiftKey && lastSelectedRowIndexRef.current !== null) {
        const start = Math.min(lastSelectedRowIndexRef.current, clickedIndex)
        const end = Math.max(lastSelectedRowIndexRef.current, clickedIndex)
        params.api.forEachNode(node => {
          if (node.rowIndex !== null && node.rowIndex >= start && node.rowIndex <= end) {
            node.setSelected(true, false)
          }
        })
      } else if (mouseEvt?.ctrlKey || mouseEvt?.metaKey) {
        params.node.setSelected(!params.node.isSelected(), false)
        lastSelectedRowIndexRef.current = clickedIndex
      } else {
        params.node.setSelected(true, true)
        lastSelectedRowIndexRef.current = clickedIndex
      }
    } else {
      params.api.deselectAll()
      lastSelectedRowIndexRef.current = null
    }
  }, [])

  // Name Value Setter
  const nameValueSetter = useCallback(
    (params: ValueSetterParams<Variable, string>): boolean => {
      const newValue = (params.newValue ?? '').trim()
      const oldVal = params.oldValue
      if (newValue === oldVal) return false

      if (!isValidVariableName(newValue)) {
        setErrorMessage(t('dialogs:variableView.invalidVarName'))
        return false
      }

      // Case-insensitive collision check (SPSS-style), excluding the row itself
      // so a pure casing change is allowed.
      const allVars = useDatasetStore.getState().variables
      const exists = allVars.some(
        (v, idx) => idx !== params.node?.rowIndex && namesEqual(v.name, newValue)
      )
      if (exists) {
        setErrorMessage(`${t('dialogs:variableView.varNameExists')}: ${newValue}`)
        return false
      }

      params.data.name = newValue
      return true
    },
    [t]
  )

  // Header Component for # column (click to select all / deselect all)
  const NumberHeaderRenderer = useCallback(
    (props: CustomHeaderProps<Variable>) => {
      const onHeaderClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        const api = props.api
        const total = api.getDisplayedRowCount()
        const selected = api.getSelectedNodes().length
        if (selected === total && total > 0) {
          api.deselectAll()
        } else {
          api.selectAll()
        }
      }

      return (
        <div
          className={styles.numberHeader}
          onClick={onHeaderClick}
          title={t('dialogs:variableView.selectAll')}
        >
          #
        </div>
      )
    },
    [t]
  )

  // AG Grid columns configuration
  const columnDefs = useMemo<ColDef<Variable>[]>(() => {
    return [
      {
        colId: '#',
        headerName: '#',
        headerComponent: NumberHeaderRenderer,
        valueGetter: 'node.rowIndex + 1',
        width: 55,
        maxWidth: 65,
        minWidth: 45,
        pinned: 'left',
        suppressMovable: true,
        lockPosition: 'left',
        resizable: false,
        sortable: false,
        editable: false,
        rowDrag: true,
        cellClass: styles.cellNumber
      },
      {
        headerName: t('dialogs:variableView.name'),
        headerTooltip: t('dialogs:variableView.selectHint'),
        field: 'name',
        tooltipField: 'name',
        editable: true,
        // Single click selects the variable (multi-select / copy); edit with a
        // double-click, F2 or by typing — the other columns keep click-to-edit.
        singleClickEdit: false,
        valueSetter: nameValueSetter,
        flex: 1.8,
        minWidth: 140,
        cellClass: styles.cellEllipsis
      },
      {
        headerName: t('dialogs:variableView.type'),
        field: 'type',
        editable: false,
        cellRenderer: TypeCellRenderer,
        cellClass: styles.cellFlush,
        flex: 1,
        minWidth: 110
      },
      {
        headerName: t('dialogs:variableView.width'),
        field: 'width',
        editable: true,
        cellRenderer: NumericSpinnerCellRenderer,
        valueParser: params => Number(params.newValue) || 8,
        flex: 0.7,
        minWidth: 75,
        maxWidth: 90
      },
      {
        headerName: t('dialogs:variableView.decimals'),
        field: 'decimals',
        editable: params => params.data?.type === 'numeric',
        cellRenderer: NumericSpinnerCellRenderer,
        valueParser: params => Number(params.newValue) || 0,
        valueFormatter: params =>
          params.data?.type === 'numeric' ? String(params.value ?? '') : '',
        flex: 0.7,
        minWidth: 75,
        maxWidth: 90
      },
      {
        headerName: t('dialogs:variableView.label'),
        field: 'label',
        tooltipField: 'label',
        editable: true,
        flex: 2.2,
        minWidth: 180,
        cellClass: styles.cellEllipsis
      },
      {
        headerName: t('dialogs:variableView.values'),
        field: 'valueLabels',
        cellRenderer: ValuesCellRenderer,
        valueFormatter: valuesFormatter,
        flex: 1.4,
        minWidth: 130
      },
      {
        headerName: t('dialogs:variableView.missing'),
        field: 'missing',
        cellRenderer: MissingCellRenderer,
        valueFormatter: missingFormatter,
        flex: 0.9,
        minWidth: 90,
        maxWidth: 110
      },
      {
        headerName: t('dialogs:variableView.measure'),
        field: 'measure',
        editable: false,
        cellRenderer: MeasureCellRenderer,
        cellClass: styles.cellFlush,
        flex: 1,
        minWidth: 110
      },
      {
        headerName: t('dialogs:variableView.role'),
        field: 'role',
        editable: false,
        cellRenderer: RoleCellRenderer,
        cellClass: styles.cellFlush,
        flex: 0.8,
        minWidth: 85,
        maxWidth: 105
      }
    ]
  }, [
    t,
    nameValueSetter,
    NumberHeaderRenderer,
    ValuesCellRenderer,
    MissingCellRenderer,
    NumericSpinnerCellRenderer,
    MeasureCellRenderer,
    TypeCellRenderer,
    RoleCellRenderer,
    valuesFormatter,
    missingFormatter
  ])

  // Sync edits back to database and Zustand
  const onCellValueChanged = useCallback(
    async (params: CellValueChangedEvent<Variable>) => {
      const colField = params.column.getId()
      const rowIndex = params.node.rowIndex
      if (rowIndex === null || !datasetId) return

      const variable = params.data
      const updates: Partial<Variable> = {}

      if (colField === 'name') updates.name = variable.name
      else if (colField === 'type') {
        updates.type = variable.type
        updates.numfmtPattern = variable.type === 'numeric' ? '0.00' : undefined
        if (variable.type !== 'numeric') {
          updates.decimals = 0
        }
      } else if (colField === 'width') updates.width = variable.width
      else if (colField === 'decimals') {
        updates.decimals = variable.decimals
        updates.numfmtPattern = updates.decimals > 0 ? `0.${'0'.repeat(updates.decimals)}` : '0'
      } else if (colField === 'label') updates.label = variable.label
      else if (colField === 'measure') updates.measure = variable.measure
      else if (colField === 'role') updates.role = variable.role

      try {
        await window.api.variable.update({
          datasetId,
          colId: variable.colId,
          updates
        })
        useDatasetStore.getState().updateVariable(rowIndex, updates)
      } catch (err) {
        console.error('Failed to update metadata cell:', err)
        setErrorMessage(localizeError(err, t))
        const restored = await window.api.variable.getAll({ datasetId })
        useDatasetStore.getState().setVariables(restored)
      }
    },
    [datasetId, t]
  )

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    variable: Variable
    rowIndex: number
  } | null>(null)

  // Add Variable handler
  const handleAddVariable = useCallback(
    async (atIndex?: number) => {
      if (!datasetId) return

      const existingNames = new Set(variables.map(v => v.name))
      const name = makeUniqueVarName(existingNames)

      const newVar: Variable = {
        colId: '', // Will be assigned by backend
        name,
        type: 'numeric',
        width: 8,
        decimals: 2,
        label: '',
        valueLabels: {},
        missing: null,
        columns: 8,
        align: 'right',
        measure: 'scale',
        role: 'none',
        numfmtPattern: '0.00'
      }

      try {
        await window.api.variable.add({
          datasetId,
          variable: newVar,
          index: atIndex
        })
        const refreshed = await window.api.variable.getAll({ datasetId })
        useDatasetStore.getState().setVariables(refreshed)
      } catch (err) {
        console.error('Failed to add variable:', err)
        setErrorMessage(localizeError(err, t))
      }
    },
    [datasetId, variables, t]
  )

  // Delete Variable handler (supports multi-selection delete)
  const handleDeleteVariable = useCallback(async () => {
    if (!datasetId) return

    const nodes = gridRef.current?.api.getSelectedNodes()
    if (!nodes || nodes.length === 0) return

    const targetVars = nodes.map(n => n.data).filter((v): v is Variable => Boolean(v))
    if (targetVars.length === 0) return
    // Same rule as Data View: a dataset needs at least one variable (Main
    // enforces it too — zero columns breaks every data read).
    if (targetVars.length >= useDatasetStore.getState().variables.length) {
      setErrorMessage(t('common:dataset.cannotDeleteLastColumn'))
      return
    }

    try {
      // One call = one undo step for the whole selection.
      await window.api.variable.deleteMany({
        datasetId,
        colIds: targetVars.map(v => v.colId)
      })
      const refreshed = await window.api.variable.getAll({ datasetId })
      useDatasetStore.getState().setVariables(refreshed)
      setSelectedCount(0)
    } catch (err) {
      console.error('Failed to delete variable(s):', err)
      setErrorMessage(localizeError(err, t))
    }
  }, [datasetId, t])

  // Context menu actions
  const onCellContextMenu = useCallback((params: CellContextMenuEvent<Variable>) => {
    const mouseEvt = params.event as MouseEvent | null
    if (mouseEvt) {
      mouseEvt.preventDefault()
    }
    if (!params.data || params.rowIndex === null) return

    // `params.node` is non-nullable in AG Grid's typings — no guard needed.
    if (!params.node.isSelected()) {
      params.node.setSelected(true, true)
    }

    setContextMenu({
      x: mouseEvt?.clientX ?? 100,
      y: mouseEvt?.clientY ?? 100,
      variable: params.data,
      rowIndex: params.rowIndex
    })
  }, [])

  // These three feed the context-menu useMemo below, so they must be stable —
  // plain function declarations changed identity every render and made the
  // memo useless (react-hooks/exhaustive-deps, denetim raporu §4.4).
  const handleInsertAt = useCallback(
    (rowIndex: number) => {
      void handleAddVariable(rowIndex)
    },
    [handleAddVariable]
  )

  const handleDeleteAt = useCallback(
    (variable: Variable) => {
      void (async () => {
        if (!datasetId) return
        if (useDatasetStore.getState().variables.length <= 1) {
          setErrorMessage(t('common:dataset.cannotDeleteLastColumn'))
          return
        }
        try {
          await window.api.variable.delete({ datasetId, colId: variable.colId })
          const refreshed = await window.api.variable.getAll({ datasetId })
          useDatasetStore.getState().setVariables(refreshed)
          setSelectedCount(0)
        } catch (err) {
          console.error('Failed to delete variable:', err)
          setErrorMessage(localizeError(err, t))
        }
      })()
    },
    [datasetId, t]
  )

  const handleCopyValueLabels = (variable: Variable) => {
    useSpecialMenuStore.getState().setLabelClipboard({
      sourceColId: variable.colId,
      sourceName: variable.name,
      valueLabels: { ...variable.valueLabels }
    })
  }

  const handlePasteValueLabels = useCallback(
    (variable: Variable) => {
      const clip = useSpecialMenuStore.getState().labelClipboard
      if (!clip || !datasetId) return
      void (async () => {
        try {
          const updates = { valueLabels: { ...clip.valueLabels } }
          await window.api.variable.update({
            datasetId,
            colId: variable.colId,
            updates
          })
          const varIdx = variables.findIndex(v => v.colId === variable.colId)
          if (varIdx !== -1) {
            useDatasetStore.getState().updateVariable(varIdx, updates)
          }
          const refreshed = await window.api.variable.getAll({ datasetId })
          useDatasetStore.getState().setVariables(refreshed)
        } catch (err) {
          console.error('Failed to paste value labels:', err)
          setErrorMessage(localizeError(err, t))
        }
      })()
    },
    [datasetId, variables, t]
  )

  const labelClipboard = useSpecialMenuStore(s => s.labelClipboard)

  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!contextMenu) return []
    return [
      {
        key: 'addVar',
        label: t('dialogs:variableView.addVar'),
        icon: <PlusIcon />,
        onClick: () => {
          handleInsertAt(contextMenu.rowIndex)
        }
      },
      {
        key: 'deleteVar',
        label: t('dialogs:variableView.deleteVar'),
        icon: <TrashIcon />,
        danger: true,
        onClick: () => {
          handleDeleteAt(contextMenu.variable)
        }
      },
      'separator',
      // Name copies act on the whole selection (right-click selects the row
      // first when it wasn't selected — see onCellContextMenu).
      {
        key: 'copyNames',
        label: t('dialogs:variableView.copyNames'),
        icon: <CopyIcon />,
        onClick: () => {
          copyVariables(getSelectedVariables(), 'lines')
        }
      },
      {
        key: 'copyNamesInline',
        label: t('dialogs:variableView.copyNamesInline'),
        icon: <CopyIcon />,
        onClick: () => {
          copyVariables(getSelectedVariables(), 'inline')
        }
      },
      {
        key: 'copyWithLabels',
        label: t('dialogs:variableView.copyWithLabels'),
        icon: <TagIcon />,
        onClick: () => {
          copyVariables(getSelectedVariables(), 'labels')
        }
      },
      'separator',
      {
        key: 'copyValueLabels',
        label: t('dialogs:variableView.copyValueLabels'),
        icon: <TagCopyIcon />,
        onClick: () => {
          handleCopyValueLabels(contextMenu.variable)
        }
      },
      {
        key: 'pasteValueLabels',
        label: t('dialogs:variableView.pasteValueLabels'),
        icon: <TagPasteIcon />,
        disabled: !labelClipboard,
        onClick: () => {
          handlePasteValueLabels(contextMenu.variable)
        }
      }
    ]
  }, [
    contextMenu,
    labelClipboard,
    t,
    handleInsertAt,
    handleDeleteAt,
    handlePasteValueLabels,
    copyVariables,
    getSelectedVariables
  ])

  // Grid wrapper CSS
  const themeClass = isDarkMode ? 'ag-theme-quartz-dark' : 'ag-theme-quartz'

  if (!datasetId) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p>{t('dialogs:variableView.noActive')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <RibbonButton
          icon="＋"
          label={t('dialogs:variableView.addVar')}
          title={t('dialogs:variableView.addVar')}
          variant="primary"
          onClick={() => {
            void handleAddVariable()
          }}
        />
        <RibbonDivider />
        <RibbonButton
          icon="🗑"
          label={t('dialogs:variableView.deleteVar')}
          title={t('dialogs:variableView.deleteVar')}
          variant="danger"
          disabled={selectedCount === 0}
          onClick={() => {
            void handleDeleteVariable()
          }}
        />
        <RibbonDivider />

        <div className={styles.searchBox}>
          <SearchIcon size={14} />
          <input
            className={styles.searchInput}
            type="text"
            value={searchQuery}
            placeholder={t('dialogs:variableView.searchPlaceholder')}
            aria-label={t('dialogs:variableView.searchPlaceholder')}
            onChange={e => {
              updateSearch(e.target.value)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                goToMatch(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                updateSearch('')
              }
            }}
          />
          {searchQuery !== '' && (
            <>
              <span className={styles.searchCount}>
                {matchIndices.length === 0
                  ? t('dialogs:variableView.searchNoMatch')
                  : `${String(activeCursor + 1)}/${String(matchIndices.length)}`}
              </span>
              <button
                className={styles.searchNavBtn}
                disabled={matchIndices.length === 0}
                onClick={() => {
                  goToMatch(-1)
                }}
                aria-label={t('dialogs:variableView.searchPrev')}
                title={t('dialogs:variableView.searchPrev')}
              >
                ‹
              </button>
              <button
                className={styles.searchNavBtn}
                disabled={matchIndices.length === 0}
                onClick={() => {
                  goToMatch(1)
                }}
                aria-label={t('dialogs:variableView.searchNext')}
                title={t('dialogs:variableView.searchNext')}
              >
                ›
              </button>
              <button
                className={styles.searchNavBtn}
                onClick={() => {
                  updateSearch('')
                }}
                aria-label={t('common:common.clear')}
                title={t('common:common.clear')}
              >
                ×
              </button>
            </>
          )}
        </div>

        <span className={styles.title}>{t('dialogs:variableView.title')}</span>
      </div>

      {errorMessage && (
        <div role="alert" className={styles.errorBar}>
          <span className="flex-1">⚠ {errorMessage}</span>
          <button
            className={styles.errorDismiss}
            onClick={() => {
              setErrorMessage(null)
            }}
            aria-label={t('dialogs:variableView.dismissError')}
            title={t('dialogs:variableView.dismissError')}
          >
            ×
          </button>
        </div>
      )}

      <div className={styles.gridContainer}>
        <div className={cx(themeClass, styles.grid)}>
          <AgGridReact<Variable>
            ref={gridRef}
            rowData={variables}
            getRowId={params => params.data.colId || params.data.name}
            columnDefs={columnDefs}
            rowClassRules={rowClassRules}
            rowSelection={{ mode: 'multiRow', enableClickSelection: false }}
            rowDragMultiRow={true}
            theme="legacy"
            onSelectionChanged={onSelectionChanged}
            onCellClicked={onCellClicked}
            onCellMouseDown={onCellMouseDown}
            onCellMouseOver={onCellMouseOver}
            onCellKeyDown={onCellKeyDown}
            onCellValueChanged={e => void onCellValueChanged(e)}
            onCellContextMenu={onCellContextMenu}
            rowDragManaged={true}
            onRowDragEnd={e => void onRowDragEnd(e)}
            rowHeight={40}
            headerHeight={38}
            defaultColDef={{
              // Click-to-edit everywhere except Name (see its colDef).
              singleClickEdit: true,
              sortable: false,
              filter: false,
              resizable: true,
              flex: 1,
              minWidth: 90
            }}
          />
        </div>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => {
            setContextMenu(null)
          }}
        />
      )}

      <div className={styles.statusBar}>
        <span>{t('dialogs:variableView.variableCount', { count: variables.length })}</span>
        {selectedCount > 0 && (
          <span>{t('dialogs:variableView.selectedCount', { count: selectedCount })}</span>
        )}
        {copiedCount !== null && (
          <span className={styles.copiedNote} role="status">
            {t('dialogs:variableView.copied', { count: copiedCount })}
          </span>
        )}
      </div>

      {/* ── Value Labels Editor Modal ────────────────────────────── */}
      {activeValueLabelEdit && (
        <ValueLabelsModal
          variable={activeValueLabelEdit.variable}
          variableIndex={activeValueLabelEdit.index}
          datasetId={datasetId}
          t={t}
          onClose={() => {
            setActiveValueLabelEdit(null)
          }}
        />
      )}

      {/* ── Missing Values Editor Modal ───────────────────────────── */}
      {activeMissingEdit && (
        <MissingValuesModal
          variable={activeMissingEdit.variable}
          variableIndex={activeMissingEdit.index}
          datasetId={datasetId}
          t={t}
          onClose={() => {
            setActiveMissingEdit(null)
          }}
        />
      )}
    </div>
  )
}
