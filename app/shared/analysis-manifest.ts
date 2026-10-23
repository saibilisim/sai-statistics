// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * analysis-manifest.ts — Bildirimsel analiz manifest'i (Faz F2,
 * ai-entegrasyon-fizibilitesi.md §5.2).
 *
 * ~24 analiz diyaloğu kendi params JSON'unu UI state'inden kurar; bu mantığı
 * AI'ın taklit etmesi 25. kopya olurdu. Manifest, v1 kapsamındaki 9 analiz
 * (kullanımın ~%80'i) için modele sunulan parametre yüzeyini TEK YERDEN tanımlar:
 *
 *   - LLM tool şeması buradan üretilir ({@link manifestToToolJsonSchema}),
 *   - `run_analysis` tool'u gelen params'ı buradan üretilen zod şemasıyla
 *     doğrular ({@link validateManifestParams}) — şema uymazsa hata modele
 *     tool result olarak döner ve model bir retry turu alır (§10 risk satırı).
 *
 * Sınır notları:
 * - analysisId'ler MEVCUT pipeline id'leridir (dialog'ların gönderdiği) —
 *   OutputBlock başlığı `analysis.<analysisId>.title` konvansiyonundan
 *   çözüldüğü için (App.tsx job:complete) yeni id icat edilmez; aksi hâlde
 *   locale'lere dokunmadan başlık çözülemezdi.
 * - R script'lerinin beklediği isim/etiket eşlemeleri (varNames, groupName,
 *   groupValueLabels, rowNames/colNames, dependentName, factorName, valueLabels)
 *   modele SORULMAZ — {@link buildCompanionParams} dataset metadata'sından
 *   türetir (companions alanı). Model yalnız colId/sayı/seçenek kurar.
 * - v1'de diyaloglara DOKUNULMAZ (§5.2): manifest yalnız AI tool'u besler;
 *   diyalogların manifeste taşınması ayrı bir refaktör fazıdır.
 */

import { z } from 'zod'

// ─── Param spec tipleri ──────────────────────────────────────────────────────

export type ManifestParamKind = 'colId' | 'colIds' | 'string' | 'number' | 'boolean' | 'object'

/** Ölçüm düzeyi ipucu — modele değişken seçiminde rehberlik (doğrulama değil). */
export type ManifestParamRole = 'scale' | 'nominal' | 'ordinal' | 'any'

export interface AnalysisParamSpec {
  kind: ManifestParamKind
  /** colId/colIds için beklenen ölçüm düzeyi (tool açıklamasına yazılır). */
  role?: ManifestParamRole
  required: boolean
  /** colIds için minimum öğe (default 1). */
  min?: number
  /**
   * Varsayılan değer. Tanımlıysa parametre opsiyoneldir ve model göndermezse
   * bu değer kullanılır; 'object' kind'ında modelin gönderdiği kısmi nesne
   * varsayılanın üzerine sığ (shallow) birleştirilir.
   */
  default?: unknown
  /** LLM tool şemasına giden kısa açıklama (İngilizce — modele giden metin). */
  description: string
}

export interface AnalysisManifestEntry {
  /** Mevcut pipeline id'si (job:complete → OutputBlock başlığı bununla çözülür). */
  analysisId: string
  /** Bare .R dosya adı (analysis-handler'ın path-traversal kuralıyla uyumlu). */
  scriptFile: string
  /** Namespaced i18n başlık anahtarı (diyalogların kullandığıyla aynı). */
  titleKey: string
  /** LLM tool şemasına giden analiz açıklaması (İngilizce). */
  description: string
  params: Record<string, AnalysisParamSpec>
  /**
   * R script'inin beklediği isim/etiket eşlemeleri — köprü (ai-bridge) bunları
   * dataset metadata'sından türetir, model asla kurmaz:
   * - names:       paramKey → hedef anahtar. colId paramı için değişken adı
   *                (string), colIds paramı için colId→name record'u (birden
   *                çok param aynı hedefe merge edilir, örn. ttestPaired
   *                var1+var2 → varNames).
   * - valueLabels: paramKey → hedef anahtar; colId→valueLabels record'u.
   */
  companions?: {
    names?: Record<string, string>
    valueLabels?: Record<string, string>
  }
}

// ─── Manifest (v1: 9 analiz, §5.2) ───────────────────────────────────────────
// Defaults, ilgili diyalogların başlangıç state'inden birebir alınmıştır
// (örn. DescriptivesDialog defaultOptions, CrosstabsDialog defaultOptions).

export const ANALYSIS_MANIFEST: readonly AnalysisManifestEntry[] = [
  {
    analysisId: 'descriptives',
    scriptFile: 'descriptives.R',
    titleKey: 'analysis:descriptives.title',
    description: 'Descriptive statistics (N, mean, sd, min, max, …) for scale variables.',
    params: {
      variables: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Scale variables to describe (colIds, at least 1).'
      },
      saveZScores: {
        kind: 'boolean',
        required: false,
        default: false,
        description: 'Save z-scores of the selected variables as new variables.'
      },
      options: {
        kind: 'object',
        required: false,
        default: {
          mean: true,
          sum: false,
          sd: true,
          variance: false,
          range: false,
          min: true,
          max: true,
          seMean: false,
          kurtosis: false,
          skewness: false,
          displayOrder: 'variable'
        },
        description:
          'Statistic toggles (mean, sum, sd, variance, range, min, max, seMean, kurtosis, skewness) and displayOrder (variable|alpha|meanAsc|meanDesc). Partial object merged over defaults.'
      }
    },
    companions: { names: { variables: 'varNames' } }
  },
  {
    analysisId: 'frequencies',
    scriptFile: 'frequencies.R',
    titleKey: 'analysis:frequencies.title',
    description: 'Frequency tables (counts, percentages) with optional statistics and charts.',
    params: {
      variables: {
        kind: 'colIds',
        role: 'any',
        required: true,
        description: 'Variables to tabulate (colIds, at least 1).'
      },
      options: {
        kind: 'object',
        required: false,
        default: { showTable: true, order: 'ascending' },
        description:
          'showTable (boolean), order (ascending|descending), optional statistics object (mean, median, mode, sd, quartiles, …) and charts object (type: none|bar|pie|histogram).'
      }
    },
    companions: {
      names: { variables: 'varNames' },
      valueLabels: { variables: 'valueLabels' }
    }
  },
  {
    analysisId: 'crosstabs',
    scriptFile: 'crosstabs.R',
    titleKey: 'analysis:crosstabs.title',
    description:
      'Crosstabulation of row vs column categorical variables, with chi-square by default.',
    params: {
      rows: {
        kind: 'colIds',
        role: 'nominal',
        required: true,
        description: 'Row variables (colIds, categorical).'
      },
      cols: {
        kind: 'colIds',
        role: 'nominal',
        required: true,
        description: 'Column variables (colIds, categorical).'
      },
      options: {
        kind: 'object',
        required: false,
        default: { cells: { observed: true }, stats: { chisquare: true } },
        description:
          'cells (observed, expected, rowPct, colPct, totalPct, residuals) and stats (chisquare, phiCramer, contingency, correlations, eta, kappa, risk, mcnemar, …). Partial object merged over defaults.'
      }
    },
    companions: {
      names: { rows: 'rowNames', cols: 'colNames' },
      valueLabels: { rows: 'rowValueLabels', cols: 'colValueLabels' }
    }
  },
  {
    analysisId: 'ttest1',
    scriptFile: 'ttest-onesample.R',
    titleKey: 'analysis:ttest1.title',
    description: 'One-sample t-test of scale variables against a test value.',
    params: {
      variables: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Test variables (colIds, scale).'
      },
      testValue: {
        kind: 'number',
        required: false,
        default: 0,
        description: 'Hypothesized mean (test value). Default 0.'
      },
      options: {
        kind: 'object',
        required: false,
        default: { missing: 'analysis' },
        description: "missing: 'analysis' (per-variable) or 'listwise'."
      }
    },
    companions: { names: { variables: 'varNames' } }
  },
  {
    analysisId: 'ttestInd',
    scriptFile: 'ttest-independent.R',
    titleKey: 'analysis:ttestInd.title',
    description: 'Independent-samples t-test comparing a scale variable across two groups.',
    params: {
      variables: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Test variables (colIds, scale).'
      },
      groupVar: {
        kind: 'colId',
        role: 'nominal',
        required: true,
        description:
          'Grouping variable (colId, categorical with exactly the two groups used below).'
      },
      group1: {
        kind: 'string',
        required: true,
        description:
          'Raw value of the first group, as a string (e.g. "0" or "Kadın" — use get_data_profile top-values or get_variables valueLabels to pick exact values).'
      },
      group2: {
        kind: 'string',
        required: true,
        description: 'Raw value of the second group, as a string.'
      },
      options: {
        kind: 'object',
        required: false,
        default: { missing: 'analysis' },
        description: "missing: 'analysis' (per-variable) or 'listwise'."
      }
    },
    companions: {
      names: { variables: 'varNames', groupVar: 'groupName' },
      valueLabels: { groupVar: 'groupValueLabels' }
    }
  },
  {
    analysisId: 'ttestPaired',
    scriptFile: 'ttest-paired.R',
    titleKey: 'analysis:ttestPaired.title',
    description: 'Paired-samples t-test between matched pairs of scale variables.',
    params: {
      var1: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description:
          'First variables of each pair (colIds). Pairs are formed positionally with var2.'
      },
      var2: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Second variables of each pair (colIds, same length as var1).'
      },
      options: {
        kind: 'object',
        required: false,
        default: { missing: 'analysis' },
        description: "missing: 'analysis' (per-pair) or 'listwise'."
      }
    },
    companions: { names: { var1: 'varNames', var2: 'varNames' } }
  },
  {
    analysisId: 'correlate',
    scriptFile: 'correlation.R',
    titleKey: 'analysis:correlate.title',
    description: 'Bivariate correlations (Pearson by default; Spearman/Kendall optional).',
    params: {
      variables: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        min: 2,
        description: 'Variables to correlate (colIds, at least 2).'
      },
      methods: {
        kind: 'object',
        required: false,
        default: { pearson: true, spearman: false, kendall: false },
        description: 'Coefficient toggles: pearson, spearman, kendall (booleans).'
      },
      options: {
        kind: 'object',
        required: false,
        default: { missing: 'pairwise' },
        description: "missing: 'pairwise' (default) or 'listwise'."
      }
    },
    companions: { names: { variables: 'varNames' } }
  },
  {
    analysisId: 'regression',
    scriptFile: 'regression-linear.R',
    titleKey: 'analysis:regression.title',
    description: 'Linear regression of a dependent scale variable on one or more predictors.',
    params: {
      dependent: {
        kind: 'colId',
        role: 'scale',
        required: true,
        description: 'Dependent (outcome) variable colId.'
      },
      independents: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Predictor variables (colIds, at least 1).'
      },
      options: {
        kind: 'object',
        required: false,
        default: { collinearity: false, durbinWatson: false },
        description:
          'Booleans/numbers matching SPSS\'s Statistics/Options/Plots dialogs: collinearity, durbinWatson, confidenceIntervals + ciLevel (default 95), covarianceMatrix, rSquaredChange, descriptives, partialCorrelations, casewiseDiagnostics + casewiseOutliersOnly + casewiseSD (default 3), includeConstant (default true), missingMethod ("listwise"|"mean"), plots: { scatterY/scatterX (one of DEPENDNT/ZPRED/ZRESID/DRESID/ADJPRED/SRESID/SDRESID), histogram, normalPP, partialPlots }.'
      }
    },
    companions: { names: { dependent: 'dependentName', independents: 'varNames' } }
  },
  {
    analysisId: 'normality',
    scriptFile: 'normality.R',
    titleKey: 'analysis:normality.title',
    description:
      'Normality tests (Shapiro-Wilk for n<=5000, Kolmogorov-Smirnov/Lilliefors otherwise) plus skewness/kurtosis (with z-scores) and descriptives for scale variables. Use this BEFORE choosing between a parametric test (ttest1, ttestInd, ttestPaired, anova, correlate/pearson) and its nonparametric alternative for a given variable — read swSig/ksSig (whichever is non-null) in the result: p < .05 indicates a normality violation. For n roughly >= 30 per group, mild violations are often tolerable (CLT) — say so explicitly rather than rejecting parametric tests outright; for small n or a clear violation, name the matching nonparametric alternative (Mann-Whitney/Wilcoxon, Kruskal-Wallis, Friedman, Spearman) via run_syntax (NPAR TESTS / NONPAR CORR) and mention it.',
    params: {
      variables: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Scale variables to test for normality (colIds, at least 1).'
      }
    },
    companions: { names: { variables: 'varNames' } }
  },
  {
    analysisId: 'anova',
    scriptFile: 'anova-oneway.R',
    titleKey: 'analysis:anova.title',
    description: 'One-way ANOVA of scale variables across levels of a categorical factor.',
    params: {
      variables: {
        kind: 'colIds',
        role: 'scale',
        required: true,
        description: 'Dependent variables (colIds, scale).'
      },
      factor: {
        kind: 'colId',
        role: 'nominal',
        required: true,
        description: 'Factor (grouping) variable colId, categorical.'
      },
      options: {
        kind: 'object',
        required: false,
        default: {},
        description:
          'Optional toggles: descriptives not needed; homogeneity, welch, brownForsythe, meansPlot, effectSize; post-hoc: tukey, bonferroni, lsd, sidak, scheffe, gamesHowell, tamhaneT2, dunnettT3, dunnettC, hochbergGT2; homogeneous-subsets-only (needs the agricolae R package): snk, duncan, regwQ, wallerDuncan (also produced for tukey/scheffe when those are on); sigLevel ("0.05").'
      }
    },
    companions: { names: { variables: 'varNames', factor: 'factorName' } }
  }
]

/** Manifest'te tanımlı analiz id'leri (run_analysis tool enum'u). */
export const MANIFEST_ANALYSIS_IDS: readonly string[] = ANALYSIS_MANIFEST.map(e => e.analysisId)

export function getManifestEntry(analysisId: string): AnalysisManifestEntry | undefined {
  return ANALYSIS_MANIFEST.find(e => e.analysisId === analysisId)
}

// ─── Manifest → zod params şeması (§6.3: run_analysis zod-validasyonlu) ──────

const COL_ID_RE = /^col_\d+$/
const ColIdSchema = z.string().regex(COL_ID_RE)

function paramSpecToZod(spec: AnalysisParamSpec): z.ZodType {
  let schema: z.ZodType
  switch (spec.kind) {
    case 'colId':
      schema = ColIdSchema
      break
    case 'colIds':
      schema = z.array(ColIdSchema).min(spec.min ?? 1)
      break
    case 'string':
      schema = z.string().max(500)
      break
    case 'number':
      schema = z.number()
      break
    case 'boolean':
      schema = z.boolean()
      break
    case 'object':
      // Options nesneleri heterojen (analiz bazlı anahtarlar); R tarafı
      // isTRUE()/default'larla savunmacı okur. Burada şekil doğrulanır,
      // içerik R'a bırakılır — yanlış anahtar sessizce zararsızdır.
      schema = z.record(z.string(), z.unknown())
      break
  }
  return spec.required ? schema : schema.optional()
}

/** Manifest girdisinden model-params zod şeması üretir (bilinmeyen anahtarlar strip edilir). */
export function buildParamsZodSchema(entry: AnalysisManifestEntry): z.ZodObject {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, spec] of Object.entries(entry.params)) {
    shape[key] = paramSpecToZod(spec)
  }
  return z.object(shape)
}

// ─── Params doğrulama + default uygulama ─────────────────────────────────────

export type ManifestParamsValidation =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: string }

/**
 * Modelin gönderdiği params'ı manifest şemasına göre doğrular ve
 * varsayılanları uygular (object kind'ında sığ merge). Şema uymazsa modele
 * tool result olarak geri dönecek, düzeltme turunu (retry) yönlendiren
 * kısa bir hata metni üretir — throw ETMEZ (§10: "şemaya uymadı, düzelt" turu).
 */
export function validateManifestParams(
  entry: AnalysisManifestEntry,
  raw: unknown
): ManifestParamsValidation {
  const parsed = buildParamsZodSchema(entry).safeParse(raw ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .slice(0, 5)
      .join('; ')
    return {
      ok: false,
      error: `Invalid params for analysis "${entry.analysisId}": ${issues}. Fix the params to match the schema and call run_analysis again.`
    }
  }
  const params = parsed.data
  // Varsayılanları uygula: object → sığ merge, diğerleri → doğrudan atama.
  for (const [key, spec] of Object.entries(entry.params)) {
    if (params[key] === undefined && spec.default !== undefined) {
      params[key] = spec.default
    } else if (spec.kind === 'object' && spec.default !== undefined && params[key] !== undefined) {
      params[key] = {
        ...(spec.default as Record<string, unknown>),
        ...(params[key] as Record<string, unknown>)
      }
    }
  }
  return { ok: true, params }
}

// ─── Companion params (varNames / *Name / *ValueLabels) ──────────────────────

interface CompanionVariableSource {
  colId: string
  name: string
  valueLabels: Record<string, string>
}

/**
 * R script'lerinin beklediği isim/etiket eşlemelerini dataset metadata'sından
 * türetir. Model bu alanları hiç görmez — dialog'ların `Object.fromEntries(
 * vars.map(v => [v.colId, v.name]))` kalıbının Main-tarafı karşılığıdır.
 */
export function buildCompanionParams(
  entry: AnalysisManifestEntry,
  params: Record<string, unknown>,
  variables: readonly CompanionVariableSource[]
): Record<string, unknown> {
  if (!entry.companions) return {}
  const byId = new Map(variables.map(v => [v.colId, v]))
  const out: Record<string, unknown> = {}

  const collectIds = (key: string): string[] => {
    const spec = entry.params[key]
    const value = params[key]
    if (!spec || value === undefined) return []
    return spec.kind === 'colIds' ? (value as string[]) : [value as string]
  }

  for (const [paramKey, target] of Object.entries(entry.companions.names ?? {})) {
    const spec = entry.params[paramKey]
    if (!spec) continue
    if (spec.kind === 'colId') {
      // Tekil: değişken adı (string) — örn. groupVar → groupName.
      const id = params[paramKey] as string | undefined
      const v = id !== undefined ? byId.get(id) : undefined
      if (v && out[target] === undefined) out[target] = v.name
    } else if (spec.kind === 'colIds') {
      // Çoğul: colId→name record — aynı hedefe merge (var1+var2 → varNames).
      const record = (out[target] as Record<string, string> | undefined) ?? {}
      for (const id of collectIds(paramKey)) {
        const v = byId.get(id)
        if (v) record[id] = v.name
      }
      if (Object.keys(record).length > 0) out[target] = record
    }
  }

  for (const [paramKey, target] of Object.entries(entry.companions.valueLabels ?? {})) {
    const record: Record<string, Record<string, string>> = {}
    for (const id of collectIds(paramKey)) {
      const v = byId.get(id)
      if (v) record[id] = v.valueLabels
    }
    if (Object.keys(record).length > 0) out[target] = record
  }

  return out
}

// ─── Manifest → LLM tool JSON şeması ─────────────────────────────────────────

/**
 * `run_analysis` tool'unun `params` alanı için analiz-bazlı JSON Schema üretir.
 * OpenAI function-calling konvansiyonu (type/properties/required). Zod şeması
 * ile aynı kaynaktan üretildiği için LLM'e giden sözleşme ile Main'deki
 * doğrulama asla sapmaz.
 */
export function manifestToToolJsonSchema(entry: AnalysisManifestEntry): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, spec] of Object.entries(entry.params)) {
    let schema: Record<string, unknown>
    switch (spec.kind) {
      case 'colId':
        // `pattern` (regex) BİLEREK yok: bazı sağlayıcıların tool-schema
        // çeviricileri (örn. sınırlı tool-calling desteği olan ücretsiz
        // modeller) yalnız "bounded literal pattern" kabul ediyor ve regex'li
        // şemayı 422 invalid_request_error ile reddediyor. Format bilgisi
        // description'a taşındı; gerçek doğrulama zaten Main'de zod ile
        // yapılıyor (AiGetDataProfileArgsSchema / validateManifestParams) —
        // burası yalnız LLM'e giden bir ipucu, güvenlik sınırı değil.
        schema = { type: 'string' }
        break
      case 'colIds':
        schema = {
          type: 'array',
          items: { type: 'string' },
          minItems: spec.min ?? 1
        }
        break
      case 'string':
        schema = { type: 'string' }
        break
      case 'number':
        schema = { type: 'number' }
        break
      case 'boolean':
        schema = { type: 'boolean' }
        break
      case 'object':
        schema = { type: 'object' }
        break
    }
    const hints: string[] = []
    if (spec.kind === 'colId' || spec.kind === 'colIds') {
      hints.push(`colId format: ${COL_ID_RE.source} (e.g. "col_3")`)
    }
    if (spec.role && spec.role !== 'any') hints.push(`expected measure: ${spec.role}`)
    if (spec.default !== undefined) {
      hints.push(`default: ${JSON.stringify(spec.default)}`)
    }
    schema['description'] =
      hints.length > 0 ? `${spec.description} (${hints.join('; ')})` : spec.description
    properties[key] = schema
    if (spec.required) required.push(key)
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false
  }
}
