// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AnalysisDialogShell — SPSS-style analysis dialog container.
 *
 * Renders the standard SPSS layout:
 *   [Source variable list] [► ◄] [Target fields] [Side buttons]
 *   [Extra content]
 *   [OK | Paste R | Reset | Cancel | Help]
 *
 * Each analysis passes `fieldDefs` (target zones), `sideButtons` (sub-dialogs),
 * and `generateRCode` for the Paste R button. The shell manages selection state
 * and variable transfer logic.
 */

import { useState, useId, useRef, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetStore } from '../../store/dataset-store'
import { useTerminalStore } from '../../store/terminal-store'
import { useUIStore } from '../../store/ui-store'
import { useAnalysisHistoryStore } from '../../store/analysis-history-store'
import { setPendingRunMeta } from '../../store/pending-run-meta'
import type { MeasureLevel, Variable } from '@shared/data-types'
import { cx } from '../../lib/cx'
import { useDialogKeyboard } from '../../lib/use-dialog-keyboard'
import { SearchIcon } from '../ContextMenu'
import styles from './AnalysisDialogShell.module.css'

// ─────────────────────────────────────────────────────────────
//  Public types
// ─────────────────────────────────────────────────────────────

export interface FieldDef {
  key: string
  labelKey: string
  /** If true, zone accepts only one variable (replaced on transfer). Default: multi */
  single?: boolean
  /** Optional filter — only matching variables can be dropped in this field */
  filter?: (v: Variable) => boolean
  /**
   * Measure (M3): a non-blocking sort hint, not a restriction — SPSS itself
   * doesn't forbid picking a non-matching-measure variable in most dialogs
   * (e.g. an ordinal Likert score is routinely used as a t-test's test
   * variable), so while this field is active the source list is only
   * reordered to surface the recommended variables first. Every variable
   * stays visible and selectable.
   */
  sortMeasure?: MeasureLevel
  /**
   * Role (M4): pre-fill this field with variables whose Variable View Role
   * matches ('both' counts as a match for either hint) when the dialog first
   * opens. A convenience default only — never enforced afterwards, the user
   * can freely add/remove variables via the normal transfer controls.
   * 'input' is the default role of every variable, so that hint applies only
   * once some variable has another role; don't put it on a single-variable
   * grouping field (it would just pick the first variable).
   */
  roleHint?: 'target' | 'input'
}

export interface SideButtonDef {
  width?: string
  key: string
  labelKey: string
  titleKey: string
  /**
   * Render the content of the sub-dialog. `assignments` is the live field →
   * variables map, for panels whose options are per-variable rather than
   * global — Cox Regression's "Categorical…" has to list the covariates the
   * user has actually transferred, and its plot options offer only those.
   * Panels that don't need it simply ignore the argument.
   */
  renderContent: (props: {
    onClose: () => void
    assignments: Record<string, Variable[]>
  }) => ReactNode
  /**
   * Grey the button out for the current assignments. SPSS disables a
   * sub-dialog whose options would be meaningless before a field is filled —
   * OLAP Cubes' Statistics and Options stay dead until a grouping variable is
   * transferred, since without one the procedure cannot run at all.
   */
  disabled?: (assignments: Record<string, Variable[]>) => boolean
}

export interface AnalysisDialogShellProps {
  /** Dialog Recall (SPSS-style): the same id passed as `run()`'s payload.analysisId
   *  — lets the shell look up this dialog's own last field assignments on
   *  mount and pre-fill them (both from the Ribbon's "Recall" list and from
   *  a plain menu reopen; there's no separate code path for either). Omit
   *  for dialogs that don't call useRunAnalysis (e.g. PowerDialog, which
   *  doesn't use this shell at all). */
  analysisId?: string
  titleKey: string
  fieldDefs: FieldDef[]
  sideButtons?: SideButtonDef[]
  extraContent?: ReactNode
  generateRCode?: (assignments: Record<string, Variable[]>) => string | null
  /** Emit an SPSS-syntax line for the "Paste Syntax" button (→ Terminal tab). */
  generateSyntax?: (assignments: Record<string, Variable[]>) => string | null
  /** True when OK should be enabled */
  canSubmit: (assignments: Record<string, Variable[]>) => boolean
  onSubmit: (assignments: Record<string, Variable[]>) => void
  onCancel: () => void
  onReset?: () => void
}

// ─────────────────────────────────────────────────────────────
//  Measure icon
// ─────────────────────────────────────────────────────────────

function MeasureIcon({ measure }: { measure: Variable['measure'] }) {
  if (measure === 'scale') {
    return (
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="none"
        stroke="var(--color-info)"
        strokeWidth="1.5"
        aria-hidden
        className={styles.measureIcon}
      >
        <rect x="1" y="4" width="14" height="8" rx="1" />
        <line x1="4" y1="4" x2="4" y2="8" />
        <line x1="7" y1="4" x2="7" y2="7" />
        <line x1="10" y1="4" x2="10" y2="8" />
        <line x1="13" y1="4" x2="13" y2="7" />
      </svg>
    )
  }
  if (measure === 'ordinal') {
    return (
      <svg
        viewBox="0 0 16 16"
        width="15"
        height="15"
        fill="var(--color-warning)"
        aria-hidden
        className={styles.measureIcon}
      >
        <rect x="2" y="10" width="3" height="4" rx="0.5" />
        <rect x="6" y="6" width="3" height="8" rx="0.5" />
        <rect x="10" y="2" width="3" height="12" rx="0.5" />
      </svg>
    )
  }
  // nominal
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden className={styles.measureIcon}>
      <circle cx="8" cy="5" r="3.5" fill="var(--color-error)" opacity="0.9" />
      <circle cx="5" cy="11" r="3.5" fill="var(--color-success)" opacity="0.9" />
      <circle cx="11" cy="11" r="3.5" fill="var(--color-info)" opacity="0.9" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────
//  Source list search / measure filter
// ─────────────────────────────────────────────────────────────

type MeasureFilter = MeasureLevel | 'all'

/** Segmented filter above the source list. 'all' shows its label; the three
 *  measure chips are icon-only (the source panel is ~200px wide) and carry
 *  their label as title/aria-label instead. */
// `as const` rather than a `{ value; labelKey: string }[]` annotation: it makes
// this a non-empty tuple, so `MEASURE_FILTERS[0]` — the fallback when the
// current value matches nothing — is known to exist under
// noUncheckedIndexedAccess, and it narrows `labelKey` to its literal keys so
// t() accepts them without a cast.
const MEASURE_FILTERS = [
  { value: 'all', labelKey: 'analysis:shell.filterAll' },
  { value: 'scale', labelKey: 'analysis:shell.filterScale' },
  { value: 'ordinal', labelKey: 'analysis:shell.filterOrdinal' },
  { value: 'nominal', labelKey: 'analysis:shell.filterNominal' }
] as const satisfies readonly { value: MeasureFilter; labelKey: string }[]

/** A variable matches the search box when the query appears in its name or
 *  its label — the two things shown in the list. Case-insensitive. */
function matchesQuery(v: Variable, query: string): boolean {
  if (!query) return true
  return v.name.toLowerCase().includes(query) || v.label.toLowerCase().includes(query)
}

// ─────────────────────────────────────────────────────────────
//  Measure Filter Dropdown
// ─────────────────────────────────────────────────────────────

function MeasureFilterDropdown({
  value,
  onChange
}: {
  value: MeasureFilter
  onChange: (val: MeasureFilter) => void
}) {
  const { t } = useTranslation(['analysis', 'common'])
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const selectedFilter = MEASURE_FILTERS.find(f => f.value === value) ?? MEASURE_FILTERS[0]

  return (
    <div ref={containerRef} className={styles.filterDropdown}>
      <button
        type="button"
        className={cx(styles.filterTrigger, isOpen && styles.filterTriggerOpen)}
        onClick={() => {
          setIsOpen(prev => !prev)
        }}
        aria-expanded={isOpen}
        aria-label={`${t('analysis:shell.filterMeasure')}: ${t(selectedFilter.labelKey)}`}
        title={`${t('analysis:shell.filterMeasure')}: ${t(selectedFilter.labelKey)}`}
      >
        <span className={styles.filterTriggerContent}>
          {value === 'all' ? t('analysis:shell.filterAll') : <MeasureIcon measure={value} />}
        </span>
        <svg
          className={cx(styles.filterTriggerChevron, isOpen && styles.filterTriggerChevronOpen)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className={styles.filterMenu} role="menu">
          {MEASURE_FILTERS.map(f => {
            const isSelected = f.value === value
            return (
              <div
                key={f.value}
                role="menuitem"
                className={cx(styles.filterMenuItem, isSelected && styles.filterMenuItemActive)}
                onClick={() => {
                  onChange(f.value)
                  setIsOpen(false)
                }}
              >
                <span className={styles.filterMenuItemIcon}>
                  {f.value === 'all' ? (
                    <span className={styles.measureAllIcon}>∞</span>
                  ) : (
                    <MeasureIcon measure={f.value} />
                  )}
                </span>
                <span>{t(f.labelKey as never)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Variable list item
// ─────────────────────────────────────────────────────────────

function VarItem({
  variable,
  selected,
  onClick,
  onDoubleClick
}: {
  variable: Variable
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
}) {
  const titleText = variable.label ? `${variable.name} (${variable.label})` : variable.name
  return (
    <div
      className={cx(styles.varItem, selected && styles.selected)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      title={titleText}
    >
      <MeasureIcon measure={variable.measure} />
      <span className={styles.varName}>{variable.name}</span>
      {variable.label && <span className={styles.varLabel}>{variable.label}</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Sub-dialog
// ─────────────────────────────────────────────────────────────

function SubDialog({
  def,
  onClose,
  assignments
}: {
  def: SideButtonDef
  onClose: () => void
  assignments: Record<string, Variable[]>
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const subRef = useRef<HTMLDivElement>(null)
  useDialogKeyboard({ containerRef: subRef, onCancel: onClose })
  return (
    <div className={styles.subOverlay} role="dialog" aria-modal>
      <div
        className={cx(styles.subDialog, def.width && styles.subDialogSized)}
        ref={subRef}
        // def.width: diyaloğa özgü genişlik (token'lı calc), çalışma zamanında gelir
        style={def.width ? { width: def.width } : undefined}
      >
        <div className={styles.subHeader}>
          <span className={styles.subTitle}>{t(def.titleKey as never)}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className={styles.subBody}>{def.renderContent({ onClose, assignments })}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Paste R modal
// ─────────────────────────────────────────────────────────────

function PasteRModal({
  code,
  onClose,
  onSendToScript
}: {
  code: string
  onClose: () => void
  /** Append the code to the Syntax tab's R script and switch there. */
  onSendToScript: () => void
}) {
  const { t } = useTranslation(['common', 'analysis'])
  const [copied, setCopied] = useState(false)
  const subRef = useRef<HTMLDivElement>(null)
  useDialogKeyboard({ containerRef: subRef, onCancel: onClose })

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
    }, 1500)
  }

  return (
    <div className={styles.subOverlay} role="dialog" aria-modal>
      <div className={styles.subDialogWide} ref={subRef}>
        <div className={styles.subHeader}>
          <span className={styles.subTitle}>{t('common.pasteR')}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className={styles.subBody}>
          <pre className={styles.pasteRCode}>{code}</pre>
        </div>
        <div className={styles.subFooter}>
          <button className={styles.btn} onClick={() => void handleCopy()}>
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          <button className={styles.btn} onClick={onSendToScript}>
            {t('analysis:terminal.r.sendToScript')}
          </button>
          <button className={cx(styles.btn, styles.primary)} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Main shell
// ─────────────────────────────────────────────────────────────

export function AnalysisDialogShell({
  analysisId,
  titleKey,
  fieldDefs,
  sideButtons,
  extraContent,
  generateRCode,
  generateSyntax,
  canSubmit,
  onSubmit,
  onCancel,
  onReset
}: AnalysisDialogShellProps) {
  const { t } = useTranslation(['common', 'analysis'])
  const uid = useId()
  const variables = useDatasetStore(s => s.variables)

  // Assignments: fieldKey → Variable[]
  // Dialog Recall (SPSS-style): if this analysisId has a remembered run
  // (Ribbon "Recall" list or just reopening the dialog normally — same
  // lookup either way, see useAnalysisHistoryStore), its field assignments
  // win outright over the roleHint convenience default below. colIds that
  // no longer resolve to a variable (renamed/deleted since) are silently
  // dropped rather than crashing.
  // Role (M4): fields with a roleHint start pre-filled with matching-role
  // variables (see FieldDef.roleHint) — a one-time convenience default
  // computed lazily on mount, not re-applied afterwards.
  const [assignments, setAssignments] = useState<Record<string, Variable[]>>(() => {
    const initial: Record<string, Variable[]> = Object.fromEntries(fieldDefs.map(f => [f.key, []]))

    const recalled = analysisId
      ? useAnalysisHistoryStore.getState().lastFor(analysisId, useDatasetStore.getState().datasetId)
      : null
    if (recalled) {
      for (const f of fieldDefs) {
        const colIds = recalled.assignments[f.key] ?? []
        initial[f.key] = colIds
          .map(id => variables.find(v => v.colId === id))
          .filter((v): v is Variable => v !== undefined)
      }
      return initial
    }

    // Every variable starts with role 'input', so an 'input' hint on an
    // untouched dataset would grab every (or the first) variable. It only
    // means something once the user has assigned roles in Variable View.
    const rolesAssigned = variables.some(v => v.role !== 'input')
    const used = new Set<string>()
    for (const f of fieldDefs) {
      if (!f.roleHint) continue
      if (f.roleHint === 'input' && !rolesAssigned) continue
      const matches = variables.filter(
        v =>
          !used.has(v.colId) &&
          (v.role === f.roleHint || v.role === 'both') &&
          (!f.filter || f.filter(v))
      )
      const picked = f.single ? matches.slice(0, 1) : matches
      picked.forEach(v => used.add(v.colId))
      initial[f.key] = picked
    }
    return initial
  })

  // Active target field (last clicked/focused)
  const [activeField, setActiveField] = useState<string>(fieldDefs[0]?.key ?? '')

  // Source selection — multi-select via Ctrl+click (toggle) and Shift+click (range)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set())
  const [lastClickedSourceId, setLastClickedSourceId] = useState<string | null>(null)

  // Target selection: { fieldKey, colIds }
  const [selectedTarget, setSelectedTarget] = useState<{
    fieldKey: string
    colIds: Set<string>
  } | null>(null)
  const [lastClickedTargetId, setLastClickedTargetId] = useState<string | null>(null)

  // Sub-dialog state
  const [openSubDialog, setOpenSubDialog] = useState<string | null>(null)
  const [showPasteR, setShowPasteR] = useState(false)

  // Source list search + measure filter — datasets routinely carry 100+
  // variables, and scrolling a 240px list to find one is the slowest step of
  // setting up an analysis. Unlike `sortMeasure` (M3, a non-blocking sort
  // hint) this filter is user-driven, so it may hide rows: any variable is
  // one keystroke away again.
  const [sourceQuery, setSourceQuery] = useState('')
  const [measureFilter, setMeasureFilter] = useState<MeasureFilter>('all')

  // Variables currently assigned to any field (used to exclude from source list)
  const assignedColIds = new Set(
    Object.values(assignments)
      .flat()
      .map(v => v.colId)
  )

  // Source list = all unassigned variables that survive the search + filter
  const normalizedQuery = sourceQuery.trim().toLowerCase()
  const isFiltering = normalizedQuery !== '' || measureFilter !== 'all'
  const sourceVars = variables.filter(
    v =>
      !assignedColIds.has(v.colId) &&
      (measureFilter === 'all' || v.measure === measureFilter) &&
      matchesQuery(v, normalizedQuery)
  )

  // Narrowing the list drops the selection: transfers resolve against the
  // *visible* list, so keeping a now-hidden variable selected would move
  // something the user can't see.
  const clearSourceSelection = () => {
    setSelectedSourceIds(new Set())
    setLastClickedSourceId(null)
  }

  // Measure (M3): while a field with a sortMeasure hint is active, surface
  // its recommended variables first — a stable reorder, never a filter.
  const activeSortMeasure = fieldDefs.find(f => f.key === activeField)?.sortMeasure
  if (activeSortMeasure) {
    sourceVars.sort(
      (a, b) => Number(b.measure === activeSortMeasure) - Number(a.measure === activeSortMeasure)
    )
  }

  // Transfer: source → active field (single or batch)
  const transferToField = (fieldKey: string, vars: Variable[]) => {
    const field = fieldDefs.find(f => f.key === fieldKey)
    if (!field) return
    const allowed = vars.filter(v => !field.filter || field.filter(v))
    if (allowed.length === 0) return

    setAssignments(prev => {
      const current = prev[fieldKey] ?? []
      if (field.single) {
        // Single-mode: replace with last selected var (allowed.length > 0, guarded above)
        const last = allowed[allowed.length - 1]
        return last ? { ...prev, [fieldKey]: [last] } : prev
      }
      const existing = new Set(current.map(v => v.colId))
      const next = [...current, ...allowed.filter(v => !existing.has(v.colId))]
      return { ...prev, [fieldKey]: next }
    })
    setSelectedSourceIds(new Set())
    setLastClickedSourceId(null)
    setActiveField(fieldKey)
  }

  // Handle source item click with Ctrl and Shift modifier support
  const handleSourceClick = (variable: Variable, e: React.MouseEvent) => {
    const colId = variable.colId
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle this item
      setSelectedSourceIds(prev => {
        const next = new Set(prev)
        if (next.has(colId)) next.delete(colId)
        else next.add(colId)
        return next
      })
    } else if (e.shiftKey && lastClickedSourceId) {
      // Shift+click: range select from last clicked to this item
      const ids = sourceVars.map(v => v.colId)
      const fromIdx = ids.indexOf(lastClickedSourceId)
      const toIdx = ids.indexOf(colId)
      const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
      const rangeIds = new Set(ids.slice(start, end + 1))
      setSelectedSourceIds(rangeIds)
    } else {
      // Plain click: select only this item
      setSelectedSourceIds(new Set([colId]))
    }
    setLastClickedSourceId(colId)
    setSelectedTarget(null)
    setLastClickedTargetId(null)
  }

  // Handle target item click with Ctrl and Shift modifier support
  const handleTargetClick = (fieldKey: string, variable: Variable, e: React.MouseEvent) => {
    const colId = variable.colId
    const assigned = assignments[fieldKey] ?? []

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle this item
      setSelectedTarget(prev => {
        if (prev && prev.fieldKey === fieldKey) {
          const next = new Set(prev.colIds)
          if (next.has(colId)) next.delete(colId)
          else next.add(colId)
          return { fieldKey, colIds: next }
        }
        return { fieldKey, colIds: new Set([colId]) }
      })
    } else if (e.shiftKey && lastClickedTargetId && selectedTarget?.fieldKey === fieldKey) {
      // Shift+click: range select from last clicked to this item in this field
      const ids = assigned.map(v => v.colId)
      const fromIdx = ids.indexOf(lastClickedTargetId)
      const toIdx = ids.indexOf(colId)
      if (fromIdx !== -1 && toIdx !== -1) {
        const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
        const rangeIds = new Set(ids.slice(start, end + 1))
        setSelectedTarget({ fieldKey, colIds: rangeIds })
      } else {
        setSelectedTarget({ fieldKey, colIds: new Set([colId]) })
      }
    } else {
      // Plain click: select only this item
      setSelectedTarget({ fieldKey, colIds: new Set([colId]) })
    }
    setLastClickedTargetId(colId)
    setSelectedSourceIds(new Set())
    setLastClickedSourceId(null)
    setActiveField(fieldKey)
  }

  // Remove: target → source (just remove from assignments)
  const removeFromField = (fieldKey: string, colIds: Set<string> | string) => {
    const idsToRemove = typeof colIds === 'string' ? new Set([colIds]) : colIds
    setAssignments(prev => ({
      ...prev,
      [fieldKey]: (prev[fieldKey] ?? []).filter(v => !idsToRemove.has(v.colId))
    }))
    setSelectedTarget(null)
    setLastClickedTargetId(null)
  }

  // Double-click source: auto-transfer to the active field (or first compatible)
  const handleSourceDoubleClick = (variable: Variable) => {
    // Find first field that accepts this variable
    const field = fieldDefs.find(f => {
      if (f.filter && !f.filter(variable)) return false
      if (f.single) return (assignments[f.key] ?? []).length === 0
      return true
    })
    if (field) transferToField(field.key, [variable])
  }

  const handleTransferIn = (fieldKey: string) => {
    if (selectedSourceIds.size === 0) return
    const vars = sourceVars.filter(v => selectedSourceIds.has(v.colId))
    transferToField(fieldKey, vars)
  }

  const handleTransferOut = (fieldKey: string) => {
    if (!selectedTarget || selectedTarget.fieldKey !== fieldKey) return
    removeFromField(fieldKey, selectedTarget.colIds)
  }

  const handleReset = () => {
    onReset?.()
    setAssignments(Object.fromEntries(fieldDefs.map(f => [f.key, []])))
    setSourceQuery('')
    setMeasureFilter('all')
    setSelectedSourceIds(new Set())
    setLastClickedSourceId(null)
    setSelectedTarget(null)
    setLastClickedTargetId(null)
    setActiveField(fieldDefs[0]?.key ?? '')
  }

  const handleOk = () => {
    if (!canSubmit(assignments)) return
    // Auto output header (variables summary + syntax) — see pending-run-meta.ts
    // for why this is dropped here instead of threaded through onSubmit.
    const summaryParts = fieldDefs
      .map(f => {
        const picked = assignments[f.key] ?? []
        if (picked.length === 0) return null
        const label: string = (t(f.labelKey as never) as string).replace(/:+$/, '').trim()
        return `${label}: ${picked.map(v => v.name).join(', ')}`
      })
      .filter((s): s is string => s !== null)
    setPendingRunMeta({
      summary: summaryParts.length > 0 ? summaryParts.join(' | ') : undefined,
      syntax: generateSyntax ? (generateSyntax(assignments) ?? undefined) : undefined
    })
    onSubmit(assignments)
  }

  const handlePasteR = () => {
    if (generateRCode) setShowPasteR(true)
  }

  // Paste Syntax: emit an SPSS-syntax line, drop it into the Terminal tab buffer,
  // switch to that tab, and close — the same dispatcher can then re-run it.
  const handlePasteSyntax = () => {
    if (!generateSyntax) return
    const line = generateSyntax(assignments)
    if (!line) return
    useTerminalStore.getState().appendSyntax(line)
    useUIStore.getState().setActiveTab('terminal')
    onCancel()
  }

  const openSub = openSubDialog ? (sideButtons ?? []).find(b => b.key === openSubDialog) : null
  const pasteRCode = showPasteR && generateRCode ? generateRCode(assignments) : null

  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogKeyboard({
    containerRef: dialogRef,
    onCancel,
    onSubmit: handleOk,
    submitDisabled: !canSubmit(assignments),
    // Pause the outer trap/Escape while a nested overlay (SubDialog /
    // PasteRModal) is open — each owns its own hook instance instead.
    paused: !!openSub || showPasteR
  })

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-labelledby={`${uid}-title`}>
      <div className={styles.dialog} ref={dialogRef}>
        {/* Header */}
        <div className={styles.header}>
          <span id={`${uid}-title`} className={styles.title}>
            {t(titleKey as never)}
          </span>
          <button className={styles.closeBtn} onClick={onCancel} aria-label={t('common.close')}>
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          <div className={styles.panelsRow}>
            {/* Source variable list */}
            <div className={styles.panel}>
              <div className={styles.panelLabel}>{t('analysis:shell.variables')}</div>

              {/* Search box & filter in single row */}
              <div className={styles.searchBox}>
                <SearchIcon size={13} />
                <input
                  className={styles.searchInput}
                  type="text"
                  value={sourceQuery}
                  placeholder={t('analysis:shell.searchPlaceholder')}
                  aria-label={t('analysis:shell.searchPlaceholder')}
                  // Filtering is live; Enter here must not run the analysis
                  // (see useDialogKeyboard).
                  data-no-submit
                  onChange={e => {
                    setSourceQuery(e.target.value)
                    clearSourceSelection()
                  }}
                />
                {sourceQuery !== '' && (
                  <button
                    className={styles.searchClear}
                    onClick={() => {
                      setSourceQuery('')
                      clearSourceSelection()
                    }}
                    aria-label={t('common.clear')}
                    title={t('common.clear')}
                  >
                    ×
                  </button>
                )}
                <div className={styles.searchDivider} />
                <MeasureFilterDropdown
                  value={measureFilter}
                  onChange={val => {
                    setMeasureFilter(val)
                    clearSourceSelection()
                  }}
                />
              </div>

              <div
                className={styles.varList}
                role="listbox"
                aria-label={t('analysis:shell.variables')}
                aria-multiselectable="true"
              >
                {sourceVars.map(v => (
                  <VarItem
                    key={v.colId}
                    variable={v}
                    selected={selectedSourceIds.has(v.colId)}
                    onClick={e => {
                      handleSourceClick(v, e)
                    }}
                    onDoubleClick={() => {
                      handleSourceDoubleClick(v)
                    }}
                  />
                ))}
                {sourceVars.length === 0 && (
                  <div className={styles.emptyZone}>
                    {isFiltering
                      ? t('analysis:shell.searchNoMatch')
                      : t('analysis:shell.allAssigned')}
                  </div>
                )}
              </div>
            </div>

            {/* Target fields with dedicated transfer buttons */}
            <div className={styles.targetPanel}>
              {fieldDefs.map(field => {
                const assigned = assignments[field.key] ?? []
                const isActive = activeField === field.key
                const hasSourceSelection = selectedSourceIds.size > 0
                const isTargetSelectedInThisField =
                  selectedTarget?.fieldKey === field.key && selectedTarget.colIds.size > 0

                // SPSS-style single transfer button: one arrow per field row
                // whose direction follows the current selection — a variable
                // picked in the source list points right (add), one picked in
                // *this* field points left (remove). Selecting on one side
                // clears the other (handleSourceClick / handleTargetClick), so
                // the two can't both be live and the arrow is never ambiguous.
                const transferOut = isTargetSelectedInThisField
                const transferLabel = transferOut
                  ? t('analysis:shell.moveLeft')
                  : t('analysis:shell.moveRight')

                return (
                  <div key={field.key} className={styles.fieldRow}>
                    {/* Dedicated Transfer Button for this field */}
                    <div className={styles.fieldTransferCol}>
                      <button
                        className={styles.transferBtn}
                        onClick={() => {
                          if (transferOut) handleTransferOut(field.key)
                          else handleTransferIn(field.key)
                        }}
                        disabled={!transferOut && !hasSourceSelection}
                        aria-label={transferLabel}
                        title={transferLabel}
                      >
                        {transferOut ? '◀' : '▶'}
                      </button>
                    </div>

                    <div className={styles.fieldGroup}>
                      <div className={styles.fieldLabel}>{t(field.labelKey as never)}</div>
                      <div
                        className={cx(
                          styles.fieldZone,
                          field.single ? styles.single : styles.multi,
                          isActive && styles.active
                        )}
                        role="listbox"
                        aria-label={t(field.labelKey as never)}
                        onClick={() => {
                          setActiveField(field.key)
                        }}
                      >
                        {assigned.length === 0 ? (
                          <div className={styles.emptyZone}>{t('analysis:shell.dropHere')}</div>
                        ) : (
                          assigned.map(v => (
                            <VarItem
                              key={v.colId}
                              variable={v}
                              selected={
                                selectedTarget?.fieldKey === field.key &&
                                selectedTarget.colIds.has(v.colId)
                              }
                              onClick={e => {
                                handleTargetClick(field.key, v, e)
                              }}
                              onDoubleClick={() => {
                                removeFromField(field.key, v.colId)
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Side buttons */}
            {sideButtons && sideButtons.length > 0 && (
              <div className={styles.sideCol}>
                {sideButtons.map(btn => (
                  <button
                    key={btn.key}
                    className={styles.sideBtn}
                    disabled={btn.disabled?.(assignments) ?? false}
                    onClick={() => {
                      setOpenSubDialog(btn.key)
                    }}
                  >
                    {t(btn.labelKey as never)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Extra content */}
          {extraContent && <div className={styles.extraContent}>{extraContent}</div>}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {generateRCode && (
              <button className={styles.btn} onClick={handlePasteR}>
                {t('common.pasteR')}
              </button>
            )}
            {generateSyntax && (
              <button className={styles.btn} onClick={handlePasteSyntax}>
                {t('common.pasteSyntax')}
              </button>
            )}
            <button className={styles.btn} onClick={handleReset}>
              {t('common.reset')}
            </button>
          </div>
          <div className={styles.footerRight}>
            <button
              className={cx(styles.btn, styles.primary)}
              onClick={handleOk}
              disabled={!canSubmit(assignments)}
            >
              {t('common.ok')}
            </button>
            <button className={styles.btn} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </div>
        </div>

        {/* Sub-dialog overlay */}
        {openSub && (
          <SubDialog
            def={openSub}
            assignments={assignments}
            onClose={() => {
              setOpenSubDialog(null)
            }}
          />
        )}

        {/* Paste R modal */}
        {showPasteR && pasteRCode && (
          <PasteRModal
            code={pasteRCode}
            onClose={() => {
              setShowPasteR(false)
            }}
            onSendToScript={() => {
              // Same flow as Paste Syntax: drop the code into the Syntax tab's
              // R script (never run), switch there and close the dialog.
              useTerminalStore.getState().appendRCode(pasteRCode)
              useUIStore.getState().setActiveTab('terminal')
              setShowPasteR(false)
              onCancel()
            }}
          />
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
//  Shared option-panel building blocks
//
//  Every analysis sub-dialog (side-button panels) hand-wrote the same
//  `<label className={styles.checkRow}><input type="checkbox" .../>{label}
//  </label>` and `<div className={styles.optionSection}>` + title + grid
//  wrapper — over a hundred times across the codebase. These two components
//  are that pattern, once, so a sub-dialog panel reads as data instead of
//  repeating the markup. Sub-dialogs that need a radio or a checkbox row with
//  a trailing number input still write those by hand — CheckOption only
//  covers the plain boolean-toggle case, which is the common one.
// ─────────────────────────────────────────────────────────────

interface CheckOptionProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
  title?: string
  disabled?: boolean
  /** Extra class (e.g. a spacing utility) appended to `.checkRow`. */
  className?: string
}

/** A single checkbox + label row, styled via `.checkRow`. */
export function CheckOption({
  checked,
  onChange,
  children,
  title,
  disabled,
  className
}: CheckOptionProps) {
  return (
    <label className={cx(styles.checkRow, className)} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => {
          onChange(e.target.checked)
        }}
      />
      {children}
    </label>
  )
}

interface OptionSectionProps {
  titleKey?: string
  title?: ReactNode
  children: ReactNode
  /** Wrap children in the two-column `.optionGrid` (the common case). Pass
   *  false for sections whose content isn't a checkbox grid (e.g. free text). */
  grid?: boolean
}

/** A titled group of options — `.optionSectionTitle` + `.optionGrid` wrapper. */
export function OptionSection({ titleKey, title, children, grid = true }: OptionSectionProps) {
  const { t } = useTranslation(['analysis'])
  return (
    <div className={styles.optionSection}>
      {(titleKey ?? title) && (
        <div className={styles.optionSectionTitle}>{titleKey ? t(titleKey as never) : title}</div>
      )}
      {grid ? <div className={styles.optionGrid}>{children}</div> : children}
    </div>
  )
}

/** Standard footer for analysis sub-dialogs with Continue and Cancel buttons. */
export function SubDialogFooter({
  onContinue,
  onCancel,
  continueDisabled
}: {
  onContinue: () => void
  onCancel: () => void
  continueDisabled?: boolean
}) {
  const { t } = useTranslation(['common'])
  return (
    <div className={styles.subFooter}>
      <button
        type="button"
        className={cx(styles.btn, styles.primary)}
        onClick={onContinue}
        disabled={continueDisabled}
      >
        {t('common.continue')}
      </button>
      <button type="button" className={styles.btn} onClick={onCancel}>
        {t('common.cancel')}
      </button>
    </div>
  )
}
