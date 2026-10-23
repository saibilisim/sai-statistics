* Extension run for SPSS 32. Comments end with a period.
* Round 2: paired Bayes is BAYES RELATED; POWER gets its ES parameter.

SET DECIMAL=DOT.

GET DATA /TYPE=TXT
  /FILE='C:\path\to\sai-statistics\app\tests\spss-parity\data.csv'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.

FORMATS score income age pre post surv (F14.6).

* Bayes one-sample t against 50. This one already ran clean in round 1; kept
* so the reference value and the paired run land in the same output file.
BAYES ONESAMPLE /INFERENCE DISTRIBUTION=NORMAL VARIABLES=score ANALYSIS=BAYESFACTOR
  /DATA VARIABLES=score NULLVALUE=50.

* Bayesian paired-samples t, Rouder JZS like the independent-samples run.
BAYES RELATED /INFERENCE ANALYSIS=BAYESFACTOR /PAIR VARIABLES=pre post NULLVALUE=0.

* Power given N and d, and required N given power: one-sample and
* independent-samples means.
POWER MEANS ONESAMPLE
  /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=0.05 N=30 ES=0.5.
POWER MEANS ONESAMPLE
  /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=0.05 POWER=0.8 ES=0.5.
POWER MEANS INDEPENDENT
  /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=0.05 N=30 ES=0.5.
POWER MEANS INDEPENDENT
  /PARAMETERS TEST=NONDIRECTIONAL SIGNIFICANCE=0.05 POWER=0.8 ES=0.5.
