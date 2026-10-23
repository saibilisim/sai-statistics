// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * new-var-names.ts — naming rules for variables created from an analysis
 * (roadmap ★11).
 *
 * Separate from NewVariablesPanel.tsx on purpose: this is the layer that
 * decides what may reach the dataset, so it is plain logic with its own unit
 * tests rather than something only reachable by rendering a dialog.
 */

/** slotKey -> variable name the user chose. Absent/empty means "don't create". */
export type NewVarSelection = Record<string, string>

/** Same rule the main-process handler enforces; checked here to explain it. */
export const NAME_RE = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/

/**
 * A slot that produces one column PER COEFFICIENT (DfBeta, partial residuals)
 * uses the typed name as a STEM: R appends 1, 2, 3… to it. The stem therefore
 * has to leave room for that suffix and must not already end in a digit, or
 * `b1` + `1` and `b11` would be indistinguishable to the reader.
 */
export const STEM_RE = /^[A-Za-z][A-Za-z0-9_.]{0,55}[A-Za-z_.]$|^[A-Za-z]$/

/** `base`, else `base_1`, `base_2`… — SPSS's habit, minus its cryptic stems. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${String(i)}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}_${String(Date.now())}`
}

/**
 * The selection as it should reach `params.createVars`: trimmed, and with
 * anything the panel is currently flagging as invalid dropped. A dialog calls
 * this on submit so a half-typed name can never reach the dataset.
 */
export function cleanNewVarSelection(
  value: NewVarSelection,
  existingNames: string[],
  /** Slot keys whose name is a stem, validated with STEM_RE instead. */
  stemKeys: readonly string[] = []
): NewVarSelection {
  const taken = new Set(existingNames.map(s => s.toLowerCase()))
  const out: NewVarSelection = {}
  for (const [key, raw] of Object.entries(value)) {
    const name = raw.trim()
    const rule = stemKeys.includes(key) ? STEM_RE : NAME_RE
    if (!rule.test(name)) continue
    // A stem's own collisions cannot be checked here — the real names are
    // stem+1, stem+2… and only R knows how many there will be. The
    // main-process handler rejects the batch if any of them collides, which is
    // the same check every other created column already goes through.
    if (!stemKeys.includes(key) && taken.has(name.toLowerCase())) continue
    taken.add(name.toLowerCase())
    out[key] = name
  }
  return out
}

/** True when at least one valid variable would be created. */
export function hasNewVars(
  value: NewVarSelection,
  existingNames: string[],
  stemKeys: readonly string[] = []
): boolean {
  return Object.keys(cleanNewVarSelection(value, existingNames, stemKeys)).length > 0
}
