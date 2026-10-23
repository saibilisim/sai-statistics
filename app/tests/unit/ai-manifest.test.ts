// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ai-manifest.test.ts — Analysis manifest birim testleri (Faz F2, §5.2/§9).
 *
 * Kapsam: manifest bütünlüğü, manifest→zod şema üretimi + params doğrulama
 * (retry-hata şekli dahil), companion params türetimi, manifest→LLM tool
 * JSON şeması üretimi.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  ANALYSIS_MANIFEST,
  MANIFEST_ANALYSIS_IDS,
  getManifestEntry,
  buildParamsZodSchema,
  validateManifestParams,
  buildCompanionParams,
  manifestToToolJsonSchema
} from '../../shared/analysis-manifest'

describe('manifest bütünlüğü', () => {
  it('v1 kapsamındaki 10 analizi benzersiz id ile tanımlar', () => {
    expect(ANALYSIS_MANIFEST).toHaveLength(10)
    expect(new Set(MANIFEST_ANALYSIS_IDS).size).toBe(10)
    expect([...MANIFEST_ANALYSIS_IDS].sort()).toEqual(
      [
        'descriptives',
        'frequencies',
        'crosstabs',
        'ttest1',
        'ttestInd',
        'ttestPaired',
        'correlate',
        'regression',
        'anova',
        'normality'
      ].sort()
    )
  })

  it('scriptFile bare .R adıdır (analysis-handler path-traversal kuralı) ve dosya r-scripts altında vardır', () => {
    const rScriptsDir = join(__dirname, '..', '..', 'r-scripts')
    for (const entry of ANALYSIS_MANIFEST) {
      expect(entry.scriptFile).toMatch(/^[^/\\]+\.R$/)
      expect(existsSync(join(rScriptsDir, entry.scriptFile))).toBe(true)
    }
  })

  it('companion eşlemeleri yalnız manifestte tanımlı param anahtarlarına işaret eder', () => {
    for (const entry of ANALYSIS_MANIFEST) {
      for (const key of Object.keys(entry.companions?.names ?? {})) {
        expect(entry.params[key], `${entry.analysisId}.companions.names.${key}`).toBeDefined()
      }
      for (const key of Object.keys(entry.companions?.valueLabels ?? {})) {
        expect(entry.params[key], `${entry.analysisId}.companions.valueLabels.${key}`).toBeDefined()
      }
    }
  })

  it('getManifestEntry bilinmeyen id için undefined döner', () => {
    expect(getManifestEntry('descriptives')?.scriptFile).toBe('descriptives.R')
    expect(getManifestEntry('npar-ks')).toBeUndefined()
  })
})

describe('validateManifestParams (manifest → zod şema + retry hatası)', () => {
  const descriptives = getManifestEntry('descriptives')!
  const ttestInd = getManifestEntry('ttestInd')!
  const correlate = getManifestEntry('correlate')!

  it('geçerli params kabul eder ve object default ile sığ merge eder', () => {
    const result = validateManifestParams(descriptives, {
      variables: ['col_1', 'col_2'],
      options: { sd: false, skewness: true }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params['variables']).toEqual(['col_1', 'col_2'])
      // Modelin göndermediği anahtarlar default'tan gelir; gönderdiği korunur.
      const options = result.params['options'] as Record<string, unknown>
      expect(options['mean']).toBe(true) // default
      expect(options['sd']).toBe(false) // model override
      expect(options['skewness']).toBe(true) // model override
      expect(options['displayOrder']).toBe('variable') // default
      // boolean default doğrudan uygulanır
      expect(result.params['saveZScores']).toBe(false)
    }
  })

  it('bilinmeyen anahtarları strip eder (R tarafına sızamaz)', () => {
    const result = validateManifestParams(descriptives, {
      variables: ['col_1'],
      maliciousSql: 'DROP TABLE x'
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect('maliciousSql' in result.params).toBe(false)
    }
  })

  it('required eksikse retry-hatası döner (throw etmez) — mesaj analiz id + alan yolu içerir', () => {
    const result = validateManifestParams(descriptives, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('descriptives')
      expect(result.error).toContain('variables')
      // Retry yönlendirmesi: modelin düzeltip tekrar çağırması gerektiği açık.
      expect(result.error).toContain('run_analysis')
    }
  })

  it('colId regex ihlali retry-hatası üretir (değişken ADI kabul edilmez)', () => {
    const result = validateManifestParams(descriptives, { variables: ['yas'] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('variables')
    }
  })

  it('colIds min kuralı: correlate en az 2 değişken ister', () => {
    expect(validateManifestParams(correlate, { variables: ['col_1'] }).ok).toBe(false)
    expect(validateManifestParams(correlate, { variables: ['col_1', 'col_2'] }).ok).toBe(true)
  })

  it('string kind: ttestInd group1/group2 zorunludur, options default dolar', () => {
    const missing = validateManifestParams(ttestInd, {
      variables: ['col_1'],
      groupVar: 'col_2'
    })
    expect(missing.ok).toBe(false)

    const ok = validateManifestParams(ttestInd, {
      variables: ['col_1'],
      groupVar: 'col_2',
      group1: '0',
      group2: '1'
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.params['options']).toEqual({ missing: 'analysis' })
    }
  })

  it('number kind default uygular (ttest1 testValue = 0)', () => {
    const result = validateManifestParams(getManifestEntry('ttest1')!, { variables: ['col_1'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.params['testValue']).toBe(0)
    }
  })

  it('buildParamsZodSchema her manifest girdisi için üretilebilir', () => {
    for (const entry of ANALYSIS_MANIFEST) {
      expect(() => buildParamsZodSchema(entry)).not.toThrow()
    }
  })
})

describe('buildCompanionParams (varNames/*Name/*ValueLabels türetimi)', () => {
  const variables = [
    { colId: 'col_1', name: 'yas', valueLabels: {} },
    { colId: 'col_2', name: 'cinsiyet', valueLabels: { '0': 'Kadın', '1': 'Erkek' } },
    { colId: 'col_3', name: 'puan', valueLabels: {} }
  ]

  it('colIds → colId→name record (descriptives varNames)', () => {
    const out = buildCompanionParams(
      getManifestEntry('descriptives')!,
      { variables: ['col_1', 'col_3'] },
      variables
    )
    expect(out).toEqual({ varNames: { col_1: 'yas', col_3: 'puan' } })
  })

  it('birden çok colIds aynı hedefe merge edilir (ttestPaired var1+var2 → varNames)', () => {
    const out = buildCompanionParams(
      getManifestEntry('ttestPaired')!,
      { var1: ['col_1'], var2: ['col_3'] },
      variables
    )
    expect(out).toEqual({ varNames: { col_1: 'yas', col_3: 'puan' } })
  })

  it('colId → değişken adı string (ttestInd groupVar → groupName) + valueLabels', () => {
    const out = buildCompanionParams(
      getManifestEntry('ttestInd')!,
      { variables: ['col_1'], groupVar: 'col_2' },
      variables
    )
    expect(out['groupName']).toBe('cinsiyet')
    expect(out['varNames']).toEqual({ col_1: 'yas' })
    expect(out['groupValueLabels']).toEqual({ col_2: { '0': 'Kadın', '1': 'Erkek' } })
  })

  it('crosstabs rows/cols → rowNames/colNames', () => {
    const out = buildCompanionParams(
      getManifestEntry('crosstabs')!,
      { rows: ['col_2'], cols: ['col_1'] },
      variables
    )
    expect(out).toEqual({
      rowNames: { col_2: 'cinsiyet' },
      colNames: { col_1: 'yas' },
      rowValueLabels: { col_2: { '0': 'Kadın', '1': 'Erkek' } },
      colValueLabels: { col_1: {} }
    })
  })

  it('regression dependent → dependentName, independents → varNames', () => {
    const out = buildCompanionParams(
      getManifestEntry('regression')!,
      { dependent: 'col_1', independents: ['col_2', 'col_3'] },
      variables
    )
    expect(out).toEqual({
      dependentName: 'yas',
      varNames: { col_2: 'cinsiyet', col_3: 'puan' }
    })
  })

  it('bilinmeyen colId sessizce atlanır (ai-bridge ayrıca colId varlık kontrolü yapar)', () => {
    const out = buildCompanionParams(
      getManifestEntry('descriptives')!,
      { variables: ['col_99'] },
      variables
    )
    expect(out).toEqual({})
  })
})

describe('manifestToToolJsonSchema (manifest → LLM tool şeması)', () => {
  it('kind eşlemesi, required listesi ve additionalProperties:false üretir', () => {
    const schema = manifestToToolJsonSchema(getManifestEntry('ttestInd')!) as {
      type: string
      additionalProperties: boolean
      required: string[]
      properties: Record<string, Record<string, unknown>>
    }
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required.sort()).toEqual(['group1', 'group2', 'groupVar', 'variables'].sort())
    // `pattern` bilerek şemada yok (bazı sağlayıcıların tool-schema
    // çeviricileri regex'i 422 ile reddediyor, bkz. manifestToToolJsonSchema
    // yorumu) — format ipucu yalnız description'da, gerçek doğrulama zod'da.
    expect(schema.properties['variables']).toMatchObject({
      type: 'array',
      minItems: 1,
      items: { type: 'string' }
    })
    expect(schema.properties['variables']?.['items']).not.toHaveProperty('pattern')
    expect(schema.properties['groupVar']).toMatchObject({ type: 'string' })
    expect(schema.properties['groupVar']?.['description']).toContain('col_')
    expect(schema.properties['group1']).toMatchObject({ type: 'string' })
    // options zorunlu değil → required listesinde yok
    expect(schema.required).not.toContain('options')
  })

  it('colIds min manifestteki gibi yansır (correlate minItems:2)', () => {
    const schema = manifestToToolJsonSchema(getManifestEntry('correlate')!) as {
      properties: Record<string, Record<string, unknown>>
    }
    expect(schema.properties['variables']).toMatchObject({ type: 'array', minItems: 2 })
  })

  it('default değerler açıklamada dokümante edilir (model sözleşmeyi görür)', () => {
    const schema = manifestToToolJsonSchema(getManifestEntry('descriptives')!) as {
      properties: Record<string, { description: string }>
    }
    expect(schema.properties['saveZScores']?.description).toContain('false')
    expect(schema.properties['options']?.description).toContain('displayOrder')
    // role ipucu açıklamaya yazılır
    expect(schema.properties['variables']?.description).toContain('scale')
  })

  it('tüm manifest girdileri için geçerli şema iskeleti üretir', () => {
    for (const entry of ANALYSIS_MANIFEST) {
      const schema = manifestToToolJsonSchema(entry) as { type: string; properties: object }
      expect(schema.type).toBe('object')
      expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(entry.params).sort())
    }
  })
})
