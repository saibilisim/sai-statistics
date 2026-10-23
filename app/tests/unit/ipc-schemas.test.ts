// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest'
import type { ZodType } from 'zod'
import {
  DatasetIdRequestSchema,
  GetChunkRequestSchema,
  GetFilteredRequestSchema,
  GetSplitGroupsRequestSchema,
  SetWeightRequestSchema,
  SetSplitRequestSchema,
  UpdateCellRequestSchema,
  UpdateCellsRequestSchema,
  InsertRowRequestSchema,
  RowIndicesRequestSchema,
  InsertColumnRequestSchema,
  ColIdRequestSchema,
  SortRequestSchema,
  SortMultiRequestSchema,
  IdentifyDuplicatesRequestSchema,
  AggregateRequestSchema,
  TransposeRequestSchema,
  MergeAddCasesRequestSchema,
  MergeAddVariablesRequestSchema,
  RestructureWideToLongRequestSchema,
  VariableUpdateRequestSchema,
  VariableReorderRequestSchema,
  RecodeRequestSchema,
  AutoRecodeRequestSchema,
  CountValuesRequestSchema,
  RankCasesRequestSchema,
  VisualBinningRequestSchema,
  ShiftValuesRequestSchema,
  ReplaceMissingRequestSchema,
  AnalysisRunRequestSchema,
  AnalysisCancelRequestSchema,
  InstallPackageRequestSchema,
  TerminalRStartRequestSchema,
  TerminalRWriteRequestSchema,
  FileOpenRequestSchema,
  FileSaveDataRequestSchema,
  FileSaveOutputRequestSchema,
  SetOutputDirtyRequestSchema,
  FileImportRequestSchema,
  FileExportRequestSchema,
  SettingsSetRequestSchema,
  AiSendRequestSchema
} from '../../shared/ipc-schemas'

// ─────────────────────────────────────────────────────────────
//  Shared negative fixtures — mirror the trust-boundary comments in
//  ipc-schemas.ts: datasetId/colId are interpolated into SQL identifiers
//  (no prepared-statement binding possible for identifiers), so a
//  compromised renderer smuggling SQL through these fields must be rejected
//  by the schema itself, not downstream.
// ─────────────────────────────────────────────────────────────

const VALID_DATASET_ID = 'ds_1234567890'
const BAD_DATASET_IDS = [
  '', // empty
  'ds_', // no digits
  'ds_abc', // non-numeric suffix
  'dataset_1', // wrong prefix (pre-fix format)
  'ds_1; DROP TABLE dataset_1;--', // SQL injection attempt
  'ds_1 UNION SELECT * FROM dataset_2', // SQL injection attempt
  '../../etc/passwd', // path traversal shaped
  123, // wrong type
  null,
  undefined
]

const VALID_COL_ID = 'col_1'
const BAD_COL_IDS = [
  '',
  'col_',
  'col_abc',
  'column_1',
  'col_1"; DROP TABLE x;--',
  '__row_idx', // reserved internal column, not a user colId
  123,
  null
]

/** Asserts `schema` rejects every value in `badValues` when substituted into
 *  `field` of `validPayload`, and accepts `validPayload` itself unmodified. */
function expectFieldRejectsAll(
  schema: ZodType,
  validPayload: Record<string, unknown>,
  field: string,
  badValues: unknown[]
): void {
  expect(schema.safeParse(validPayload).success, 'valid payload should parse').toBe(true)
  for (const bad of badValues) {
    const payload = { ...validPayload, [field]: bad }
    const result = schema.safeParse(payload)
    expect(result.success, `expected rejection for ${field} = ${JSON.stringify(bad)}`).toBe(false)
  }
}

describe('ipc-schemas: datasetId trust boundary', () => {
  it('DatasetIdRequestSchema', () => {
    expectFieldRejectsAll(
      DatasetIdRequestSchema,
      { datasetId: VALID_DATASET_ID },
      'datasetId',
      BAD_DATASET_IDS
    )
  })

  it('GetChunkRequestSchema', () => {
    expectFieldRejectsAll(
      GetChunkRequestSchema,
      { datasetId: VALID_DATASET_ID, offset: 0, limit: 100 },
      'datasetId',
      BAD_DATASET_IDS
    )
  })

  it('UpdateCellRequestSchema', () => {
    expectFieldRejectsAll(
      UpdateCellRequestSchema,
      { datasetId: VALID_DATASET_ID, rowIndex: 0, colId: VALID_COL_ID, value: 'x' },
      'datasetId',
      BAD_DATASET_IDS
    )
  })

  it('SetWeightRequestSchema / SetSplitRequestSchema accept null colId (clears weight/split)', () => {
    expect(
      SetWeightRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, colId: null }).success
    ).toBe(true)
    expect(
      SetSplitRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, colId: null }).success
    ).toBe(true)
  })

  it('MergeAddCasesRequestSchema rejects malformed datasetIdA/B', () => {
    expectFieldRejectsAll(
      MergeAddCasesRequestSchema,
      { datasetIdA: VALID_DATASET_ID, datasetIdB: 'ds_2' },
      'datasetIdA',
      BAD_DATASET_IDS
    )
    expectFieldRejectsAll(
      MergeAddCasesRequestSchema,
      { datasetIdA: VALID_DATASET_ID, datasetIdB: 'ds_2' },
      'datasetIdB',
      BAD_DATASET_IDS
    )
  })
})

describe('ipc-schemas: colId trust boundary', () => {
  it('ColIdRequestSchema', () => {
    expectFieldRejectsAll(
      ColIdRequestSchema,
      { datasetId: VALID_DATASET_ID, colId: VALID_COL_ID },
      'colId',
      BAD_COL_IDS
    )
  })

  it('SortRequestSchema', () => {
    expectFieldRejectsAll(
      SortRequestSchema,
      { datasetId: VALID_DATASET_ID, colId: VALID_COL_ID, direction: 'asc' },
      'colId',
      BAD_COL_IDS
    )
    expect(
      SortRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        colId: VALID_COL_ID,
        direction: 'sideways'
      }).success
    ).toBe(false)
  })

  it('SortMultiRequestSchema enforces 1-16 keys', () => {
    const key = { colId: VALID_COL_ID, direction: 'asc' as const }
    expect(
      SortMultiRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, keys: [] }).success
    ).toBe(false)
    expect(
      SortMultiRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, keys: [key] }).success
    ).toBe(true)
    expect(
      SortMultiRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        keys: Array.from({ length: 17 }, () => key)
      }).success
    ).toBe(false)
  })

  it('VariableUpdateRequestSchema rejects malformed colId', () => {
    expectFieldRejectsAll(
      VariableUpdateRequestSchema,
      { datasetId: VALID_DATASET_ID, colId: VALID_COL_ID, updates: {} },
      'colId',
      BAD_COL_IDS
    )
  })

  it('VariableReorderRequestSchema rejects a non-col_ id in the array', () => {
    expect(
      VariableReorderRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        colIds: [VALID_COL_ID]
      }).success
    ).toBe(true)
    expect(
      VariableReorderRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        colIds: ['col_1; DROP TABLE x']
      }).success
    ).toBe(false)
  })
})

describe('ipc-schemas: GetChunkRequestSchema bounds', () => {
  const base = { datasetId: VALID_DATASET_ID }

  it('accepts a valid chunk request', () => {
    expect(GetChunkRequestSchema.safeParse({ ...base, offset: 0, limit: 50_000 }).success).toBe(
      true
    )
  })

  it('rejects limit above the 50,000-row cap (defeats the point of chunking)', () => {
    expect(GetChunkRequestSchema.safeParse({ ...base, offset: 0, limit: 50_001 }).success).toBe(
      false
    )
  })

  it('rejects limit below 1, negative offset, and non-integers', () => {
    expect(GetChunkRequestSchema.safeParse({ ...base, offset: 0, limit: 0 }).success).toBe(false)
    expect(GetChunkRequestSchema.safeParse({ ...base, offset: -1, limit: 100 }).success).toBe(false)
    expect(GetChunkRequestSchema.safeParse({ ...base, offset: 0.5, limit: 100 }).success).toBe(
      false
    )
  })
})

describe('ipc-schemas: cell value type union', () => {
  it('accepts string, number, boolean, null; rejects object/array/undefined', () => {
    const base = { datasetId: VALID_DATASET_ID, rowIndex: 0, colId: VALID_COL_ID }
    for (const value of ['x', 1, true, null]) {
      expect(
        UpdateCellRequestSchema.safeParse({ ...base, value }).success,
        JSON.stringify(value)
      ).toBe(true)
    }
    for (const value of [{ v: 1 }, [1, 2], undefined]) {
      expect(
        UpdateCellRequestSchema.safeParse({ ...base, value }).success,
        JSON.stringify(value)
      ).toBe(false)
    }
  })

  it('UpdateCellsRequestSchema validates every entry in the batch', () => {
    const good = { rowIndex: 0, colId: VALID_COL_ID, value: 'x' }
    expect(
      UpdateCellsRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, updates: [good] }).success
    ).toBe(true)
    expect(
      UpdateCellsRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        updates: [good, { ...good, colId: 'not-a-col-id' }]
      }).success
    ).toBe(false)
  })
})

describe('ipc-schemas: structural ops', () => {
  it('InsertRowRequestSchema rejects negative rowIndex', () => {
    expect(
      InsertRowRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, rowIndex: 0 }).success
    ).toBe(true)
    expect(
      InsertRowRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, rowIndex: -1 }).success
    ).toBe(false)
  })

  it('RowIndicesRequestSchema rejects non-integer / negative indices', () => {
    expect(
      RowIndicesRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, rowIndices: [0, 1, 2] })
        .success
    ).toBe(true)
    expect(
      RowIndicesRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, rowIndices: [0, -1] })
        .success
    ).toBe(false)
    expect(
      RowIndicesRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, rowIndices: [1.5] }).success
    ).toBe(false)
  })

  it('InsertColumnRequestSchema requires a full Variable-shaped payload', () => {
    expect(
      InsertColumnRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, variable: { colId: '' } })
        .success
    ).toBe(false)
  })
})

describe('ipc-schemas: Identify Duplicates / Aggregate / Restructure bounds', () => {
  it('IdentifyDuplicatesRequestSchema enforces 1-32 matchColIds', () => {
    const base = { datasetId: VALID_DATASET_ID, primaryName: 'p', sequenceName: 's' }
    expect(IdentifyDuplicatesRequestSchema.safeParse({ ...base, matchColIds: [] }).success).toBe(
      false
    )
    expect(
      IdentifyDuplicatesRequestSchema.safeParse({ ...base, matchColIds: [VALID_COL_ID] }).success
    ).toBe(true)
    expect(
      IdentifyDuplicatesRequestSchema.safeParse({
        ...base,
        matchColIds: Array.from({ length: 33 }, (_, i) => `col_${String(i)}`)
      }).success
    ).toBe(false)
  })

  it('AggregateRequestSchema requires at least one aggregate', () => {
    expect(
      AggregateRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        breakColIds: [],
        aggregates: []
      }).success
    ).toBe(false)
    expect(
      AggregateRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        breakColIds: [],
        aggregates: [{ colId: VALID_COL_ID, fn: 'mean', targetName: 't' }]
      }).success
    ).toBe(true)
    expect(
      AggregateRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        breakColIds: [],
        aggregates: [{ colId: VALID_COL_ID, fn: 'bogus', targetName: 't' }]
      }).success
    ).toBe(false)
  })

  it('RestructureWideToLongRequestSchema requires >= 2 valueColIds', () => {
    const base = { datasetId: VALID_DATASET_ID, idColIds: [], indexName: 'idx', valueName: 'val' }
    expect(
      RestructureWideToLongRequestSchema.safeParse({ ...base, valueColIds: [VALID_COL_ID] }).success
    ).toBe(false)
    expect(
      RestructureWideToLongRequestSchema.safeParse({ ...base, valueColIds: ['col_1', 'col_2'] })
        .success
    ).toBe(true)
  })

  it('TransposeRequestSchema / MergeAddVariablesRequestSchema accept the happy path', () => {
    expect(
      TransposeRequestSchema.safeParse({ datasetId: VALID_DATASET_ID, nameColId: null }).success
    ).toBe(true)
    expect(
      MergeAddVariablesRequestSchema.safeParse({
        datasetIdA: VALID_DATASET_ID,
        datasetIdB: 'ds_2',
        keyColIdA: VALID_COL_ID,
        keyColIdB: 'col_2'
      }).success
    ).toBe(true)
  })

  it('GetFilteredRequestSchema / GetSplitGroupsRequestSchema reject non-col_ filter keys', () => {
    expect(
      GetFilteredRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        columnFilters: { [VALID_COL_ID]: { operator: 'equals', value: '1' } }
      }).success
    ).toBe(true)
    expect(
      GetFilteredRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        columnFilters: { 'not-a-col-id': { operator: 'equals', value: '1' } }
      }).success
    ).toBe(false)
    expect(
      GetSplitGroupsRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        columnFilters: {},
        splitColId: 'bad'
      }).success
    ).toBe(false)
  })
})

describe('ipc-schemas: transform requests', () => {
  it('RecodeRequestSchema refine requires at least one mapping or range mapping', () => {
    const base = {
      datasetId: VALID_DATASET_ID,
      sourceColId: VALID_COL_ID,
      targetColId: null,
      mappings: [],
      elseValue: null,
      outputType: 'numeric' as const
    }
    expect(RecodeRequestSchema.safeParse(base).success).toBe(false)
    expect(
      RecodeRequestSchema.safeParse({ ...base, mappings: [{ oldValue: '1', newValue: '2' }] })
        .success
    ).toBe(true)
    expect(
      RecodeRequestSchema.safeParse({
        ...base,
        rangeMappings: [{ low: 0, high: 10, newValue: 'x' }]
      }).success
    ).toBe(true)
  })

  it('AutoRecodeRequestSchema / CountValuesRequestSchema / RankCasesRequestSchema reject bad enums', () => {
    expect(
      AutoRecodeRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        sourceColId: VALID_COL_ID,
        targetName: 't',
        order: 'sideways'
      }).success
    ).toBe(false)
    expect(
      CountValuesRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        sourceColIds: [],
        targetName: 't',
        matchValue: '1'
      }).success
    ).toBe(false) // sourceColIds min 1
    expect(
      RankCasesRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        sourceColId: VALID_COL_ID,
        targetName: 't',
        order: 'ascending',
        method: 'bogus'
      }).success
    ).toBe(false)
  })

  it('VisualBinningRequestSchema caps bins at 2-50', () => {
    const base = {
      datasetId: VALID_DATASET_ID,
      sourceColId: VALID_COL_ID,
      targetName: 't',
      method: 'equalWidth' as const
    }
    expect(VisualBinningRequestSchema.safeParse({ ...base, bins: 1 }).success).toBe(false)
    expect(VisualBinningRequestSchema.safeParse({ ...base, bins: 51 }).success).toBe(false)
    expect(VisualBinningRequestSchema.safeParse({ ...base, bins: 10 }).success).toBe(true)
  })

  it('ShiftValuesRequestSchema caps n at 1-1000', () => {
    const base = {
      datasetId: VALID_DATASET_ID,
      sourceColId: VALID_COL_ID,
      targetName: 't',
      direction: 'lag' as const
    }
    expect(ShiftValuesRequestSchema.safeParse({ ...base, n: 0 }).success).toBe(false)
    expect(ShiftValuesRequestSchema.safeParse({ ...base, n: 1001 }).success).toBe(false)
    expect(ShiftValuesRequestSchema.safeParse({ ...base, n: 5 }).success).toBe(true)
  })

  it('ReplaceMissingRequestSchema rejects an unknown method', () => {
    expect(
      ReplaceMissingRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        colId: VALID_COL_ID,
        method: 'mean'
      }).success
    ).toBe(true)
    expect(
      ReplaceMissingRequestSchema.safeParse({
        datasetId: VALID_DATASET_ID,
        colId: VALID_COL_ID,
        method: 'guess'
      }).success
    ).toBe(false)
  })
})

describe('ipc-schemas: analysis + R package install', () => {
  it('AnalysisRunRequestSchema scriptFile only accepts a bare "<word>.R" filename (no path traversal)', () => {
    const base = { analysisId: 'descriptives', datasetId: VALID_DATASET_ID, params: {} }
    expect(
      AnalysisRunRequestSchema.safeParse({ ...base, scriptFile: 'descriptives.R' }).success
    ).toBe(true)
    for (const scriptFile of [
      '../../../etc/passwd',
      '/etc/passwd',
      'descriptives.R; rm -rf /',
      'descriptives.js',
      'sub/dir/descriptives.R',
      ''
    ]) {
      expect(AnalysisRunRequestSchema.safeParse({ ...base, scriptFile }).success, scriptFile).toBe(
        false
      )
    }
  })

  it('AnalysisCancelRequestSchema requires a UUID jobId', () => {
    expect(AnalysisCancelRequestSchema.safeParse({ jobId: 'not-a-uuid' }).success).toBe(false)
    expect(
      AnalysisCancelRequestSchema.safeParse({ jobId: '123e4567-e89b-12d3-a456-426614174000' })
        .success
    ).toBe(true)
  })

  it('InstallPackageRequestSchema only accepts allow-listed package names', () => {
    expect(InstallPackageRequestSchema.safeParse({ package: 'lme4' }).success).toBe(true)
    expect(InstallPackageRequestSchema.safeParse({ package: 'jsonlite' }).success).toBe(true)
    for (const pkg of ['rm -rf /', 'lme4; system("whoami")', 'not-on-the-allowlist', '']) {
      expect(InstallPackageRequestSchema.safeParse({ package: pkg }).success, pkg).toBe(false)
    }
  })
})

describe('ipc-schemas: terminal / file / settings', () => {
  it('TerminalRStartRequestSchema / TerminalRWriteRequestSchema accept the expected shapes', () => {
    expect(TerminalRStartRequestSchema.safeParse({}).success).toBe(true)
    expect(TerminalRStartRequestSchema.safeParse({ datasetId: VALID_DATASET_ID }).success).toBe(
      true
    )
    expect(TerminalRStartRequestSchema.safeParse({ datasetId: 'bad' }).success).toBe(false)
    expect(TerminalRWriteRequestSchema.safeParse({ code: 'print(1)' }).success).toBe(true)
    expect(TerminalRWriteRequestSchema.safeParse({ code: 123 }).success).toBe(false)
  })

  it('FileOpenRequestSchema is an optional non-empty string', () => {
    expect(FileOpenRequestSchema.safeParse(undefined).success).toBe(true)
    expect(FileOpenRequestSchema.safeParse('/some/path.sdf').success).toBe(true)
    expect(FileOpenRequestSchema.safeParse('').success).toBe(false)
  })

  it('FileSaveDataRequestSchema / FileExportRequestSchema require a valid datasetId', () => {
    expectFieldRejectsAll(
      FileSaveDataRequestSchema,
      { datasetId: VALID_DATASET_ID },
      'datasetId',
      BAD_DATASET_IDS
    )
    expectFieldRejectsAll(
      FileExportRequestSchema,
      { datasetId: VALID_DATASET_ID },
      'datasetId',
      BAD_DATASET_IDS
    )
  })

  it('FileSaveOutputRequestSchema rejects empty html/defaultName', () => {
    expect(
      FileSaveOutputRequestSchema.safeParse({ html: '<html></html>', defaultName: 'out' }).success
    ).toBe(true)
    expect(FileSaveOutputRequestSchema.safeParse({ html: '', defaultName: 'out' }).success).toBe(
      false
    )
  })

  it('SetOutputDirtyRequestSchema requires a boolean', () => {
    expect(SetOutputDirtyRequestSchema.safeParse({ dirty: true }).success).toBe(true)
    expect(SetOutputDirtyRequestSchema.safeParse({ dirty: 'true' }).success).toBe(false)
  })

  it('FileImportRequestSchema is fully optional but validates fileType when present', () => {
    expect(FileImportRequestSchema.safeParse(undefined).success).toBe(true)
    expect(FileImportRequestSchema.safeParse({}).success).toBe(true)
    expect(FileImportRequestSchema.safeParse({ fileType: 'csv' }).success).toBe(true)
    expect(FileImportRequestSchema.safeParse({ fileType: 'parquet' }).success).toBe(false)
  })

  it('SettingsSetRequestSchema requires a non-empty path', () => {
    expect(
      SettingsSetRequestSchema.safeParse({ path: 'appearance.theme', value: 'dark' }).success
    ).toBe(true)
    expect(SettingsSetRequestSchema.safeParse({ path: '', value: 'dark' }).success).toBe(false)
  })
})

describe('ipc-schemas: ai:send mentionBlocks (spec §5.4)', () => {
  const VALID_MESSAGE = { role: 'user', content: 'bu tabloyu yorumla' }
  const VALID_BLOCK = {
    analysisId: 'descriptives',
    titleKey: 'output.descriptives.title',
    timestamp: '2026-07-27T00:00:00.000Z',
    datasetName: 'Test Veri',
    result: { success: true, tables: [], plots: [], warnings: [], notes: [] }
  }

  it('mentionBlocks opsiyoneldir; yoksa da parse edilir', () => {
    expect(AiSendRequestSchema.safeParse({ messages: [VALID_MESSAGE] }).success).toBe(true)
  })

  it('geçerli mentionBlocks kabul edilir', () => {
    const result = AiSendRequestSchema.safeParse({
      messages: [VALID_MESSAGE],
      mentionBlocks: [VALID_BLOCK]
    })
    expect(result.success).toBe(true)
  })

  it('5 bloktan fazlası reddedilir (context şişmesine karşı üst sınır)', () => {
    const result = AiSendRequestSchema.safeParse({
      messages: [VALID_MESSAGE],
      mentionBlocks: Array.from({ length: 6 }, () => VALID_BLOCK)
    })
    expect(result.success).toBe(false)
  })

  it('bozuk blok (result alanı şema dışı) reddedilir', () => {
    const result = AiSendRequestSchema.safeParse({
      messages: [VALID_MESSAGE],
      mentionBlocks: [{ ...VALID_BLOCK, result: { success: 'evet' } }]
    })
    expect(result.success).toBe(false)
  })
})
