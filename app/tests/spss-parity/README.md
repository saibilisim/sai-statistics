# SPSS parity harness

Compares our analysis scripts against **IBM SPSS Statistics itself**, on the
same data, without anyone exporting anything by hand.

This exists because parity was previously checked by running both programs
manually and eyeballing two HTML files. That found real defects, but only for
whatever the tester happened to run, and only when they had time to run it.

> **SPSS output is not in this repository.** The job files, the synthetic
> dataset and the comparison scripts are; what SPSS itself produces
> (`*-out.htm`, `*-output.xml`, the extracted `spss-*.json` values,
> `knn-pred.csv`) is IBM SPSS program output and is git-ignored. To run the
> comparison you need a licensed SPSS installation: point the `/FILE=` and
> `.spj` paths (written as `C:\path\to\sai-statistics\…`) at your checkout,
> run the jobs as described below, then the extract and compare steps.

## How it works

1. `make-dataset.R` writes `data.csv` from a fixed seed.
2. `job.sps` + `job.spj` run that CSV through SPSS headlessly:
   ```
   "C:\Program Files (x86)\IBM\SPSS\Statistics\26\stats.exe" job.spj -production
   ```
   No GUI, exit 0, output written to `spss-out.htm`. It runs fine alongside an
   open SPSS session. (The Batch Facility, `statisticsb.exe`, is Server-only —
   the Production Facility is what desktop SPSS gives you. Job XML is validated
   against `production-1.4.xsd` in the SPSS install directory.)
3. `extract-spss.cjs` scrapes `spss-out.htm` into `spss-values.json`.
4. `compare.R` runs the same analyses through our production R scripts, via the
   r-validation harness, and diffs against those values at the precision SPSS
   printed them.

5. `syntax-dispatch.test.ts` parses that same `job.sps` with our own SPSS-syntax
   dispatcher and records the `{analysisId, scriptFile, params}` it produces.
   `compare.R`'s last section replays those params through the same R scripts,
   so one run checks the statistics **and** the syntax front-end that reaches
   them. Everything above that section hand-writes its params, which keeps a
   control: a difference that shows up only in the syntax section is a
   mis-translated command, not a wrong statistic.

```
Rscript tests/spss-parity/make-dataset.R tests/spss-parity/data.csv
# …run SPSS (step 2)…
node tests/spss-parity/extract-spss.cjs tests/spss-parity/spss-out.htm \
     tests/spss-parity/spss-values.json
pnpm vitest run tests/spss-parity/syntax-dispatch.test.ts
Rscript tests/spss-parity/compare.R

# Extension run (procedures compare.R does not cover; see "Not yet compared"):
#   stats.exe job-ext.spj -production        (SPSS 26)
#   stats.exe job-ext32.spj -production      (SPSS 32)
node tests/spss-parity/extract-ext.cjs tests/spss-parity/spss-ext-out.htm \
     tests/spss-parity/spss-ext32-out.htm tests/spss-parity/spss-ext-values.json
Rscript tests/spss-parity/compare-ext.R
```

`compare.R` locates its own inputs, so it can be launched from anywhere.

## The UI-driven layer (ui-job)

The harness above never touches a dialog: params are hand-written in compare.R
or parsed from job.sps. A checkbox wired to the wrong parameter is invisible to
all of it. The ui layer closes that, for the dialogs that generate syntax:

```
node tests/e2e/e2e-ui-syntax.cjs            # real menus → dialogs → Paste/OK captures
pnpm vitest run tests/spss-parity/dispatch-ui-syntax.test.ts
# SPSS, either route:
#   stats.exe ui-job.spj -production                    (needs a free clipboard)
#   statisticspython3.bat tests/spss-parity/run-ui-job.py   (headless backend, no clipboard)
node tests/spss-parity/extract-tables-oxml.cjs tests/spss-parity/ui-job-output.xml \
     tests/spss-parity/spss-ui-tables.json
Rscript tests/spss-parity/compare-ui.R              # 1126 OK, 0 FARK, 46 BILINCLI
Rscript tests/spss-parity/compare-ui.R oneway       # …or only matching scenarios
```

- `tests/e2e/e2e-ui-syntax.cjs` opens each scenario's dialog through the real
  menu channel, makes real selections (source list + ▶, sub-dialog checkboxes,
  text fields), then captures both outputs of the dialog: the Paste-Syntax
  command out of the Terminal buffer (`ui-job.sps`) and the exact
  `analysis.run` payload the same selections send via OK (`ui-dialog-runs.json`,
  through the `__SAI_RUNS__` hook in useRunAnalysis).
- `dispatch-ui-syntax.test.ts` does two things: dispatches `ui-job.sps` through
  the real registry into `ui-syntax-params.json`, and asserts **Paste ≡ OK** —
  the syntax-derived params and the OK payload must describe the same analysis
  (canonicalized by variable name, per analysisId). A dialog option the syntax
  generator drops fails here by scenario name.
- `compare-ui.R` replays `ui-syntax-params.json` through the production R
  scripts and diffs **every table SPSS printed**, cell by cell, against SPSS's
  own run of the pasted commands: **1126 comparisons, 0 FARK, 46 BILINCLI, 0
  ATLANDI over 57 scenarios — every analysis dialog in the app.** Frequencies, Crosstabs, Independent/One-sample/Paired
  T, Means, Descriptives, NONPAR CORR, ONEWAY, Regression, Explore, the whole
  NPAR TESTS family (Chi-Square, Binomial, K-S, Runs, M-W, Wilcoxon, K-W,
  Friedman), Reliability, Partial Correlation, Case Summaries, OLAP Cubes,
  Ratio Statistics, ROC, Curve Estimation, Binary Logistic, UNIANOVA, Factor,
  Discriminant, K-Means, Hierarchical Cluster, Proximities, Kaplan-Meier, Cox
  Regression, GLM Multivariate, GLM Repeated Measures, Multiple Response,
  NOMREG, PLUM, PROBIT, Life Tables, MIXED, GENLIN, MVA, KNN, Classification
  Tree, GEE, Multidimensional Scaling, Multiple Imputation, both Report
  Summaries and the Chart dialog — plus the four SPSS 27+ procedures run
  against **SPSS 32**: PROPORTIONS, GENLINMIXED, ROC ANALYSIS and POWER.
  BILINCLI is compare.R's bucket: a difference that was chased down, explained
  and kept — it prints its reason and is not a FARK.
  It reads `spss-ui-tables.json` — the generic
  OXML dump, so a new scenario needs no bespoke extractor. Long columns
  (frequency table, percentile rows, extreme values) are compared as vectors
  and reported as one `max|d|` line.
  Adding a dialog means: a scenario entry in the e2e, a canonicalizer in the
  dispatch test, a block in compare-ui.R.

Real defects this layer caught:

1. `buildSyntax.frequencies` emitted only `VARIABLES=` — every Statistics /
   Charts / Format selection was silently absent from Paste (OK carried them).
   The generator now takes the dialog's options.
2. The FREQUENCIES handler translated `/BARCHART` to `charts.type = 'bar'`, but
   frequencies.R switches on `'barChart'` — a pasted `/BARCHART` drew nothing.
   Fixed to the script's vocabulary.
3. **The pasted REGRESSION did not run in SPSS at all.** Subcommand order is not
   free there: `/STATISTICS` must precede `/DEPENDENT`, or SPSS answers "Invalid
   REGRESSION subcommand order … Execution of this command stops" — which is
   what the first full-scenario run got instead of a Model Summary. The
   generator now writes `/STATISTICS COEFF OUTS R ANOVA COLLIN TOL` before
   `/DEPENDENT` (naming the defaults again, since an explicit `/STATISTICS`
   replaces them) — the form SPSS's own dialog pastes.
4. **Cumulative Percent summed the rounded column.** frequencies.R accumulated
   the already-rounded Valid Percent values, so age's last row read 100.1 where
   SPSS reads 100.0. Now accumulated unrounded and rounded once.
5. **Explore's Case Processing Summary hid the excluded cases.** It counted on
   the post-listwise frame, reporting "36 valid / 0 missing / 36 total" where
   SPSS reports "36 / 4 / 40" — the exclusion the table exists to show. Counts
   now come from the pre-deletion frame.
6. **Levene "based on trimmed mean" used R's trimming, not SPSS's.** `mean(trim
= 0.05)` drops whole cases only; SPSS trims exactly 5% per tail, weighting
   the boundary case by the fraction. score read .916 against SPSS's .912.
   explore.R already had the SPSS formula, so it moved to `_bootstrap.R` as
   `trimmed_mean_5()` and both callers use it.

Second batch — the eight Nonparametric Tests dialogs got a Paste button (one
NPAR TESTS sub-command each) and joined the harness. What that turned up:

7. **`/METHOD` was in the ignored list.** A pasted `/METHOD=EXACT` (or `MC`)
   ran asymptotic-only and said nothing — the same silent-drop class as
   `/MISSING` before it. Now parsed into `options.pMethod` for every sub-test.
8. **The Binomial test used the wrong category as Group 1.** SPSS's Group 1 is
   the value of the FIRST case in the file; we sorted and took the smallest.
   With a test proportion of .5 only the row order looked odd — with any other
   test proportion it silently tested the _other_ category, i.e. a different
   p-value. `unique()` (first-occurrence order) now matches SPSS.
9. **One-Sample K-S reported the uncorrected p.** SPSS 26's own "Asymp. Sig."
   on that table is Lilliefors-corrected (its footnote says so, capped at .200
   as a lower bound); ours was the classical, liberal one — exactly the case
   CLAUDE.md §11 flags as scientifically wrong when the parameters come from
   the sample. The corrected significance is now its own column
   (`nortest::lillie.test`), with the classical Z/Sig kept for SPSS-style
   comparison. The old "install nortest" warning remains as the fallback.
10. **R rounds half to even, SPSS rounds half away from zero.** The Friedman
    mean rank 2.925 printed as 2.92 against SPSS's 2.93. `_bootstrap.R` now has
    `round_half_up()`, used by the NPAR rank tables (where fractional ranks put
    values on the boundary most often). Other scripts still use plain `round()`
    — the same difference can surface anywhere a displayed value lands exactly
    on a rounding boundary.

Third and fourth batches — Reliability, Partial Correlation, Case Summaries,
OLAP Cubes, Ratio Statistics, ROC, Curve Estimation, Binary Logistic, then
UNIANOVA, Factor, Discriminant, K-Means, Hierarchical Cluster, Proximities,
Kaplan-Meier and Cox Regression. What those turned up:

11. **`PROXIMITIES` pasted `/MATRIX=OUT(*)`, which destroys the dataset.** That
    subcommand replaces the active file with the proximity matrix, so every
    command after it in the pasted job failed with "undefined variable" — the
    run lost KM, COXREG and EXAMINE before anyone looked at a number. The
    generator now writes `/VIEW=VARIABLE /PRINT PROXIMITIES` and leaves the
    data alone.
12. **`RATIO STATISTICS` without `/PRINT` prints no statistics.** SPSS emits
    only the Case Processing Summary — the table the dialog exists for never
    appeared. The generator now names the columns ratio.R produces (and `COV`
    is not an SPSS keyword; the two coefficients of variation are `MDCOV` and
    `MNCOV`).
13. **The OXML extractor lost whole tables.** Column-only pivots (Reliability
    Statistics, ROC's Area Under the Curve, Curve Fit's Model Summary) came out
    as a bare header, and layered pivots (OLAP Cubes by group, ONEWAY's
    Multiple Comparisons and Homogeneous Subsets) returned only their first
    layer. Both are fixed in `extract-tables-oxml.cjs`; the layer label is now
    part of the row-label path.
14. **95% intervals used the textbook 1.96.** SPSS uses the exact quantile, and
    on the ROC area the difference is visible at the printed precision (upper
    bound .907 vs .906 with identical area and SE). `qnorm(0.975)` now, in
    roc.R, crosstabs.R, genlin.R and the three t-tests.

Fifth batch — the rest of the Analyze menu (GLM Multivariate and Repeated
Measures, Multiple Response, NOMREG, PLUM, PROBIT, Life Tables, MIXED, GENLIN,
MVA) plus the two SPSS 27+ procedures, run against the SPSS 32 install:

15. **PROBIT pasted a model on a different scale.** SPSS's PROBIT log10-
    transforms every covariate unless told otherwise, so the pasted command fit
    log10(score) and reported 9.950 where we report 0.083. `/LOG=NONE` now.
    (Its `OF observations` term is not optional either — the paste carries the
    `COMPUTE saiN=1.` that makes "one observation per case" explicit.)
16. **GENLINMIXED syntax copied out of SPSS did not run here.** Our handler
    read `/FIXED EFFECTS=score USE_INTERCEPT=TRUE` as a variable list and
    failed with "unknown variables". Option assignments are now dropped from
    the effects list.
17. **Two analyses had a different id on the syntax path than on the OK path** —
    `glmRepeated` vs the dialog's `glmRep`, `multipleResponse` vs `mr`, and
    PROPORTIONS collapsed three dialog ids into one. A syntax run and a dialog
    run of the same analysis have to land in the output store under one
    identity; the handlers now use the dialog's id.
18. **The e2e could not see a text field with no `type` attribute.** `input`
    without `type` is a text input but does not match `[type="text"]`, so
    Proportions' success-value box was skipped and every later value landed one
    field early (SPSS rejected the resulting `TESTVAL=1`). The selector now
    includes `input:not([type])`.
19. **SPSS 32's Python bootstrap needed a different locale patch.** The 26
    script patches `PyInvokeSpss.GetCLocale` before `import spss`; on 32 that
    module is not importable at top level, the try/except swallowed it, and
    every Submit died on the Turkish locale. `run-ui-job32.py` patches
    `spss.spss.PyInvokeSpss` after the import instead.

Sixth batch — the last ten dialogs. These had no SPSS command in the parser at
all, so each needed a handler written first (`handlers-extra.ts`): KNN, ALSCAL,
MULTIPLE IMPUTATION, POWER, REPORT, ROC ANALYSIS and GRAPH. What that turned up:

20. **`TREE`'s minimum-cases limit was silently dropped.** The handler looked for
    `MINPARENT`; SPSS's keyword is `MINPARENTSIZE`, so the regex never matched
    and a pasted tree grew with the default limit instead of the dialog's.
21. **The e2e made its selections on the previous dialog.** Readiness was "a
    listbox exists", which a _stale_ dialog also satisfies — the first scenario
    whose dialog lingered pushed every later one onto the wrong window. It now
    waits for the previous dialog to close first, and Power Analysis (no
    variable list at all) gets its own readiness rule.
22. **Three SPSS commands refuse to run in the form we would have pasted**, each
    found by probing before writing the generator: `KNN` puts the neighbour
    count on `/MODEL NEIGHBORS=FIXED(K=n)` (`K` on `/CRITERIA` is rejected),
    `TREE` needs `MINPARENTSIZE` _and_ a `MINCHILDSIZE` no larger than it, and
    `MULTIPLE IMPUTATION` refuses to impute without an `/OUTFILE` (the paste
    declares a dataset for it). `POWER MEANS INDEPENDENT` likewise wants two
    group sizes, not one.
23. **Power Analysis had no Paste button because its dialog is not the shell.**
    `DialogBase` now takes the same `generateSyntax` contract, so a dialog built
    without `AnalysisDialogShell` can still round-trip.

Known, documented differences (no comparison possible, not defects):

- SPSS prints ONEWAY's Descriptives table only on `/STATISTICS=DESCRIPTIVES`;
  our dialog has no such checkbox and the table is always emitted. Group N and
  Mean are checked against SPSS's Homogeneous Subsets table instead.
- SPSS's Levene table has a fourth row ("based on median with adjusted df");
  ours has three (see §A3 of the findings — a guessed df formula risks a
  silently wrong p).
- With `COLLIN`, SPSS also prints Collinearity Diagnostics (eigenvalues /
  condition index) and, with `/RESIDUALS`, Residuals Statistics. We report
  tolerance/VIF only.
- EXAMINE with a factor emits an ungrouped block _and_ the by-group block; we
  emit the grouped one, which is what compare-ui.R compares.
- NPAR TESTS cannot carry the Monte Carlo **seed** (SPSS keeps it on a separate
  `SET SEED` command), so a pasted MC run draws its own sample. Nor does it have
  a keyword for the K-sample dialogs' **pairwise comparisons** checkbox. Both
  are left out of the Paste ≡ OK canonical forms on purpose.
- `/K-W` and `DISCRIMINANT /GROUPS` require a value range for the factor and our
  dialogs have none, so the generator writes the widest plausible range
  `(1 99)`; SPSS uses only the levels actually present, which is what the R
  scripts do too.
- OLAP CUBES has no `/MISSING` keyword in SPSS at all, so the dialog's listwise
  option cannot travel through Paste (it does travel through OK).
- The nine BILINCLI cells and why they stay:
  - **ROC's AUC upper bound** — both sides print SE .037, but ours is DeLong
    (1988, what pROC uses and what roc-analysis.R shares) and SPSS's is the
    Hanley-McNeil form with empirical Q1/Q2: 0.03711 vs 0.03702.
  - **Ward's agglomeration coefficient** — a scale, not a value: SPSS reports
    the cumulative within-cluster sum of squares (total ESS 408.425 at the last
    stage, verified), we report `hclust(ward.D2)`'s merge height (18.54). Same
    tree. `hclust(d^2, "ward.D")` plus a running total would match SPSS exactly
    — open work for hierarchical.R.
  - **Kaplan-Meier's median CI** — SPSS uses median ± 1.96·SE (linear); we use
    Brookmeyer-Crowley, which is what the survival package and the modern
    literature use for censored data (already documented in survival-km.R).
  - **Cox's -2LL, Wald and Sig.** — Efron's tie correction (R's default, the
    more accurate one with ties) against SPSS's Breslow. B, SE, Exp(B) and the
    CI agree to the printed digit; the fixture has many tied event times.
  - The Agglomeration Schedule's _pairing_ is not compared at all: the q items
    are integers, hundreds of pairs sit at distance 0, and which one merges
    first is arbitrary.
  - **GLM Multivariate's intercept row** — Wilks' Lambda is 0.043 there and F is
    hypersensitive to its last printed digit; every grp3 line matches exactly.
    (Same finding compare.R already recorded for this procedure.)
  - **PLUM's standard errors** — the estimates agree; the SEs come from a
    different information matrix (MASS::polr's Hessian vs SPSS's Fisher
    scoring) and move Wald/Sig in the third decimal.
  - **PROBIT's Z ratio** — estimate and significance agree; Z moves by 0.002 on
    a fourth-decimal SE difference.
  - **MIXED's denominator df** — Satterthwaite (ours) vs SPSS's containment
    default; the confidence interval follows from it. Estimates, SEs, t and Sig
    match.
  - **GENLINMIXED's coefficients** — the same model fit two ways: lme4's
    Laplace approximation against SPSS's own linearization. Sign and magnitude
    agree, the third decimal does not.
- NOMREG uses the LAST category as reference, we use the first, so the
  coefficients are different contrasts and are not compared; the pseudo-R²
  trio, which is a function of the likelihoods, is.
- Life Tables: SPSS's own dialog asks for both interval bounds ("0 through ** by
  **") and `/INTERVAL` is not optional; ours asks only for the width, so the
  paste assumes 20 intervals.
- **Five commands print no pivot table at all**, so there is nothing for
  compare-ui.R to diff: ALSCAL and REPORT emit plain text, GRAPH emits a chart,
  and MULTIPLE IMPUTATION writes its result to a dataset. All five do run
  cleanly in SPSS (the job has no warning table for them) and their Paste ≡ OK
  round trip is locked in the dispatch test; compare-ui.R only asserts that our
  side produced output.
- **Classification Tree** is the same family, not the same tree: ours is rpart
  (CART with cp pruning), SPSS's CRT has its own minimums and pruning, and SPSS
  keeps cases with missing predictors via surrogate splits (120) where we use
  complete cases (117). The confusion matrix therefore differs; overall accuracy
  (76.9% vs 76.7%) and the risk estimate (.231 vs .233) agree.
- **KNN**: SPSS partitions into training/holdout by default and scores the
  holdout, so its hit rates are not on the same footing as our leave-one-out
  ones. The case counts are compared.
- **GEE**: `SUBJECT=grp3` gives only three clusters on this fixture; the
  exchangeable working correlation estimated from three clusters moves both the
  coefficients and the errors between geepack's sandwich and SPSS's
  model-based estimator.

## The missing-values layer (job-missing)

Every dialog that exposes SPSS's Missing Values option, run twice on the
fixture's overlapping NAs (score 3, income 4, post 2 of 120 rows): once with
SPSS's own default (ANALYSIS / PAIRWISE), once with `/MISSING LISTWISE`:

```
pnpm vitest run tests/spss-parity/dispatch-missing.test.ts   # writes missing-syntax-params.json
statisticspython3.bat tests/spss-parity/run-missing-job.py   # real SPSS 26 → OXML
node tests/spss-parity/extract-tables-oxml.cjs \
     tests/spss-parity/missing-job-output.xml tests/spss-parity/spss-missing-tables.json
Rscript tests/spss-parity/compare-missing.R                  # 134 OK, 0 FARK
```

`dispatch-missing.test.ts` is the silent-drop guard: every `/MISSING LISTWISE`
statement must arrive as `options.missing: 'listwise'`, every default statement
without the key. `compare-missing.R` then compares Ns (and means / correlation
coefficients) per cell between the production R scripts and SPSS — T-TEST (all
three forms), ONEWAY, MEANS, CORRELATIONS, EXAMINE, NPAR M-W / K-W / Wilcoxon,
SUMMARIZE, OLAP CUBES.

What it caught and measured:

- **`/MISSING` was parsed by nobody.** The ONEWAY Paste generator emitted
  `/MISSING=LISTWISE` (the dialog carried the selection) and the handler
  silently ran analysis-wise; the other procedures' generators didn't emit it
  at all. `parseMissingStrategy()` now feeds `options.missing` in the T-TEST,
  ONEWAY, CORRELATIONS, MEANS, EXAMINE, NPAR, SUMMARIZE and OLAP handlers, and
  the generators emit it.
- **SPSS EXAMINE's default missing handling is LISTWISE**, not
  analysis-by-analysis: the run without `/MISSING` and the one with
  `/MISSING=LISTWISE` produce identical tables (score valid 114, not 117). Our
  Explore default was per-variable; `explore.R` and the dialog now default to
  listwise, keeping "analysis by analysis" as a beyond-SPSS mode.
- **OLAP CUBES has no `/MISSING`** (probe-missing.py: SPSS rejects it), so the
  dialog's listwise option there is a beyond-SPSS extra, dispatch-tested only.
- **MEANS and SUMMARIZE print `Invalid MISSING subcommand. Found: LISTWISE`**
  in a Warnings table — and then honor it anyway (uniform Ns per cell). The
  comparison uses the numbers, not the warning.
- Our Case-Processing-Summary table in listwise mode reports Total = valid N
  where SPSS still shows the pre-filter total with a Missing column — the
  analysis numbers agree; the CPS presentation does not (cosmetic, noted).

## Covered so far

29 SPSS procedures, each once directly and once through the syntax dispatcher:

Frequencies · Descriptives · Explore (EXAMINE) · Means · Case Summaries
(SUMMARIZE) · OLAP Cubes · independent / paired / one-sample t tests · one-way
ANOVA (both dependents, group descriptives, Levene) · Pearson / Spearman /
partial correlation · Crosstabs (chi-square, Phi, Cramer's V, observed counts) ·
linear regression (model summary, ANOVA, coefficients) · binary logistic ·
curve estimation · reliability (alpha, item-total, scale) · ROC (both the ROC
Curve and the ROC Analysis dialog, since they are separate scripts) ·
Kaplan-Meier ·
Cox regression · and all eight NPAR TESTS (Mann-Whitney, Wilcoxon, Kruskal-
Wallis, Friedman, binomial, chi-square goodness of fit, one-sample K-S, runs).

plus, from wave 3: factor analysis (PCA) · discriminant · ratio statistics ·
ordinal regression (PLUM) · missing value analysis · GLM univariate (two-way
factorial) · GLM multivariate (MANOVA); and from wave 4: multinomial logistic
(NOMREG) · life tables · GENLIN (Poisson) · GLM repeated measures ·
proximities · multiple response; and from wave 7: GEE (GENLIN /REPEATED),
MEANS with the full /CELLS list, and RELIABILITY /MODEL=SPLIT.

Wave 5 leaves the defaults behind and turns on the sub-dialog option sets:
Crosstabs' full statistics and cells on a real 2x2, ONEWAY's seven post-hoc
methods plus Welch and Brown-Forsythe, Explore's M-estimators and extreme
values, Kendall's tau-b, and FREQUENCIES /NTILES.

Wave 6 is the WEIGHT / SPLIT FILE / FILTER matrix: all eight cells of
weight x split x filter, plus weighted Frequencies. The app injects these at
one choke point (analysis-handler.ts) -- weightVariable and splitVariable ride
along in the params, a case filter is applied upstream in the DuckDB query --
and the harness mirrors that exactly, so what is compared is the production
path and not a re-implementation of it.

Wave 8 adds a second SPSS. **IBM SPSS Statistics 32** is installed alongside
26, which brings the procedures 26 simply does not have — Compare Means >
Proportions arrived in 27 — so the three Proportions procedures are compared
for the first time. See _Two SPSS versions_ below for what changed between the
two, and why `job.sps` is still run on 26.

Wave 7 closes the list of things this README used to call "still to be
written". Two of them turned out to be feature gaps rather than missing
comparisons, so the features were built: **MEANS /CELLS** (the Cells sub-dialog
was parsed and thrown away, so every run printed Mean / N / Std. Deviation
whatever was asked for) and **RELIABILITY /MODEL=SPLIT** (the split-half model
did not exist). The third, **GEE**, only needed the comparison written once
geepack was installed.

**687 comparisons, 0 unexplained differences.** Beside OK and FARK, `compare.R`
reports two more outcomes, both printed on every run so nothing can hide in a
silent pass: **BILINCLI** (16) for a difference we looked at and decided to
keep, and **ACIK** (0) for one we have not explained yet. A block whose table
is missing counts as a skip for the same reason — an `if (!is.null(t))` guard
that quietly does nothing is the same silent pass a wrong column key gives,
and this harness had one: the Explore descriptives block compared nothing for
two waves before that was fixed.

### Two SPSS versions

`job.sps` runs on **SPSS 26**; `job32.sps` runs on **SPSS 32**. They are
separate files with separate value sets and separate extractors, on purpose:
re-running the 26 baseline on another version would silently move the numbers
661 comparisons are pinned to, and SPSS 27+ writes a different HTML dialect
anyway (`<table class="pivot"><caption>` instead of 26's `class="Default
PivotTable"` with a `summary` attribute).

**What changed between 26 and 32.** The whole of `job.sps` was re-run on 32 and
the two extractions diffed. Of the 655 values the 26-dialect extractor could
read from both, **644 are identical** and the 11 that differ are all
presentation, not statistics:

- **8 are `,000` becoming `<.001`.** SPSS 27 changed how it prints a p-value
  below .001. `extract-spss32.cjs` keeps that as a bound (`{lt: 0.001}`) rather
  than reading it as the number 0.001, and the comparison checks "is ours below
  the bound" instead of equality — treating it as a value would be a lie in the
  direction that makes the test pass.
- **3 are a trailing empty row** dropped from the correlation matrices.

The remaining 292 keys could not be read from the 32 output at all, because
several tables genuinely changed shape in 27+, not just markup. The clearest
case: the **Independent Samples Test** no longer carries Levene's columns and
splits Significance into **One-Sided p** and **Two-Sided p**. That is a real
difference from what we print, and it is a gap on our side rather than a defect
— worth revisiting if one-sided p-values matter to users.

**What 32 unlocked.** Three procedures that 26 cannot run at all:

| Procedure                       | Working syntax                                                        | Result  |
| ------------------------------- | --------------------------------------------------------------------- | ------- |
| One-Sample Proportions          | `PROPORTIONS /ONESAMPLE d1 /SUCCESS VALUE=LEVEL(1).`                  | matches |
| Independent-Samples Proportions | `PROPORTIONS /INDEPENDENTSAMPLES d1 BY grp2 /SUCCESS VALUE=LEVEL(1).` | matches |
| Paired-Samples Proportions      | `PROPORTIONS /PAIREDSAMPLES d1 d2 /SUCCESS VALUE=LEVEL(1).`           | matches |

Finding those spellings took three probe rounds — `/TEST`, `/CI`, `TESTVALUE=`,
`VARIABLES=`, `PAIRS=` and `BY grp2(1 2)` are all rejected — and the first round
was wasted on a mistake this project has now made three times: **an SPSS comment
runs to its terminating `.`, not to end of line**, so every banner without a
period swallowed the command beneath it and five procedures silently never ran.
`job32.sps` and `probe32.sps` both carry the period on every comment.

The paired comparison also produced a change on our side. SPSS reports the
asymptotic McNemar (z = (b−c)/√(b+c)); `proportions.R` reported only the exact
binomial test, so the p-values differed for a reason that looked like an error.
Per CLAUDE.md §11 the table now carries **both** — Z, Asymp. Sig. and Exact
Sig. — which matches the reference and keeps the value that is right when the
discordant count is small.

### Which procedures this SPSS can run

Measured, not assumed: `probe.sps` + `probe-report.cjs` run one command per
candidate procedure and report which produced tables. On this install **no
module is missing** — Advanced Statistics, Regression, Missing Values, Decision
Trees, Categories and Bayesian all answered. Every failure in the first probe
round was a syntax error of ours.

Not yet compared, and why:

- **TREE** — SPSS grows CRT with its own pruning and surrogate splits, tree.R
  uses rpart; the two are different algorithms, not different settings.

The entries that used to stand here were closed by the **extension run**
(`job-ext.sps` on 26, `job-ext32.sps` on 32 → `extract-ext.cjs` →
`spss-ext-values.json` → `compare-ext.R`; **80 comparisons, 0 unexplained**):

- **REPORT (Summaries in Rows / in Columns)** — the legacy REPORT emits a
  preformatted text block, parsed from the `&nbsp;` layout (dot decimals, while
  pivots print commas). "Summaries in Columns" turned out to paste `SUMMARIZE`,
  not REPORT — the same command as Case Summaries with a different default.
  One micro-finding: SPSS's own text print of an integer sum came back as
  `1985797.000001`; ours is exact, so Sum cells compare with a relative
  tolerance.
- **PROBIT** — covariates go after `WITH`, and `/LOG=NONE` is needed or SPSS
  log10-transforms them. Finding: SPSS prints standard errors from the
  **observed** information matrix where `glm()` reports the **expected**
  Fisher information — for a non-canonical link like probit they differ (~1%).
  `regression-probit.R` now recomputes SE/Z/Sig from the observed Hessian and
  matches. Z can still land 0.001 off at the last printed digit because SPSS's
  optimizer stops at its own convergence tolerance (B, SE, Sig. all match).
- **K-Means** — comparable once the initial centres are pinned on both sides
  (`/INITIAL=(…)`, parenthesised cluster-by-cluster; `kmeans.R` accepts an
  optional `initialCenters` param). Second finding: SPSS's
  `METHOD=KMEANS(NOUPDATE)` is **Lloyd's** batch iteration, not Hartigan-Wong
  — `kmeans.R` now uses `algorithm = "Lloyd"` and reproduces SPSS's centres
  and sizes exactly (34/58/28 on the fixture).
- **KNN** — fixed with `/PARTITION TRAINING=100 HOLDOUT=0` and
  `/MODEL NEIGHBORS=FIXED(K=3)`; the classification table is model-viewer-only
  and never reaches the production HTML, so `/SAVE PREDVAL` + `SAVE TRANSLATE`
  writes the per-case predictions to CSV instead. Finding: SPSS **min-max**
  normalizes predictors (not z-scores, as knn.R's comment claimed) and its
  training-sample classification leaves the case itself out — exactly what
  `class::knn.cv` does. `knn.R` now min-max normalizes; confusion matrix and
  overall accuracy match case-by-case (117/117).
- **Hierarchical cluster** — with `/MEASURE=EUCLID` the Likert fixture still
  can't be compared stage-by-stage (hundreds of zero-distance ties; which tie
  merges first is a free choice that changes later group averages — 91 of 119
  stages coincide). The tie-free proof runs on `score income pre`: **all 113
  coefficients match**, at full precision via OXML (see below).
- **MDS** — ALSCAL's text block parses fine, but the numbers measure different
  things: SPSS's Stress/RSQ are taken against the _optimally scaled
  disparities_, ours against the raw distances, and ALSCAL's iterative solution
  is stress-optimal where `cmdscale` is strain-optimal (its configuration's
  raw stress is 0.362 vs our 0.388). Documented, not asserted.
- **POWER** — it exists on the SPSS 32 install after all (the README's earlier
  claim was wrong): `POWER MEANS ONESAMPLE/INDEPENDENT /PARAMETERS … ES=d`.
  `power.R`'s noncentral-t computation matches both directions (power at N,
  required N at power).

### The clipboard and the headless backend

Two operational notes from the extension run:

- `stats.exe -production` can die at startup with
  `java.lang.IllegalStateException: cannot open system clipboard` when another
  process holds the clipboard; the process then lingers without writing
  output. Kill leftover `stats.exe` processes and retry.
- SPSS 32's external Python (`statisticspython3.bat`) drives `spssengine.exe`
  with no Java UI and no clipboard at all, and `OMS … FORMAT=OXML` yields
  **full-precision** values (the HTML export truncates to the display format).
  Two Turkish-locale traps on this route: `spss.py`'s `Submit` crashes decoding
  the C locale (`GetCLocale` returns a non-UTF-8 byte) until
  `PyInvokeSpss.GetCLocale` is monkeypatched to return `("C",)`, and the
  syntax still needs `SET DECIMAL=DOT.` first. `cluster-cont.xml` was produced
  this way.

### Bayesian: half of it was comparable after all

This README used to dismiss the six Bayesian procedures in one line — "SPSS's
priors and BayesFactor's JZS priors differ by design, so a difference would not
mean a defect". That was an assumption, never tested, and it was half wrong.

SPSS 27+ names its Bayes-factor methods explicitly: `/ESTBF COMPUTATION=ROUDER`
and `TYPE=JZS` are the same family `BayesFactor` implements. The commands are
reachable — the grammar is in the install's own `syntax_xml/BAYES *.xml`, which
is worth reading rather than guessing at, since `/VARIABLES` as a leading
subcommand is rejected everywhere and the variable list goes inside
`/INFERENCE VARIABLES=` for some commands and bare after the command name for
others.

What a prior-width sweep against SPSS's printed values showed:

| Procedure             | Closest we get                 | Verdict                                                                                                                           |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Independent-samples t | **exact at r = 1** (BF01 .338) | compared                                                                                                                          |
| Linear regression     | **exact at r = 1** (BF10 .086) | compared                                                                                                                          |
| One-sample t          | **exact at r = 1** (BF01 .454) | compared (extension run; `/DATA` needs its own `VARIABLES=`)                                                                      |
| Paired t              | **exact at r = 1**             | compared as a bound — SPSS prints BF01 = .000, ours is ~1e-9; the command is `BAYES RELATED /PAIR VARIABLES=`, not `BAYES PAIRED` |
| Correlation           | ratio 1.6 at r = 1             | not reproducible                                                                                                                  |
| One-way ANOVA         | ratio 3.0 at r = 1             | not reproducible                                                                                                                  |

So the difference for the first two was **prior width, not prior family**: SPSS's
Rouder/JZS default is r = 1 where ours is r = 0.707 ("medium", the BayesFactor
and JASP convention). `compare.R` passes `rscale` explicitly for those two
rather than changing any default — a user comparing our defaults against SPSS's
will still see different numbers, for a reason that is now understood and
documented instead of asserted.

The correlation and ANOVA Bayes factors are not reachable from any width, so
those two stay uncompared — but now because it was measured, not because it
seemed likely.

### Deliberate differences

`compare.R` has a third outcome beside OK and FARK: **BILINCLI**, for a
difference we looked at and decided to keep. They are printed every run, so
"0 FARK" keeps meaning "nothing unexplained" rather than "nothing differs".

Each one prints its reason directly under its own row, next to the two numbers
it explains, wrapped and prefixed with `|`. The reason says which variable
entered the analysis and which estimator produced the value — "product A does
X, product B does Y" reads like an excuse and leaves the next reader nothing to
check, whereas naming the variable and the method makes the number
reproducible from the note alone. The tail summary lists the labels only.

**The same reasons now ship in the product.** A user who runs one of these
procedures here and elsewhere and gets two different numbers should be able to
see why from our output alone, without owning the other package or reading this
file, so each analysis states its own method choice under the table it affects
(`sai_output(notes = …)`, rendered below the tables by `AnalysisBlock.tsx`):
`output.cox.tiesEfronNote` (only when the data has tied event times),
`output.survival.medianCiNote`, `output.roc.seMethodNoteNegexp`,
`output.rocAnalysis.seMethodNote`, and, for a requested statistic that produces
nothing, the warning `output.crosstabs.warnKappaCategories`. Writing those notes
turned up a real defect rather than a wording problem — see _ROC: one area, two
standard errors_ below. They are worded as
"this is what was computed", never as "X does it differently" — the user's
other tool is not ours to characterise, and a method name is checkable where a
comparison is not. MANOVA's intercept F gets no note: nothing was chosen there,
the two values differ only in the digit the reference rounds away.

- **Cox regression** (−2LL, LR chi-square): `surv` has tied event times, and
  the model on `score` + `age` estimates the partial likelihood with Efron's
  tie correction — the more accurate one when ties are present, and `coxph()`'s
  default. CLAUDE.md §11 takes R's default where it is the better statistic. A
  coarser correction (Breslow) moves the third decimal.
- **Kaplan-Meier median CI**: `surv` against `evt = 1` by `grp2`. The median's
  interval comes from inverting the Greenwood confidence band for S(t) at
  S = 0.5, the standard construction; the linear median ± 1.96·SE(median)
  approximation is not used. The two separate in the censored tail. (The median
  itself matches.)
- **ROC upper confidence limit**: `score` against `disease = 1`; the interval
  is built on the DeLong standard error (0.037108), giving 0.906506. The
  reference is published to three decimals, and every SE in [0.0365, 0.0375]
  prints the same 0.037 — the difference is that rounding digit alone.
- **MANOVA intercept F** (2570.277 vs 2570.983): `pre` and `post` by `grp2`. At
  the intercept Wilks' Λ falls to 0.0219, and F = ((1−Λ)/Λ)·(errDf/hypDf), so
  half a unit in Λ's third decimal moves F by ~10: the published 0.022 admits
  every F in roughly [2560, 2580]. The `grp2` rows — the ones that test a
  hypothesis anyone cares about — match exactly.
- **GEE intercept Wald** (61.057 vs 61.058): `q1` on `score`, exchangeable
  working correlation over `grp3`, robust SEs. Wald = (B/SE)², so a statistic
  of magnitude 61 is being checked to 0.0005 against an SE published to four
  decimals: every SE that prints as .4617 spans Wald 61.034–61.061. B, SE and
  Sig. match exactly, and so does the `score` row's Wald, where the same SE
  precision buys two more digits of resolution.
- **Split-half, unequal-length Spearman-Brown** (0.8240 vs 0.823): `q1`–`q5`
  split by item order into `q1`–`q3` and `q4`–`q5`; ours is the Spearman-Brown
  generalisation to an uneven split, `r / (2L(1−L) + r(1 − 2L(1−L)))` with
  L = 3/5. The other eight coefficients in that table — both halves' alphas,
  the correlation between forms, equal-length Spearman-Brown, Guttman — match
  exactly, so the data and the split agree and only this formula differs. With
  r fixed at 0.692 no standard variant reaches 0.823 (Flanagan-Rulon 0.8065,
  Angoff-Feldt 0.8201, Raju/Horst 0.8401), and the length ratio that would
  produce it is L = 0.5915, which a 3-against-2 split does not have.
- **Explore's M-estimators** (4 values, ~0.02-0.10 on a location of 52.7): see
  _M-estimators: the missing scale convention_ below — the algorithm is now
  identified and fixed; this near-symmetric fixture just isn't skewed enough
  for the fix to move the number much. Two real, skewed SPSS runs confirm it.
- **Crosstabs kappa**: rows are `d1` (0/1), columns `grp2` (1/2). Cohen's kappa
  measures agreement between two ratings of the _same_ categories, so
  `crosstabs.R` requires identical row and column categories and leaves the
  cell empty here. Pairing the categories by position would produce a number
  that is not an agreement measure. Keeping the guard.

### ROC: one area, two standard errors (found here, fixed)

Writing the method notes surfaced a defect the comparison had never been in a
position to see. `roc.R` (Analyze → ROC Curve) computed the nonparametric
DeLong standard error; `roc-analysis.R` (Analyze → ROC Analysis) still used
Hanley & McNeil's 1982 `Q1 = A/(2−A)`, `Q2 = 2A²/(1+A)` shortcut, which reaches
the same answer only if the scores are exponentially distributed. On the
fixture that is SE .039 against .037, and a visibly wider interval — one
dataset, two confidence intervals, decided by which menu item the user opened.

It survived because only `roc.R` was ever compared: a second implementation
that nothing checks is not covered by the first one's passing row. Both now
call `_bootstrap.R`'s `auc_nonparametric_se()`, both are compared against SPSS
here, and `tests/r-validation/test-roc-se-2026-08.R` pins the SE to the
definition computed independently — including a check that its fixture actually
separates the two formulas, so the test cannot quietly stop testing anything.

### Open differences

**None.** The count is 0, and `unresolved()` is deliberately left in
`compare.R` with no caller: if BILINCLI were the only outcome available, the
next difference nobody has explained would quietly be filed as deliberate.

### M-estimators: the missing scale convention (found here, fixed)

Explore's four M-estimators — ours 52.785/52.786/52.817/52.786 against SPSS's
52.739/52.691/52.753/52.690 on this fixture (N 117, mean 52.9185, SD 11.8725,
both sides otherwise OK) — used to sit in _Open differences_ as unexplained,
then moved to BILINCLI once a search over the documented algorithm's variants
came back empty:

- scale fixed once from the median, and re-estimated at every iteration;
- MAD scaled by 1.4826, by 1/0.6745, by √(π/2), by 1.2533, and unscaled;
- joint location-and-scale iteration (Huber's Proposal 2), including
  `MASS::huber` and `MASS::hubers` directly;
- starting values from 45 to 60, in case a redescending psi was settling into a
  different local solution.

Every one of those returned our own number, so the search concluded there was
no algorithm to find. That conclusion was wrong, not the search: on this
fixture the scale convention barely moves the IRLS fixed point at all, because
almost no point sits near a psi cutoff either way — every variant "returning
our number" was the fixture failing to discriminate between them, not the
conventions agreeing.

A 2026-08-23 session testing against a _skewed_ clinical dataset settled it.
Two SPSS 26 Explore variables (Hb and CRP, split by a factor) were pasted with
their stem-and-leaf plots and Extreme Values tables, precise enough to
reconstruct the exact raw data behind each published number (every
"Extremes" bucket resolves against the published Highest/Lowest-5 list, so
nothing is approximated — confirmed by matching N/mean/median/SD/min/max
against SPSS's own Descriptives table first). Testing every scale/iteration
combination from the list above against those exact values, instead of
against this mild fixture, isolated the one that reproduces all four
estimators on both real runs: **scale = the raw median absolute deviation
from the median — no 1.4826/0.6745 normal-consistency constant — computed
once and held fixed across every IRLS iteration.** That is not what
`MASS::rlm()`'s default (`scale.est = "MAD"`) does: it applies the constant
_and_ re-estimates scale every iteration, which is what `explore.R` called
before this fix.

The two real fixtures went from 5-27% off SPSS (worse the more skewed the
variable) to within 0.1-0.5% with the corrected convention — see
`tests/r-validation/test-m-estimators-2026-08.R`, which now pins both
reconstructed datasets alongside the original self-consistency check.
`explore.R`'s `m_estimate()` is a hand-written IRLS now, not a `MASS::rlm()`
call (MASS still supplies the Huber/Tukey/Hampel weight functions).

This fixture's own residual (0.02-0.10 on a location of ~52.7) barely moved,
which is exactly what the mechanism above predicts — it stays in BILINCLI at
that smaller, now-understood magnitude rather than being fully closed.

### Not comparable

`mixed-models.R` requires a subject variable, so it cannot reproduce SPSS's
fixed-effects-only `MIXED score BY grp3 /FIXED=grp3` and is not compared.
K-means is not compared either: cluster labels are arbitrary and the two
implementations seed differently, so the partitions are not expected to line
up (ours 30/41/49, SPSS 27/35/58 on the fixture) — a meaningful comparison
would need a fixed initial-centre specification on both sides.

Hierarchical cluster, likewise, for two reasons. SPSS's dialog defaults to
**squared** Euclidean distance for interval data while `hierarchical.R` uses
`dist()`'s plain Euclidean, and averaging squares is not the square of
averaging. Worse, the fixture is Likert data: hundreds of pairs sit at
distance zero, and which of them merges first — a free choice for any
implementation — changes every subsequent group average. Squaring our
distances moves the tail from 2.09…2.96 to 4.30…9.79 against SPSS's
5.00…9.71: closer, still not equal. The distance default is worth revisiting
on its own merits; the schedule is not a reproducible comparison target.

### What it caught

**Percentiles.** `FREQUENCIES /PERCENTILES` on age, p = 90: SPSS 63.9, ours
63.1. `wtd_quantile()` delegated to R's default `quantile()`, type 7; SPSS uses
HAVERAGE ("Weighted Average (Definition 1)"), which is type 6. Quartiles and
the median agree under both, so nothing downstream had ever noticed. The
weighted branch was a third rule again — with all weights 1 it returned a
different number than the unweighted branch on the same data. Both fixed in
`_bootstrap.R`; a zero-weight case no longer shifts a percentile either.

**Four more statistics defects**, from widening the harness past its first ten
procedures (each now pinned in
`tests/r-validation/test-spss-parity-wave2-2026-08.R`):

- **Friedman** used the uncorrected chi-square, which assumes no tied values
  within a case. Likert items are nothing but ties and it is biased downward:
  0.517 where SPSS and base R's own `friedman.test` both give 0.768 — p .772
  against .681, enough to flip a call.
- **Wilcoxon signed-rank** ranked a floating-point near-tie as two distinct
  values. Two-decimal data subtracted in binary gives 1.8399999999999892 and
  1.8400000000000034 for a pair that is tied at 1.84; one negative, one
  positive, so half a rank moved between the sign groups and Z shifted.
- **ROC standard error** used Hanley & McNeil's 1982 shortcut, which equals the
  right answer only if the scores are exponentially distributed — nothing
  checked that, and the fixture does not satisfy it. Replaced with DeLong's,
  which is what SPSS's "nonparametric assumption" SE is.
- **Kaplan-Meier median** came straight from `survfit()`'s `median` column,
  which returns the MIDPOINT of a flat 0.5 stretch. On the fixture S(13.26) =
  0.5 exactly and the next event is at 13.94, so it reported 13.60 — a time at
  which nothing happened. Now the smallest t with S(t) ≤ 0.5, as in SPSS and
  in the textbook.

**Three more, from wave 3:**

- **Factor analysis** printed the whole Component Matrix negated (−.800 where
  SPSS prints .800). An eigenvector's sign is arbitrary, so LAPACK's choice is
  as good as any mathematically — and useless to a reader: it reads as "these
  items load negatively" and inverts the interpretation of every component.
  Each component is now reflected so its dominant loading is positive, which is
  SPSS's convention. Communalities (squares) were never affected.
- **Discriminant** classified with the observed group proportions (MASS::lda's
  default) where SPSS uses equal priors — 62.3% correct against SPSS's 60.5%.
  The prior belongs on `predict()`, not on `lda()`: MASS also uses it to weight
  the between-class scatter, and setting it at fit time moved the eigenvalue
  and pushed Wilks' chi-square off SPSS (11.911 vs 11.908). SPSS keeps the two
  separate — functions from the data, classification from the stated priors.
- **Ratio statistics** reported the coefficient of dispersion as a percentage
  (6.497) where SPSS prints the proportion (0.065). The IAAO literature does
  quote COD as a percentage, but a number 100× off the reference tool is worse
  than a convention debate.

**The syntax front-end**, once it was pointed at real SPSS syntax rather than
at syntax we had generated ourselves:

- an unpaired apostrophe in a comment (`SPSS's`, `don't`) opened a string that
  never closed, so every command after it was swallowed into one chunk — and
  because that chunk began with the comment's `*`, it was discarded as a
  comment. Eight procedures disappeared with no error and no output;
- a comment is a command running to its terminating `.`, not a line: a comment
  containing a sentence was split, and each piece after the first surfaced as
  "Unrecognized command";
- `FREQUENCIES` and `DESCRIPTIVES` ignored `/STATISTICS` entirely (every flag
  hard-coded), so a pasted command asking for twelve statistics produced the
  default four — silently, under a success message. `/PERCENTILES`, `/NTILES`
  and `/FORMAT=NOTABLE` were ignored too;
- `ONEWAY score BY grp3 /STATISTICS HOMOGENEITY` tried to resolve `/STATISTICS`
  as a variable name, because the bare variable list was read to end-of-body
  instead of to the first subcommand (same latent bug in six other handlers);
- `T-TEST PAIRS=pre WITH post (PAIRED)` treated `(PAIRED)` as a variable;
- CROSSTABS wanted `CHISQUARE`, but SPSS's keyword is `CHISQ` (likewise
  `BTAU`/`CTAU`), so `/STATISTICS=CHISQ PHI` produced no chi-square table. Our
  "Paste Syntax" button now emits SPSS's spelling too, so what it generates is
  valid in SPSS as well.

and, from the wider job:

- every `NPAR TESTS` sub-command with a parameter — `/BINOMIAL(0.5)=evt`,
  `/K-S(NORMAL)=score`, `/RUNS(MEDIAN)=score` — failed with "unknown
  variables". The parenthetical was stripped but the `=` sits _after_ it, so
  the variable name came out as `=score`. Only `/CHISQUARE=grp3`, which has no
  parenthetical, worked;
- `COXREG` and `LOGISTIC REGRESSION` accepted covariates only as `WITH a b c`,
  while SPSS's own dialogs paste them on `/METHOD=ENTER a b c` and omit WITH
  entirely — the canonical pasted syntax was rejected;
- `EXAMINE` ignored `/PERCENTILES`, `/PLOT` and `/STATISTICS`: `/PLOT NONE`
  still drew a boxplot and `/PERCENTILES(5,10,25)` produced no percentile
  table;
- `SUMMARIZE` and `OLAP CUBES` had no handler at all. The analyses and their
  dialogs exist; pasting SPSS's syntax for them said "Unrecognized command".

All of these were invisible to the existing unit tests, which fed the
dispatcher syntax our own generator had produced — a closed loop that agreed
with itself.

## Traps worth knowing

**Decimal separator.** This SPSS runs in a Turkish locale, where the decimal
separator is a comma, so `72.55` in the CSV is rejected on import. The first run
looked catastrophic — `score` came back with N=2 of 120, perfect correlations,
R=1.000 — when in fact only the integer columns had survived. `SET DECIMAL=DOT.`
before `GET DATA` fixes it. Note SPSS still _prints_ commas; the extractor
handles that (and SPSS's bare `,124` for 0.124).

**Nested tables.** A pivot table with a layer dimension contains a small
`<table class="defaultLayer">` inside its first row, so a non-greedy
`/<table[\s\S]*?<\/table>/` ends the OUTER table at the INNER one's closing
tag. FREQUENCIES' Statistics table therefore looked absent from the export
while sitting there in plain HTML. `tableBlocks()` matches brace-style instead.

**An SPSS comment runs to its terminating `.`, not to end of line.** Wave 6's
section banners (`* W: weight only ────`) had no period, so each one swallowed
the command on the next line: `WEIGHT BY wt`, `FILTER BY keep` and
`SORT CASES BY grp2` never executed, and the runs looked plausible while
measuring the wrong thing (the split cells reported N = 1, because an unsorted
file starts a new split group at every change of `grp2`). This is the exact
defect the dispatcher had and that this harness found — made again, in the
SPSS input, by the person who had just fixed it. Terminate every comment.

**Fixture collinearity.** `region` was first built by cycling four values
against `grp2`'s two, which made region determine grp2 exactly and turned the
crosstab into a degenerate Phi = 1. Anything cycled with `rep()` needs its
period checked against the other cycled columns, or sampled instead.

## Extending it

Add the procedure to `job.sps`, add an extraction block to `extract-spss.cjs`
(locate the table by a content signature — SPSS emits a Notes table before every
procedure, so indices shift), and add a section to `compare.R`.

Take the column keys from the R script itself rather than guessing: several
first attempts here compared against keys that did not exist, which shows up as
`ATLANDI`, not as a failure. A silent skip is the failure mode to watch for.
