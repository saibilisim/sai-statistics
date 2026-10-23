# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
"""Generates tests/py-parity/data.csv — the dataset e2e-analysis-pyparity.cjs
analyses through the app's menus and reference.py recomputes in Python.

Same columns as tests/spss-parity/data.csv (so the shared dialog scenarios in
tests/e2e/lib/ui-dialog-driver.cjs apply unchanged), but a different, larger
sample: 200 cases, real relationships between the variables, tied values and
missing cells in score / income / age / post, so listwise vs pairwise and tie
corrections actually matter. Fixed seed: rerunning gives the same file.

Run: python tests/py-parity/gen_data.py
"""
import csv
import os

import numpy as np

rng = np.random.default_rng(20261018)
n = 200

grp2 = rng.integers(1, 3, n)
grp3 = rng.integers(1, 4, n)
grp4 = rng.integers(1, 5, n)
region = rng.choice(["North", "South", "East", "West"], n)
age = rng.integers(18, 71, n).astype(float)
# score: depends on group, rounded to 1 decimal so there are ties
score = np.round(50 + 4 * (grp3 - 2) + 0.15 * (age - 45) + rng.normal(0, 10, n), 1)
income = np.round(20000 + 350 * score + 180 * age + rng.normal(0, 6000, n), 0)
pre = np.round(rng.normal(100, 15, n), 2)
post = np.round(pre + 3 + rng.normal(0, 6, n), 2)
# Likert items sharing a latent trait (reliability / factor / Friedman)
trait = rng.normal(0, 1, n)
q = [np.clip(np.round(3 + 0.9 * trait + rng.normal(0, 0.9, n) + d), 1, 5) for d in (0, 0.2, -0.2, 0.4, 0)]
lin = -6 + 0.11 * score
disease = (rng.random(n) < 1 / (1 + np.exp(-lin))).astype(int)
hazard = 0.05 * np.exp(0.03 * (score - 50) + 0.01 * (age - 45))
t_event = rng.exponential(1 / hazard)
t_cens = rng.uniform(5, 40, n)
surv = np.round(np.minimum(t_event, t_cens), 2)
evt = (t_event <= t_cens).astype(int)
d = [(rng.random(n) < p).astype(int) for p in (0.5, 0.35, 0.6)]
wt = rng.integers(1, 4, n)
keep = (rng.random(n) < 0.8).astype(int)


def blank(arr, idx):
    out = arr.astype(object)
    out[idx] = ""
    return out


score_o = blank(score, rng.choice(n, 8, replace=False))
income_o = blank(income, rng.choice(n, 10, replace=False))
age_o = blank(age, rng.choice(n, 5, replace=False))
post_o = blank(post, rng.choice(n, 6, replace=False))

cols = {
    "id": np.arange(1, n + 1),
    "score": score_o,
    "income": income_o,
    "age": age_o,
    "grp2": grp2,
    "grp3": grp3,
    "region": region,
    "pre": pre,
    "post": post_o,
    "q1": q[0], "q2": q[1], "q3": q[2], "q4": q[3], "q5": q[4],
    "surv": surv,
    "evt": evt,
    "disease": disease,
    "grp4": grp4,
    "d1": d[0], "d2": d[1], "d3": d[2],
    "wt": wt,
    "keep": keep,
}


def fmt(v):
    if v == "":
        return ""
    if isinstance(v, (float, np.floating)):
        return str(int(v)) if float(v).is_integer() else repr(round(float(v), 4))
    return str(v)


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.csv")
with open(out, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(cols.keys())
    for i in range(n):
        w.writerow([fmt(c[i]) for c in cols.values()])
print(f"wrote {out} ({n} rows)")
