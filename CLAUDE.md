# CLAUDE.md — SAI Statistics

> The working guide for contributors **and** AI coding agents (Claude Code and
> others), and the single source of truth for technology and architecture
> decisions. Read it before writing code.
>
> Section numbers are stable: code comments cite them ("CLAUDE.md §9").

---

## 0. Document Map

| Document | Role |
|----------|------|
| **CLAUDE.md** (this file) | Decisions and rules: stack, architecture principles, DRY / i18n / theme / IPC / security conventions |
| [README.md](README.md) | What the app is, how to build and package it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to propose a change: issues, pull requests, CLA, review |
| [CLA.md](CLA.md) | The Contributor License Agreement new contributors sign (`.github/workflows/cla.yml`) |
| [docs/architecture.md](docs/architecture.md) | Technical reference: layers, data-flow diagrams, IPC channel list (Turkish) |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |

> Examples in `docs/architecture.md` that use `.js`/`require()` are
> illustrative; §2 (TypeScript, ESM, electron-vite) overrides them.
>
> Some code comments refer to internal planning documents (`roadmap.md`,
> `project.md`, `docs/roadmap/…`, `docs/gecmis/…`, dated audit notes). Those
> are not part of this repository; the comment itself carries the reasoning
> you need.

---

## 1. Project Summary

SAI Statistics is a **cross-platform desktop statistics application built on
the R engine**. Users import data, define variables, run analyses through R,
and read results as tables and interactive charts.

- **Platforms:** Windows, macOS, Linux from one codebase.
- **Language:** the UI is multilingual (Turkish is the reference locale, plus
  English, Spanish, French, Portuguese, Italian). Code comments are a mix of
  Turkish and English; **no user-visible text is hard-coded** (§6).
- **Positioning:** in user-visible text (UI strings, locale files, package and
  store descriptions, AI system prompts) the product is described as above.
  Do not call it an "SPSS alternative" or "SPSS clone". SPSS is named only in a
  functional context (SPSS syntax, `.sav` import/export, parity tests).

---

## 2. Technology Stack & Decisions

| Layer | Technology | Note |
|-------|------------|------|
| **Language** | **TypeScript** (strict) | All `.ts`/`.tsx`. No new JS source (build/test scripts in `.cjs` are the exception). |
| **Modules** | **ESM** (`"type": "module"`) | No `require()` in app code. |
| **Package manager** | **pnpm** | Not npm/yarn. Lockfile `app/pnpm-lock.yaml`. Node version pinned in `app/.nvmrc` (24). |
| **Desktop shell** | Electron | Security settings in §9 are not negotiable. |
| **Build/dev** | electron-vite + Vite | One config for main / preload / renderer, with HMR. |
| **Packaging** | electron-builder | Win NSIS · macOS DMG · Linux AppImage/deb/rpm · Flatpak |
| **UI** | React 19 | Function components + hooks only. |
| **Data View** | AG Grid **Community** | Selection, clipboard, fill handle, context menu, find/replace are written on top of Community. **Enterprise is never used** — `no-restricted-imports` in `eslint.config.js` enforces it (it would also be licence-incompatible with this repository). |
| **Variable View** | AG Grid Community | No Enterprise features. |
| **Output tables** | Plain HTML `<table>` | Deliberate: simple rendering, full control of the formatted look. |
| **Charts** | Plotly.js | R `ggplot` → `ggplotly()` → JSON. |
| **State** | Zustand + zundo | zundo for UI state; data undo/redo is a DB snapshot in Main (`undo-manager.ts`), cell-value undo in `cell-value-undo.ts`. |
| **Data store** | **`@duckdb/node-api`** (Neo client) | Not the old `duckdb` node bindings. In-memory, Parquet/Arrow native. |
| **Data transfer** | Arrow IPC / Parquet | Main ↔ R without type loss. |
| **Statistics engine** | R via `child_process.spawn` | Main process only. No `exec` / shell strings. |
| **Settings** | electron-store, validated with zod | Plain JSON the user may edit by hand. |
| **i18n** | react-i18next | Active everywhere. |
| **Schema validation** | zod | At every R↔JSON and IPC boundary. |
| **Logging** | electron-log | Main + renderer, written to file. |
| **Lint/format** | ESLint (flat config `eslint.config.js`) + Prettier | No legacy `.eslintrc`. |
| **Tests** | Vitest · Playwright-driven Electron scripts · R validation harness | Unit / E2E / R correctness. |
| **Auto-update** | electron-updater | Official builds only. |

> For libraries whose API moves between versions (DuckDB, AG Grid, Electron,
> electron-vite) check current documentation rather than memory.

---

## 3. Architecture Principles

Three runtimes; **every boundary is crossed with JSON/Arrow and is typed**:

```
Renderer (React)  ──IPC──►  Main (Node)  ──spawn──►  R process
   typed channel             typed handler           zod-validated JSON
```

**Dependency direction:**
- The renderer does not know Main's internals — only the `window.api`
  contract exposed by preload.
- Main does not know R's internals — only script name + params + the JSON
  result schema.
- R does not know Electron — it reads JSON on stdin/args and writes JSON on
  stdout, like a pure function.

**Layer responsibilities:**
- `app/electron/` → Main: files, DuckDB, R bridge, job queue, settings. **No UI logic.**
- `app/src/` → Renderer: UI and state. **Direct `fs` / `child_process` / DuckDB access is forbidden** — everything goes through IPC.
- `app/r-scripts/` → Pure statistics. **No file paths, no IPC knowledge**, JSON in / JSON out.
- `app/shared/` → TypeScript types and zod schemas shared by both sides (IPC contracts, analysis schemas, settings type). Single source of truth.

---

## 4. Folder Conventions

All application code lives under `app/`. The tree is visible with `ls`; only
conventions that cannot be read from the code are listed here:

- **`app/shared/`** — types and schemas only (no runtime logic). IPC contracts
  (`ipc-contracts.ts`) and zod schemas live here (§8).
- **`app/src/theme/`** — the **only** theme source (§7). No hard-coded colours
  or pixel values anywhere else.
- **`app/src/analyses/`** — analysis UIs. There is **no `registry.ts`**; wiring
  follows the manual pattern in §5.
- **`app/r-scripts/_bootstrap.R`** — sourced by every analysis script: JSON
  I/O, Arrow reading, `get_weights()` / `apply_user_missing()` /
  `sai_output()` helpers. Look for an existing helper before writing one.
- **`app/electron/ipc/`** — Main handlers. A new analysis does **not** add a
  file here; `analysis:run` is the single generic handler (§5).
- **`app/tests/e2e/`** — Playwright-driven Electron scripts (`e2e-*.cjs`) and
  their runner; **`app/tests/perf/`** — performance/memory measurements.
- **`app/scripts/`** — build, packaging and R-runtime vendoring tools only.

> Build outputs (`app/out`, `app/dist`) and vendored R runtimes
> (`app/resources/r-runtime*`) are generated and git-ignored — don't read them.

---

## 5. DRY Rule #1 — Adding an Analysis (most important)

Every analysis needs **4 layers**: R script + dialog UI + IPC call + output
render. If you find a copy-pasted analysis, refactor it to this pattern; do
not invent a new architecture.

**The wiring points for a new analysis:**

1. `app/r-scripts/<analysis>.R` — source `_bootstrap.R`, compute only, return
   the standard `sai_output(tables=, plots=, warnings=, notes=)` JSON.
2. `app/shared/analysis-types.ts` — the generic `AnalysisResultSchema` already
   covers the output; an analysis-specific schema is **usually not needed**
   (params reach `analysis:run` as `Record<string, unknown>`; the R script
   validates its own fields, e.g. with `%in% names(df)`).
3. **Menu:** add the item to `app/electron/menu/menu-builder.ts` (i18n `menuKey`).
4. **`MENU_CHANNELS`:** add `menu:analyze:<analysis>` to `MENU_CHANNELS` in
   `app/shared/ipc-contracts.ts`.
5. **`App.tsx` dispatch:** a `case 'menu:analyze:<analysis>':` block that opens
   the dialog; on confirm it calls
   `window.api.analysis.run({ analysisId, datasetId, scriptFile, params })`.
   Results arrive through the `job:complete` / `job:error` events into
   `useOutputStore`.
6. **Dialog:** `app/src/analyses/<category>/<Analysis>Dialog.tsx`, built on the
   shared `AnalysisDialogShell` + `fieldDefs`; `generateRCode` /
   `generateSyntax` feed the "Paste R" / "Paste Syntax" buttons.
7. **i18n:** add menu, title and output-column keys to
   `app/src/i18n/locales/<lang>/{menu,analysis}.json` for **every** locale.

> **Generic IPC handler:** `analysis:run` (`electron/ipc/analysis-handler.ts`)
> validates `scriptFile` + `params` with zod, runs R, and validates the result
> with `AnalysisResultSchema` (`job-manager.ts`). Weighting, split file and
> user-missing values are injected there for every caller. **Never write a
> per-analysis IPC handler.**

> **Generic output renderer:** the standard `{ tables[], plots[], warnings[],
> notes }` shape is rendered by `OutputView` / `OutputPlotView`. Write a custom
> renderer only when genuinely needed.

---

## 6. DRY Rule #2 — Internationalisation

**No user-visible text is embedded in code.** Every string comes from `t("key")`.

- Locale files: `app/src/i18n/locales/<lang>/*.json`; Turkish (`tr`) is the
  reference locale.
- This includes the native menu, status bar, dialog titles, and **fixed table
  headings returned by R** — R returns data + keys (e.g. `titleKey`), the
  renderer translates.
- New text → new key in **every** locale at once. A unit test fails on
  missing keys.
- A new language = a new locale folder + one registration; no code changes.

```tsx
// ❌ wrong
<button>Çalıştır</button>
// ✅ right
<button>{t('common.run')}</button>
```

---

## 7. DRY Rule #3 — Central Theme & Design Tokens

**All visual decisions live in `app/src/theme/`.** Hard-coded colours and pixel
values in components are forbidden.

- `tokens.ts` → semantic tokens (`color.bg.primary`, `space.md`, `font.size.body`, `radius.sm` …).
- `themes.ts` → values per theme (light / dark / high-contrast).
- Tokens are written to `:root` as CSS custom properties (`--color-bg-primary` …) and used with `var()`.
- Theme switch: Zustand `theme` → `<html data-theme="dark">` → variables update.
- "System" follows `prefers-color-scheme`.

```css
/* ❌ */ .cell { background: #fff; padding: 8px; }
/* ✅ */ .cell { background: var(--color-bg-primary); padding: var(--space-sm); }
```

---

## 8. DRY Rule #4 — Typed IPC Contracts

All IPC channels are defined **once**, in `app/shared/ipc-contracts.ts`;
preload, Main handlers and renderer calls share those types.

- Never type a channel name as a bare string — take it from the contract.
- Every `invoke` channel has request/response types; every `send` channel a payload type.
- JSON coming back from R is **validated with zod** in `r-bridge.ts`. A schema
  mismatch throws — it is never passed through silently (a wrong statistic is
  a critical bug).

---

## 9. Security (non-negotiable)

**Electron `webPreferences`:**
- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — never change.
- `webSecurity` is never `false`; no remote module.
- A Content-Security-Policy is set; no `unsafe-eval`, no remote scripts. AG
  Grid's legacy CSS theme embeds its icon font as a `data:` URI, hence
  `font-src 'self' data:`.

**IPC & process boundary:**
- No direct `fs`, `child_process` or DuckDB access in the renderer — only `window.api`.
- IPC handlers **verify the sender** (`event.senderFrame` origin) and **validate
  the payload with zod** before doing anything.
- New windows and navigation are blocked: `setWindowOpenHandler` (external
  links → default browser), `will-navigate` denied.

**Injection:**
- Every user input that reaches R (column names, formulas) is validated against
  an allow-list or passed as a parameter.
- `spawn(cmd, [args])` with `shell: false`; never `exec` or string-built shell commands.
- DuckDB queries use parameter binding (prepared statements), not string concatenation.
- File paths are normalised and checked for traversal.

**R terminal — a scoped, documented exception:**
The allow-list rule above protects against injection from *untrusted data*.
The R terminal is the user running *their own code on their own machine* by
choice (the RStudio/Jupyter category) — a different threat model. Its rules:
1. Opt-in / power-user, can be disabled: `r.consoleEnabled` in `settings.json`
   (default `true`); `electron/ipc/r-session.ts` refuses to start when it is `false`.
2. **Nothing runs automatically** — even if an opened file contains code, it
   runs only when the user explicitly presses Run.
3. Only the `senderFrame`-verified renderer drives the console.
4. `spawn(..., {shell:false})`, sandbox, contextIsolation and CSP stay intact.
5. The data bridge is **read-only** — the console cannot corrupt the DuckDB master.

`system()` and friends are not blocked (ineffective, and it would cripple
legitimate use); rule 2 is the real barrier. Extensions under the same model:
the Packages panel installs without an allow-list (same power as typing
`install.packages()`), package names still pass a strict regex; htmlwidgets
render in a `sandbox="allow-scripts"` iframe served from the `sai-widget://`
protocol (opaque origin, no preload/IPC, widget CSP `connect-src 'none'`);
side-channel file paths reported by R are ignored outside the session's
`mkdtemp` directory; `sai_commit()` imports a new dataset through the normal
import path and never writes into the open one.

**SPSS syntax is not part of that exception:** syntax maps onto the existing
`analysis:run` / `transform:*` / `variable:*` channels with zod + allow-lists.
Arbitrary code never reaches R through it.

**AI integration — data-leak rules:**
- Only the **Main process** talks to the model provider
  (`electron/ipc/ai-bridge/`, `electron/ai/`). The renderer never sends a byte
  to the provider and never sees the session token.
- The SAI account session token never enters `settings.json`. It is stored
  only through `safeStorage`; no channel reads it back. If
  `isEncryptionAvailable()` is false, it is not stored (no plain-text fallback).
  On Linux Flatpak this needs `--talk-name=org.freedesktop.secrets`.
- `ai.provider` is `'server' | 'off'` only.
- **Raw data rows are never sent to the model** and there is no option to do
  so: only variable metadata, allow-listed aggregates (`get_data_profile` — no
  free SQL; N / missing / mean / sd / min / max / distinct count, never cell
  values or frequency tables) and `AnalysisResult` tables.
- The AI tool surface is limited to the analyses in
  `shared/analysis-manifest.ts` (zod-validated params); `run_analysis` goes
  through `analysis-handler`. **The AI cannot run R code.** It may only
  *propose* R code (`propose_r_code`), shown in a card whose only action is
  sending it to the R script editor; running it is the user's explicit act.
  R console output, session state and script contents are never sent to the
  model. No file-writing or export tools.
- Prompts and conversation content are never logged — only metadata such as
  tool name and token counts.
- **Instruction text lives on the SAI server.** The client sends no system
  prompt and no tool descriptions — only the context the server needs, as the
  `sai_prompt` request field (`electron/ipc/ai-bridge/prompts.ts`: dataset
  metadata, analysis schemas, mentioned output tables). That file is where the
  data rules above are enforced, so what reaches the model stays auditable
  here. Tool names and parameter schemas also stay in the client: the client
  executes the tools and validates their arguments. Changing `sai_prompt`'s
  shape means a new `version`, made together with the server.
- The server's prompt tells the model not to invent statistics that are not in
  the tables, to carry `warnings`/`notes`, and to answer in the UI language,
  and puts the context in sections marked as user DATA, not instructions
  (prompt-injection hygiene). AI notes are excluded from HTML/PDF export unless
  the user opts in.

---

## 10. Development Commands

Run from `app/`:

```bash
pnpm install            # dependencies (Node version in .nvmrc); also enables .githooks
pnpm dev                # electron-vite dev (main/preload/renderer HMR)
pnpm build              # production build
pnpm typecheck          # tsc --noEmit
pnpm lint               # ESLint + Prettier check
pnpm test               # Vitest (includes the locale key-parity test)
pnpm test:r-validation  # R scripts vs. known reference values (tests/r-validation/)
pnpm test:e2e           # runs tests/e2e/e2e-*.cjs in sequence (Playwright as Electron driver,
                        # not the `playwright test` CLI). Needs `pnpm build` first;
                        # on headless Linux wrap in `xvfb-run -a`;
                        # some scripts need `node tests/e2e/setup-e2e-fixtures.cjs`.
                        # Targeted: node tests/e2e/run-e2e.cjs <pattern>
pnpm dist               # electron-builder package for this platform
pnpm dist:win|:mac|:linux
pnpm vendor:r-runtime       # portable R runtime for Linux packages (app/resources/r-runtime/)
pnpm vendor:r-runtime:win   # same for Windows (PowerShell, Windows only)
pnpm vendor:r-runtime:mac   # same for macOS (macOS only)
Rscript r-scripts/setup.R   # install/check the R packages the analyses use
```

The R package list and the pinned R / repository versions live in
`app/shared/r-packages.json` (`bundled` + `console`). When that list changes,
re-run the vendor step — an old runtime builds fine but the analyses that need
the new packages fail. Each vendor script finishes by loading every package
and stops if one is missing.

Release notes for official builds live in `app/release-notes.json`
(`pnpm release-notes:new` / `release-notes:check`): written for end users —
what changed and why it helps, no internal names — in every UI language with
the same number of items.

---

## 11. Working Conventions

- **New analysis = §5.** No other path.
- **New text = §6.** Turn any literal string you find into a key.
- **New style = §7.** Turn any hard-coded colour/px you find into a token.
- **Every R script change gets a validation test** in `tests/r-validation/`
  with known reference values. A wrong p-value is the most critical bug class
  in this project.
- **Statistical correctness over SPSS imitation.** SPSS is the general
  reference, but where SPSS and statistical science disagree, follow the science:
  - **Use R's default** when R (base or a package) does a computation
    correctly; don't hand-write a formula to imitate a weaker SPSS default.
    E.g. `wilcox.test` gives an **exact** p for small n without ties — use it.
  - **Offer Monte Carlo** where asymptotics are unreliable (small/sparse
    samples): see `sai_monte_carlo_chisq` in `_bootstrap.R` and `PMethodSection.tsx`.
  - **Use a package for exact tests R's default lacks** (e.g.
    `coin::wilcox_test(distribution = "exact")` with ties) — never hand-roll a
    permutation algorithm.
  - **Presentation:** keep the familiar table (U/W/Z/Asymp. Sig.) and add the
    scientifically right value (Exact Sig.) as an **extra column**, as the
    SPSS Exact Tests module does.
  - **Exception:** don't adopt R's exact result when it is invalid too. E.g. the
    one-sample KS test with estimated parameters is liberal even when exact;
    the right test is Lilliefors (the Normality tab already uses `nortest`).
- **Version-sensitive library APIs** → check current docs, don't write from memory.
- Match the surrounding code: comment density, naming, idiom.
- **Type safety:** no `any`; unknown data is `unknown` + zod parse. Work is not
  done until `typecheck` and `lint` are clean.
- **ESM imports** use the `@shared` / `@` aliases; avoid long `../../..` chains.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`),
  small and meaningful.
- **Accessibility:** ARIA and keyboard navigation from the start on every
  interactive element.
- **Never commit data:** real datasets, statistics-package exports and
  personal paths are blocked by `.gitignore` and `.githooks/pre-commit`. Test
  fixtures must be synthetic or anonymised.
- **Agent sessions — keep long output out of context:** write long command
  output to `app/tmp/` (git-ignored) and read a summary, e.g.
  `pnpm test:e2e > tmp/e2e.log 2>&1`, then search for `PASS|FAIL`. Run targeted
  subsets (`node tests/e2e/run-e2e.cjs <pattern>`,
  `Rscript tests/r-validation/run-all.R <pattern>`, `vitest run <file>`). Never
  read large fixtures whole (`tests/spss-parity/compare*.R`, generated
  outputs) — grep them.

---

## 12. Current Status

Implemented: data layer (DuckDB, chunked loading, `.sav`/CSV/Excel import,
`.sdf` project files), Data View and Variable View on AG Grid Community, 50+
analyses with weighting / split file / user-missing values applied in one place
(`analysis-handler.ts`), formatted output with HTML/PDF/Word/Excel export, SPSS
syntax, R terminal (console, script editor, plots, packages, htmlwidgets,
debugger, reports), optional AI assistant, packaging for Windows, macOS and
Linux (deb, rpm, AppImage, Flatpak) with an embedded R runtime. Output flows
top to bottom (newest at the end) in the view, the navigator and every export.

Known limits: the Data View has no paging (the whole dataset is held in
memory, loaded in chunks); Arch/pacman packaging is documented but not built.

---

## 13. Feature Workflow

The normative recipe for an analysis is §5; this is the test/verification
discipline around it:

1. **Research:** pick the R package and its parameters; read the data flow in
   `docs/architecture.md`.
2. **R script:** `r-scripts/<analysis>.R`, sourcing `_bootstrap.R`, returning `sai_output()`.
3. **R validation:** a test with known reference values in
   `tests/r-validation/` — **cannot be skipped** (§11).
4. **Wiring:** menu + `MENU_CHANNELS` + `App.tsx` dispatch (§5.3–5.5). No new IPC handler.
5. **UI:** `AnalysisDialogShell` + `fieldDefs`; i18n keys in every locale.
6. **E2E:** `tests/e2e/e2e-<topic>.cjs` confirming the UI + R round trip;
   run it targeted (`node tests/e2e/run-e2e.cjs <topic>`).

Security review: §9 is binding (preload/contextBridge surface, `spawn`
allow-lists, DuckDB parameter binding); read new code against it.

---

> This is a living document. When an architecture decision changes, update it here.
