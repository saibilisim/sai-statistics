* Probe round 2: the commands round 1 rejected, with corrected syntax.
* Round 1 established that no MODULE is missing — every command was recognised,
* so each failure below was a syntax error of mine, not a licensing wall.

SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0.

FORMATS score income age pre post surv (F14.6).

KNN score BY grp2 WITH age income /NEIGHBORS FIXED=3.
KNN score BY grp2 WITH age income /MODEL METRIC=EUCLID.
BAYES INDEPENDENT /VARIABLES GROUPVAR=grp2 GROUPVALUE=1 2 TESTVARS=score /CRITERIA CILEVEL=95.
BAYES ONESAMPLE /VARIABLES=score /CRITERIA CILEVEL=95.
BAYES CORRELATION /VARIABLES=score income /CRITERIA CILEVEL=95.
BAYES PAIRED /PAIRS pre WITH post /CRITERIA CILEVEL=95.
