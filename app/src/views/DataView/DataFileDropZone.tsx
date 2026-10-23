// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { importDataset } from '../../lib/file-actions'
import styles from './DataView.module.css'

const supportedFile = /\.(csv|txt|xlsx|sav|zsav|por|dta|sas7bdat|xpt)$/i

export function DataFileDropZone({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  const depth = useRef(0)
  const busy = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const resetDrag = () => {
    depth.current = 0
    setDragging(false)
  }

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    resetDrag()
    if (busy.current) return
    setError('')
    const files = Array.from(event.dataTransfer.files)
    const file = files[0]
    if (files.length !== 1 || !file) {
      setError(t('fileDrop.singleFile'))
      return
    }
    if (!supportedFile.test(file.name)) {
      setError(t('fileDrop.unsupported'))
      return
    }
    busy.current = true
    setImporting(true)
    try {
      const filePath = window.api.file.getPathForFile(file)
      if (!filePath) throw new Error(t('fileDrop.noPath'))
      await importDataset({ filePath })
    } catch (err) {
      setError(t('fileDrop.failed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      busy.current = false
      setImporting(false)
    }
  }

  return (
    <div
      className={styles.fileDropZone}
      aria-busy={importing}
      onDragEnterCapture={event => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        depth.current += 1
        setDragging(true)
      }}
      onDragOverCapture={event => {
        if (!isFileDrag(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = busy.current ? 'none' : 'copy'
      }}
      onDragLeaveCapture={event => {
        if (!isFileDrag(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDropCapture={event => {
        void onDrop(event)
      }}
      onDragEndCapture={resetDrag}
    >
      {children}
      {(dragging || importing) && (
        <div className={styles.fileDropOverlay} role="status">
          {importing ? t('fileDrop.importing') : t('fileDrop.release')}
        </div>
      )}
      {error && (
        <div className={styles.fileDropError} role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError('')
            }}
          >
            {t('common.close')}
          </button>
        </div>
      )}
    </div>
  )
}
