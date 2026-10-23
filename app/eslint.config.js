// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  {
    // Build artefacts, not sources. The r-runtime-* trees are the vendored,
    // .gitignore'd R distributions produced by scripts/vendor-r-runtime*.sh —
    // they ship third-party JS inside R's HTML docs (katex, prism), which would
    // otherwise fail the lint on any machine that has run `pnpm vendor:r-runtime`.
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'resources/r-runtime/**',
      'resources/r-runtime-win/**',
      'resources/r-runtime-mac/**',
      // Scratch area (CLAUDE.md §11): logs, one-off scripts and a conda/mamba
      // cache with thousands of third-party files — never project code.
      'tmp/**',
      'release-sourcemaps/**',
      // flatpak-builder output (pnpm dist:flatpak*) — a full copy of the packaged app.
      'flatpak-build-dir/**',
      'flatpak-repo/**',
      '.flatpak-builder/**'
    ]
  },

  // Shared + Electron Main + Preload
  {
    files: ['shared/**/*.ts', 'electron/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },

  // Renderer (React)
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'error',
      // aggrid-gecis-roadmap.md T7: the DataView grid (cell-selection.ts,
      // use-cell-selection.ts, use-structural-ops.ts, DataViewContextMenu.tsx,
      // find-replace.ts) reimplements range selection/clipboard/context-menu/
      // find-replace against ag-grid-community's public API specifically so
      // ag-grid-enterprise (CellSelectionModule, ContextMenuModule, ...) is
      // never needed — a licensing requirement, not a preference (see
      // aggrid-gecis-roadmap.md §"AG Grid Enterprise fiyat araştırması": the
      // standard license excludes distributed open-source desktop apps, and
      // the project cannot embed a paid license key in a public repo). This
      // rule makes an accidental import (e.g. copy-pasted from an AG Grid doc
      // example) a build-time error instead of a silent license violation.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['ag-grid-enterprise', 'ag-grid-enterprise/*'],
              message:
                'ag-grid-enterprise is not licensed for this project (T7, aggrid-gecis-roadmap.md) — reimplement against ag-grid-community instead.'
            }
          ]
        }
      ]
    }
  }
)
