// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Clipboard text for selected variables in Variable View.
 *   • lines   — one name per line (pastes as a column in Excel / a list anywhere)
 *   • inline  — space-separated, ready for SPSS syntax (`FREQUENCIES VARIABLES=…`)
 *               or an R vector after a quick edit
 *   • labels  — `name<TAB>label` rows (pastes as two columns in Excel)
 */
import type { Variable } from '@shared/data-types'

export type VariableCopyFormat = 'lines' | 'inline' | 'labels'

export function formatVariablesForCopy(
  variables: Pick<Variable, 'name' | 'label'>[],
  format: VariableCopyFormat
): string {
  switch (format) {
    case 'inline':
      return variables.map(v => v.name).join(' ')
    case 'labels':
      // Tabs/newlines inside a label would break the two-column paste.
      return variables.map(v => `${v.name}\t${v.label.replace(/[\t\r\n]+/g, ' ')}`).join('\n')
    case 'lines':
      return variables.map(v => v.name).join('\n')
  }
}
