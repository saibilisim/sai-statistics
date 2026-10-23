* UI-driven parity job — written by e2e-ui-syntax.cjs; do not edit by hand.
* Each command below is the Paste-Syntax output of a dialog driven through
* the real menu channel. SPSS 27+ procedures — run against SPSS 32.
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
* scenario: proportions-one-disease.
PROPORTIONS
  /ONESAMPLE disease TESTVAL=0.5
  /SUCCESS VALUE=LEVEL(1)
  /CRITERIA CILEVEL=95.

* scenario: glmm-disease-score-grp3.
GENLINMIXED
  /FIELDS TARGET=disease
  /TARGET_OPTIONS DISTRIBUTION=BINOMIAL LINK=LOGIT
  /FIXED EFFECTS=score USE_INTERCEPT=TRUE
  /RANDOM USE_INTERCEPT=TRUE SUBJECTS=grp3 COVARIANCE_TYPE=VARIANCE_COMPONENTS
  /BUILD_OPTIONS TARGET_CATEGORY_ORDER=DESCENDING.

* scenario: roc-analysis-score-disease.
ROC ANALYSIS score BY disease(1)
  /CRITERIA CUTOFF=INCLUDE TESTPOS=LARGE DISTRIBUTION=FREE CI=95.

* scenario: power-onesample.
POWER MEANS INDEPENDENT
  /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=0.05 N=30 30 ES=0.5.
