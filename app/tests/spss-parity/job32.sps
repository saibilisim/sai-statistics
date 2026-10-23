* SPSS 32 reference run — the procedures SPSS 26 does not have.
*
* Kept separate from job.sps on purpose. job.sps is the SPSS 26 reference and
* its numbers are the ones 661 comparisons are pinned to; re-running it on a
* different version would silently move that baseline. This file only adds what
* 26 could not do: the SPSS 27+ procedures.
*
* Every comment here ends with a period. An SPSS comment is a COMMAND that runs
* to its terminating '.', not to end of line, so a banner without one swallows
* the command on the next line and it never runs.

SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

FORMATS score income age pre post surv (F14.6).

* One-Sample Proportions: d1, success = 1, against the default test value .5.
PROPORTIONS /ONESAMPLE d1 /SUCCESS VALUE=LEVEL(1).

* Independent-Samples Proportions: d1 by grp2.
PROPORTIONS /INDEPENDENTSAMPLES d1 BY grp2 /SUCCESS VALUE=LEVEL(1).

* Paired-Samples Proportions: d1 against d2 on the same cases.
PROPORTIONS /PAIREDSAMPLES d1 d2 /SUCCESS VALUE=LEVEL(1).

* ROC ANALYSIS, the 27+ procedure, with the standard error and interval.
ROC ANALYSIS score BY disease(1) /PRINT SE.

* ROC ANALYSIS again, asking for the coordinate points as well.
ROC ANALYSIS score BY disease(1) /PRINT SE COORDINATES.

* Bayesian independent-samples t test, Rouder's method — the JZS Bayes factor,
* the same family BayesFactor::ttestBF computes. Comparable once the prior width
* matches: SPSS's Rouder default is r = 1, our "wide".
BAYES INDEPENDENT /INFERENCE VARIABLES=score GROUP=grp2 SELECT=LEVEL(1 2)
  ANALYSIS=BAYESFACTOR /ESTBF COMPUTATION=ROUDER.

* Bayesian linear regression, JZS. Also r = 1 on the standardized coefficient.
BAYES REGRESSION score WITH age /INFERENCE ANALYSIS=BAYESFACTOR.

* Bayesian correlation and Bayesian ANOVA are run here too, but only so the
* numbers are on record: no prior width reproduces them (see README), so
* compare.R does not assert on them.
BAYES CORRELATION /INFERENCE VARIABLES=score income ANALYSIS=BAYESFACTOR /ESTBF TYPE=JZS.

BAYES ANOVA score BY grp3 /INFERENCE ANALYSIS=BAYESFACTOR /ESTBF COMPUTATION=ROUDER.
