// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * formula.ts — a small, safe spreadsheet-formula engine for DataView cell
 * formulas (the "=A7+B7" feature). Framework-free and unit-tested.
 *
 * Design decisions (see the discussion in the roadmap thread):
 *  - Formulas are METADATA: stored per-cell in `customStyles` (local .sdf),
 *    never in DuckDB. DuckDB keeps the evaluated value, so R/analyses read a
 *    plain number and the SPSS data model is untouched (the reason cell
 *    formulas were once out-of-scope — that objection is dissolved here).
 *  - Recalc is "recompute every formula cell on any edit" (v1) — this module
 *    only provides pure evaluation; the orchestration lives in DataView.
 *  - Cell references are A1-style and resolve against a caller-supplied
 *    resolver (visible grid position → value), reusing getColumnLetter /
 *    columnLetterToIndex from data-grid.ts.
 *  - Missing data (name-resolver mode only, i.e. Compute Variable / syntax
 *    COMPUTE): a missing variable value is SPSS system-missing, carried as
 *    NaN — it propagates through arithmetic/comparisons, the aggregate
 *    functions skip it, AND/OR use SPSS three-valued logic, and a NaN result
 *    comes back as `value: null`. A1 cell formulas keep Excel semantics
 *    (blank → 0) since they never resolve a name.
 *  - NO `eval()` / `Function()` — a hand-written tokenizer + recursive-descent
 *    evaluator over an allow-list of operators and functions (security §9).
 */
import { columnLetterToIndex, getColumnLetter } from './data-grid'
import type { CellValue } from '@shared/data-types'

/** Resolves a cell reference (0-based data-column index, 0-based visible-row
 *  index) to its current value. Out-of-range should return null. */
export type RefResolver = (colIndex: number, rowIndex: number) => CellValue

/** Resolves a bare identifier (a VARIABLE NAME, e.g. `yas`) to its value for
 *  the row being evaluated — used by Compute Variable, where SPSS-style
 *  expressions name variables instead of using A1 cell addresses. Returns
 *  `undefined` when the name isn't a known variable, so the evaluator can
 *  report `#NAME?` instead of silently treating it as 0. */
export type NameResolver = (name: string) => CellValue | undefined

export interface FormulaOk {
  ok: true
  /** null = system-missing (only produced when a NameResolver is used). */
  value: number | string | boolean | null
}
export interface FormulaErr {
  ok: false
  /** Excel-style short code: #REF!, #DIV/0!, #VALUE!, #NAME?, #NUM!. */
  error: string
}
export type FormulaResult = FormulaOk | FormulaErr

/** True when a raw cell-edit string is a formula (leading "=", Excel-style). */
export function isFormula(raw: string): boolean {
  return raw.trimStart().startsWith('=')
}

// ─────────────────────────────────────────────────────────────
//  Reference re-writing for fill (relative refs shift, $ locks)
// ─────────────────────────────────────────────────────────────

/**
 * Shifts every RELATIVE cell reference in a formula by (dRow, dCol),
 * leaving `$`-locked parts fixed — the fill-handle / Ctrl+D behaviour
 * (filling `=A7+B7` down by one → `=A8+B8`, right by one → `=B7+C7`).
 * A reference pushed off the top/left edge becomes `#REF!`. Function names
 * (letters followed by `(`) are skipped via a lookahead.
 */
/**
 * Rewrites every cell reference in a formula through `fn`, preserving `$`
 * locks, string literals, and everything else verbatim. `fn` receives the
 * 0-based (col, row) plus whether each part is `$`-locked and returns the new
 * 0-based (col, row); a negative result becomes `#REF!`. This is the shared
 * engine behind both relative fill-shift (`adjustReferences`) and the
 * visible↔stable-row remapping the "bind formulas to row identity" model
 * needs. The trailing `(?![0-9A-Za-z(])` stops the regex backtracking a
 * function name like `LOG10(` into a bogus ref "LOG1".
 */
export function remapReferences(
  src: string,
  fn: (
    col: number,
    row: number,
    colLocked: boolean,
    rowLocked: boolean
  ) => { col: number; row: number }
): string {
  return src.replace(
    /"[^"]*"|(\$?)([A-Za-z]+)(\$?)(\d+)(?![0-9A-Za-z(])/g,
    (
      m: string,
      colLock: string | undefined,
      col: string | undefined,
      rowLock: string | undefined,
      row: string | undefined
    ) => {
      if (col === undefined || row === undefined) return m // string literal → leave as-is
      const cIdx = columnLetterToIndex(col)
      if (cIdx === -1) return m // not a real column ref, leave as-is
      const rIdx = parseInt(row, 10) - 1
      const mapped = fn(cIdx, rIdx, colLock === '$', rowLock === '$')
      if (mapped.col < 0 || mapped.row < 0) return '#REF!'
      return `${colLock ?? ''}${getColumnLetter(mapped.col)}${rowLock ?? ''}${String(mapped.row + 1)}`
    }
  )
}

/**
 * Shifts every RELATIVE cell reference by (dRow, dCol), `$`-locked parts
 * fixed — the fill-handle / Ctrl+D behaviour (`=A7+B7` down by one → `=A8+B8`).
 * Off-edge refs become `#REF!`. Thin wrapper over `remapReferences`.
 */
export function adjustReferences(src: string, dRow: number, dCol: number): string {
  return remapReferences(src, (col, row, colLocked, rowLocked) => ({
    col: colLocked ? col : col + dCol,
    row: rowLocked ? row : row + dRow
  }))
}

// ─────────────────────────────────────────────────────────────
//  Tokenizer
// ─────────────────────────────────────────────────────────────

type TokType =
  | 'num'
  | 'str'
  | 'ref'
  | 'func'
  | 'bool'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
interface Token {
  type: TokType
  value: string
  /** Original spelling of a 'func' identifier — `value` is upper-cased for
   *  function lookup, but a VARIABLE name must resolve as the user wrote it. */
  raw?: string
  /** for 'ref' */
  col?: number
  row?: number
}

const KEYWORD_COMPARISONS: Record<string, string> = {
  EQ: '=',
  NE: '<>',
  LT: '<',
  GT: '>',
  LE: '<=',
  GE: '>='
}

class FormulaError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const s = input
  while (i < s.length) {
    const ch = s[i] ?? ''
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    // String literal "…" (Excel) or '…' (SPSS syntax: IF (grp = 'A') read as
    // #NAME? and silently matched no case). A doubled quote inside is literal.
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let str = ''
      while (j < s.length) {
        if (s[j] === ch) {
          if (s[j + 1] === ch) {
            str += ch
            j += 2
            continue
          }
          break
        }
        str += s[j] ?? ''
        j++
      }
      if (s[j] !== ch) throw new FormulaError('#VALUE!') // unterminated string
      tokens.push({ type: 'str', value: str })
      i = j + 1
      continue
    }
    // Number (with optional decimals). Leading sign handled as unary op.
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i + 1
      while (j < s.length && (s[j] ?? '') >= '0' && (s[j] ?? '') <= '9') j++
      if ((s[j] ?? '') === '.') {
        j++
        while (j < s.length && (s[j] ?? '') >= '0' && (s[j] ?? '') <= '9') j++
      }
      tokens.push({ type: 'num', value: s.slice(i, j) })
      i = j
      continue
    }
    // Identifier: cell ref ($?LETTERS$?DIGITS), function name (LETTERS…‘(’),
    // or TRUE/FALSE. `_` is not a valid A1 cell-ref character, but SPSS/SAI
    // variable names allow it (leading or internal, see VAR_NAME_RE in
    // spss-syntax.ts) — without it here, a name like `yb_yatisi` tokenized as
    // "yb" followed by a bare "_" the scanner couldn't classify at all,
    // aborting the whole expression with #NAME? (destek talebi 2026-09-26).
    if (ch === '$' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      const refMatch = /^(\$?)([A-Za-z]+)(\$?)(\d+)/.exec(s.slice(i))
      // A cell ref only if it is NOT immediately followed by '(' (that would
      // make the letters a function name like LOG10().
      if (refMatch) {
        const after = i + refMatch[0].length
        // peek next non-space
        let k = after
        while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++
        if (s[k] !== '(') {
          const col = columnLetterToIndex(refMatch[2] ?? '')
          if (col === -1) throw new FormulaError('#REF!')
          const row = parseInt(refMatch[4] ?? '0', 10) - 1
          tokens.push({ type: 'ref', value: refMatch[0], col, row })
          i = after
          continue
        }
      }
      // Otherwise a name: function or boolean literal.
      const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))
      if (nameMatch) {
        const name = nameMatch[0].toUpperCase()
        i += nameMatch[0].length
        if (name === 'TRUE' || name === 'FALSE') {
          tokens.push({ type: 'bool', value: name })
        } else {
          tokens.push({ type: 'func', value: name, raw: nameMatch[0] })
        }
        continue
      }
      throw new FormulaError('#NAME?')
    }
    // Two-char comparison operators (SPSS also writes "not equal" as ~=).
    const two = s.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>' || two === '~=') {
      tokens.push({ type: 'op', value: two === '~=' ? '<>' : two })
      i += 2
      continue
    }
    // SPSS symbolic logic: & AND, | OR, ~ NOT — as the keyword tokens.
    const logical = ch === '&' ? 'AND' : ch === '|' ? 'OR' : ch === '~' ? 'NOT' : null
    if (logical) {
      tokens.push({ type: 'func', value: logical, raw: logical })
      i++
      continue
    }
    if ('+-*/^=<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch })
      i++
      continue
    }
    if (ch === ',' || ch === ';') {
      tokens.push({ type: 'comma', value: ',' })
      i++
      continue
    }
    if (ch === ':') {
      tokens.push({ type: 'colon', value: ':' })
      i++
      continue
    }
    throw new FormulaError('#NAME?')
  }
  return tokens
}

// ─────────────────────────────────────────────────────────────
//  Evaluator (recursive descent, direct value production)
// ─────────────────────────────────────────────────────────────

/** A resolved argument: a scalar, or a flattened numeric list (from a range),
 *  which only aggregate functions accept. */
type Scalar = number | boolean | string
type EvalArg = Scalar | number[]

class Parser {
  private pos = 0
  constructor(
    private readonly toks: Token[],
    private readonly resolve: RefResolver,
    private readonly resolveName?: NameResolver
  ) {}

  private peek(): Token | undefined {
    return this.toks[this.pos]
  }
  private next(): Token | undefined {
    return this.toks[this.pos++]
  }
  private expect(type: TokType): Token {
    const t = this.next()
    if (!t || t.type !== type) throw new FormulaError('#NUM!')
    return t
  }

  parse(): Scalar {
    const v = this.parseOr()
    if (this.pos !== this.toks.length) throw new FormulaError('#NUM!')
    return asScalar(v)
  }

  // AND/OR/NOT are tokenized as plain 'func' identifiers (letters, no
  // trailing '(') — recognised here by value, above comparison in precedence
  // (SPSS: NOT binds tighter than AND, AND tighter than OR), so
  // `a = 1 AND b = 2 OR c = 3` reads as `(a=1 AND b=2) OR (c=3)`. A variable
  // literally named and/or/not would be shadowed, same tradeoff SPSS itself
  // makes with these as reserved words.
  private isKeyword(t: Token | undefined, word: string): boolean {
    return !!t && t.type === 'func' && t.value === word
  }

  private parseOr(): EvalArg {
    let left = this.parseAnd()
    while (this.isKeyword(this.peek(), 'OR')) {
      this.next()
      const right = this.parseAnd()
      // SPSS three-valued logic: true wins over missing, missing over false.
      const a = asScalar(left)
      const b = asScalar(right)
      left = truthy(a) || truthy(b) ? true : isSysmis(a) || isSysmis(b) ? NaN : false
    }
    return left
  }

  private parseAnd(): EvalArg {
    let left = this.parseNot()
    while (this.isKeyword(this.peek(), 'AND')) {
      this.next()
      const right = this.parseNot()
      // SPSS three-valued logic: false wins over missing, missing over true.
      const a = asScalar(left)
      const b = asScalar(right)
      const aFalse = !isSysmis(a) && !truthy(a)
      const bFalse = !isSysmis(b) && !truthy(b)
      left = aFalse || bFalse ? false : isSysmis(a) || isSysmis(b) ? NaN : true
    }
    return left
  }

  private parseNot(): EvalArg {
    if (this.isKeyword(this.peek(), 'NOT')) {
      this.next()
      const v = asScalar(this.parseNot())
      return isSysmis(v) ? NaN : !truthy(v)
    }
    return this.parseComparison()
  }

  private parseComparison(): EvalArg {
    let left = this.parseAdd()
    for (;;) {
      const tok = this.peek()
      // SPSS keyword comparisons (EQ NE LT GT LE GE), reserved words like AND.
      const op =
        tok?.type === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(tok.value)
          ? tok.value
          : tok?.type === 'func'
            ? KEYWORD_COMPARISONS[tok.value]
            : undefined
      if (!op) break
      this.next()
      const right = this.parseAdd()
      left = compare(asScalar(left), asScalar(right), op)
    }
    return left
  }

  private parseAdd(): EvalArg {
    let left = this.parseMul()
    for (;;) {
      const tok = this.peek()
      if (!tok || tok.type !== 'op' || (tok.value !== '+' && tok.value !== '-')) break
      this.next()
      const a = asNumber(left)
      const b = asNumber(this.parseMul())
      left = tok.value === '+' ? a + b : a - b
    }
    return left
  }

  private parseMul(): EvalArg {
    let left = this.parsePow()
    for (;;) {
      const tok = this.peek()
      if (!tok || tok.type !== 'op' || (tok.value !== '*' && tok.value !== '/')) break
      this.next()
      const a = asNumber(left)
      const b = asNumber(this.parsePow())
      if (tok.value === '/') {
        if (b === 0) throw new FormulaError('#DIV/0!')
        left = a / b
      } else {
        left = a * b
      }
    }
    return left
  }

  private parsePow(): EvalArg {
    const left = this.parseUnary()
    const tok = this.peek()
    if (tok && tok.type === 'op' && tok.value === '^') {
      this.next()
      const right = this.parsePow() // right-associative
      return Math.pow(asNumber(left), asNumber(right))
    }
    return left
  }

  private parseUnary(): EvalArg {
    const t = this.peek()
    if (t?.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next()
      const v = asNumber(this.parseUnary())
      return t.value === '-' ? -v : v
    }
    return this.parsePrimary()
  }

  private parsePrimary(): EvalArg {
    const t = this.next()
    if (!t) throw new FormulaError('#NUM!')
    switch (t.type) {
      case 'num':
        return parseFloat(t.value)
      case 'str':
        return t.value
      case 'bool':
        return t.value === 'TRUE'
      case 'lparen': {
        const v = this.parseOr()
        this.expect('rparen')
        return v
      }
      case 'ref': {
        // Variable names may LOOK like cell refs (`q1`, `var2`). When a name
        // resolver is in play (Compute Variable), try the name first — its
        // expressions address variables, not A1 cells.
        if (this.resolveName && this.peek()?.type !== 'colon') {
          const named = this.resolveName(t.value)
          if (named !== undefined) return nameToScalar(named)
        }
        // A range if the next token is a colon.
        if (this.peek()?.type === 'colon') {
          this.next()
          const end = this.expect('ref')
          return this.resolveRange(t, end)
        }
        return refToScalar(this.resolve(t.col ?? 0, t.row ?? 0))
      }
      case 'func': {
        // `name(` is a function call; a bare `name` is a variable reference
        // (Compute Variable's SPSS-style expressions).
        if (this.peek()?.type !== 'lparen' && this.resolveName) {
          const v = this.resolveName(t.raw ?? t.value)
          if (v === undefined) throw new FormulaError('#NAME?')
          return nameToScalar(v)
        }
        return this.parseFuncCall(t.value)
      }
      default:
        throw new FormulaError('#NUM!')
    }
  }

  private resolveRange(a: Token, b: Token): number[] {
    const c0 = Math.min(a.col ?? 0, b.col ?? 0)
    const c1 = Math.max(a.col ?? 0, b.col ?? 0)
    const r0 = Math.min(a.row ?? 0, b.row ?? 0)
    const r1 = Math.max(a.row ?? 0, b.row ?? 0)
    const out: number[] = []
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const v = this.resolve(c, r)
        const n = toNumberOrNull(v)
        if (n !== null) out.push(n) // blanks/text skipped, Excel aggregate behaviour
      }
    }
    return out
  }

  private parseFuncCall(name: string): EvalArg {
    this.expect('lparen')
    const args: EvalArg[] = []
    if (this.peek()?.type !== 'rparen') {
      args.push(this.parseOr())
      while (this.peek()?.type === 'comma') {
        this.next()
        args.push(this.parseOr())
      }
    }
    this.expect('rparen')
    return applyFunction(name, args)
  }
}

// ── Coercions ──────────────────────────────────────────────────────────────
function asScalar(v: EvalArg): Scalar {
  if (Array.isArray(v)) throw new FormulaError('#VALUE!') // a range in scalar position
  return v
}
function asNumber(v: EvalArg): number {
  return numify(asScalar(v))
}
function numify(v: Scalar): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  if (v.trim() === '') return 0 // blank string → 0
  if (Number.isNaN(n)) throw new FormulaError('#VALUE!')
  return n
}
/** A cell reference's value in scalar context: blank/null → 0, numeric string
 *  → number, other text → the text (so text comparisons work; arithmetic on it
 *  later throws #VALUE via numify). */
function refToScalar(v: CellValue): Scalar {
  if (v === null || v === '') return 0
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isNaN(n) ? String(v) : n
}
/** A variable's value in Compute (name) mode: a missing (null) value is
 *  system-missing → NaN, which then propagates (see the header note). */
function nameToScalar(v: CellValue): Scalar {
  return v === null ? NaN : refToScalar(v)
}
function isSysmis(v: Scalar): boolean {
  return typeof v === 'number' && Number.isNaN(v)
}
/** A value as text for the string functions; missing is the empty string. */
function textOf(v: Scalar): string {
  if (isSysmis(v)) return ''
  return typeof v === 'boolean' ? (v ? '1' : '0') : String(v)
}
function toNumberOrNull(v: CellValue): number | null {
  if (v === null || v === '') return null
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function compare(a: Scalar, b: Scalar, op: string): boolean | number {
  // A comparison with a system-missing operand is itself missing (SPSS).
  if (isSysmis(a) || isSysmis(b)) return NaN
  let cmp: number
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b
  else if (typeof a === 'boolean' || typeof b === 'boolean') cmp = numify(a) - numify(b)
  else cmp = String(a).localeCompare(String(b))
  switch (op) {
    case '=':
      return cmp === 0
    case '<>':
      return cmp !== 0
    case '<':
      return cmp < 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '>=':
      return cmp >= 0
    default:
      throw new FormulaError('#NUM!')
  }
}

/** Flattens function args (scalars + ranges) into a numeric list, skipping
 *  non-numeric scalars — used by the aggregate functions. */
function flattenNums(args: EvalArg[]): number[] {
  const out: number[] = []
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a)
    else {
      const n = typeof a === 'number' ? a : typeof a === 'boolean' ? (a ? 1 : 0) : Number(a)
      if (!Number.isNaN(n)) out.push(n)
    }
  }
  return out
}

/** True when some argument is system-missing — an aggregate over nothing
 *  but missing values is itself missing (SPSS), not Excel's 0/#DIV/0!. */
function anySysmis(args: EvalArg[]): boolean {
  return args.some(a => !Array.isArray(a) && isSysmis(a))
}

function applyFunction(name: string, args: EvalArg[]): EvalArg {
  const arg = (i: number): EvalArg => {
    const a = args[i]
    if (a === undefined) throw new FormulaError('#NUM!')
    return a
  }
  const scalar1 = (): number => {
    if (args.length !== 1) throw new FormulaError('#NUM!')
    return numify(asScalar(arg(0)))
  }
  switch (name) {
    case 'ABS':
      return Math.abs(scalar1())
    case 'SQRT': {
      const x = scalar1()
      if (x < 0) throw new FormulaError('#NUM!')
      return Math.sqrt(x)
    }
    case 'EXP':
      return Math.exp(scalar1())
    case 'LN': {
      const x = scalar1()
      if (x <= 0) throw new FormulaError('#NUM!')
      return Math.log(x)
    }
    case 'LOG10': {
      const x = scalar1()
      if (x <= 0) throw new FormulaError('#NUM!')
      return Math.log10(x)
    }
    case 'INT':
      return Math.floor(scalar1())
    case 'SIGN':
      return Math.sign(scalar1())
    case 'ROUND': {
      if (args.length < 1 || args.length > 2) throw new FormulaError('#NUM!')
      const x = numify(asScalar(arg(0)))
      const d = args.length === 2 ? numify(asScalar(arg(1))) : 0
      const f = Math.pow(10, d)
      return Math.round(x * f) / f
    }
    case 'MOD': {
      if (args.length !== 2) throw new FormulaError('#NUM!')
      const b = numify(asScalar(arg(1)))
      if (b === 0) throw new FormulaError('#DIV/0!')
      return numify(asScalar(arg(0))) % b
    }
    case 'POWER': {
      if (args.length !== 2) throw new FormulaError('#NUM!')
      return Math.pow(numify(asScalar(arg(0))), numify(asScalar(arg(1))))
    }
    case 'IF': {
      if (args.length < 2 || args.length > 3) throw new FormulaError('#NUM!')
      const cond = truthy(asScalar(arg(0)))
      if (cond) return asScalar(arg(1))
      return args.length === 3 ? asScalar(arg(2)) : false
    }
    case 'SUM': {
      const xs = flattenNums(args)
      if (xs.length === 0 && anySysmis(args)) return NaN
      return xs.reduce((s, n) => s + n, 0)
    }
    case 'MEAN':
    case 'AVERAGE': {
      const xs = flattenNums(args)
      if (xs.length === 0 && anySysmis(args)) return NaN
      if (xs.length === 0) throw new FormulaError('#DIV/0!')
      return xs.reduce((s, n) => s + n, 0) / xs.length
    }
    case 'MEDIAN': {
      const xs = flattenNums(args)
        .slice()
        .sort((a, b) => a - b)
      if (xs.length === 0 && anySysmis(args)) return NaN
      if (xs.length === 0) throw new FormulaError('#NUM!')
      const mid = Math.floor(xs.length / 2)
      const hi = xs[mid] ?? 0
      const lo = xs[mid - 1] ?? 0
      return xs.length % 2 ? hi : (lo + hi) / 2
    }
    case 'MIN': {
      const xs = flattenNums(args)
      if (xs.length === 0 && anySysmis(args)) return NaN
      return xs.length === 0 ? 0 : Math.min(...xs)
    }
    case 'MAX': {
      const xs = flattenNums(args)
      if (xs.length === 0 && anySysmis(args)) return NaN
      return xs.length === 0 ? 0 : Math.max(...xs)
    }
    case 'COUNT':
      return flattenNums(args).length
    // ── SPSS syntax functions (COMPUTE / IF / DO IF) ──
    case 'LG10': {
      const x = scalar1()
      if (x <= 0) throw new FormulaError('#NUM!')
      return Math.log10(x)
    }
    case 'TRUNC':
      return Math.trunc(scalar1())
    case 'RND': {
      // SPSS rounds halves away from zero; RND(x, mult) to a multiple of mult.
      if (args.length < 1 || args.length > 2) throw new FormulaError('#NUM!')
      const x = numify(asScalar(arg(0)))
      const mult = args.length === 2 ? numify(asScalar(arg(1))) : 1
      if (mult === 0) throw new FormulaError('#NUM!')
      const q = x / mult
      return Math.sign(q) * Math.round(Math.abs(q)) * mult
    }
    case 'MISSING':
    case 'SYSMIS': {
      if (args.length !== 1) throw new FormulaError('#NUM!')
      return isSysmis(asScalar(arg(0)))
    }
    case 'NVALID':
    case 'NMISS': {
      const scalars = args.map(asScalar)
      const nMiss = scalars.filter(isSysmis).length
      return name === 'NMISS' ? nMiss : scalars.length - nMiss
    }
    case 'SD':
    case 'VARIANCE': {
      const xs = flattenNums(args).filter(n => !Number.isNaN(n))
      if (xs.length < 2) return NaN
      const mean = xs.reduce((s, n) => s + n, 0) / xs.length
      const v = xs.reduce((s, n) => s + (n - mean) ** 2, 0) / (xs.length - 1)
      return name === 'SD' ? Math.sqrt(v) : v
    }
    case 'CONCAT':
      return args.map(a => textOf(asScalar(a))).join('')
    case 'UPCASE':
    case 'LOWER':
    case 'LTRIM':
    case 'RTRIM':
    case 'LENGTH': {
      if (args.length !== 1) throw new FormulaError('#NUM!')
      const s = textOf(asScalar(arg(0)))
      if (name === 'UPCASE') return s.toUpperCase()
      if (name === 'LOWER') return s.toLowerCase()
      if (name === 'LTRIM') return s.replace(/^\s+/, '')
      if (name === 'RTRIM') return s.replace(/\s+$/, '')
      return s.length
    }
    case 'ANY': {
      // ANY(x, v1, v2, …): x equals one of the values; missing x → missing.
      if (args.length < 2) throw new FormulaError('#NUM!')
      const x = asScalar(arg(0))
      if (isSysmis(x)) return NaN
      return args.slice(1).some(v => compare(x, asScalar(v), '=') === true)
    }
    case 'RANGE': {
      // RANGE(x, lo1, hi1 [, lo2, hi2 …]): x inside one of the closed ranges.
      if (args.length < 3 || args.length % 2 === 0) throw new FormulaError('#NUM!')
      const x = asScalar(arg(0))
      if (isSysmis(x)) return NaN
      for (let i = 1; i < args.length; i += 2) {
        const lo = asScalar(arg(i))
        const hi = asScalar(arg(i + 1))
        if (compare(x, lo, '>=') === true && compare(x, hi, '<=') === true) return true
      }
      return false
    }
    default:
      throw new FormulaError('#NAME?')
  }
}

/** Excel/SPSS truthiness: booleans as-is, 0/blank-string are false, any other
 *  number or non-empty text is true. Exported so callers evaluating a
 *  logical expression outside a formula (e.g. SPSS `IF (cond) ...`) can
 *  interpret the result the same way AND/OR/NOT do internally. */
export function truthy(v: Scalar | null): boolean {
  if (v === null) return false // system-missing condition → case not selected (SPSS IF)
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  return v.trim() !== ''
}

/**
 * Evaluates a formula string (with or without the leading "=") against a cell
 * resolver. Returns a discriminated result; never throws.
 */
export function evaluateFormula(
  src: string,
  resolve: RefResolver,
  resolveName?: NameResolver
): FormulaResult {
  try {
    const body = src.trimStart().startsWith('=') ? src.trimStart().slice(1) : src
    if (body.trim() === '') return { ok: false, error: '#NUM!' }
    const toks = tokenize(body)
    if (toks.length === 0) return { ok: false, error: '#NUM!' }
    const value = new Parser(toks, resolve, resolveName).parse()
    // NaN = system-missing in Compute (name) mode; in A1 mode it can only be a
    // math-domain error, reported like Excel.
    if (resolveName && typeof value === 'number' && Number.isNaN(value)) {
      return { ok: true, value: null }
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return { ok: false, error: '#NUM!' }
    return { ok: true, value }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.code }
    return { ok: false, error: '#VALUE!' }
  }
}

/** Extracts the distinct cell references a formula reads (0-based col/row),
 *  expanding ranges. Used by the recalc orchestration to skip formulas whose
 *  precedents didn't change (cheap, even in the recompute-all model). Returns
 *  [] if the formula can't be tokenized. */
export function extractReferences(src: string): { col: number; row: number }[] {
  const body = src.trimStart().startsWith('=') ? src.trimStart().slice(1) : src
  let toks: Token[]
  try {
    toks = tokenize(body)
  } catch {
    return []
  }
  const out: { col: number; row: number }[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (!t || t.type !== 'ref') continue
    // range?
    const b = toks[i + 2]
    if (toks[i + 1]?.type === 'colon' && b?.type === 'ref') {
      const c0 = Math.min(t.col ?? 0, b.col ?? 0)
      const c1 = Math.max(t.col ?? 0, b.col ?? 0)
      const r0 = Math.min(t.row ?? 0, b.row ?? 0)
      const r1 = Math.max(t.row ?? 0, b.row ?? 0)
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push({ col: c, row: r })
      i += 2
    } else {
      out.push({ col: t.col ?? 0, row: t.row ?? 0 })
    }
  }
  return out
}
