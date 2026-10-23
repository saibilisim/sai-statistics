* Missing-values strategy parity run: every procedure twice — SPSS's own
* default (ANALYSIS / PAIRWISE) and /MISSING LISTWISE — on the fixture whose
* NAs overlap (score 3, income 4, post 2 of 120 rows).
* Paths are absolute — see README.md before running on another machine.

* Turkish-locale decimal guard, same as job.sps.
SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

FORMATS score income age pre post (F14.6).

* 1. One-sample T-TEST.
T-TEST /TESTVAL=50 /VARIABLES=score income.
T-TEST /TESTVAL=50 /VARIABLES=score income /MISSING=LISTWISE.

* 2. Paired T-TEST (two pairs, overlapping NAs across all four).
T-TEST PAIRS=pre score WITH post income (PAIRED).
T-TEST PAIRS=pre score WITH post income (PAIRED) /MISSING=LISTWISE.

* 3. Independent-samples T-TEST.
T-TEST GROUPS=grp2(1 2) /VARIABLES=score income.
T-TEST GROUPS=grp2(1 2) /VARIABLES=score income /MISSING=LISTWISE.

* 4. ONEWAY (DESCRIPTIVES so the per-group N is visible).
ONEWAY score income BY grp3
  /STATISTICS DESCRIPTIVES
  /MISSING ANALYSIS.
ONEWAY score income BY grp3
  /STATISTICS DESCRIPTIVES
  /MISSING LISTWISE.

* 5. MEANS.
MEANS TABLES=score income BY grp3.
MEANS TABLES=score income BY grp3
  /MISSING=LISTWISE.

* 6. CORRELATIONS (SPSS default: PAIRWISE).
CORRELATIONS /VARIABLES=score income age.
CORRELATIONS /VARIABLES=score income age
  /MISSING=LISTWISE.

* 7. EXAMINE.
EXAMINE VARIABLES=score income BY grp3
  /PLOT NONE.
EXAMINE VARIABLES=score income BY grp3
  /PLOT NONE
  /MISSING=LISTWISE.

* 8. NPAR Mann-Whitney.
NPAR TESTS
  /M-W= score income BY grp2(1 2).
NPAR TESTS
  /M-W= score income BY grp2(1 2)
  /MISSING LISTWISE.

* 9. NPAR Kruskal-Wallis.
NPAR TESTS
  /K-W=score income BY grp3(1 3).
NPAR TESTS
  /K-W=score income BY grp3(1 3)
  /MISSING LISTWISE.

* 10. NPAR Wilcoxon (two pairs, like the paired T-TEST).
NPAR TESTS
  /WILCOXON=pre score WITH post income (PAIRED).
NPAR TESTS
  /WILCOXON=pre score WITH post income (PAIRED)
  /MISSING LISTWISE.

* 11. SUMMARIZE (Case Summaries).
SUMMARIZE
  /TABLES=score income BY grp3
  /FORMAT=NOLIST
  /CELLS=COUNT MEAN.
SUMMARIZE
  /TABLES=score income BY grp3
  /FORMAT=NOLIST
  /CELLS=COUNT MEAN
  /MISSING=LISTWISE.

* 12. OLAP CUBES (no /MISSING in SPSS — probe-missing.py confirmed it rejects.
* the subcommand, so only the default run is here; the dialog's listwise
* option is a beyond-SPSS extra, covered by the dispatch test only).
OLAP CUBES score income BY grp3
  /CELLS=COUNT MEAN.
