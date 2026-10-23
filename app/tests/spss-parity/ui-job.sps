* UI-driven parity job — written by e2e-ui-syntax.cjs; do not edit by hand.
* Each command below is the Paste-Syntax output of a dialog driven through
* the real menu channel. Same data and import as job.sps.
SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

* Enough decimals that comparisons are not limited by the display format.
FORMATS score income age pre post surv (F14.6).
* scenario: frequencies-age.
FREQUENCIES VARIABLES=age
  /STATISTICS=MEAN STDDEV MINIMUM MAXIMUM.

* scenario: crosstabs-grp3-disease.
CROSSTABS /TABLES=grp3 BY disease
  /STATISTICS=CHISQ PHI
  /CELLS=COUNT EXPECTED.

* scenario: ttest-ind-score-income.
T-TEST GROUPS=grp2(1 2) /VARIABLES=score income.

* scenario: ttest1-score-income.
T-TEST /TESTVAL=50 /VARIABLES=score income.

* scenario: ttest-paired.
T-TEST PAIRS=pre score WITH post income (PAIRED).

* scenario: means-score-income-grp3.
MEANS TABLES=score income BY grp3
  /CELLS=COUNT MEAN MEDIAN MIN MAX STDDEV.

* scenario: descriptives-score-income.
DESCRIPTIVES VARIABLES=score income
  /STATISTICS=MEAN STDDEV VARIANCE RANGE MINIMUM MAXIMUM.

* scenario: correlate-spearman.
NONPAR CORR VARIABLES=score income age
  /PRINT=SPEARMAN.

* scenario: oneway-score-income-grp3.
ONEWAY score income BY grp3
  /STATISTICS=HOMOGENEITY WELCH
  /POSTHOC=TUKEY ALPHA(0.05).

* scenario: regression-linear.
REGRESSION
  /STATISTICS COEFF OUTS R ANOVA COLLIN TOL
  /DEPENDENT=income
  /METHOD=ENTER score age
  /RESIDUALS DURBIN.

* scenario: npar-chisquare-grp3.
NPAR TESTS /CHISQUARE=grp3.

* scenario: npar-binomial-disease.
NPAR TESTS /BINOMIAL(0.5)=disease.

* scenario: npar-ks-score.
NPAR TESTS /K-S(NORMAL)=score.

* scenario: npar-runs-score.
NPAR TESTS /RUNS(MEDIAN)=score.

* scenario: npar-mw-score-income.
NPAR TESTS /M-W=score income BY grp2(1 2) /STATISTICS=DESCRIPTIVES QUARTILES.

* scenario: npar-wilcoxon-pairs.
NPAR TESTS /WILCOXON=pre score WITH post income (PAIRED).

* scenario: npar-kw-score-income.
NPAR TESTS /K-W=score income BY grp3(1 99)
  /STATISTICS=DESCRIPTIVES QUARTILES.

* scenario: npar-friedman-q1-q5.
NPAR TESTS /FRIEDMAN=q1 q2 q3 q4 q5.

* scenario: reliability-q1-q5.
RELIABILITY /VARIABLES=q1 q2 q3 q4 q5
  /MODEL=ALPHA
  /STATISTICS=DESCRIPTIVE SCALE.

* scenario: partial-corr-score-income-age.
PARTIAL CORR /VARIABLES=score income BY age.

* scenario: case-summaries-score-income-grp3.
SUMMARIZE /TABLES=score income BY grp3
  /FORMAT=LIST TOTAL LIMIT=100
  /CELLS=COUNT MEAN STDDEV.

* scenario: olap-cubes-score-income-grp3.
OLAP CUBES /VARIABLES=score income BY grp3
  /CELLS=COUNT MEAN SUM STDDEV NPCT SPCT.

* scenario: ratio-income-score-grp3.
RATIO STATISTICS income WITH score BY grp3
  /PRINT=MEDIAN MEAN WGTMEAN MIN MAX RANGE COD PRD MDCOV MNCOV.

* scenario: roc-score-disease.
ROC score BY disease(1)
  /PLOT=CURVE(REFERENCE)
  /PRINT=SE
  /CRITERIA=CUTOFF(INCLUDE) TESTPOS(LARGE) DISTRIBUTION(FREE) CI(95)
  /MISSING=EXCLUDE.

* scenario: curve-income-score.
CURVEFIT /VARIABLES=income WITH score
  /CONSTANT
  /MODEL=LINEAR
  /PLOT FIT.

* scenario: logistic-disease-score-age.
LOGISTIC REGRESSION VARIABLES=disease
  /METHOD=ENTER score age
  /CRITERIA=CUT(.5) ITERATE(20).

* scenario: glm-uni-score-grp3.
UNIANOVA score BY grp3
  /METHOD=SSTYPE(3)
  /INTERCEPT=INCLUDE
  /DESIGN=grp3.

* scenario: factor-q1-q5.
FACTOR /VARIABLES=q1 q2 q3 q4 q5
  /MISSING LISTWISE
  /ANALYSIS q1 q2 q3 q4 q5
  /PRINT INITIAL EXTRACTION ROTATION
  /CRITERIA MINEIGEN(1) ITERATE(25)
  /EXTRACTION PC
  /ROTATION NOROTATE
  /METHOD=CORRELATION.

* scenario: discriminant-grp2-score-age.
DISCRIMINANT /GROUPS=grp2(1 99)
  /VARIABLES=score age
  /ANALYSIS ALL
  /PRIORS EQUAL
  /STATISTICS=TABLE
  /CLASSIFY=NONMISSING POOLED.

* scenario: kmeans-score-age.
QUICK CLUSTER score age
  /MISSING=LISTWISE
  /CRITERIA=CLUSTER(2) MXITER(10) CONVERGE(0)
  /METHOD=KMEANS(NOUPDATE)
  /PRINT INITIAL ANOVA.

* scenario: hierarchical-q1-q3.
CLUSTER q1 q2 q3
  /METHOD WARD
  /MEASURE=SEUCLID
  /PRINT SCHEDULE.

* scenario: distances-q1-q3.
PROXIMITIES q1 q2 q3
  /VIEW=VARIABLE
  /MEASURE=EUCLID
  /PRINT PROXIMITIES
  /STANDARDIZE=NONE.

* scenario: km-surv-evt-grp2.
KM surv BY grp2
  /STATUS=evt(1)
  /PRINT MEAN
  /PLOT SURVIVAL
  /COMPARE OVERALL POOLED LOGRANK.

* scenario: cox-surv-evt-score-age.
COXREG surv
  /STATUS=evt(1)
  /METHOD=ENTER score age
  /PRINT=CI(95)
  /CRITERIA=PIN(.05) POUT(.1) ITERATE(20).

* scenario: glm-multi-score-income-grp3.
GLM score income BY grp3
  /METHOD=SSTYPE(3)
  /INTERCEPT=INCLUDE
  /CRITERIA=ALPHA(.05)
  /DESIGN=grp3.

* scenario: glm-repeated-q1-q3.
GLM q1 q2 q3
  /WSFACTOR=factor1 3 Polynomial
  /METHOD=SSTYPE(3)
  /CRITERIA=ALPHA(.05)
  /WSDESIGN=factor1.

* scenario: mult-response-d1-d3.
MULT RESPONSE /GROUPS=saiset(d1 d2 d3 (1))
  /FREQUENCIES=saiset.

* scenario: multinomial-grp3-score-age.
NOMREG grp3 (BASE=FIRST ORDER=ASCENDING) BY score age
  /INTERCEPT=INCLUDE
  /MODEL
  /CRITERIA=CIN(95) MXITER(100) MXSTEP(5) LCONVERGE(0) PCONVERGE(0.000001) SINGULAR(1e-8) DELTA(0) CHKSEP(20)
  /STEPWISE=PIN(0.05) POUT(0.1) ENTRYMETHOD(LR) REMOVALMETHOD(LR) MINEFFECT(0) RULE(SINGLE)
  /SCALE=1
  /PRINT=CPS SUMMARY STEP MFI PARAMETER LRT.

* scenario: ordinal-grp3-score-age.
PLUM grp3 WITH score age
  /LINK=LOGIT
  /CRITERIA=CIN(95) DELTA(0) MXITER(100) MXSTEP(5) LCONVERGE(0) PCONVERGE(0.000001) SINGULAR(1e-8)
  /PRINT=FIT PARAMETER SUMMARY.

* scenario: probit-disease-score.
PROBIT disease OF score WITH age
  /MODEL=PROBIT
  /TRANSFORM=NONE
  /PRINT=FREQ CI
  /NATRES=NONE
  /CRITERIA=ITERATE(20) SIG(0.15).

* scenario: lifetables-surv-evt.
SURVIVAL TABLE=surv
  /INTERVAL=THRU 100 BY 5
  /STATUS=evt(1)
  /PRINT=TABLE.

* scenario: mixed-score-age-grp3.
MIXED score WITH age
  /CRITERIA=CIN(95)
  /FIXED=age | SSTYPE(3)
  /METHOD=REML
  /PRINT=SOLUTION
  /RANDOM=INTERCEPT | SUBJECT(grp3) COVTYPE(VC).

* scenario: genlin-evt-score-age.
GENLIN evt WITH score age
  /MODEL score age INTERCEPT=YES DISTRIBUTION=POISSON LINK=LOG
  /CRITERIA METHOD=FISHER(1) CILEVEL=95
  /PRINT SOLUTION.

* scenario: mva-score-income-post.
MVA VARIABLES=score income post
  /MPATTERN.

* scenario: knn-disease-score-age.
KNN disease WITH score age
  /MODEL NEIGHBORS=FIXED(K=5).

* scenario: tree-disease-score-age.
TREE disease [n] BY score [s] age [s]
  /GROWTHLIMIT MAXDEPTH=3 MINPARENTSIZE=20 MINCHILDSIZE=10
  /METHOD TYPE=CRT.

* scenario: gee-score-age-grp3.
GENLIN score WITH age
  /MODEL age INTERCEPT=YES DISTRIBUTION=NORMAL LINK=IDENTITY
  /REPEATED SUBJECT=grp3 CORRTYPE=EXCHANGEABLE
  /PRINT SOLUTION.

* scenario: mds-q1-q3.
ALSCAL VARIABLES=q1 q2 q3
  /SHAPE=SYMMETRIC
  /LEVEL=INTERVAL
  /CRITERIA=DIMENS(2).

* scenario: mi-score-income.
DATASET DECLARE saiimp.
MULTIPLE IMPUTATION score income
  /IMPUTE METHOD=AUTO NIMPUTATIONS=5
  /OUTFILE IMPUTATIONS=saiimp.

* scenario: report-rows-score-grp3.
REPORT /FORMAT=LIST AUTOMATIC
  /VARIABLES=score
  /BREAK=grp3
  /SUMMARY=MEAN.

* scenario: report-columns-score-grp3.
REPORT /FORMAT=AUTOMATIC
  /VARIABLES=score
  /BREAK=grp3
  /SUMMARY=MEAN.

* scenario: chart-histogram-score.
GRAPH /HISTOGRAM=score.

* scenario: explore-score-income-grp3.
EXAMINE VARIABLES=score income BY grp3
  /STATISTICS DESCRIPTIVES EXTREME
  /PERCENTILES
  /PLOT BOXPLOT HISTOGRAM
  /MISSING=LISTWISE.
