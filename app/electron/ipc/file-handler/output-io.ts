// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '../../../shared/ipc-contracts'
import {
  FileSaveOutputRequestSchema,
  FileExportOutputTextRequestSchema,
  FileExportOutputBinaryRequestSchema,
  FileOpenSyntaxRequestSchema,
  FileSaveSyntaxRequestSchema,
  SYNTAX_FILE_MAX_CHARS
} from '../../../shared/ipc-schemas'
import { handleValidated } from '../security'
import { dialogText } from './shared'

// Script files the user picked in an open/save dialog this session. A later
// Save may write to one of these without asking again (RStudio-style Save);
// a path the renderer merely names is never written without a dialog.
const chosenSyntaxPaths = new Set<string>()
const pathKey = (p: string): string =>
  process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)

/** A script the user opened another way (the R Files pane) — Save may write it. */
export function approveSyntaxPath(p: string): void {
  chosenSyntaxPaths.add(pathKey(p))
}

export function registerOutputHandlers(): void {
  // 4b. file:save-output — self-contained Output-tab HTML export (P0.2). The
  // renderer serializes the OutputBlock[] to HTML (tables + rasterized plots);
  // Main only owns the native save dialog + disk write.
  handleValidated(
    IPC.FILE_SAVE_OUTPUT,
    FileSaveOutputRequestSchema,
    async ({ html, defaultName }): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: dialogText().saveOutput,
        defaultPath: defaultName,
        filters: [{ name: 'HTML (*.html)', extensions: ['html'] }]
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      await fs.promises.writeFile(result.filePath, html, 'utf8')
      return result.filePath
    }
  )

  // 4c. file:export-output-pdf — same self-contained HTML from the renderer
  // (P0.2), rendered off-screen in a throwaway BrowserWindow and printed to
  // PDF via Electron's own printToPDF (no external dependency: unlike a
  // Word/.docx export, PDF needs nothing beyond what Electron/Chromium
  // already ships).
  handleValidated(
    IPC.FILE_EXPORT_OUTPUT_PDF,
    FileSaveOutputRequestSchema,
    async ({ html, defaultName }): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: dialogText().exportOutputPdf,
        defaultPath: defaultName.replace(/\.html$/i, '.pdf'),
        filters: [{ name: 'PDF (*.pdf)', extensions: ['pdf'] }]
      })

      if (result.canceled || !result.filePath) {
        return null
      }

      const pdfWindow = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      try {
        await pdfWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
        const buffer = await pdfWindow.webContents.printToPDF({
          printBackground: true,
          landscape: false
        })
        await fs.promises.writeFile(result.filePath, buffer)
      } finally {
        pdfWindow.destroy()
      }
      return result.filePath
    }
  )

  // 4f. file:export-output-text — generic save-dialog-then-write-text,
  // backing the Export Output dialog's Word/Excel/CSV/Markdown formats
  // (output-export.ts builds format-specific text content in the renderer;
  // Main just owns the native save dialog + disk write, same division as
  // file:save-output).
  handleValidated(
    IPC.FILE_EXPORT_OUTPUT_TEXT,
    FileExportOutputTextRequestSchema,
    async ({ content, defaultName, filterName, extensions }): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: dialogText().exportOutput,
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions }]
      })
      if (result.canceled || !result.filePath) return null

      await fs.promises.writeFile(result.filePath, content, 'utf8')
      return result.filePath
    }
  )

  // file:export-output-binary — same as above for the native .docx/.xlsx
  // exports, whose bytes the renderer builds (output-export-office.ts).
  handleValidated(
    IPC.FILE_EXPORT_OUTPUT_BINARY,
    FileExportOutputBinaryRequestSchema,
    async ({ data, defaultName, filterName, extensions }): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        title: dialogText().exportOutput,
        defaultPath: defaultName,
        filters: [{ name: filterName, extensions }]
      })
      if (result.canceled || !result.filePath) return null

      await fs.promises.writeFile(result.filePath, data)
      return result.filePath
    }
  )

  // file:open-syntax — Sözdizimi sekmesinde .sps (veya R modunda .R) açma.
  // The path never crosses from the renderer: Main shows the dialog and
  // returns only the text (plus the chosen path for the Save default name).
  // Oversized files are refused.
  handleValidated(
    IPC.FILE_OPEN_SYNTAX,
    FileOpenSyntaxRequestSchema,
    async ({ kind }): Promise<{ filePath: string; content: string } | null> => {
      const dlg = dialogText()
      const result = await dialog.showOpenDialog({
        title: kind === 'r' ? dlg.openRScript : dlg.openSyntax,
        properties: ['openFile'],
        filters: [
          kind === 'r'
            ? { name: dlg.rScriptFilter, extensions: ['R', 'r', 'Rmd', 'rmd', 'qmd'] }
            : { name: dlg.syntaxFilter, extensions: ['sps'] },
          { name: dlg.textFilter, extensions: ['txt'] }
        ]
      })
      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) return null
      const { size } = await fs.promises.stat(filePath)
      if (size > SYNTAX_FILE_MAX_CHARS) throw new Error('Syntax file is too large')
      // SPSS writes syntax as UTF-8 (often with a BOM) — strip the BOM.
      const content = (await fs.promises.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '')
      chosenSyntaxPaths.add(pathKey(filePath))
      return { filePath, content }
    }
  )

  // file:save-syntax — Sözdizimi sekmesinde .sps (veya R modunda .R) kaydetme.
  // With `filePath` already chosen this session: write it directly.
  handleValidated(
    IPC.FILE_SAVE_SYNTAX,
    FileSaveSyntaxRequestSchema,
    async ({ content, defaultName, kind, filePath }): Promise<string | null> => {
      if (filePath && chosenSyntaxPaths.has(pathKey(filePath))) {
        await fs.promises.writeFile(filePath, content, 'utf8')
        return filePath
      }
      const dlg = dialogText()
      const result = await dialog.showSaveDialog({
        title: kind === 'r' ? dlg.saveRScript : dlg.saveSyntax,
        defaultPath: defaultName,
        filters:
          kind === 'r'
            ? // R Markdown / Quarto documents keep their own extension.
              /\.(rmd|qmd)$/i.test(defaultName)
              ? [{ name: 'R Markdown', extensions: [defaultName.split('.').pop() as string] }]
              : [{ name: dlg.rScriptFilter, extensions: ['R'] }]
            : [{ name: dlg.syntaxFilter, extensions: ['sps'] }]
      })
      if (result.canceled || !result.filePath) return null
      await fs.promises.writeFile(result.filePath, content, 'utf8')
      chosenSyntaxPaths.add(pathKey(result.filePath))
      return result.filePath
    }
  )
}
