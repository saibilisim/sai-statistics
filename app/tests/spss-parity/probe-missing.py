# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Probe: which /MISSING spellings does SPSS 26 accept per procedure?
#   "C:\Program Files (x86)\IBM\SPSS\Statistics\26\statisticspython3.bat" probe-missing.py
import os
try:
    import PyInvokeSpss
    PyInvokeSpss.GetCLocale = lambda: ("C",)
except Exception:
    pass
import spss

HERE = os.path.dirname(os.path.abspath(__file__))
JOB = os.path.join(HERE, "job-missing.sps").replace("\\", "/")

# Load the data once (GET DATA preamble of the job, up to the first procedure).
spss.Submit("SET DECIMAL=DOT.")
spss.Submit("""GET DATA /TYPE=TXT
  /FILE='%s'
  /DELIMITERS="," /QUALIFIER='"' /FIRSTCASE=2
  /VARIABLES=id F8.0 score F8.2 income F8.0 age F8.0 grp2 F8.0 grp3 F8.0
             region A8 pre F8.2 post F8.2 q1 F8.0 q2 F8.0 q3 F8.0 q4 F8.0
             q5 F8.0 surv F8.2 evt F8.0 disease F8.0 grp4 F8.0
             d1 F8.0 d2 F8.0 d3 F8.0 wt F8.0 keep F8.0.""" % os.path.join(HERE, "data.csv").replace("\\", "/"))

PROBES = [
    ("T-TEST one-sample", "T-TEST /TESTVAL=50 /VARIABLES=score income /MISSING=LISTWISE."),
    ("T-TEST paired", "T-TEST PAIRS=pre score WITH post income (PAIRED) /MISSING=LISTWISE."),
    ("T-TEST ind", "T-TEST GROUPS=grp2(1 2) /VARIABLES=score income /MISSING=LISTWISE."),
    ("ONEWAY", "ONEWAY score income BY grp3 /STATISTICS DESCRIPTIVES /MISSING LISTWISE."),
    ("MEANS eq", "MEANS TABLES=score income BY grp3 /MISSING=LISTWISE."),
    ("MEANS space", "MEANS TABLES=score income BY grp3 /MISSING LISTWISE."),
    ("CORRELATIONS", "CORRELATIONS /VARIABLES=score income age /MISSING=LISTWISE."),
    ("EXAMINE", "EXAMINE VARIABLES=score income BY grp3 /PLOT NONE /MISSING=LISTWISE."),
    ("NPAR M-W", "NPAR TESTS /M-W= score income BY grp2(1 2) /MISSING LISTWISE."),
    ("NPAR K-W", "NPAR TESTS /K-W=score income BY grp3(1 3) /MISSING LISTWISE."),
    ("NPAR WILCOXON", "NPAR TESTS /WILCOXON=pre score WITH post income (PAIRED) /MISSING LISTWISE."),
    ("SUMMARIZE eq", "SUMMARIZE /TABLES=score income BY grp3 /FORMAT=NOLIST /CELLS=COUNT MEAN /MISSING=LISTWISE."),
    ("SUMMARIZE table", "SUMMARIZE /TABLES=score income BY grp3 /FORMAT=NOLIST /CELLS=COUNT MEAN /MISSING=TABLE."),
    ("OLAP eq", "OLAP CUBES score income BY grp3 /CELLS=COUNT MEAN /MISSING=LISTWISE."),
]
for name, cmd in PROBES:
    try:
        spss.Submit(cmd)
        print("OK   ", name)
    except Exception as e:
        print("FAIL ", name, "|", str(e).strip().split("\n")[0][:100])
spss.StopSPSS()
