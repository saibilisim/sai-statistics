# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Runs ui-job32.sps — the SPSS 27+ procedures of the UI harness — through the
# SPSS 32 backend, capturing every pivot as OXML. Same headless route as
# run-ui-job.py, which targets the SPSS 26 install for everything else (that
# version is the numeric baseline and is deliberately not re-run on 32).
#
#   "C:\Program Files\IBM\SPSS Statistics\statisticspython3.bat" run-ui-job32.py
#
# Output: ui-job32-output.xml (read by extract-tables-oxml.cjs).
import os

import spss

# Same Turkish-locale guard as run-ui-job.py: the SPSS Python bootstrap reads
# the C locale through PyInvokeSpss and under tr-TR that call returns bytes
# UTF-8 cannot decode, so Submit dies before running anything.
#
# SPSS 32 needs a different handle than 26: `import PyInvokeSpss` raises
# ModuleNotFoundError here (it is not on sys.path as a top-level module), so
# the 26 script's try/except swallowed the patch and Submit still died. The
# binding actually used lives in the spss.spss submodule's namespace.
from spss import spss as _spss_impl

_spss_impl.PyInvokeSpss.GetCLocale = lambda: ("C",)

HERE = os.path.dirname(os.path.abspath(__file__))
JOB = os.path.join(HERE, "ui-job32.sps").replace("\\", "/")
OUT = os.path.join(HERE, "ui-job32-output.xml").replace("\\", "/")

if os.path.exists(OUT):
    os.remove(OUT)

spss.Submit("OMS /SELECT ALL /DESTINATION FORMAT=OXML OUTFILE='%s' VIEWER=NO." % OUT)
spss.Submit("INSERT FILE='%s'." % JOB)
spss.Submit("OMSEND.")
spss.StopSPSS()
print("ui-job32-output.xml written" if os.path.exists(OUT) else "OUTPUT MISSING")
