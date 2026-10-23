// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RReportView — the rendered R report (Faz T3 P2), an editor-area tab like
 * View() grids and widgets. Rendered with React from the report data (no
 * HTML strings, so R output can't inject markup); HTML/PDF export builds
 * its own escaped document (r-report.ts buildReportHtml).
 */
import { useTranslation } from 'react-i18next'
import { highlightCode } from '../../lib/code-highlight'
import { cx } from '../../lib/cx'
import { mdBlocks, mdInline, type ReportItem, type RReport } from '../../lib/r-report'
import { RefreshIcon, SaveIcon } from './terminal-icons'
import styles from './TerminalView.module.css'

function Inline({ text }: { text: string }) {
  return (
    <>
      {mdInline(text).map((s, i) =>
        s.kind === 'code' ? (
          <code key={i} className={styles.reportInlineCode}>
            {s.text}
          </code>
        ) : s.kind === 'bold' ? (
          <strong key={i}>{s.text}</strong>
        ) : s.kind === 'italic' ? (
          <em key={i}>{s.text}</em>
        ) : (
          s.text
        )
      )}
    </>
  )
}

function Code({ code }: { code: string }) {
  return (
    <pre className={cx(styles.reportPre, styles.reportCode)}>
      {code.split('\n').map((line, i) => (
        <span key={i}>
          {highlightCode(line, 'r').map((tok, j) =>
            tok.kind === 'plain' ? (
              tok.text
            ) : (
              <span key={j} className={styles[`tok_${tok.kind}`]}>
                {tok.text}
              </span>
            )
          )}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

function Item({ item }: { item: ReportItem }) {
  if (item.kind === 'heading') {
    return item.level <= 1 ? (
      <h3 className={styles.reportH1}>
        <Inline text={item.text} />
      </h3>
    ) : (
      <h4 className={styles.reportH2}>
        <Inline text={item.text} />
      </h4>
    )
  }
  if (item.kind === 'text') {
    return (
      <>
        {mdBlocks(item.text).map((b, i) =>
          b.kind === 'p' ? (
            <p key={i} className={styles.reportP}>
              <Inline text={b.text} />
            </p>
          ) : b.kind === 'ul' ? (
            <ul key={i} className={styles.reportList}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </ul>
          ) : (
            <ol key={i} className={styles.reportList}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </ol>
          )
        )}
      </>
    )
  }
  return (
    <div className={styles.reportChunk}>
      {!item.hideCode && <Code code={item.code} />}
      {item.output !== '' && (
        <pre className={cx(styles.reportPre, styles.reportOut, item.error && styles.reportErr)}>
          {item.output}
        </pre>
      )}
      {item.tables.map((tbl, i) => (
        <div key={i} className={styles.reportTableWrap}>
          {tbl.title && <div className={styles.reportCaption}>{tbl.title}</div>}
          <table className={styles.reportTable}>
            <thead>
              <tr>
                {tbl.columns.map((c, j) => (
                  <th key={j}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tbl.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((v, k) => (
                    <td key={k} className={typeof v === 'number' ? styles.reportNum : undefined}>
                      {v ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {item.plots.map((png, i) => (
        <img key={i} className={styles.reportImg} src={`data:image/png;base64,${png}`} alt="" />
      ))}
    </div>
  )
}

export function RReportView({
  report,
  running,
  onRerun,
  onSave
}: {
  report: RReport
  running: boolean
  onRerun: () => void
  onSave: (format: 'html' | 'pdf') => void
}) {
  const { t } = useTranslation(['analysis'])
  const when = new Date(report.createdAt).toLocaleString()
  return (
    <div className={styles.reportPane}>
      <div className={styles.reportToolbar}>
        <span className={styles.reportMeta}>
          {t('terminal.r.report.generated', { when })}
          {report.datasetName !== '' && ` · ${report.datasetName}`}
        </span>
        <span className={styles.spacer} />
        <button type="button" className={styles.button} onClick={onRerun} disabled={running}>
          <RefreshIcon size={12} />
          {running ? t('terminal.r.report.running') : t('terminal.r.report.rerun')}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            onSave('html')
          }}
          disabled={running}
        >
          <SaveIcon size={12} />
          {t('terminal.r.report.saveHtml')}
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            onSave('pdf')
          }}
          disabled={running}
        >
          <SaveIcon size={12} />
          {t('terminal.r.report.savePdf')}
        </button>
      </div>
      <article className={styles.reportDoc} aria-busy={running}>
        <h2 className={styles.reportTitle}>{report.title}</h2>
        {report.items.length === 0 && !running && (
          <p className={styles.sideEmpty}>{t('terminal.r.report.empty')}</p>
        )}
        {report.items.map((item, i) => (
          <Item key={i} item={item} />
        ))}
        {report.incomplete && (
          <p className={styles.reportIncomplete}>{t('terminal.r.report.incomplete')}</p>
        )}
      </article>
    </div>
  )
}
