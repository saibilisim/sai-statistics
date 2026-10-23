* Extension run: procedures job.sps does not cover. Comments end with a period.
* Round 2: REPORT/PROBIT/QUICK CLUSTER/KNN syntax corrected against the IBM
* Command Syntax Reference (v26).

SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

FORMATS score income age pre post surv (F14.6).

* The k-means centre table prints at the variables' own display format, so
* the integer Likert items need decimals too or every centre comes back "3".
FORMATS q1 q2 q3 (F14.6).

* 1. REPORT with the summary functions as rows (Report Summaries in Rows).
* FORMAT must be the first subcommand; NOLIST is the default; one /SUMMARY
* per line so each statistic is its own row. grp2 alternates 1,2 row by row,
* and REPORT reads the file sequentially, so sort first.
SORT CASES BY grp2.
REPORT FORMAT=AUTOMATIC NOLIST
  /VARIABLES=score income
  /BREAK=grp2 (TOTAL)
  /SUMMARY=VALIDN
  /SUMMARY=MEAN
  /SUMMARY=STDDEV
  /SUMMARY=SUM
  /SUMMARY=MIN
  /SUMMARY=MAX.

* 2. Report Summaries in Columns pastes SUMMARIZE, not REPORT (IBM Base
* user's guide menu mapping); job.sps already runs exactly this shape, so it
* is repeated here only to keep this file self-contained.
SUMMARIZE /TABLES=score BY grp2 /FORMAT=NOLIST TOTAL /CELLS=COUNT MEAN STDDEV.

* 3. PROBIT on case-level binary data: every case is a single trial; the
* covariates go after WITH; /LOG=NONE stops the default log10 transform.
COMPUTE ntot = 1.
EXECUTE.
PROBIT disease OF ntot WITH score age
  /LOG=NONE
  /MODEL=PROBIT.

* 4. QUICK CLUSTER with pinned initial centres (parenthesised, cluster by
* cluster); the R side starts from the same three points.
QUICK CLUSTER q1 q2 q3
  /INITIAL=(1 1 1 3 3 3 5 5 5)
  /MISSING=LISTWISE
  /CRITERIA=CLUSTER(3) MXITER(20) CONVERGE(0)
  /METHOD=KMEANS(NOUPDATE)
  /PRINT INITIAL ANOVA CLUSTER.

* 5. KNN with fixed k and no holdout: k lives on /MODEL, the target's
* measurement level in parentheses after the variable. The classification
* table is model-viewer-only and never reaches the production HTML export, so
* the per-case predicted class is saved and written out instead.
KNN disease (MLEVEL=N) WITH score age
  /PARTITION TRAINING=100 HOLDOUT=0
  /MODEL NEIGHBORS=FIXED(K=3)
  /SAVE PREDVAL(knnpred).
SAVE TRANSLATE OUTFILE='C:\path\to\sai-statistics\app\tests\spss-parity\knn-pred.csv'
  /TYPE=CSV /REPLACE /FIELDNAMES /MAP
  /KEEP=id disease knnpred.

* 6. Hierarchical cluster on plain Euclidean distance, matching dist().
* The Likert items carry hundreds of zero-distance ties, so a second run on
* continuous variables gives the tie-free, stage-by-stage comparison.
CLUSTER q1 q2 q3 /METHOD BAVERAGE /MEASURE=EUCLID /PRINT SCHEDULE.
CLUSTER score income pre /METHOD BAVERAGE /MEASURE=EUCLID /PRINT SCHEDULE.

* 7. ALSCAL on the same distance matrix mds.R builds: Euclidean distances
* between the five z-scored item vectors, fed in as a ready matrix so only
* the scaling algorithm itself differs between the two sides.
MATRIX DATA VARIABLES=q1 q2 q3 q4 q5
  /FORMAT=FULL
  /CONTENTS=PROX.
BEGIN DATA
0.000000 11.456537 10.708287 11.168412 9.814463
11.456537 0.000000 12.072500 11.815492 11.967916
10.708287 12.072500 0.000000 11.169630 10.342464
11.168412 11.815492 11.169630 0.000000 10.246388
9.814463 11.967916 10.342464 10.246388 0.000000
END DATA.
ALSCAL VARIABLES=q1 q2 q3 q4 q5
  /SHAPE=SYMMETRIC /LEVEL=INTERVAL(1) /CONDITION=MATRIX /MODEL=EUCLID
  /CRITERIA=DIMENS(2) /PRINT=DATA HEADER.
