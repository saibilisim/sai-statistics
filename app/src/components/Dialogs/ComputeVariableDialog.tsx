// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ComputeVariableDialog.tsx — Transform ▸ Compute Variable, laid out like
 * SPSS: target variable, numeric expression, a source-variable list you can
 * push into the expression, a function list, and a calculator keypad.
 *
 * Replaces ComputeInfoDialog, which pointed users at a "Data View cell
 * formulas" flow that stopped existing when the previous grid engine was
 * removed (2026-07-20), leaving the menu item dead. The expression is evaluated by the
 * same safe engine as cell formulas (src/lib/formula.ts — hand-written parser,
 * NO eval()), extended with variable-name resolution so expressions read
 * `kilo / (boy * boy)` instead of A1-style addresses.
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CellValue, Variable } from '@shared/data-types'
import { evaluateFormula } from '../../lib/formula'
import { useDatasetStore } from '../../store/dataset-store'
import { fetchAllRows } from '../../lib/fetch-all-rows'
import { cx } from '../../lib/cx'
import styles from './ComputeVariableDialog.module.css'

/** Functions offered in the picker — the subset formula.ts implements. */
const FUNCTIONS = [
  'ABS(x)',
  'SQRT(x)',
  'EXP(x)',
  'LN(x)',
  'LOG10(x)',
  'INT(x)',
  'SIGN(x)',
  'ROUND(x, d)',
  'MOD(x, y)',
  'POWER(x, y)',
  'IF(cond, a, b)',
  'SUM(a, b, …)',
  'MEAN(a, b, …)',
  'MEDIAN(a, b, …)',
  'MIN(a, b, …)',
  'MAX(a, b, …)',
  'COUNT(a, b, …)'
]

const KEYPAD = [
  ['7', '8', '9', '+', '<', '>'],
  ['4', '5', '6', '-', '<=', '>='],
  ['1', '2', '3', '*', '=', '<>'],
  ['0', '.', '(', ')', '/', '^']
]

export interface ComputeVariableDialogProps {
  onClose: () => void
}

export function ComputeVariableDialog({ onClose }: ComputeVariableDialogProps) {
  const { t } = useTranslation(['common', 'menu'])
  const variables = useDatasetStore(s => s.variables)
  const datasetId = useDatasetStore(s => s.datasetId)

  const [targetName, setTargetName] = useState('')
  const [expression, setExpression] = useState('')
  const [running, setRunning] = useState(false)
  /** Inline status/error line — SPSS reports compute problems in the dialog
   *  rather than a transient toast, and the user needs it while fixing the
   *  expression. */
  const [message, setMessage] = useState<string | null>(null)
  const exprRef = useRef<HTMLTextAreaElement>(null)

  /** Inserts text at the caret (SPSS's ► button / double-click behaviour). */
  const insertAtCaret = (text: string) => {
    const el = exprRef.current
    if (!el) {
      setExpression(e => e + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    setExpression(e => e.slice(0, start) + text + e.slice(end))
    // Restore focus and place the caret after the inserted text.
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  /** A function entry like "ROUND(x, d)" inserts as "ROUND(" so the user
   *  types the arguments — matching SPSS, which inserts the signature. */
  const insertFunction = (sig: string) => {
    const name = sig.slice(0, sig.indexOf('('))
    insertAtCaret(`${name}(`)
  }

  const nameTaken = useMemo(
    () => variables.some(v => v.name.toLowerCase() === targetName.trim().toLowerCase()),
    [variables, targetName]
  )
  const canRun = targetName.trim() !== '' && expression.trim() !== '' && !running

  /**
   * Evaluates the expression for every row and writes the result into the
   * target variable, creating it when new. Runs in the renderer against the
   * already-loaded rows (the same data the grid shows), then persists with one
   * batched `updateCells` — no new IPC surface, and the expression never
   * reaches DuckDB or R as code.
   */
  const run = () => {
    const dsId = datasetId
    if (!dsId) return
    setRunning(true)
    setMessage(null)
    void (async () => {
      try {
        const target = targetName.trim()
        const freshVars = useDatasetStore.getState().variables
        const existing = freshVars.find(v => v.name.toLowerCase() === target.toLowerCase())

        // Pull every row (post-filter view isn't right here: Compute applies
        // to the whole dataset, like SPSS).
        const allRows = await fetchAllRows(dsId, useDatasetStore.getState().rowCount)

        // Evaluate first — if the expression is broken we abort before
        // touching the dataset.
        const results: CellValue[] = []
        let firstError: string | null = null
        for (const row of allRows) {
          const byName = (name: string): CellValue | undefined => {
            const idx = freshVars.findIndex(v => v.name.toLowerCase() === name.toLowerCase())
            return idx === -1 ? undefined : (row[idx] ?? null)
          }
          const res = evaluateFormula(expression, () => null, byName)
          if (!res.ok) {
            firstError ??= res.error
            results.push(null)
          } else {
            results.push(typeof res.value === 'boolean' ? (res.value ? 1 : 0) : res.value)
          }
        }
        if (firstError && results.every(r => r === null)) {
          setMessage(t('dialog.compute.exprError', { error: firstError }))
          setRunning(false)
          return
        }

        // Create the target column when it doesn't exist yet.
        let targetVar: Variable | undefined = existing
        if (!targetVar) {
          const numeric = results.every(r => r === null || typeof r === 'number')
          const updated = await window.api.variable.add({
            datasetId: dsId,
            variable: {
              colId: '',
              name: target,
              type: numeric ? 'numeric' : 'string',
              width: numeric ? 8 : 20,
              decimals: numeric ? 2 : 0,
              label: '',
              missing: null,
              valueLabels: {},
              columns: 8,
              align: numeric ? 'right' : 'left',
              measure: numeric ? 'scale' : 'nominal',
              role: 'none'
            },
            index: freshVars.length
          })
          useDatasetStore.getState().setVariables(updated)
          targetVar = updated.find(v => v.name.toLowerCase() === target.toLowerCase())
        }
        if (!targetVar) throw new Error('Target variable could not be created')

        await window.api.data.updateCells({
          datasetId: dsId,
          updates: results.map((value, rowIndex) => ({
            rowIndex,
            colId: targetVar.colId,
            value
          }))
        })
        useDatasetStore.getState().bumpDataVersion()
        useDatasetStore.getState().setModified(true)
        if (firstError) {
          // Some rows failed (e.g. text in an arithmetic expression) — keep the
          // dialog open and say so; those cells were written as blank.
          setMessage(t('dialog.compute.doneWithErrors', { name: target, error: firstError }))
          setRunning(false)
        } else {
          onClose()
        }
      } catch (err: unknown) {
        console.error('Compute variable failed:', err)
        setMessage(t('dialog.compute.failed'))
        setRunning(false)
      }
    })()
  }

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('menu:transform.computeVariable')}
        onMouseDown={e => {
          e.stopPropagation()
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose()
        }}
      >
        <div className={styles.header}>
          <span className={styles.title}>{t('menu:transform.computeVariable')}</span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.targetRow}>
            <label className={styles.fieldLabel} htmlFor="cv-target">
              {t('dialog.compute.targetVariable')}
            </label>
            <input
              id="cv-target"
              className={styles.input}
              value={targetName}
              onChange={e => {
                setTargetName(e.target.value)
              }}
              placeholder={t('dialog.compute.targetPlaceholder')}
            />
            {nameTaken && (
              <span className={styles.overwriteHint}>{t('dialog.compute.willOverwrite')}</span>
            )}
          </div>

          <div className={styles.mainRow}>
            {/* Source variables — double-click (or ►) pushes into the expression */}
            <div className={styles.panel}>
              <div className={styles.panelTitle}>{t('dialog.compute.variables')}</div>
              <ul className={styles.list}>
                {variables.map(v => (
                  <li key={v.colId}>
                    <button
                      type="button"
                      className={styles.listItem}
                      title={v.label || v.name}
                      onDoubleClick={() => {
                        insertAtCaret(v.name)
                      }}
                      onClick={() => {
                        insertAtCaret(v.name)
                      }}
                    >
                      {v.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Expression + keypad */}
            <div className={styles.centerPanel}>
              <div className={styles.panelTitle}>{t('dialog.compute.expression')}</div>
              <textarea
                ref={exprRef}
                className={styles.expression}
                value={expression}
                spellCheck={false}
                onChange={e => {
                  setExpression(e.target.value)
                }}
                placeholder={t('dialog.compute.expressionPlaceholder')}
              />
              <div className={styles.keypad}>
                {KEYPAD.map((row, i) => (
                  <div key={i} className={styles.keypadRow}>
                    {row.map(k => (
                      <button
                        key={k}
                        type="button"
                        className={styles.key}
                        onClick={() => {
                          insertAtCaret(k)
                        }}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Functions */}
            <div className={styles.panel}>
              <div className={styles.panelTitle}>{t('dialog.compute.functions')}</div>
              <ul className={styles.list}>
                {FUNCTIONS.map(f => (
                  <li key={f}>
                    <button
                      type="button"
                      className={cx(styles.listItem, styles.mono)}
                      onClick={() => {
                        insertFunction(f)
                      }}
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {message && (
          <div className={styles.message} role="status">
            {message}
          </div>
        )}

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              setTargetName('')
              setExpression('')
            }}
          >
            {t('common.reset')}
          </button>
          <button
            type="button"
            className={cx(styles.btn, styles.primary)}
            onClick={run}
            disabled={!canRun}
          >
            {t('common.ok')}
          </button>
          <button type="button" className={styles.btn} onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
