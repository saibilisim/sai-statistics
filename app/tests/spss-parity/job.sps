* SPSS reference run for the parity comparison.
* Paths are absolute — see README.md before running on another machine.

* This SPSS runs in a Turkish locale, where the decimal separator is a comma:
* without this, "72.55" in the CSV is rejected and only the integer-valued
* columns survive the import (score came back with N=2 of 120). DOT also makes
* the output use dots, which the comparison parser then reads unambiguously.
SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

* Enough decimals that comparisons are not limited by SPSS's display format.
FORMATS score income age pre post surv (F14.6).

FREQUENCIES VARIABLES=age
  /FORMAT=NOTABLE
  /STATISTICS=MEAN MEDIAN MODE STDDEV VARIANCE RANGE MINIMUM MAXIMUM SEMEAN SUM SKEWNESS SESKEW KURTOSIS SEKURT
  /PERCENTILES=25 50 75 90.

DESCRIPTIVES VARIABLES=score income pre post
  /STATISTICS=MEAN STDDEV VARIANCE RANGE MIN MAX SEMEAN KURTOSIS SKEWNESS SUM.

T-TEST GROUPS=grp2(1 2)
  /VARIABLES=score income
  /CRITERIA=CI(.95).

T-TEST PAIRS=pre WITH post (PAIRED)
  /CRITERIA=CI(.95).

T-TEST /TESTVAL=50 /VARIABLES=score /CRITERIA=CI(.95).

ONEWAY score income BY grp3
  /STATISTICS DESCRIPTIVES HOMOGENEITY
  /MISSING ANALYSIS.

CORRELATIONS /VARIABLES=score income age pre
  /PRINT=TWOTAIL NOSIG
  /MISSING=PAIRWISE.

NONPAR CORR /VARIABLES=score income age
  /PRINT=SPEARMAN TWOTAIL NOSIG
  /MISSING=PAIRWISE.

CROSSTABS /TABLES=region BY grp2
  /STATISTICS=CHISQ PHI
  /CELLS=COUNT EXPECTED
  /COUNT ROUND CELL.

REGRESSION
  /MISSING LISTWISE
  /STATISTICS COEFF OUTS R ANOVA
  /DEPENDENT score
  /METHOD=ENTER income age.

* ── Wave 2 procedures ──────────────────────────────────────────────────────
* Appended AFTER the originals on purpose: extract-spss.cjs locates tables by
* content signature and takes the FIRST match, so the commands the earlier
* comparisons were built against must keep coming first.

EXAMINE VARIABLES=score
  /PLOT NONE /STATISTICS DESCRIPTIVES /PERCENTILES(5,10,25,50,75,90,95).

MEANS TABLES=score BY grp3 /CELLS MEAN COUNT STDDEV.

PARTIAL CORR /VARIABLES=score income BY age /SIGNIFICANCE=TWOTAIL.

NPAR TESTS /M-W= score BY grp2(1 2).
NPAR TESTS /WILCOXON=pre WITH post (PAIRED).
NPAR TESTS /K-W=score BY grp3(1 3).
NPAR TESTS /FRIEDMAN=q1 q2 q3.
NPAR TESTS /BINOMIAL(0.5)=evt.
NPAR TESTS /CHISQUARE=grp3.
NPAR TESTS /K-S(NORMAL)=score.
NPAR TESTS /RUNS(MEDIAN)=score.

RELIABILITY /VARIABLES=q1 q2 q3 q4 q5 /MODEL=ALPHA
  /STATISTICS=DESCRIPTIVE SCALE /SUMMARY=TOTAL.

ROC score BY disease (1) /PLOT=NONE /PRINT=SE
  /CRITERIA=CUTOFF(INCLUDE) TESTPOS(LARGE) CI(95).

KM surv BY grp2 /STATUS=evt(1) /PRINT TABLE MEAN /COMPARE OVERALL POOLED.

COXREG surv /STATUS=evt(1) /METHOD=ENTER score age /PRINT=CI(95).

LOGISTIC REGRESSION VARIABLES=disease /METHOD=ENTER score age.

CURVEFIT /VARIABLES=score WITH age /CONSTANT /MODEL=LINEAR QUADRATIC.

SUMMARIZE /TABLES=score BY grp2 /FORMAT=NOLIST TOTAL /CELLS=COUNT MEAN STDDEV.

OLAP CUBES score BY grp2 /CELLS=COUNT MEAN STDDEV.

* ── Wave 3: the Advanced/model family ──────────────────────────────────────
* Still appended last, for the same first-match reason as wave 2.

FACTOR /VARIABLES=q1 q2 q3 q4 q5 /ANALYSIS=q1 q2 q3 q4 q5
  /PRINT=INITIAL EXTRACTION /CRITERIA=MINEIGEN(1) ITERATE(25)
  /EXTRACTION=PC /ROTATION=NOROTATE.

DISCRIMINANT /GROUPS=grp2(1 2) /VARIABLES=score income age
  /ANALYSIS ALL /PRIORS EQUAL /STATISTICS=TABLE /CLASSIFY=NONMISSING POOLED.

QUICK CLUSTER q1 q2 q3 /MISSING=LISTWISE
  /CRITERIA=CLUSTER(3) MXITER(20) CONVERGE(0) /METHOD=KMEANS(NOUPDATE)
  /PRINT INITIAL ANOVA CLUSTER.

RATIO STATISTICS post WITH pre /PRINT=MEAN MEDIAN COD PRD CIN(95).

NOMREG grp3 (BASE=LAST ORDER=ASCENDING) WITH score age
  /MODEL /PRINT=PARAMETER SUMMARY LRT.

PLUM grp3 WITH score age /LINK=LOGIT /PRINT=PARAMETER SUMMARY FIT.

SURVIVAL TABLE=surv BY grp2(1 2) /INTERVAL=THRU 24 BY 6
  /STATUS=evt(1) /PRINT=TABLE.

MVA VARIABLES=score income post /TTEST PROB PERCENT=1.

GLM score BY grp3 grp4 /DESIGN=grp3 grp4 grp3*grp4
  /PRINT=DESCRIPTIVE /INTERCEPT=INCLUDE.

GLM pre post BY grp2 /DESIGN=grp2 /PRINT=DESCRIPTIVE.

MIXED score BY grp3 /FIXED=grp3 | SSTYPE(3) /METHOD=REML
  /PRINT=SOLUTION.

* ── Wave 4: the last of the procedures the probe says SPSS can run here ─────

* BASE=FIRST to match our reference category (wave 3 used BASE=LAST).
NOMREG grp3 (BASE=FIRST ORDER=ASCENDING) WITH score age
  /MODEL /PRINT=PARAMETER SUMMARY.

* Ungrouped, so it lines up with our life table (the earlier one is BY grp2).
SURVIVAL TABLE=surv /INTERVAL=THRU 24 BY 6 /STATUS=evt(1) /PRINT=TABLE.

GENLIN q1 WITH score age
  /MODEL score age DISTRIBUTION=POISSON LINK=LOG
  /PRINT SOLUTION FIT.

GENLIN q1 WITH score
  /MODEL score DISTRIBUTION=NORMAL LINK=IDENTITY
  /REPEATED SUBJECT=grp3 CORRTYPE=EXCHANGEABLE
  /PRINT SOLUTION.

GLM pre post /WSFACTOR=timepoint 2 Polynomial /WSDESIGN=timepoint.

CLUSTER q1 q2 q3 /METHOD BAVERAGE /MEASURE=SEUCLID /PRINT SCHEDULE.

PROXIMITIES q1 q2 q3 /VIEW=VARIABLE /MEASURE=EUCLID /PRINT PROXIMITIES.

MULT RESPONSE /GROUPS=dset (d1 d2 d3 (1)) /FREQUENCIES=dset.

TREE disease [n] BY score [s] age [s]
  /METHOD TYPE=CRT /GROW MAXDEPTH=3 MINPARENT=20 MINCHILD=7
  /TREE DISPLAY=NONE /PRINT RISK CLASSIFICATION.

* ── Wave 5: sub-dialog options ─────────────────────────────────────────────
* Everything so far exercised each procedure's DEFAULT output. These runs turn
* on the option sets the Statistics / Cells / Post Hoc sub-dialogs offer, which
* is where a silently-dropped switch would hide.

* 2x2 for the statistics that need one (risk, McNemar, kappa). NOT grp2 BY
* grp4: both are rep(c(1,2)) over the same rows, so they are the SAME variable
* and every measure came back 1.000 — the fixture-collinearity trap again.
* d1 comes from q1, which owes nothing to grp2.
CROSSTABS /TABLES=d1 BY grp2
  /STATISTICS=CHISQ PHI CC LAMBDA UC BTAU CTAU GAMMA D ETA KAPPA RISK MCNEMAR
  /CELLS=COUNT EXPECTED ROW COLUMN TOTAL RESID SRESID ASRESID
  /COUNT ROUND CELL.

ONEWAY score BY grp3
  /STATISTICS HOMOGENEITY WELCH BROWNFORSYTHE
  /POSTHOC=LSD BONFERRONI SIDAK SCHEFFE TUKEY GH T2 ALPHA(0.05)
  /MISSING ANALYSIS.

EXAMINE VARIABLES=score
  /PLOT NONE /STATISTICS DESCRIPTIVES EXTREME(5) /MESTIMATORS
  /PERCENTILES(5,10,25,50,75,90,95).

MEANS TABLES=score BY grp3
  /CELLS MEAN COUNT STDDEV MEDIAN MIN MAX RANGE SUM VARIANCE KURT SKEW
  /STATISTICS ANOVA LINEARITY.

NONPAR CORR /VARIABLES=score income age /PRINT=KENDALL TWOTAIL NOSIG
  /MISSING=PAIRWISE.

FREQUENCIES VARIABLES=age /FORMAT=NOTABLE /NTILES=4.

RELIABILITY /VARIABLES=q1 q2 q3 q4 q5 /MODEL=SPLIT.

* Wave 6: WEIGHT / SPLIT FILE / FILTER, and their combinations.
* Each cell of the matrix gets its OWN alias of `score`, so the row label in
* the output identifies which cell produced it. Without that every run emits a
* table called "Descriptive Statistics" with a row called "score" and the eight
* cells are told apart only by document order — one inserted command and every
* comparison silently shifts.

COMPUTE s_w = score.
COMPUTE s_f = score.
COMPUTE s_wf = score.
COMPUTE s_s = score.
COMPUTE s_ws = score.
COMPUTE s_fs = score.
COMPUTE s_wfs = score.
COMPUTE a_w = age.
EXECUTE.

* SPLIT FILE needs the file sorted on the split variable; unsorted, SPSS
* starts a new group at every change of grp2 and every "group" holds one case.
SORT CASES BY grp2.

* W: weight only.
WEIGHT BY wt.
DESCRIPTIVES VARIABLES=s_w
  /STATISTICS=MEAN STDDEV VARIANCE SEMEAN MIN MAX SUM SKEWNESS KURTOSIS.
FREQUENCIES VARIABLES=a_w /FORMAT=NOTABLE
  /STATISTICS=MEAN MEDIAN STDDEV SUM /PERCENTILES=25 75.
T-TEST GROUPS=grp2(1 2) /VARIABLES=score /CRITERIA=CI(.95).
ONEWAY score BY grp3 /STATISTICS DESCRIPTIVES.
CROSSTABS /TABLES=d1 BY grp2 /STATISTICS=CHISQ /CELLS=COUNT.
MEANS TABLES=score BY grp3 /CELLS MEAN COUNT STDDEV.
NPAR TESTS /BINOMIAL(0.5)=d1.
WEIGHT OFF.

* F: filter only.
FILTER BY keep.
DESCRIPTIVES VARIABLES=s_f /STATISTICS=MEAN STDDEV VARIANCE MIN MAX SUM.
T-TEST GROUPS=grp2(1 2) /VARIABLES=score /CRITERIA=CI(.95).
FILTER OFF.

* S: split only.
SPLIT FILE SEPARATE BY grp2.
DESCRIPTIVES VARIABLES=s_s /STATISTICS=MEAN STDDEV MIN MAX.
SPLIT FILE OFF.

* W+F.
WEIGHT BY wt.
FILTER BY keep.
DESCRIPTIVES VARIABLES=s_wf /STATISTICS=MEAN STDDEV VARIANCE SUM.
FILTER OFF.
WEIGHT OFF.

* W+S.
WEIGHT BY wt.
SPLIT FILE SEPARATE BY grp2.
DESCRIPTIVES VARIABLES=s_ws /STATISTICS=MEAN STDDEV SUM.
SPLIT FILE OFF.
WEIGHT OFF.

* F+S.
FILTER BY keep.
SPLIT FILE SEPARATE BY grp2.
DESCRIPTIVES VARIABLES=s_fs /STATISTICS=MEAN STDDEV SUM.
SPLIT FILE OFF.
FILTER OFF.

* W+F+S.
WEIGHT BY wt.
FILTER BY keep.
SPLIT FILE SEPARATE BY grp2.
DESCRIPTIVES VARIABLES=s_wfs /STATISTICS=MEAN STDDEV SUM.
SPLIT FILE OFF.
FILTER OFF.
WEIGHT OFF.
