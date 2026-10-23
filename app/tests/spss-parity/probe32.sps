* One-sample Bayes factor, with DISTRIBUTION as the grammar requires. Comments end with a period.

SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

FORMATS score income age pre post surv (F14.6).

* One-sample, normal likelihood, null value 50.
BAYES ONESAMPLE /INFERENCE DISTRIBUTION=NORMAL VARIABLES=score ANALYSIS=BAYESFACTOR /DATA NULLVALUE=50.

* Independent samples again, so the exact figure is in this same output.
BAYES INDEPENDENT /INFERENCE VARIABLES=score GROUP=grp2 SELECT=LEVEL(1 2) ANALYSIS=BAYESFACTOR /ESTBF COMPUTATION=ROUDER.

* Regression again.
BAYES REGRESSION score WITH age /INFERENCE ANALYSIS=BAYESFACTOR.
