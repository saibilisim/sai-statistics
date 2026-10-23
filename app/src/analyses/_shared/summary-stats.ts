// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The statistic menu shared by the three Reports procedures — Case Summaries,
 * Report Summaries in Rows and Report Summaries in Columns.
 *
 * This is the renderer half of `_bootstrap.R`'s `sai_summary_stat_defs()`:
 * same keys, same order. Keeping one list per dialog is how the three drift
 * into offering different statistics under different names, so they all import
 * from here and the R side reads the same keys back out of `options.stats`.
 *
 * Order is SPSS's own output order, verified against a real SPSS 26 Case
 * Summaries export. `SUMMARY_STAT_KEYS` doubles as the checkbox order, so the
 * dialog lists statistics in the order the table will print them.
 */

export const SUMMARY_STAT_KEYS = [
  'n',
  'mean',
  'median',
  'groupedMedian',
  'seMean',
  'sum',
  'min',
  'max',
  'range',
  'first',
  'last',
  'sd',
  'variance',
  'kurtosis',
  'seKurtosis',
  'skewness',
  'seSkewness',
  'harmonic',
  'geometric'
] as const

export type SummaryStatKey = (typeof SUMMARY_STAT_KEYS)[number]

export type SummaryStats = Record<SummaryStatKey, boolean>

/**
 * How the Statistics sub-dialog groups the menu. Sixteen checkboxes in one
 * flat two-column grid read as an undifferentiated list; SPSS's own Frequencies
 * Statistics dialog splits the same kinds of statistic into Central Tendency /
 * Dispersion / Distribution, so these follow that grouping, with the count and
 * the two order-based statistics (which apply to string variables too) in
 * their own group.
 *
 * Only affects presentation — the run order is SUMMARY_STAT_KEYS above, which
 * is what the R side prints.
 */
export const SUMMARY_STAT_GROUPS: { titleKey: string; keys: SummaryStatKey[] }[] = [
  { titleKey: 'analysis:summaryStats.groups.count', keys: ['n', 'first', 'last'] },
  {
    titleKey: 'analysis:summaryStats.groups.centralTendency',
    keys: ['mean', 'median', 'groupedMedian', 'sum', 'harmonic', 'geometric']
  },
  {
    titleKey: 'analysis:summaryStats.groups.dispersion',
    keys: ['sd', 'variance', 'seMean', 'min', 'max', 'range']
  },
  {
    titleKey: 'analysis:summaryStats.groups.distribution',
    keys: ['skewness', 'seSkewness', 'kurtosis', 'seKurtosis']
  }
]

/** SPSS's own default selection: N, Mean, Std. Deviation. */
export const DEFAULT_SUMMARY_STATS: SummaryStats = SUMMARY_STAT_KEYS.reduce(
  (acc, key) => ({ ...acc, [key]: key === 'n' || key === 'mean' || key === 'sd' }),
  {} as SummaryStats
)

/** i18n key for a statistic's label. The three dialogs share one set of
 *  labels so the same statistic is never worded differently between them. */
export function summaryStatLabelKey(key: SummaryStatKey): string {
  return `analysis:col.${key}`
}

// ─────────────────────────────────────────────────────────────
//  OLAP Cubes' extra cells
// ─────────────────────────────────────────────────────────────

/**
 * The four percentage cells SPSS offers on top of the menu above — NPCT, SPCT
 * and their NPCT(var)/SPCT(var) forms. They are not in the registry proper
 * because none of them is a function of one variable's values alone: each
 * needs a base computed outside the cell (the whole cube, or the cell's own
 * category of one grouping variable). olap-cubes.R computes them for the same
 * four keys; the R counterpart's comment says so from its side.
 *
 * `pctNIn`/`pctSumIn` are one checkbox but as many columns as there are
 * grouping variables — SPSS lists the variables individually in its own
 * dialog, which only makes sense there because its Cell Statistics box is an
 * ordered list rather than a checkbox grid.
 */
export const OLAP_PERCENT_STAT_KEYS = ['pctTotalN', 'pctTotalSum', 'pctNIn', 'pctSumIn'] as const

export type OlapPercentStatKey = (typeof OLAP_PERCENT_STAT_KEYS)[number]

export type OlapStats = SummaryStats & Record<OlapPercentStatKey, boolean>

/** The Statistics sub-dialog of OLAP Cubes: the shared menu plus percentages. */
export const OLAP_STAT_GROUPS: { titleKey: string; keys: string[] }[] = [
  ...SUMMARY_STAT_GROUPS,
  {
    titleKey: 'analysis:summaryStats.groups.percentages',
    keys: [...OLAP_PERCENT_STAT_KEYS]
  }
]

/** SPSS OLAP Cubes' own default cell statistics: Sum, N, Mean, Std. Deviation,
 *  % of Total Sum, % of Total N. */
export const DEFAULT_OLAP_STATS: OlapStats = {
  ...SUMMARY_STAT_KEYS.reduce(
    (acc, key) => ({
      ...acc,
      [key]: key === 'n' || key === 'mean' || key === 'sd' || key === 'sum'
    }),
    {} as SummaryStats
  ),
  pctTotalN: true,
  pctTotalSum: true,
  pctNIn: false,
  pctSumIn: false
}
