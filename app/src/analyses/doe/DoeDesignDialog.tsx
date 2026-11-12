// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Create Design dialog — Analyze → Design of Experiments → Create Design.
 * Builds a randomized plan (doe-designs.ts) and opens it as a new dataset with
 * an empty response column to fill in after the experiment.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DialogBase } from '../../components/Dialogs/DialogBase'
import styles from '../../components/Dialogs/DataDialogs.module.css'
import shellStyles from '../../components/Dialogs/AnalysisDialogShell.module.css'
import { useDatasetStore } from '../../store/dataset-store'
import { ensureCanReplaceDataset } from '../../lib/file-actions'
import {
  buildDesign,
  designSize,
  type DoeDesignSpec,
  type DoeDesignType,
  type DoeFactorSpec
} from './doe-designs'
import { designSpecError, factorSlots } from './doe-params'

const DESIGNS: DoeDesignType[] = ['crd', 'rcbd', 'latin', 'factorial', 'splitplot', 'twok']

interface FactorRow {
  name: string
  levels: string
}

const splitLevels = (s: string) =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)

export function DoeDesignDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['common', 'analysis'])
  const [design, setDesign] = useState<DoeDesignType>('rcbd')
  const [rows, setRows] = useState<FactorRow[]>([
    { name: 'Treatment', levels: 'T1, T2, T3, T4' },
    { name: 'B', levels: 'B1, B2' },
    { name: 'C', levels: 'C1, C2' },
    { name: 'D', levels: '-, +' },
    { name: 'E', levels: '-, +' },
    { name: 'F', levels: '-, +' }
  ])
  const [nFactors, setNFactors] = useState(2)
  const [reps, setReps] = useState('4')
  const [blocked, setBlocked] = useState(false)
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1e6)))
  const [response, setResponse] = useState('Response')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const slots = factorSlots(design, nFactors)
  const factors: DoeFactorSpec[] = rows.slice(0, slots.count).map(r => ({
    name: r.name.trim(),
    levels: design === 'twok' ? splitLevels(r.levels).slice(0, 2) : splitLevels(r.levels)
  }))
  const spec: DoeDesignSpec = {
    type: design,
    factors,
    replicates: Number(reps),
    blocked: design === 'factorial' && blocked,
    seed: Number(seed),
    responseName: response.trim()
  }
  const repsKey =
    design === 'rcbd' || design === 'splitplot' || (design === 'factorial' && blocked)
      ? 'analysis:doe.blocks'
      : 'analysis:doe.replicates'
  const specErr = designSpecError(spec)
  const size = specErr ? 0 : designSize(spec)

  const handleOk = async () => {
    if (specErr) return
    if (!(await ensureCanReplaceDataset())) return
    setBusy(true)
    setError(null)
    try {
      const columns = buildDesign(spec)
      const result = await window.api.data.createDataset({
        name: `${t(`analysis:doe.design_${design}`)} (seed ${seed})`,
        columns
      })
      useDatasetStore
        .getState()
        .setDataset(
          result.dataset.id,
          result.dataset.name,
          result.dataset.filePath,
          result.variables,
          result.dataset.rowCount,
          null
        )
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const setRow = (i: number, patch: Partial<FactorRow>) => {
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  return (
    <DialogBase
      titleKey="analysis:doe.createTitle"
      onOk={() => void handleOk()}
      onCancel={onClose}
      okDisabled={busy || specErr !== null}
    >
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('analysis:doe.designLabel')}</span>
        <select
          className={styles.condSelect}
          value={design}
          aria-label={t('analysis:doe.designLabel')}
          onChange={e => {
            setDesign(e.target.value as DoeDesignType)
          }}
        >
          {DESIGNS.map(d => (
            <option key={d} value={d}>
              {t(`analysis:doe.design_${d}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={shellStyles.optionHint}>{t(`analysis:doe.createHint_${design}`)}</div>
      {slots.variable && (
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t('analysis:doe.nFactors')}</span>
          <input
            type="number"
            className={styles.condInput}
            min={slots.min}
            max={slots.max}
            value={nFactors}
            aria-label={t('analysis:doe.nFactors')}
            onChange={e => {
              setNFactors(
                Math.min(slots.max, Math.max(slots.min, Number(e.target.value) || slots.min))
              )
            }}
          />
        </div>
      )}
      {rows.slice(0, slots.count).map((r, i) => (
        <div key={i} className={styles.conditionRow}>
          <span className={styles.condLabel}>
            {t((slots.labelKeys[i] ?? 'analysis:doe.factorN') as never, { n: i + 1 })}
          </span>
          <input
            className={styles.condInput}
            value={r.name}
            maxLength={40}
            aria-label={t('analysis:doe.factorName', { n: i + 1 })}
            onChange={e => {
              setRow(i, { name: e.target.value })
            }}
          />
          <input
            className={styles.condInput}
            value={r.levels}
            aria-label={t('analysis:doe.factorLevels', { n: i + 1 })}
            placeholder={t(
              design === 'twok' ? 'analysis:doe.levelsTwoK' : 'analysis:doe.levelsHint'
            )}
            onChange={e => {
              setRow(i, { levels: e.target.value })
            }}
          />
        </div>
      ))}
      {design !== 'latin' && (
        <div className={styles.conditionRow}>
          <span className={styles.condLabel}>{t(repsKey)}</span>
          <input
            type="number"
            min="1"
            max="100"
            className={styles.condInput}
            value={reps}
            aria-label={t(repsKey)}
            onChange={e => {
              setReps(e.target.value)
            }}
          />
        </div>
      )}
      {design === 'factorial' && (
        <label className={shellStyles.checkRow}>
          <input
            type="checkbox"
            checked={blocked}
            onChange={e => {
              setBlocked(e.target.checked)
            }}
          />
          {t('analysis:doe.blockedOption')}
        </label>
      )}
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('analysis:doe.responseName')}</span>
        <input
          className={styles.condInput}
          value={response}
          maxLength={40}
          aria-label={t('analysis:doe.responseName')}
          onChange={e => {
            setResponse(e.target.value)
          }}
        />
      </div>
      <div className={styles.conditionRow}>
        <span className={styles.condLabel}>{t('analysis:doe.seed')}</span>
        <input
          type="number"
          className={styles.condInput}
          value={seed}
          aria-label={t('analysis:doe.seed')}
          onChange={e => {
            setSeed(e.target.value)
          }}
        />
      </div>
      <div className={specErr ? shellStyles.errorText : shellStyles.hintText}>
        {specErr ? t(specErr as never) : t('analysis:doe.sizePreview', { n: size })}
      </div>
      {error && <div className={shellStyles.errorText}>{error}</div>}
    </DialogBase>
  )
}
