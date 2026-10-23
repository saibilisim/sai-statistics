// SPDX-FileCopyrightText: 2026 SAI Bilişim
// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { builtinModules } from 'node:module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const appVersion = (
  JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
).version

// electron-vite normally externalizes 'electron' + Node builtins by default,
// but supplying a custom rollupOptions.external replaces that default list
// entirely instead of merging with it — so it must be restated here for any
// build target (main/preload) that needs a custom external list of its own.
const electronAndBuiltinsExternal = [
  'electron',
  /^electron\/.+/,
  ...builtinModules.flatMap(m => [m, `node:${m}`])
]

export default defineConfig({
  main: {
    build: {
      // Minified + hidden source maps (2026-10-09): the shipped main/preload bundle
      // was plain, comment-preserving JS readable from app.asar. Maps are written
      // next to the bundle for decoding user crash logs but are excluded from the
      // package (electron-builder files: !out/**/*.map) and archived per release
      // by the release pipeline. The renderer needs the same flags: this
      // electron-vite version does NOT minify it by default (2026-10-10 audit found
      // the 4.8 MB UI bundle shipped with comments and original names).
      minify: true,
      sourcemap: 'hidden',
      externalizeDeps: {
        exclude: ['electron-store', 'conf', 'electron-log']
      },
      rollupOptions: {
        input: resolve('electron/main.ts'),
        output: {
          entryFileNames: 'main.cjs',
          format: 'cjs'
        },
        // @duckdb/node-bindings resolves its native binding via per-platform
        // optional packages (linux-x64-gnu, linux-x64-musl, ...); only the
        // one matching the current platform is installed, so rolldown must
        // treat all of them as external instead of trying to bundle them.
        external: [...electronAndBuiltinsExternal, /^@duckdb\/node-bindings-/]
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    }
  },
  preload: {
    build: {
      minify: true,
      sourcemap: 'hidden',
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: {
          entryFileNames: 'preload.cjs',
          format: 'cjs'
        },
        external: electronAndBuiltinsExternal
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    }
  },
  renderer: {
    root: '.',
    define: {
      // About dialog (P1.1) — the only place the version string is shown.
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    server: {
      watch: {
        // flatpak-builder bind-mounts /var/run/udev etc. under its build dir — that tree
        // contains circular symlinks that crash chokidar (ELOOP) if the dev server is
        // left watching the project root while a flatpak build exists on disk. The same
        // goes for any build output a script leaves under tmp/ (scratch area, CLAUDE.md
        // §11), so everything that is not renderer source is ignored.
        ignored: [
          '**/flatpak-build-dir/**',
          '**/flatpak-repo/**',
          '**/.flatpak-builder/**',
          '**/tmp/**',
          '**/dist/**',
          '**/release-sourcemaps/**',
          '**/resources/r-runtime*/**'
        ]
      }
    },
    build: {
      minify: true,
      sourcemap: 'hidden',
      rollupOptions: {
        input: resolve('index.html')
      }
    },
    resolve: {
      alias: {
        '@': resolve('src'),
        '@shared': resolve('shared')
      }
    },
    plugins: [react()]
  }
})
