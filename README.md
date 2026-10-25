# SAI Statistics

A cross-platform desktop statistics application built on the R engine —
Electron, React, DuckDB and R in one codebase for Windows, macOS and Linux.

Import data, define variables, run statistical analyses backed by real R code,
and read the results as formatted tables and interactive charts.

> **Official builds** are published at [saistatistics.com](https://saistatistics.com)
> and in the Microsoft Store, signed by SAI Bilişim. Builds from other sources
> are not ours; see [TRADEMARK.md](TRADEMARK.md).

## Features

- **Data View** (AG Grid Community spreadsheet with cell formulas, fill handle
  and find/replace) and **Variable View** with full variable metadata: value
  labels, missing values, measurement level, column formats.
- **50+ statistical procedures** — descriptives, t-tests/ANOVA,
  correlation/regression, non-parametric tests, GLM, factor/cluster analysis,
  survival analysis and more. Everything is computed in R: R's own functions
  and CRAN packages (`t.test`, `lm`, `survival`, `lme4`, …) where they fit, and
  formulas written in R where a procedure needs a convention they don't offer
  (SPSS frequency-weight semantics, Type III sums of squares, …).
- **Validated results** — every R script is checked against known reference
  values (`app/tests/r-validation/`), and an SPSS parity harness compares the
  same analyses with IBM SPSS Statistics output (`app/tests/spss-parity/`).
- **SPSS syntax** — paste or write SPSS command syntax (`FREQUENCIES`,
  `RECODE`, `DO REPEAT`, …); it runs through the same typed, validated pipeline
  the menus use. `.sav` files import and export.
- **R terminal** — a persistent R session with the dataset loaded read-only,
  plus a script editor, plots, a package panel and a debugger.
- **Output window** with copyable tables, exportable to HTML, PDF, Word and Excel.
- **AI assistant** (optional, requires a SAI account) — explains results and
  proposes analyses. Raw data rows are never sent to the model; see
  [CLAUDE.md §9](CLAUDE.md#9-security-non-negotiable).
- Interface in Turkish, English, Spanish, French, Portuguese and Italian;
  a new language is a locale folder away.

## Building from source

Prerequisites:

- **Node.js 24+** (see `app/.nvmrc`) and **pnpm**.
- **R** with `Rscript` on `PATH`, plus the packages the analyses use:
  ```bash
  Rscript app/r-scripts/setup.R
  ```
  The app also detects a missing R or missing packages on first launch.

```bash
cd app
pnpm install
pnpm dev          # electron-vite dev server with HMR
```

Other commands (run from `app/`):

```bash
pnpm build              # production build (electron-vite)
pnpm typecheck          # tsc --noEmit, main + renderer
pnpm lint               # ESLint + Prettier check
pnpm test               # Vitest unit tests
pnpm test:r-validation  # R scripts against known reference values
pnpm test:e2e           # Playwright-driven Electron end-to-end scenarios (needs pnpm build)
pnpm dist               # electron-builder package for the current platform
pnpm dist:win|:mac|:linux
```

## Packaging installers

The interactive script at the repo root shows a menu (deb / rpm / AppImage /
Flatpak / Windows / macOS) and runs the whole pipeline for the chosen target:
install → R runtime vendoring → build → electron-builder. Missing tools are
installed project-locally under `.tools/` (Node, pnpm, micromamba); only rpm /
flatpak / wine system packages need `sudo`, and the script asks first.

```bash
./build-installer.sh
```

The packaged app can ship its own portable R runtime, so end users don't need
R installed. The runtime is platform-specific and must be vendored **on** the
target platform:

```bash
cd app
pnpm install
pnpm vendor:r-runtime:win   # Windows (PowerShell) → resources/r-runtime-win
pnpm vendor:r-runtime:mac   # macOS                → resources/r-runtime-mac
pnpm vendor:r-runtime       # Linux                → resources/r-runtime
pnpm dist:win               # or dist:mac / dist:linux → app/dist/
```

Notes:

- Builds you make yourself are unsigned. Code signing uses SAI Bilişim's
  certificate and is part of the official release process only.
- The Windows installer is x64 (also runs on ARM64 Windows via emulation).
  Cross-building it from Linux additionally requires `wine`.
- The vendored runtime carries every package the analyses use, so the
  installed app never downloads an R package. Windows ships CRAN's R and Linux
  builds the same R version, both with packages from the dated Posit Package
  Manager snapshot in `app/shared/r-packages.json`. macOS ships CRAN's R as
  well, one runtime per CPU (arm64, Intel), validated on GitHub's macOS
  runners (`.github/workflows/macos-runtime.yml`).
- Skipping the vendor step still produces a working installer: the app then
  falls back to a system R found on `PATH` (see `app/electron/ipc/r-bridge.ts`).
- Each vendor script checks that the runtime still works after being moved to a
  different path with a clean environment, so a broken bundle fails at build
  time, not on the user's machine.

## Project structure

```
sai-statistics/
├── app/
│   ├── shared/      # Types shared by Main + Renderer: IPC contracts, zod schemas
│   ├── electron/    # Main process: windows, IPC handlers, R bridge, DuckDB, menu
│   ├── src/         # Renderer (React): views, dialogs, stores, i18n, theme
│   ├── r-scripts/   # Pure R analysis scripts — JSON in, JSON out
│   ├── resources/   # Icons, sample data, user docs, default settings
│   ├── scripts/     # Build, packaging and R-runtime vendoring tools
│   ├── flatpak/     # Flatpak / Flathub manifests
│   └── tests/
│       ├── unit/          # Vitest
│       ├── integration/   # Vitest against DuckDB
│       ├── r-validation/  # R scripts vs. reference values
│       ├── spss-parity/   # R scripts vs. IBM SPSS output (needs SPSS to regenerate)
│       ├── py-parity/     # Results vs. an independent Python implementation
│       ├── e2e/           # Playwright-driven Electron scenarios + runner
│       └── perf/          # Performance and memory measurements
└── docs/            # Architecture reference
```

[CLAUDE.md](CLAUDE.md) holds the architecture rules and coding conventions
(it doubles as the brief for AI coding agents); [docs/architecture.md](docs/architecture.md)
is the layer and data-flow reference (currently in Turkish; an English
translation is a welcome contribution).

## Contributing

Bug reports, translations and pull requests are welcome — read
[CONTRIBUTING.md](CONTRIBUTING.md) first. Security issues go through
[SECURITY.md](SECURITY.md), not public issues.

## Citing

If you use SAI Statistics in published research, please cite it; see
[CITATION.cff](CITATION.cff) (GitHub shows a "Cite this repository" button).

## License

Copyright © 2026 SAI Bilişim.

SAI Statistics is free software: you can redistribute it and/or modify it under
the terms of the **GNU Affero General Public License v3.0 only**
(AGPL-3.0-only); see [LICENSE](LICENSE). It is distributed WITHOUT ANY
WARRANTY. Statistical output should be checked by a qualified person before it
is relied on.

The bundled R runtime and CRAN packages keep their own licenses (mostly
GPL-2/GPL-3); third-party notices are generated into
`app/resources/legal/THIRD_PARTY_NOTICES.txt` at packaging time.

The "SAI Statistics" name and logo are trademarks of SAI Bilişim and are not
covered by the AGPL; see [TRADEMARK.md](TRADEMARK.md).

SPSS is a trademark of IBM Corp. This project is not affiliated with or
endorsed by IBM.
