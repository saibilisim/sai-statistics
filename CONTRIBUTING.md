# Contributing to SAI Statistics

Thanks for helping. Bug reports, statistical corrections, translations and
pull requests are all welcome. This page explains how to make a change land
smoothly.

## Before you start

- **Read [CLAUDE.md](CLAUDE.md).** It holds the architecture rules and
  conventions every change is reviewed against (it is also the brief for AI
  coding agents, so it is written to be followed literally).
- **Open an issue first for anything larger than a small fix**, so we can agree
  on the approach before you spend time on it.
- **Security problems** go to [SECURITY.md](SECURITY.md), never a public issue.
- Be kind: this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## What we especially welcome

- **Wrong numbers.** If a result differs from R, SPSS, Stata, SAS or a
  textbook, open an issue with the data (synthetic or anonymised), the
  procedure and both outputs. A wrong statistic is our most serious bug class.
- **Translations.** Each UI language is a folder under
  `app/src/i18n/locales/`. Turkish (`tr`) is the reference; copy it, translate
  the values, keep the keys. The key-parity test tells you what is missing.
- **R validation tests** for procedures with thin coverage.
- **Accessibility** fixes (keyboard navigation, screen readers, contrast).

## Development setup

See [README.md → Building from source](README.md#building-from-source). In short:

```bash
cd app
pnpm install    # also enables the pre-commit hook in .githooks/
pnpm dev
```

## Making a change

1. Fork and create a branch from `main`.
2. Follow the patterns in [CLAUDE.md](CLAUDE.md):
   - a new analysis follows the wiring in §5 (no new IPC handler, no registry);
   - user-visible text goes through i18n in **every** locale (§6);
   - styles use theme tokens, never hard-coded colours or pixels (§7);
   - IPC channels come from `app/shared/ipc-contracts.ts` (§8);
   - the security rules in §9 are not negotiable.
3. **Any change to an R script needs a test** in `app/tests/r-validation/`
   with reference values from an independent source (another package, a
   published example, a textbook) — not values our own code produced.
4. Run the checks before you push:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm test:r-validation          # if you touched R
   node tests/e2e/run-e2e.cjs <topic>  # after pnpm build, if you touched UI flows
   ```
5. Open a pull request. Describe what changed and why, and how you verified it.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Test data

**Never commit real data** — no real datasets, survey responses, patient or
customer records, and no exports from other statistics packages. Fixtures must
be synthetic (generated from a fixed seed, like `app/tests/spss-parity/make-dataset.R`)
or anonymised beyond re-identification. The `.gitignore` and the pre-commit
hook block data formats — including plain-text tables such as `.csv` and
`.txt` — files over 5 MB and absolute home-directory paths, and CI repeats the
data-file check and scans for secrets on every pull request. A new fixture
must be added to the allow-list in `.githooks/check-files`, with its origin
stated in the commit. These are a safety net, not a substitute for checking
what you add.

## The SPSS parity harness

`app/tests/spss-parity/` compares our scripts with IBM SPSS Statistics. The
job files and comparison scripts are here, but SPSS's own output is not
committed: regenerating it needs a licensed SPSS installation (see the README
in that folder). Contributors without SPSS can ignore this harness; CI does
not depend on it.

## Contributor License Agreement

Before your first pull request is merged, you will be asked to sign the
[Contributor License Agreement](CLA.md) (CLA): a bot comments on the pull
request, and you sign by replying with the sentence it gives. One signature
covers all your later contributions. The CLA lets SAI Bilişim keep
distributing the project, including under other licence terms alongside the
AGPL; you keep the copyright to your contribution, and everything accepted
stays available under the AGPL (CLA §4).

## Use of AI assistants

You may use AI coding assistants. You are responsible for every line you
submit: review it, test it, and make sure you have the right to contribute it.
Mention significant AI assistance in the pull request description.

## Code comments in Turkish

Many comments are in Turkish, because the project started as a Turkish team's
codebase. New comments may be in English or Turkish; translating existing ones
to English is a welcome contribution. Some comments refer to internal planning
documents that are not in this repository — the comment itself carries the
reasoning.

## Licence

By contributing you agree that your contribution is licensed under the
[GNU AGPL v3.0 only](LICENSE), as the rest of the project, subject to the CLA.
