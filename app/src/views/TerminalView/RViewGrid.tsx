// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RViewGrid — read-only grid for `View(df)` from the R console (Faz T3).
 *
 * AG Grid Community's infinite row model: rows are paged out of the DuckDB
 * temp table Main loaded the snapshot into (`terminal:r:view-rows`), so any
 * size opens instantly and only visible blocks are in memory. Sorting is done
 * by DuckDB (one column at a time), not in the grid.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AgGridReact } from 'ag-grid-react'
import {
  ModuleRegistry,
  AllCommunityModule,
  type ColDef,
  type IDatasource,
  type ValueGetterParams
} from 'ag-grid-community'
import type { TerminalRViewPayload } from '@shared/ipc-contracts'
import { useResolvedTheme } from '../../theme/ThemeProvider'
import { cx } from '../../lib/cx'
import styles from './TerminalView.module.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'

ModuleRegistry.registerModules([AllCommunityModule])

type ViewRow = Record<string, string | number | boolean | null>

const BLOCK_SIZE = 200
// DuckDB type names (INTEGER, UBIGINT, DECIMAL(9,2)…) — not INTERVAL.
const NUMERIC_TYPE = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|DOUBLE|DECIMAL)\b/

/** Column key for the i-th data column (names can be anything, so not used as keys). */
const colKey = (i: number): string => `c${String(i)}`

export function RViewGrid({ view }: { view: TerminalRViewPayload }) {
  const { t } = useTranslation(['analysis'])
  const isDark = useResolvedTheme() !== 'light'

  const columnDefs = useMemo<ColDef<ViewRow>[]>(
    () => [
      {
        headerName: '',
        colId: '__row',
        width: 64,
        pinned: 'left',
        sortable: false,
        resizable: false,
        cellClass: styles.viewRowNum,
        valueGetter: (p: ValueGetterParams<ViewRow>) =>
          p.node?.rowIndex != null ? p.node.rowIndex + 1 : ''
      },
      ...view.columns.map(
        (c, i): ColDef<ViewRow> => ({
          headerName: c.name,
          field: colKey(i),
          headerTooltip: `${c.name} · ${c.type}`,
          type: NUMERIC_TYPE.test(c.type) ? 'numericColumn' : undefined
        })
      )
    ],
    [view]
  )

  const datasource = useMemo<IDatasource>(
    () => ({
      rowCount: view.rowCount,
      getRows: params => {
        const sort = params.sortModel[0]
        const sortIdx = sort ? Number(sort.colId.slice(1)) : -1
        const sortCol = sort && sortIdx >= 0 ? view.columns[sortIdx]?.name : undefined
        window.api.terminal
          .rViewRows({
            viewId: view.viewId,
            offset: params.startRow,
            limit: Math.max(1, params.endRow - params.startRow),
            sortCol,
            sortDir: sortCol ? sort?.sort : undefined
          })
          .then(res => {
            const rows = res.rows.map(r => {
              const o: ViewRow = {}
              r.forEach((v, i) => {
                o[colKey(i)] = v
              })
              return o
            })
            params.successCallback(rows, view.rowCount)
          })
          .catch(() => {
            params.failCallback()
          })
      }
    }),
    [view]
  )

  return (
    <div className={styles.viewPane}>
      <div className={styles.viewInfo}>
        {t('terminal.r.view.info', {
          rows: view.rowCount.toLocaleString(),
          cols: view.columns.length.toLocaleString()
        })}
      </div>
      <div className={cx(isDark ? 'ag-theme-quartz-dark' : 'ag-theme-quartz', styles.viewGrid)}>
        <AgGridReact<ViewRow>
          theme="legacy"
          rowModelType="infinite"
          datasource={datasource}
          cacheBlockSize={BLOCK_SIZE}
          maxBlocksInCache={50}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: true, minWidth: 80 }}
          animateRows={false}
          enableCellTextSelection
        />
      </div>
    </div>
  )
}
