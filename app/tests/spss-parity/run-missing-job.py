# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Runs job-missing.sps through the SPSS backend WITHOUT the Java UI, capturing
# every pivot as OXML. Same route as run-ui-job.py (the .spj/production route
# dies on this machine with "cannot open system clipboard").
#
#   "C:\Program Files (x86)\IBM\SPSS\Statistics\26\statisticspython3.bat" run-missing-job.py
#
# Output: missing-job-output.xml (read by extract-tables-oxml.cjs).
import os
import sys

# The SPSS Python bootstrap reads the C locale through PyInvokeSpss; under a
# Turkish Windows locale that call returns bytes cp1254 can't decode and the
# whole session dies before Submit. Pin it to C.
try:
    import PyInvokeSpss
    PyInvokeSpss.GetCLocale = lambda: ("C",)
except Exception:
    pass

import spss

HERE = os.path.dirname(os.path.abspath(__file__))
JOB = os.path.join(HERE, "job-missing.sps").replace("\\", "/")
OUT = os.path.join(HERE, "missing-job-output.xml").replace("\\", "/")

if os.path.exists(OUT):
    os.remove(OUT)

spss.Submit("OMS /SELECT ALL /DESTINATION FORMAT=OXML OUTFILE='%s' VIEWER=NO." % OUT)
spss.Submit("INSERT FILE='%s'." % JOB)
spss.Submit("OMSEND.")
spss.StopSPSS()
print("missing-job-output.xml written" if os.path.exists(OUT) else "OUTPUT MISSING")
