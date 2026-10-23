// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NewVariablesPanel.tsx — the shared "create new variables from this analysis"
 * sub-dialog panel (roadmap ★11).
 *
 * SPSS calls the equivalent panel "Save", which is misleading: it never writes
 * a file, it adds columns to the active dataset. This project uses the honest
 * name, and the panel behaves like Transform > Compute Variable — the user
 * names each variable, the column appears in Data View, Ctrl+Z undoes it, and
 * saving the file stays a separate action.
 *
 * An analysis wires this up by declaring its slots and passing the resulting
 * `Record<slotKey, name>` straight through to `params.createVars`; the R script
 * reads the same keys via requested_new_vars(). No analysis writes its own
 * naming, validation or column-writing code.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckOption, OptionSection, SubDialogFooter } from './AnalysisDialogShell'
import styles from './AnalysisDialogShell.module.css'
import { NAME_RE, STEM_RE, uniqueName, type NewVarSelection } from '@/lib/new-var-names'

export type { NewVarSelection }

/** One offerable variable: what the analysis can compute per case. */
export interface NewVarSlot {
  /** Key sent in `params.createVars` and read by the R script. */
  key: string
  /** i18n key for the checkbox label (what the column will contain). */
  labelKey: string
  /** Suggested variable name, made unique against the dataset before use. */
  defaultName: string
  /**
   * The analysis produces one column PER COEFFICIENT for this slot (DfBeta,
   * partial residuals), so the typed name is a stem that R suffixes with
   * 1, 2, 3… A single name field cannot express that, which is why these
   * slots were left out until the panel understood stems.
   */
  perCoefficient?: boolean
  stemHintKey?: string
}

interface NewVariablesPanelProps {
  hintKey?: string
  slots: NewVarSlot[]
  value: NewVarSelection
  onChange: (next: NewVarSelection) => void
  /** Names already in the dataset — a collision is rejected by the handler, so
   *  it is worth catching while the user can still fix it. */
  existingNames: string[]
  onClose?: () => void
}

export function NewVariablesPanel({
  hintKey = 'analysis:newVars.hint',
  slots,
  value,
  onChange,
  existingNames,
  onClose
}: NewVariablesPanelProps) {
  const { t } = useTranslation(['analysis'])
  const [local, setLocal] = useState(value)
  const current = onClose ? local : value
  const setCurrent = (next: NewVarSelection) => {
    if (onClose) {
      setLocal(next)
    } else {
      onChange(next)
    }
  }

  const lower = (s: string) => s.toLowerCase()
  const takenElsewhere = (slotKey: string): Set<string> =>
    new Set([
      ...existingNames.map(lower),
      ...Object.entries(current)
        .filter(([k, v]) => k !== slotKey && v.trim() !== '')
        .map(([, v]) => lower(v.trim()))
    ])

  const toggle = (slot: NewVarSlot, on: boolean) => {
    if (!on) {
      // Drop the key rather than blanking it: an empty string would still ride
      // along to R, which then has to re-decide what "empty" means.
      setCurrent(Object.fromEntries(Object.entries(current).filter(([k]) => k !== slot.key)))
      return
    }
    setCurrent({ ...current, [slot.key]: uniqueName(slot.defaultName, takenElsewhere(slot.key)) })
  }

  const isStem = (slotKey: string) => slots.some(s => s.key === slotKey && s.perCoefficient)

  const errorFor = (slotKey: string, name: string): string | null => {
    const trimmed = name.trim()
    if (trimmed === '') return t('analysis:newVars.errEmpty')
    if (isStem(slotKey)) {
      // Stems are checked against a stricter shape (no trailing digit, room
      // for the suffix) and NOT against existing names: the real names are
      // stem+1, stem+2… and only the analysis knows how many.
      return STEM_RE.test(trimmed) ? null : t('analysis:newVars.errStem')
    }
    if (!NAME_RE.test(trimmed)) return t('analysis:newVars.errInvalid')
    if (takenElsewhere(slotKey).has(lower(trimmed))) return t('analysis:newVars.errDuplicate')
    return null
  }

  return (
    <>
      <OptionSection titleKey="analysis:newVars.title" grid={false}>
        <div className={styles.optionHint}>{t(hintKey as never)}</div>
        {slots.map(slot => {
          const name = current[slot.key]
          const checked = name !== undefined
          const error = checked ? errorFor(slot.key, name) : null
          return (
            <div key={slot.key} className={styles.newVarRow}>
              <CheckOption
                checked={checked}
                onChange={on => {
                  toggle(slot, on)
                }}
              >
                {t(slot.labelKey as never)}
              </CheckOption>
              {slot.perCoefficient === true && checked && (
                <span className={styles.optionHint}>
                  {t((slot.stemHintKey ?? 'analysis:newVars.stemHint') as never)}
                </span>
              )}
              {checked && (
                <>
                  <input
                    type="text"
                    className="numField"
                    aria-label={t('analysis:newVars.nameLabel')}
                    value={name}
                    onChange={e => {
                      setCurrent({ ...current, [slot.key]: e.target.value })
                    }}
                  />
                  {error !== null && <span className={styles.newVarError}>{error}</span>}
                </>
              )}
            </div>
          )
        })}
      </OptionSection>

      {onClose && (
        <SubDialogFooter
          onContinue={() => {
            onChange(local)
            onClose()
          }}
          onCancel={onClose}
        />
      )}
    </>
  )
}
