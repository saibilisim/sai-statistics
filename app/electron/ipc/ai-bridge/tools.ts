// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tools.ts — agent tool yürütücüleri: get_variables, get_data_profile,
 * run_analysis, run_syntax ve bunları çağıran executeToolCall dispatcher'ı.
 */

import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  AiRunAnalysisArgsSchema,
  AiRunSyntaxArgsSchema,
  AiProposeSyntaxArgsSchema,
  AiProposeRCodeArgsSchema,
  AiGetVariablesArgsSchema,
  AiGetDataProfileArgsSchema
} from '../../../shared/ai-types'
import type { AiToolName, AiSyntaxProposal, ToolCall } from '../../../shared/ai-types'
import { IPC } from '../../../shared/ipc-contracts'
import {
  splitStatements,
  parseStatement,
  dispatchAnalysisStatement,
  ANALYSIS_COMMAND_NAMES,
  type AnalysisDispatchCtx,
  type SyntaxLogEntry
} from '../../../shared/spss-syntax-analysis'
import type { Dataset } from '../../../shared/data-types'
import {
  MANIFEST_ANALYSIS_IDS,
  getManifestEntry,
  validateManifestParams,
  buildCompanionParams
} from '../../../shared/analysis-manifest'
import { loadedDatasets, getDbConnection } from '../db-handler'
import { enqueueAiAnalysis } from './job-bridge'
import { compactAnalysisResult } from './context-budget'

// ─── Tool yürütücüler ────────────────────────────────────────────────────────
// Tool hataları throw EDİLMEZ — { error } payload'ı olarak modele döner;
// model düzeltip yeniden deneyebilir (retry turu, §10). Yalnız altyapı
// hataları (provider, iptal) yukarı fırlar.

// Değer etiketi sayısı değişken başına sınırlanır: SPSS'e alışkın kullanıcılar
// bazen serbest metin sütunlarını etiketliyor (yüzlerce etiket) — model için
// ilk N tanesi türü anlamaya yeter, gerisi get_data_profile'ın işi.
const MAX_VALUE_LABELS_PER_VARIABLE = 30

function executeGetVariables(rawArgs: string): unknown {
  const parsed = AiGetVariablesArgsSchema.safeParse(JSON.parse(rawArgs))
  if (!parsed.success) {
    return { error: `Invalid get_variables arguments: ${parsed.error.message}` }
  }
  const dataset = loadedDatasets.get(parsed.data.datasetId)
  if (!dataset) {
    return {
      error: `Dataset not found: ${parsed.data.datasetId}. Use one of the dataset ids listed in DATA CONTEXT.`
    }
  }
  // Boş/tanımsız alanlar ATLANIR. Bu sonuç modele tool mesajı olarak gider ve
  // turun KALAN her round-trip'inde yeniden gönderilir; 120+ değişkenli bir
  // Excel dosyasında `"label":"","valueLabels":{},"missing":null` üçlüsü
  // payload'ın yarısından fazlasını kaplıyor, yanıt turunu yavaşlatıyor ve
  // küçük modellerin context penceresini zorluyordu (2026-08-14 kullanıcı
  // geri bildirimi: tur "Değişkenler listeleniyor"da uzun süre bekliyor).
  // Anlam kaybı yok: alanın yokluğu "boş" demektir.
  const variables = dataset.variables.map(v => {
    const entry: Record<string, unknown> = {
      colId: v.colId,
      name: v.name,
      type: v.type,
      measure: v.measure
    }
    if (v.label !== '') entry['label'] = v.label
    const labelEntries = Object.entries(v.valueLabels)
    if (labelEntries.length > 0) {
      entry['valueLabels'] = Object.fromEntries(
        labelEntries.slice(0, MAX_VALUE_LABELS_PER_VARIABLE)
      )
      if (labelEntries.length > MAX_VALUE_LABELS_PER_VARIABLE) {
        entry['valueLabelsTruncated'] =
          `${String(labelEntries.length)} value labels defined; only the first ${String(MAX_VALUE_LABELS_PER_VARIABLE)} are shown. Call get_data_profile for this variable to see its actual value distribution.`
      }
    }
    if (v.missing) entry['missing'] = v.missing
    if (v.type === 'numeric') entry['decimals'] = v.decimals
    return entry
  })
  return {
    datasetId: dataset.id,
    name: dataset.name,
    rowCount: dataset.rowCount,
    variableCount: variables.length,
    // Atlanan alanlar model tarafından "bilinmiyor" sanılmasın.
    note: 'Fields that are empty are omitted: no "label" means the variable has no label, no "valueLabels" means none are defined, no "missing" means no user-missing values are declared.',
    variables
  }
}

/** DuckDB agregat değerlerini JSON-güvenli hâle getirir (COUNT → bigint). */
function sqlNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number') return value
  return Number(value)
}

async function executeGetDataProfile(rawArgs: string): Promise<unknown> {
  const parsed = AiGetDataProfileArgsSchema.safeParse(JSON.parse(rawArgs))
  if (!parsed.success) {
    return { error: `Invalid get_data_profile arguments: ${parsed.error.message}` }
  }
  const { datasetId } = parsed.data
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) {
    return { error: `Dataset not found: ${datasetId}. Use one of the dataset ids in DATA CONTEXT.` }
  }
  // §6.3: allow-list'li agregasyonlar, serbest SQL YOK. Tanımlayıcılar
  // allow-list'ten gelir (colId ^col_\d+$ regex + metadata eşleşmesi;
  // datasetId Main-üretimi UUID + regex guard) — buildFilterWhere'in
  // interpolate deseniyle aynı güvenlik seviyesi; bağlanacak kullanıcı
  // DEĞERİ hiç yok (sorgu tamamen sabit + allow-list tanımlayıcı).
  if (!/^[A-Za-z0-9_-]+$/.test(datasetId)) {
    return { error: 'Invalid datasetId format.' }
  }

  // Toplu biçim: tek çağrıda birden çok değişken → daha az agent turu.
  // Tek colId biçiminin dönüş şekli DEĞİŞMEZ (profil alanları kökte).
  if (parsed.data.colIds) {
    const profiles: unknown[] = []
    for (const id of parsed.data.colIds) {
      profiles.push(await profileVariable(dataset, datasetId, id))
    }
    return { datasetId, profiles }
  }
  return await profileVariable(dataset, datasetId, parsed.data.colId ?? '')
}

async function profileVariable(
  dataset: Dataset,
  datasetId: string,
  colId: string
): Promise<unknown> {
  const variable = dataset.variables.find(v => v.colId === colId)
  if (!variable) {
    return {
      colId,
      error: `Variable not found: ${colId}. Call get_variables for the valid colIds.`
    }
  }
  const table = `dataset_${datasetId}`
  const col = `"${colId}"`
  const conn = await getDbConnection()

  const countsReader = await conn.runAndReadAll(
    `SELECT COUNT(*) AS total, COUNT(${col}) AS valid FROM ${table}`
  )
  const countsRow = countsReader.getRows()[0]
  const total = sqlNumber(countsRow?.[0]) ?? 0
  const valid = sqlNumber(countsRow?.[1]) ?? 0

  const profile: Record<string, unknown> = {
    colId,
    name: variable.name,
    label: variable.label,
    type: variable.type,
    measure: variable.measure,
    total,
    valid,
    missing: total - valid
  }

  if (variable.type === 'numeric') {
    const statsReader = await conn.runAndReadAll(
      `SELECT MEAN(${col}) AS mean, STDDEV_SAMP(${col}) AS sd, MIN(${col}) AS min, MAX(${col}) AS max, ` +
        `COUNT(DISTINCT ${col}) AS d, SUM(CASE WHEN ${col} <> FLOOR(${col}) THEN 1 ELSE 0 END) AS frac FROM ${table}`
    )
    const row = statsReader.getRows()[0]
    profile['mean'] = sqlNumber(row?.[0])
    profile['sd'] = sqlNumber(row?.[1])
    // Identifier-like columns (national id, phone, patient no): whole numbers
    // that are almost all distinct. Their min/max would be two real
    // identifiers, i.e. cell values (§9) — withheld.
    const distinct = sqlNumber(row?.[4]) ?? 0
    const fractional = sqlNumber(row?.[5]) ?? 0
    const identifierLike = valid >= 20 && fractional === 0 && distinct / valid > 0.9
    if (identifierLike) {
      profile['minMaxWithheld'] = 'identifier-like column'
    } else {
      profile['min'] = sqlNumber(row?.[2])
      profile['max'] = sqlNumber(row?.[3])
    }
  }

  // Kategorik değişkenler (ve nominal/ordinal kodlanmış sayısallar) için yalnız
  // farklı-değer SAYISI döner — hiçbir hücre değeri/frekans tablosu modele gitmez
  // (ham-değer-yok politikası, CLAUDE.md §9). Kategori adları için get_variables'taki
  // değer etiketleri (metadata) kullanılır.
  if (variable.type !== 'numeric' || variable.measure !== 'scale') {
    const distinctReader = await conn.runAndReadAll(
      `SELECT COUNT(DISTINCT ${col}) AS d FROM ${table}`
    )
    profile['distinctCount'] = sqlNumber(distinctReader.getRows()[0]?.[0]) ?? 0
  }

  return profile
}

async function executeRunAnalysis(
  rawArgs: string,
  sender: WebContents,
  signal: AbortSignal
): Promise<unknown> {
  let rawJson: unknown
  try {
    rawJson = JSON.parse(rawArgs)
  } catch {
    return { error: 'run_analysis arguments are not valid JSON.' }
  }
  const parsed = AiRunAnalysisArgsSchema.safeParse(rawJson)
  if (!parsed.success) {
    return { error: `Invalid run_analysis arguments: ${parsed.error.message}` }
  }
  const { datasetId, analysisId, params } = parsed.data

  const entry = getManifestEntry(analysisId)
  if (!entry) {
    // §6.3: yalnız manifest'teki analizler.
    return {
      error: `Unknown analysisId: ${analysisId}. Supported: ${MANIFEST_ANALYSIS_IDS.join(', ')}.`
    }
  }
  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) {
    return { error: `Dataset not found: ${datasetId}. Use one of the dataset ids in DATA CONTEXT.` }
  }

  // Manifest zod şeması — şema uymazsa hata modele tool result olarak döner
  // ve model bir düzeltme (retry) turu alır (§10).
  const validation = validateManifestParams(entry, params)
  if (!validation.ok) {
    return { error: validation.error }
  }

  // colId'ler gerçekten var mı? R da yakalar ama buradaki mesaj modele
  // düzeltme için doğrudan kullanılabilir colId listesi verir.
  const knownIds = new Set(dataset.variables.map(v => v.colId))
  const referenced: string[] = []
  for (const [key, spec] of Object.entries(entry.params)) {
    const value = validation.params[key]
    if (value === undefined) continue
    if (spec.kind === 'colId') referenced.push(value as string)
    else if (spec.kind === 'colIds') referenced.push(...(value as string[]))
  }
  const unknownIds = referenced.filter(id => !knownIds.has(id))
  if (unknownIds.length > 0) {
    return {
      error: `Unknown colId(s): ${[...new Set(unknownIds)].join(', ')}. Call get_variables for the valid colIds of dataset ${datasetId}.`
    }
  }

  // Companion params (varNames, groupName, groupValueLabels, …) — dialogların
  // metadata'dan kurduğu eşlemelerin Main-tarafı karşılığı (manifest).
  const companions = buildCompanionParams(entry, validation.params, dataset.variables)

  const { jobId, result } = await enqueueAiAnalysis({
    datasetId,
    analysisId,
    scriptFile: entry.scriptFile,
    params: { ...validation.params, ...companions },
    sender,
    signal
  })

  // §3.1 adım 3: "sonuç geldi" tool mesajı — model bir sonraki turda yorumlar.
  // Aynı result Renderer'a da job:complete ile gitti (Output bloğu) — iki akış
  // birbirinden bağımsız ve aynı kaynaktan (job-manager) beslenir. Modele
  // giden kopya kısaltılır (grafik/vaka verisi yok, bkz. context-budget.ts):
  // bu mesaj turun kalan her round-trip'inde yeniden gönderilir.
  return { jobId, analysisId, status: 'completed', result: compactAnalysisResult(result) }
}

// run_syntax fans out to one R job per recognized analysis command, and a
// SINGLE statement can itself fan out further (NPAR TESTS dispatches one job
// per /subcommand clause — a syntax string repeating "/CHISQUARE=x" dozens of
// times would otherwise enqueue dozens of R processes from one tool call).
// Capped so one call can't amplify into a resource-exhaustion burst — the
// model just gets told to split the work across more run_syntax calls.
const MAX_ANALYSES_PER_RUN_SYNTAX_CALL = 10

// ─── run_syntax: shared/spss-syntax-analysis.ts'in Main-tarafı uygulaması ────
// Terminal sekmesinin (src/lib/spss-syntax.ts) kullandığı AYNI parsing/param
// kodu — tek fark `ctx.runAnalysis`'in enqueueAiAnalysis'e (run_analysis'in
// zaten kullandığı Main job hattı) bağlanması. Model syntax METNİ üretir ama
// metin yalnızca bu deterministik regex tabanlı dispatcher'dan geçer, asla
// R'a/shell'e ulaşmaz — keyfi kod yürütme değil (§9). Mutasyon komutları
// (RENAME/RECODE/WEIGHT/SELECT IF/FILTER/...) Renderer store'una ihtiyaç
// duyduğu için burada YOKTUR — dispatchAnalysisStatement onları tanımaz,
// unsupportedCommands listesine düşerler. analysisId/scriptFile HER ZAMAN
// shared handler'ların içindeki sabit string literalleridir — model syntax
// METNİYLE bunları asla ezemez (§9 "R'a giden girdiler allow-list ile
// parametrize edilir" burada da geçerli: yalnız değişken adları/sayısal
// değerler modelden gelir, hepsi params alanlarına — hiçbiri analysisId/
// scriptFile'a — akar).
async function executeRunSyntax(
  rawArgs: string,
  sender: WebContents,
  signal: AbortSignal
): Promise<unknown> {
  let rawJson: unknown
  try {
    rawJson = JSON.parse(rawArgs)
  } catch {
    return { error: 'run_syntax arguments are not valid JSON.' }
  }
  const parsed = AiRunSyntaxArgsSchema.safeParse(rawJson)
  if (!parsed.success) {
    return { error: `Invalid run_syntax arguments: ${parsed.error.message}` }
  }
  const { datasetId, syntax } = parsed.data

  const dataset = loadedDatasets.get(datasetId)
  if (!dataset) {
    return { error: `Dataset not found: ${datasetId}. Use one of the dataset ids in DATA CONTEXT.` }
  }

  const statements = splitStatements(syntax)
  if (statements.length === 0) {
    return { error: 'No statement found in syntax (expected one or more "."-terminated commands).' }
  }

  const results: { analysisId: string; jobId: string; result: Record<string, unknown> }[] = []
  const log: SyntaxLogEntry[] = []
  const unsupportedCommands: string[] = []
  const atCap = (): boolean => results.length >= MAX_ANALYSES_PER_RUN_SYNTAX_CALL

  const ctx: AnalysisDispatchCtx = {
    variables: dataset.variables,
    runAnalysis: async req => {
      if (atCap()) throw new Error('run_syntax per-call analysis cap reached')
      const { jobId, result } = await enqueueAiAnalysis({
        datasetId,
        analysisId: req.analysisId,
        scriptFile: req.scriptFile,
        params: req.params,
        sender,
        signal
      })
      results.push({ analysisId: req.analysisId, jobId, result: compactAnalysisResult(result) })
    }
  }

  for (const raw of statements) {
    if (atCap()) break
    try {
      const dispatched = await dispatchAnalysisStatement(raw, ctx)
      if (dispatched) {
        log.push(...dispatched.log)
        continue
      }
      const st = parseStatement(raw, ANALYSIS_COMMAND_NAMES)
      unsupportedCommands.push(st.command)
    } catch (err) {
      if (!atCap()) throw err // iptal/gerçek altyapı hatası — turu sonlandırır
      break
    }
  }

  if (results.length === 0 && log.length === 0) {
    return {
      error:
        `No statistical-analysis command recognized. run_syntax only executes analysis commands: ${ANALYSIS_COMMAND_NAMES.join(', ')}. ` +
        `Not recognized/not available here: ${unsupportedCommands.join(', ')}.`
    }
  }

  return {
    status: 'completed',
    results,
    log,
    ...(unsupportedCommands.length > 0 ? { unsupportedCommands } : {}),
    ...(atCap()
      ? {
          note: `Stopped after ${String(MAX_ANALYSES_PER_RUN_SYNTAX_CALL)} analyses in this call — remaining statements were not run. Split the rest across additional run_syntax calls if needed.`
        }
      : {})
  }
}

// ─── propose_syntax: mutasyon syntax'ını kullanıcı onayına sunar ────────────
// Hiçbir şey ÇALIŞTIRMAZ — Main'in elinde Renderer store'u yok; syntax
// ai:syntax-proposal event'iyle sohbetteki onay kartına düşer, kullanıcı ✓
// derse Renderer runSpssSyntax (Terminal ile aynı deterministik parser) ile
// yürütür. Tool sonucu modele "sunuldu" bilgisini döner; model kullanıcıya
// kartı inceleyip onaylamasını söyler.
function executeProposeSyntax(rawArgs: string, sender: WebContents, turnId: string): unknown {
  let rawJson: unknown
  try {
    rawJson = JSON.parse(rawArgs)
  } catch {
    return { error: 'propose_syntax arguments are not valid JSON.' }
  }
  const parsed = AiProposeSyntaxArgsSchema.safeParse(rawJson)
  if (!parsed.success) {
    return { error: `Invalid propose_syntax arguments: ${parsed.error.message}` }
  }
  const { syntax, description } = parsed.data

  if (!sender.isDestroyed()) {
    const proposal: AiSyntaxProposal = {
      turnId,
      proposalId: randomUUID(),
      syntax,
      ...(description ? { description } : {})
    }
    sender.send(IPC.AI_SYNTAX_PROPOSAL, proposal)
  }
  return {
    proposed: true,
    syntax,
    note: 'The syntax was presented to the user in an approval card and was NOT executed. It will run only if the user accepts it — tell the user to review the card and click ✓ to run it or ✗ to dismiss it.'
  }
}

// ─── propose_r_code: R terminali için kod önerir ─────────────────────────────
// Hiçbir şey ÇALIŞTIRMAZ — ne burada ne Renderer'da: kart kodu yalnız R betik
// editörüne gönderir, kullanıcı orada okuyup kendisi çalıştırır. R kodu keyfi
// kod olduğu için (SPSS önerisinin aksine) tek tıkla çalıştırma yoktur:
// veri metadata'sındaki bir prompt-injection modeli zararlı kod önermeye
// itebilir; bariyer kullanıcının kodu editörde görüp elle çalıştırmasıdır.
function executeProposeRCode(rawArgs: string, sender: WebContents, turnId: string): unknown {
  let rawJson: unknown
  try {
    rawJson = JSON.parse(rawArgs)
  } catch {
    return { error: 'propose_r_code arguments are not valid JSON.' }
  }
  const parsed = AiProposeRCodeArgsSchema.safeParse(rawJson)
  if (!parsed.success) {
    return { error: `Invalid propose_r_code arguments: ${parsed.error.message}` }
  }
  const { code, description } = parsed.data

  if (!sender.isDestroyed()) {
    const proposal: AiSyntaxProposal = {
      turnId,
      proposalId: randomUUID(),
      syntax: code,
      language: 'r',
      ...(description ? { description } : {})
    }
    sender.send(IPC.AI_SYNTAX_PROPOSAL, proposal)
  }
  return {
    proposed: true,
    note: 'The R code was shown to the user in a card and was NOT executed — you cannot run R code and you will not see its output. The user can send it to the R script editor (Syntax tab, R mode) and run it there themselves. Tell the user that, and do not claim any results from it.'
  }
}

export async function executeToolCall(
  call: ToolCall,
  sender: WebContents,
  signal: AbortSignal,
  turnId: string
): Promise<unknown> {
  try {
    switch (call.name as AiToolName) {
      case 'get_variables':
        return executeGetVariables(call.arguments)
      case 'get_data_profile':
        return await executeGetDataProfile(call.arguments)
      case 'run_analysis':
        return await executeRunAnalysis(call.arguments, sender, signal)
      case 'run_syntax':
        return await executeRunSyntax(call.arguments, sender, signal)
      case 'propose_syntax':
        return executeProposeSyntax(call.arguments, sender, turnId)
      case 'propose_r_code':
        return executeProposeRCode(call.arguments, sender, turnId)
      default:
        return {
          error: `Unknown tool: ${call.name}. Available: get_variables, get_data_profile, run_analysis, run_syntax, propose_syntax, propose_r_code.`
        }
    }
  } catch (err) {
    if (signal.aborted) throw err // iptal tool hatası değil — turu sonlandırır
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
