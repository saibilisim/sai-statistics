// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ipc-schemas.ts — zod payload schemas for the data:* / variable:* IPC channels.
 *
 * These are validated in the Main process via `handleValidated()`. They live in
 * their own module (not ipc-contracts.ts) so that importing IPC channel *names*
 * does not pull `zod` into the sandboxed preload bundle (`require('zod')` fails
 * under `sandbox: true`). Request types are inferred here = single source.
 */

import { z } from 'zod'
import { VariableSchema, CustomStylesSchema } from './data-types'
import { isAllowedPackage } from './optional-packages'
import {
  ChatMessageSchema,
  AiInterpretBlockSchema,
  AiAccountCredentialsSchema,
  AiAccountRegisterCredentialsSchema,
  AiAccountResendVerificationSchema,
  AiChatEntrySchema
} from './ai-types'
import { OutputDocumentSchema } from './output-document'
import { CaseVarSchema } from './analysis-types'

// datasetId is interpolated into SQL as a table-name suffix (`dataset_${datasetId}`)
// and DuckDB doesn't support parameter binding for identifiers — constrain it to
// the exact format the app itself generates (`ds_<timestamp>`, see file-handler.ts /
// db-handler.ts) so a compromised renderer can't smuggle SQL via datasetId.
const datasetIdField = z.string().regex(/^ds_\d+$/)
// colId is interpolated into SQL projections — strict allow-list.
const colIdField = z.string().regex(/^col_\d+$/)
const cellValueField = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const DatasetIdRequestSchema = z.object({ datasetId: datasetIdField })
export type DatasetIdRequest = z.infer<typeof DatasetIdRequestSchema>

// data:get-chunk (chunked-load-roadmap.md C1) — limit is capped in the schema
// itself so a malformed/malicious single request can't pull the whole 10M-cell
// dataset in one shot, defeating the point of chunking.
export const MAX_CHUNK_ROWS = 50_000
export const GetChunkRequestSchema = z.object({
  datasetId: datasetIdField,
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(MAX_CHUNK_ROWS)
})
export type GetChunkRequest = z.infer<typeof GetChunkRequestSchema>

// data:get-filtered — the active column filter (Select Cases). Keys are
// allow-listed colIds; operators are a fixed enum; values are bound parameters
// in the SQL builder, so no value sanitisation is needed here.
export const FilterOperatorSchema = z.enum([
  'is_empty',
  'is_not_empty',
  'equals',
  'not_equals',
  'contains',
  'starts_with',
  'ends_with',
  'in',
  'greater_than',
  'less_than',
  'greater_than_or_equal',
  'less_than_or_equal'
])
export const ColumnFilterSchema = z.object({
  operator: FilterOperatorSchema,
  value: z.string()
})
export const GetFilteredRequestSchema = z.object({
  datasetId: datasetIdField,
  columnFilters: z.record(colIdField, ColumnFilterSchema)
})
export type GetFilteredRequest = z.infer<typeof GetFilteredRequestSchema>

// data:get-split-groups — distinct values of the split variable (Split File),
// respecting the active filter, for the analysis runner to iterate per group.
export const GetSplitGroupsRequestSchema = z.object({
  datasetId: datasetIdField,
  columnFilters: z.record(colIdField, ColumnFilterSchema),
  splitColId: colIdField
})
export type GetSplitGroupsRequest = z.infer<typeof GetSplitGroupsRequestSchema>

// data:set-weight — Weight Cases (W1). colId null clears weighting.
export const SetWeightRequestSchema = z.object({
  datasetId: datasetIdField,
  colId: colIdField.nullable()
})
export type SetWeightRequest = z.infer<typeof SetWeightRequestSchema>

// data:set-split — Split File (B2, spss-parity-findings-2026-07-07). colId
// null clears splitting. Same choke-point pattern as SetWeightRequestSchema.
export const SetSplitRequestSchema = z.object({
  datasetId: datasetIdField,
  colId: colIdField.nullable()
})
export type SetSplitRequest = z.infer<typeof SetSplitRequestSchema>

// data:set-column-filters — mirrors the Renderer's active column filters
// (Data View grid / SELECT IF) into Main so AI-triggered analyses
// (run_analysis/run_syntax) can honor them too, the same way GUI dialogs
// already do by passing columnFilters explicitly. Same choke-point pattern
// as SetWeightRequestSchema/SetSplitRequestSchema.
export const SetColumnFiltersRequestSchema = z.object({
  datasetId: datasetIdField,
  columnFilters: z.record(colIdField, ColumnFilterSchema)
})
export type SetColumnFiltersRequest = z.infer<typeof SetColumnFiltersRequestSchema>

export const SetCustomStylesRequestSchema = z.object({
  datasetId: datasetIdField,
  customStyles: CustomStylesSchema.nullable()
})
export type SetCustomStylesRequest = z.infer<typeof SetCustomStylesRequestSchema>

export const UpdateCellRequestSchema = z.object({
  datasetId: datasetIdField,
  rowIndex: z.number().int().nonnegative(),
  colId: colIdField,
  value: cellValueField
})
export type UpdateCellRequest = z.infer<typeof UpdateCellRequestSchema>

export const UpdateCellsRequestSchema = z.object({
  datasetId: datasetIdField,
  updates: z
    .array(
      z.object({
        rowIndex: z.number().int().nonnegative(),
        colId: colIdField,
        value: cellValueField
      })
    )
    .max(1_000_000)
})
export type UpdateCellsRequest = z.infer<typeof UpdateCellsRequestSchema>

export const InsertRowRequestSchema = z.object({
  datasetId: datasetIdField,
  rowIndex: z.number().int().nonnegative()
})
export type InsertRowRequest = z.infer<typeof InsertRowRequestSchema>

// Bulk append at the end of the dataset (paste growth) — one snapshot/one
// dataVersion bump for N rows, see IPC.DATA_APPEND_ROWS.
export const AppendRowsRequestSchema = z.object({
  datasetId: datasetIdField,
  count: z.number().int().positive().max(1_000_000)
})
export type AppendRowsRequest = z.infer<typeof AppendRowsRequestSchema>

// delete-rows + reorder-rows: indices interpolated into SQL → integers only.
export const RowIndicesRequestSchema = z.object({
  datasetId: datasetIdField,
  rowIndices: z.array(z.number().int().nonnegative())
})
export type RowIndicesRequest = z.infer<typeof RowIndicesRequestSchema>

// insert-column / variable:add. colId may be '' on insert (backend assigns it,
// then re-validates with the strict VariableSchema), so it is relaxed here.
export const InsertColumnRequestSchema = z.object({
  datasetId: datasetIdField,
  variable: VariableSchema.extend({ colId: z.string() }),
  index: z.number().int().nonnegative().optional()
})
export type InsertColumnRequest = z.infer<typeof InsertColumnRequestSchema>

// delete-column / variable:delete
export const ColIdRequestSchema = z.object({
  datasetId: datasetIdField,
  colId: colIdField
})
export type ColIdRequest = z.infer<typeof ColIdRequestSchema>

export const ColIdsRequestSchema = z.object({
  datasetId: datasetIdField,
  colIds: z.array(colIdField).min(1)
})
export type ColIdsRequest = z.infer<typeof ColIdsRequestSchema>

export const SortRequestSchema = z.object({
  datasetId: datasetIdField,
  colId: colIdField,
  direction: z.enum(['asc', 'desc'])
})
export type SortRequest = z.infer<typeof SortRequestSchema>

// Sort Cases (SPSS Data > Sort Cases): multi-key ORDER BY, one direction per key.
export const SortMultiRequestSchema = z.object({
  datasetId: datasetIdField,
  keys: z
    .array(z.object({ colId: colIdField, direction: z.enum(['asc', 'desc']) }))
    .min(1)
    .max(16)
})
export type SortMultiRequest = z.infer<typeof SortMultiRequestSchema>

// Identify Duplicate Cases (SPSS Data > Identify Duplicate Cases): flags the
// first case in each group of "matching" variables as primary, and records
// each group's 1-based match sequence — same shape as SPSS's own
// PrimaryFirst/MatchSequence output variables.
export const IdentifyDuplicatesRequestSchema = z.object({
  datasetId: datasetIdField,
  matchColIds: z.array(colIdField).min(1).max(32),
  primaryName: z.string().min(1),
  primaryLabel: z.string().optional(),
  sequenceName: z.string().min(1),
  sequenceLabel: z.string().optional()
})
export type IdentifyDuplicatesRequest = z.infer<typeof IdentifyDuplicatesRequestSchema>

// Aggregate (SPSS Data > Aggregate): break variables + summary functions per
// source column, producing a NEW dataset (one row per break-variable group —
// "Create a new dataset" is the only mode implemented, SPSS's default and
// most common choice; "add aggregate variables to active dataset" is a
// different, rarer mode and left for a later iteration if requested).
export const AggregateFunctionSchema = z.enum([
  'mean',
  'sum',
  'n',
  'sd',
  'min',
  'max',
  'median',
  'first',
  'last'
])
export type AggregateFunction = z.infer<typeof AggregateFunctionSchema>

export const AggregateRequestSchema = z.object({
  datasetId: datasetIdField,
  breakColIds: z.array(colIdField).min(0).max(16),
  aggregates: z
    .array(
      z.object({
        colId: colIdField,
        fn: AggregateFunctionSchema,
        targetName: z.string().min(1)
      })
    )
    .min(1)
    .max(64)
})
export type AggregateRequest = z.infer<typeof AggregateRequestSchema>

// Transpose (SPSS Data > Transpose): rows become variables, variables become
// rows — produces a NEW dataset. A "Name Variable" (optional, string-typed)
// supplies the new variable NAMES (SPSS's own convention); when omitted,
// generated as var001, var002, ... An optional "case name" column with the
// original variable names is always added (SPSS calls it CASE_LBL).
export const TransposeRequestSchema = z.object({
  datasetId: datasetIdField,
  nameColId: colIdField.nullable()
})
export type TransposeRequest = z.infer<typeof TransposeRequestSchema>

// Merge Files > Add Cases (SPSS Data > Merge Files > Add Cases): stack rows
// from a second, already-imported dataset onto the active one — variables
// matched by name (case-insensitive) keep the active dataset's own
// definition; unmatched variables from either side are added as new columns
// (NULL for the rows from the dataset that didn't have them). Produces a NEW
// dataset (id A is untouched); dataset B is dropped afterwards — it only
// existed transiently to supply rows for the merge.
export const MergeAddCasesRequestSchema = z.object({
  datasetIdA: datasetIdField,
  datasetIdB: datasetIdField
})
export type MergeAddCasesRequest = z.infer<typeof MergeAddCasesRequestSchema>

// Merge Files > Add Variables (SPSS Data > Merge Files > Add Variables):
// join a second, already-imported dataset onto the active one by a key
// variable (LEFT JOIN — every case in the active dataset is kept). Colliding
// non-key variable names from B are uniquified (e.g. "age_2"), matching the
// app's existing import collision convention. Produces a NEW dataset;
// dataset B is dropped afterwards.
export const MergeAddVariablesRequestSchema = z.object({
  datasetIdA: datasetIdField,
  datasetIdB: datasetIdField,
  keyColIdA: colIdField,
  keyColIdB: colIdField
})
export type MergeAddVariablesRequest = z.infer<typeof MergeAddVariablesRequestSchema>

// Restructure > Variables to Cases (SPSS Data > Restructure, "wide to long"):
// stacks a group of wide columns (e.g. score_t1, score_t2, score_t3) into
// one long "value" column + an "index" column recording which source column
// each stacked row came from (1, 2, 3, ... in the order given). Id columns
// are kept as-is and replicated across the stacked rows. Single-group v1 —
// SPSS supports multiple simultaneous variable groups; not implemented here
// (talep gelirse eklenir, bkz. roadmap.md). Produces a NEW dataset.
export const RestructureWideToLongRequestSchema = z.object({
  datasetId: datasetIdField,
  idColIds: z.array(colIdField).max(32),
  valueColIds: z.array(colIdField).min(2).max(200),
  indexName: z.string().min(1),
  valueName: z.string().min(1)
})
export type RestructureWideToLongRequest = z.infer<typeof RestructureWideToLongRequestSchema>

export const VariableUpdateRequestSchema = z.object({
  datasetId: datasetIdField,
  colId: colIdField,
  // colId identifies the variable and is never changed through an update.
  updates: VariableSchema.partial().omit({ colId: true })
})
export type VariableUpdateRequest = z.infer<typeof VariableUpdateRequestSchema>

export const VariableReorderRequestSchema = z.object({
  datasetId: datasetIdField,
  colIds: z.array(colIdField)
})
export type VariableReorderRequest = z.infer<typeof VariableReorderRequestSchema>

// ─── Transform schemas ────────────────────────────────────────────────────────

// transform:recode
// newValue null = SYSMIS (`(9=SYSMIS)` in syntax).
const recodeMappingSchema = z.object({
  oldValue: z.string(),
  newValue: z.string().nullable()
})
// SPSS THRU/LO/HI range mapping — low/high null means unbounded (LO.../...HI).
// Evaluated against the source cast to DOUBLE, so only meaningful for numeric sources.
const recodeRangeMappingSchema = z.object({
  low: z.number().nullable(),
  high: z.number().nullable(),
  newValue: z.string().nullable()
})
export const RecodeRequestSchema = z
  .object({
    datasetId: datasetIdField,
    sourceColId: colIdField,
    // null → create new column (into different); same as sourceColId → in-place (into same)
    targetColId: colIdField.nullable(),
    targetName: z.string().min(1).optional(),
    targetLabel: z.string().optional(),
    mappings: z.array(recodeMappingSchema),
    rangeMappings: z.array(recodeRangeMappingSchema).optional(),
    // What a missing (NULL) source becomes — `(SYSMIS=9)`; null keeps it missing.
    sysmisValue: z.string().nullable().optional(),
    elseValue: z.string().nullable(), // null = preserve source value
    // ELSE = SYSMIS is a third state distinct from both "keep" (elseValue
    // null) and "set to this literal" (elseValue a string) — the unmatched
    // rows become missing, not the literal text "SYSMIS" or an empty string
    // (which used to be cast straight into a numeric column and fail).
    elseSysmis: z.boolean().optional(),
    outputType: z.enum(['string', 'numeric'])
  })
  .refine(
    r => r.mappings.length > 0 || (r.rangeMappings?.length ?? 0) > 0 || r.sysmisValue !== undefined,
    { message: 'At least one mapping or range mapping is required' }
  )
export type RecodeRequest = z.infer<typeof RecodeRequestSchema>

// transform:auto-recode
export const AutoRecodeRequestSchema = z.object({
  datasetId: datasetIdField,
  sourceColId: colIdField,
  targetName: z.string().min(1),
  targetLabel: z.string().optional(),
  order: z.enum(['ascending', 'descending'])
})
export type AutoRecodeRequest = z.infer<typeof AutoRecodeRequestSchema>

// transform:count-values
export const CountValuesRequestSchema = z.object({
  datasetId: datasetIdField,
  sourceColIds: z.array(colIdField).min(1),
  targetName: z.string().min(1),
  targetLabel: z.string().optional(),
  matchValue: z.string()
})
export type CountValuesRequest = z.infer<typeof CountValuesRequestSchema>

// transform:rank-cases
export const RankCasesRequestSchema = z.object({
  datasetId: datasetIdField,
  sourceColId: colIdField,
  targetName: z.string().min(1),
  targetLabel: z.string().optional(),
  order: z.enum(['ascending', 'descending']),
  method: z.enum(['rank', 'dense_rank', 'percent_rank'])
})
export type RankCasesRequest = z.infer<typeof RankCasesRequestSchema>

// transform:visual-binning — SPSS Visual Binning: groups a continuous
// variable into a new categorical variable via equal-width, equal-count
// (quantile), or user-supplied cut points.
export const VisualBinningRequestSchema = z.object({
  datasetId: datasetIdField,
  sourceColId: colIdField,
  targetName: z.string().min(1),
  targetLabel: z.string().optional(),
  method: z.enum(['equalWidth', 'equalCount', 'manual']),
  bins: z.number().int().min(2).max(50).optional(),
  cutPoints: z.array(z.number()).optional()
})
export type VisualBinningRequest = z.infer<typeof VisualBinningRequestSchema>

// transform:shift-values — SPSS Shift Values: a new variable holding the
// value of an existing variable n cases before (lag) or after (lead) the
// current case, in current row order.
export const ShiftValuesRequestSchema = z.object({
  datasetId: datasetIdField,
  sourceColId: colIdField,
  targetName: z.string().min(1),
  targetLabel: z.string().optional(),
  direction: z.enum(['lag', 'lead']),
  n: z.number().int().min(1).max(1000)
})
export type ShiftValuesRequest = z.infer<typeof ShiftValuesRequestSchema>

// transform:replace-missing
export const ReplaceMissingRequestSchema = z.object({
  datasetId: datasetIdField,
  colId: colIdField,
  method: z.enum(['mean', 'median', 'mode', 'value']),
  value: z.string().optional()
})
export type ReplaceMissingRequest = z.infer<typeof ReplaceMissingRequestSchema>

// transform:create-variables — an analysis's case-level output as new columns.
// `variables` is CaseVarSchema (shared/analysis-types.ts) with the per-value
// alignment key; the handler re-checks length, range and name collisions
// before it touches the table, because a caseVar payload has travelled
// R -> stdout JSON -> job-manager -> renderer -> back here and only the
// dataset itself knows how many rows there actually are.
export const CreateVariablesRequestSchema = z.object({
  datasetId: datasetIdField,
  variables: z.array(CaseVarSchema).min(1).max(64)
})
export type CreateVariablesRequest = z.infer<typeof CreateVariablesRequestSchema>

// ─── Analysis schemas ─────────────────────────────────────────────────────────

export const ColumnFilterSchemaForAnalysis = z.record(
  colIdField,
  z.object({ operator: FilterOperatorSchema, value: z.string() })
)

export const AnalysisRunRequestSchema = z.object({
  analysisId: z.string().min(1),
  datasetId: datasetIdField,
  scriptFile: z.string().regex(/^[\w-]+\.R$/), // e.g. "descriptives.R"
  params: z.record(z.string(), z.unknown()),
  columnFilters: ColumnFilterSchemaForAnalysis.optional(),
  summary: z.string().optional(),
  syntax: z.string().optional()
})
export type AnalysisRunRequest = z.infer<typeof AnalysisRunRequestSchema>

export const AnalysisCancelRequestSchema = z.object({
  jobId: z.uuid()
})
export type AnalysisCancelRequest = z.infer<typeof AnalysisCancelRequestSchema>

// ─── Optional R package install ───────────────────────────────────────────────
// `package` is constrained to the allow-list (shared/optional-packages.ts) to
// prevent arbitrary install.packages() injection.
export const InstallPackageRequestSchema = z.object({
  package: z.string().refine(isAllowedPackage, 'Package not in allow-list')
})
export type InstallPackageRequest = z.infer<typeof InstallPackageRequestSchema>

// ─── Terminal — persistent R console (Faz T2) ─────────────────────────────────
// NOTE: `code` is deliberately NOT allow-listed — the R console is the user's own
// local code (CLAUDE.md §9 exception). It is still typed + senderFrame-validated,
// and never auto-run (the renderer writes only on explicit user action).
export const TerminalRStartRequestSchema = z.object({
  datasetId: datasetIdField.optional()
})
export type TerminalRStartRequest = z.infer<typeof TerminalRStartRequestSchema>

export const TerminalRWriteRequestSchema = z.object({
  code: z.string()
})
export type TerminalRWriteRequest = z.infer<typeof TerminalRWriteRequestSchema>

export const TerminalRRunRequestSchema = z.object({
  code: z.string(),
  runId: z.string().regex(/^[0-9a-f-]{8,64}$/)
})

export const TerminalRReloadRequestSchema = z.object({
  datasetId: datasetIdField.optional()
})
export type TerminalRReloadRequest = z.infer<typeof TerminalRReloadRequestSchema>

export const TerminalRCompleteRequestSchema = z.object({
  /** The editor/console line up to the caret. */
  line: z.string().max(10_000)
})
export type TerminalRCompleteRequest = z.infer<typeof TerminalRCompleteRequestSchema>

const rViewIdField = z.string().regex(/^rview_\d+$/)
export const TerminalRViewRowsRequestSchema = z.object({
  viewId: rViewIdField,
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(5000),
  /** Column NAME — checked against the view's own column list before use. */
  sortCol: z.string().max(10_000).optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
})
export type TerminalRViewRowsRequest = z.infer<typeof TerminalRViewRowsRequestSchema>

export const TerminalRCommitResolveRequestSchema = z.object({
  commitId: z.string().regex(/^commit_\d+$/),
  accept: z.boolean()
})
export type TerminalRCommitResolveRequest = z.infer<typeof TerminalRCommitResolveRequestSchema>

// Packages pane install. NOT allow-listed (unlike r:install-package, which
// serves analyses): this is the console's own "install.packages()", the user's
// explicit action under the CLAUDE.md §9 console exception — it grants nothing
// the console input does not. The name is still a strict R package name.
export const TerminalRPkgInstallRequestSchema = z.object({
  name: z
    .string()
    .max(100)
    .regex(/^[A-Za-z][A-Za-z0-9.]*[A-Za-z0-9]$/)
})
export type TerminalRPkgInstallRequest = z.infer<typeof TerminalRPkgInstallRequestSchema>
export const RConsolePackagesMarkerSchema = z.array(
  z.object({ name: z.string(), version: z.string(), lib: z.string(), attached: z.boolean() })
)

export const TerminalRPlotExportRequestSchema = z.object({
  plotId: z.number().int().min(1),
  format: z.enum(['png', 'svg', 'pdf']),
  widthCm: z.number().min(1).max(100),
  heightCm: z.number().min(1).max(100),
  /** PNG only; SVG/PDF are vector. */
  dpi: z.number().int().min(72).max(1200)
})
export type TerminalRPlotExportRequest = z.infer<typeof TerminalRPlotExportRequestSchema>
export const RConsolePlotExportMarkerSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional()
})

export const TerminalRViewCloseRequestSchema = z.object({ viewId: rViewIdField })
export type TerminalRViewCloseRequest = z.infer<typeof TerminalRViewCloseRequestSchema>

// R → Main side-channel payloads (_r_console.R markers). R output is
// validated before it is trusted, like every other R result (§8).
export const RConsoleViewMarkerSchema = z.object({ path: z.string(), title: z.string() })
// sai_commit(): `variables` is validated main-side (StatVariablesSchema).
export const RConsoleCommitMarkerSchema = z.object({
  path: z.string(),
  name: z.string(),
  rows: z.number().int().min(0),
  cols: z.number().int().min(0),
  variables: z.array(z.unknown())
})
export const RConsoleTracebackMarkerSchema = z.array(z.string()).max(50)
export const RConsoleWidgetMarkerSchema = z.object({ dir: z.string(), title: z.string() })
export const RConsoleHelpMarkerSchema = z.object({ path: z.string(), title: z.string().optional() })
export const RConsoleEnvItemSchema = z.object({
  name: z.string(),
  cls: z.string(),
  kind: z.enum(['data', 'function', 'value']),
  dims: z.array(z.number()).nullable().optional(),
  desc: z.string(),
  size: z.number()
})
/** The global environment — or, while the debugger waits, the browsed frame + its call. */
export const RConsoleEnvMarkerSchema = z.union([
  z.array(RConsoleEnvItemSchema),
  z.object({ frame: z.string(), items: z.array(RConsoleEnvItemSchema) })
])
/** Files pane: the working directory and (up to 500 of `total`) entries. */
export const RConsoleWdMarkerSchema = z.object({
  wd: z.string(),
  total: z.number().int().min(0),
  files: z.array(z.object({ name: z.string(), dir: z.boolean(), size: z.number().min(0) })).max(500)
})
// terminal:r:open-file — a script listed in the Files pane, by bare name.
export const TerminalROpenFileRequestSchema = z
  .object({ name: z.string().min(1).max(255) })
  .strict()
export const RConsoleCompleteMarkerSchema = z.object({
  token: z.string(),
  items: z.array(z.object({ text: z.string(), fn: z.boolean(), args: z.string() }))
})

// ─── File — dialogs open/save native files, so payloads are mostly OS paths
// the main process itself produced via dialog.showOpenDialog/showSaveDialog.
// `filePath` when supplied directly by the renderer (e.g. Recent Files) is
// still typed + senderFrame-validated here; path traversal is not meaningful
// for these operations (dialog.show* / fs read the literal path, no SQL/shell
// interpolation), but the shape must match to reach the handler at all.
export const FileOpenRequestSchema = z.string().min(1).optional()
export type FileOpenRequest = z.infer<typeof FileOpenRequestSchema>

export const FileSaveDataRequestSchema = z.object({
  datasetId: datasetIdField,
  customStyles: CustomStylesSchema.nullish(),
  chatHistory: z.array(AiChatEntrySchema).nullish(),
  /** Output sekmesi — .sdf içine output.json olarak gömülür. */
  outputDocument: OutputDocumentSchema.nullish()
})
export type FileSaveDataRequest = z.infer<typeof FileSaveDataRequestSchema>

// file:save-output — self-contained Output-tab HTML export (P0.2)
export const FileSaveOutputRequestSchema = z.object({
  html: z.string().min(1),
  defaultName: z.string().min(1)
})
export type FileSaveOutputRequest = z.infer<typeof FileSaveOutputRequestSchema>

// app:set-output-dirty — renderer tells Main whether Output has changes not
// yet saved into the .sdf, so the window-close guard (main.ts) can ask to save.
export const SetOutputDirtyRequestSchema = z.object({ dirty: z.boolean() })
export type SetOutputDirtyRequest = z.infer<typeof SetOutputDirtyRequestSchema>

// app:get-startup-info — renderer sends its recentFiles list (settings) so
// Main can report which still exist on disk. Same cap as settings.recentFiles.
export const GetStartupInfoRequestSchema = z.object({
  recentFiles: z.array(z.string().min(1)).max(20)
})
export type GetStartupInfoRequest = z.infer<typeof GetStartupInfoRequestSchema>

// file:export-output-text — generic save-dialog-then-write-text, backing the
// Export Output dialog's Word/Excel/CSV/Markdown formats. `extensions` is
// constrained to plain lowercase-alnum tokens — it only ever feeds the save
// dialog's file-type filter, but stays allow-listed rather than free-form.
export const FileExportOutputTextRequestSchema = z.object({
  content: z.string(),
  defaultName: z.string().min(1),
  filterName: z.string().min(1),
  extensions: z.array(z.string().regex(/^[a-z0-9]+$/)).min(1)
})
export type FileExportOutputTextRequest = z.infer<typeof FileExportOutputTextRequestSchema>

// file:export-output-binary — the same save flow for the native .docx/.xlsx
// exports, whose bytes the renderer builds (output-export-office.ts). Capped
// well above any realistic report (plots are a few hundred KB each).
export const OUTPUT_EXPORT_MAX_BYTES = 256 * 1024 * 1024
export const FileExportOutputBinaryRequestSchema = z.object({
  data: z
    .instanceof(Uint8Array)
    .refine(d => d.byteLength > 0 && d.byteLength <= OUTPUT_EXPORT_MAX_BYTES),
  defaultName: z.string().min(1),
  filterName: z.string().min(1),
  extensions: z.array(z.string().regex(/^[a-z0-9]+$/)).min(1)
})
export type FileExportOutputBinaryRequest = z.infer<typeof FileExportOutputBinaryRequestSchema>

// file:open-syntax / file:save-syntax — Sözdizimi sekmesinin .sps dosyaları.
// Main owns the native dialog + disk I/O; the text is size-capped both ways.
export const SYNTAX_FILE_MAX_CHARS = 5_000_000
// `kind` picks the file type: SPSS syntax (default) or an R script (R mode).
const syntaxKindField = z.enum(['spss', 'r']).optional()
export const FileOpenSyntaxRequestSchema = z.object({ kind: syntaxKindField }).strict()
export const FileSaveSyntaxRequestSchema = z.object({
  content: z.string().max(SYNTAX_FILE_MAX_CHARS),
  defaultName: z.string().min(1).max(255),
  kind: syntaxKindField,
  // Save without a dialog — honoured only for a path the user picked in this
  // session's open/save syntax dialog (Main keeps that list); anything else
  // falls back to the dialog.
  filePath: z.string().min(1).max(4096).optional()
})
export type FileSaveSyntaxRequest = z.infer<typeof FileSaveSyntaxRequestSchema>

export const FileImportRequestSchema = z
  .object({
    filePath: z.string().min(1).optional(),
    fileType: z.enum(['csv', 'excel', 'spss', 'stata', 'sas']).optional(),
    options: z
      .object({
        delimiter: z.string().optional(),
        header: z.boolean().optional(),
        encoding: z.string().optional()
      })
      .optional()
  })
  .optional()
export type FileImportRequest = z.infer<typeof FileImportRequestSchema>

export const FileExportRequestSchema = z.object({
  datasetId: datasetIdField,
  // Honored only by the E2E runner (approved-paths.ts testOnlyPath); exports
  // otherwise always go through the native save dialog.
  filePath: z.string().min(1).optional()
})
export type FileExportRequest = z.infer<typeof FileExportRequestSchema>

// Dropped/picked File → Main approves the OS path (webUtils.getPathForFile only
// yields a path for a genuine user-supplied File) before file:import may read it.
export const FileApprovePathRequestSchema = z.string().min(1)

// ─── Settings ──────────────────────────────────────────────────────────────
export const SettingsSetRequestSchema = z.object({
  path: z.string().min(1),
  value: z.unknown()
})
export type SettingsSetRequest = z.infer<typeof SettingsSetRequestSchema>

// ─── AI (Faz F0, ai-entegrasyon-fizibilitesi.md §7) ─────────────────────────
// ai:interpret şeması ai-types.ts'de (AnalysisResultSchema'yı yeniden kullanır);
// burada yalnız ai-types'a ait olmayan request şemaları var.

// ai:send — sohbet geçmişi. Üst sınır, context kırpma (§10 maliyet riski)
// Renderer'a gelmeden Main'de garanti altına alınsın diye.
// mentionBlocks (§5.4 "Sohbette Aç"): Renderer, mention'lanan Output
// bloklarının payload'ını (AiInterpretBlockSchema — ai:interpret ile aynı
// şekil) gönderir; Main bunları agent döngüsü context'ine DATA bölümü olarak
// enjekte eder. ~5 blok üst sınırı context şişmesine karşı.
export const AiSendRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(200),
  mentionBlocks: z.array(AiInterpretBlockSchema).max(5).optional()
})
export type AiSendRequest = z.infer<typeof AiSendRequestSchema>

// ai:cancel — turnId, ai:send'in ürettiği UUID (analysis:cancel deseniyle aynı).
export const AiCancelRequestSchema = z.object({
  turnId: z.uuid()
})
export type AiCancelRequest = z.infer<typeof AiCancelRequestSchema>

// diag:contact-support — mailto gövdesi (sistem bilgisi + kullanıcı metni).
// Alıcı/konu Main'de sabit; yalnız gövde taşınır. Üst sınır mailto pratik
// uzunluğunu aşmasın diye (çok uzun body bazı istemcilerde kırpılır) 5000.
export const DiagContactSupportRequestSchema = z.object({
  body: z.string().max(5000).optional()
})
export type DiagContactSupportRequest = z.infer<typeof DiagContactSupportRequestSchema>

// ai:account:register / ai:account:login — 'server' provider (bizim kotamız,
// SAI hesabı). Şekil ai-types.ts AiAccountCredentialsSchema ile aynı; request
// şemaları burada (diğer *RequestSchema'larla aynı yerde) tutulur.
// Kayıt, girişten AYRI şema kullanır (2026-08-15): kayıt şifre politikasını
// (AI_PASSWORD_MIN_LENGTH + yaygın-şifre/e-posta-içerme kuralları) zorunlu
// kılar, giriş kılmaz — eski hesapların şifresi yeni politikayı sağlamayabilir.
export const AiAccountRegisterRequestSchema = AiAccountRegisterCredentialsSchema
export type AiAccountRegisterRequest = z.infer<typeof AiAccountRegisterRequestSchema>

export const AiAccountLoginRequestSchema = AiAccountCredentialsSchema
export type AiAccountLoginRequest = z.infer<typeof AiAccountLoginRequestSchema>

export const AiAccountResendVerificationRequestSchema = AiAccountResendVerificationSchema
export type AiAccountResendVerificationRequest = z.infer<
  typeof AiAccountResendVerificationRequestSchema
>

// Tam auth (2026-08-15): şifre sıfırlama / değiştirme / e-posta değiştirme / silme.
// Parola alt sınırları GİRİŞ tarafıyla uyumlu (min 8) — yeni parolanın politikası
// (min 10 + …) UI'da checkPasswordPolicy ile ve sunucuda bağımsız uygulanır.
export const AiAccountForgotRequestSchema = z.object({
  email: z.email().max(254).trim()
})
export type AiAccountForgotRequest = z.infer<typeof AiAccountForgotRequestSchema>

export const AiAccountChangePasswordRequestSchema = z.object({
  oldPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200)
})
export type AiAccountChangePasswordRequest = z.infer<typeof AiAccountChangePasswordRequestSchema>

export const AiAccountChangeEmailRequestSchema = z.object({
  newEmail: z.email().max(254).trim(),
  password: z.string().min(1).max(200)
})
export type AiAccountChangeEmailRequest = z.infer<typeof AiAccountChangeEmailRequestSchema>

// Silme geri alınamaz; bearer token tek başına yetmez. İki kanıt biçimi:
// parola (parolalı hesap) VEYA googleReauth (Google ile bağlı hesap — Main'in
// yakın zamanlı Google doğrulamasını tutuyor, Renderer bunu kendisi üretemez).
export const AiAccountDeleteRequestSchema = z.union([
  z.object({ password: z.string().min(1).max(200) }),
  z.object({ googleReauth: z.literal(true) })
])
export type AiAccountDeleteRequest = z.infer<typeof AiAccountDeleteRequestSchema>

// ai:account:checkout — kredi paketi variant ID'si (server/src/routes/billing.ts
// GET /billing/packs'ten gelen değerlerden biri; sunucu zaten CREDIT_PACKS'e
// karşı ayrıca doğruluyor, burada yalnız zarf şekli garantilenir).
export const AiCheckoutRequestSchema = z.object({
  variantId: z.string().min(1)
})
export type AiCheckoutRequest = z.infer<typeof AiCheckoutRequestSchema>
