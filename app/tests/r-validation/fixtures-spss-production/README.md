# Driving SPSS itself to produce reference values

These files recover SPSS's own answers instead of guessing at them from an
exported report. They are what settled the Grouped Median definition (see
`../test-grouped-median-2026-08.R` and `grouped_median()` in `_bootstrap.R`).

## Why this exists

SPSS Statistics **desktop** has no Batch Facility — `statisticsb.exe` ships only
with SPSS Statistics Server. It does have the **Production Facility**, which
runs a job headlessly:

```
"C:\Program Files (x86)\IBM\SPSS\Statistics\26\stats.exe" "gm2.spj" -production
```

No GUI window opens, the process exits 0, and the output is written to the path
named in the job. It ran fine alongside an already-open SPSS session.

A `.spj` job is XML validated against `production-1.4.xsd` in the SPSS install
directory:

```xml
<job xmlns="http://www.ibm.com/software/analytics/spss/xml/production"
     syntaxFormat="interactive">
  <output outputPath="…\out.htm" outputFormat="html"/>
  <syntax syntaxPath="…\job.sps"/>
</job>
```

`outputFormat` accepts `html`, `text-utf8`, `viewer`, `excel`, `pdf` and more.
Prefer `html` — the `text-utf8` writer dropped the leading character of many
cells in our run, which is easy to misread as wrong numbers.

**Paths inside the `.spj` and `.sps` must be absolute**, so these files are
machine-specific; edit them before re-running on another machine.

## The jobs here

- `gm.sps` / `gm.csv` — first pass, default formats. Told us the answer scales
  with the data but was rounded to 2 decimals, which was not enough.
- `gm2.sps` / `gm2.csv` — the decisive run. `FORMATS … (F14.6)` so the grouped
  median is printed to six decimals, and five variables chosen so that each
  isolates one candidate definition:

  | var | values                  | what it separates                                         |
  | --- | ----------------------- | --------------------------------------------------------- |
  | `a` | 1,1,1,2,2,2,3,3,3,3     | baseline                                                  |
  | `b` | `a` × 10                | is the width absolute or relative to the data?            |
  | `c` | 1,1,1,2,2,2,4,4,4,4     | which gap matters — above or below the median?            |
  | `d` | 1,1,1,5,5,5,9,9,9,9     | same, wider                                               |
  | `e` | 1,1,1,2,2,2,3,3,3,**4** | the pair with `a` that kills the whole class-width family |

  `a` and `e` share a median class, a cumulative-below and a class frequency,
  differing only in the frequency of the class _above_ — yet SPSS answers
  2.142857 and 2.166667. No `w` can produce both.

- `case-summaries.sps` / `.spj` + `make-case-summaries.R` — the reference
  values behind `test-case-summaries-spss-2026-08.R` and section 2 of
  `test-grouped-median-2026-08.R`. The generator writes the synthetic
  `../fixtures-spss-case-summaries-100.csv` (fixed seed) and a 309-case
  extension to a temp folder; the job runs every Case Summaries statistic on
  the first and a `LIMIT=100` listing on the second. Last run 2026-10-24,
  SPSS Statistics 26, Turkish Windows locale (string Maximum depends on it:
  ş sorts before z).

## Reusing this

Any future SPSS parity question can be settled the same way rather than by
fitting formulas to exported output: write a `.sps`, point a `.spj` at it, run
`stats.exe … -production`, and read the result. Keep the input data small and
its structure deliberate — the value here came from the design of the fixture,
not from the volume of numbers.
