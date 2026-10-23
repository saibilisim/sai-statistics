// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * cx — tiny classNames joiner.
 *
 * Filters out falsy entries (including the `undefined` that CSS-module class
 * lookups produce under `noUncheckedIndexedAccess`) and joins the rest with a
 * space. Use instead of hand-built `` `${styles.a} ${cond ? styles.b : ''}` ``
 * template strings, which leak `string | undefined` into the markup.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ')
}
