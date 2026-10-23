# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
"""Recomputes the Analyze-menu results of e2e-analysis-pyparity.cjs in Python
and compares them with what SAI showed, cell by cell.

    python tests/py-parity/reference.py <data.csv> <pyparity-sai.json>

The reference side is deliberately independent of our R scripts: scipy,
statsmodels and textbook formulas. A SAI value is "equal" when it agrees with
the Python value to the precision SAI displays it (a value shown as 0.579 is
compared to 3 decimals), or to 1e-6 relative for full-precision values. A
p-value SAI shows as 0 must be below 0.001. Iteratively fitted models (logit,
GLM, ordinal, multinomial, mixed, GEE, Cox) are compared to 1e-4 relative:
R and statsmodels stop at different convergence criteria (SPSS's own default,
a parameter change below 0.001, is looser than either).

Where SAI follows a convention the Python libraries don't, the reference is
written to that convention, with the reason next to it: Levene on SPSS's
fractionally 5%-trimmed mean, the SPSS approximation of Hotelling-Lawley's F,
Efron ties in Cox (R's default, documented in survival-cox.R), PLUM/NOMREG's
-2LL kernel (compared through the model chi-square, which it cancels out of).

Exit status 1 when any comparison fails. Scenarios without a Python
counterpart (k-means, trees, KNN, multiple imputation, …: random or
algorithm-specific) are listed as not compared.
"""
import json
import math
import sys
import warnings
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import statsmodels.formula.api as smf

warnings.filterwarnings("ignore")

DATA = pd.read_csv(sys.argv[1])
RES = {r["id"]: r for r in json.load(open(sys.argv[2], encoding="utf-8"))}

failures, passes, notes = [], 0, []


# ── comparison helpers ─────────────────────────────────────────────────────


def decimals(v):
    """Decimals SAI showed. 0.000025 arrives as 2.5e-05 — 6 decimals, not 12."""
    s = format(float(v), ".12f").rstrip("0")
    return len(s.split(".")[1]) if "." in s else 0


def close(sai, ref, p=False, rel=1e-6):
    if sai is None or sai == "" or isinstance(sai, str) and not _num(sai):
        return False
    sai = float(str(sai).replace("*", "")) if isinstance(sai, str) else float(sai)
    if ref is None or (isinstance(ref, float) and math.isnan(ref)):
        return False
    ref = float(ref)
    if p and sai == 0:
        return ref < 0.001
    d = decimals(sai)
    tol = 0.5 * 10 ** (-d) * 1.02 if d < 7 else 0
    return abs(sai - ref) <= max(tol, rel * abs(ref), 1e-12)


def _num(s):
    try:
        float(str(s).replace("*", ""))
        return True
    except ValueError:
        return False


def check(scn, what, sai, ref, p=False, rel=1e-6):
    global passes
    if close(sai, ref, p=p, rel=rel):
        passes += 1
    else:
        failures.append(f"{scn}: {what}: SAI={sai!r} Python={ref!r}")


def tables(scn, prefix):
    r = RES.get(scn)
    if not r:
        return []
    return [t for t in r["tables"] if t["titleKey"] == prefix or t["titleKey"].startswith(prefix + ":")
            or t["titleKey"].startswith(prefix)]


def table(scn, prefix, nth=0):
    ts = tables(scn, prefix)
    if len(ts) <= nth:
        failures.append(f"{scn}: table {prefix!r} missing")
        return None
    return ts[nth]


def carried(t):
    """Rows with blank leading label cells filled from the row above."""
    out, prev = [], []
    for row in t["rows"]:
        row = list(row)
        for i, v in enumerate(row[:2]):
            if v in ("", None) and i < len(prev):
                row[i] = prev[i]
            else:
                break
        out.append(row)
        prev = row
    return out


def col(t, key):
    cols = t["columns"]
    for i, c in enumerate(cols):
        if c == key:
            return i
    for i, c in enumerate(cols):
        if key in str(c):
            return i
    raise KeyError(f"column {key} not in {cols}")


def row(t, *labels):
    for r in carried(t):
        if all(str(r[i]) == str(l) for i, l in enumerate(labels)):
            return r
    return None


def cell(scn, t, labels, key):
    if t is None:
        return None
    r = row(t, *labels)
    if r is None:
        failures.append(f"{scn}: row {labels} not in {t['titleKey']}")
        return None
    return r[col(t, key)]


def has(scn):
    if scn not in RES:
        notes.append(f"{scn}: not run")
        return False
    return True


D = DATA


def s(name, mask=None):
    x = D[name] if mask is None else D.loc[mask, name]
    return x.dropna().astype(float)


def sd(x):
    return float(np.std(x, ddof=1))


# ── Descriptive statistics ─────────────────────────────────────────────────

if has("frequencies-age"):
    sc = "frequencies-age"
    t = table(sc, "output.frequencies.statsTitle")
    a = s("age")
    check(sc, "N valid", cell(sc, t, ["output.stat.nValid"], "output.col.value"), len(a))
    check(sc, "N missing", cell(sc, t, ["output.stat.nMissing"], "output.col.value"), D.age.isna().sum())
    check(sc, "mean", cell(sc, t, ["output.stat.mean"], "output.col.value"), a.mean())
    check(sc, "sd", cell(sc, t, ["output.stat.sd"], "output.col.value"), sd(a))
    check(sc, "min", cell(sc, t, ["output.stat.min"], "output.col.value"), a.min())
    check(sc, "max", cell(sc, t, ["output.stat.max"], "output.col.value"), a.max())
    t = table(sc, "output.frequencies.tableTitle")
    vc = a.value_counts().sort_index()
    cum = 0
    for v, n in vc.items():
        lab = f"{v:.2f}"
        cum += n
        check(sc, f"freq {lab}", cell(sc, t, [lab], "output.col.frequency"), n)
        check(sc, f"valid% {lab}", cell(sc, t, [lab], "output.col.validPct"), 100 * n / len(a))
        check(sc, f"cum% {lab}", cell(sc, t, [lab], "output.col.cumPct"), 100 * cum / len(a))

if has("descriptives-score-income"):
    sc = "descriptives-score-income"
    t = table(sc, "output.descriptives.title")
    for v in ("score", "income"):
        x = s(v)
        check(sc, f"{v} N", cell(sc, t, [v], "output.col.n"), len(x))
        check(sc, f"{v} mean", cell(sc, t, [v], "output.col.mean"), x.mean())
        check(sc, f"{v} sd", cell(sc, t, [v], "output.col.sd"), sd(x))
        check(sc, f"{v} variance", cell(sc, t, [v], "output.col.variance"), x.var(ddof=1))
        check(sc, f"{v} range", cell(sc, t, [v], "output.col.range"), x.max() - x.min())
    check(sc, "valid N listwise", cell(sc, t, ["output.descriptives.validN"], "output.col.n"),
          D[["score", "income"]].dropna().shape[0])

if has("means-score-income-grp3"):
    sc = "means-score-income-grp3"
    for i, v in enumerate(("score", "income")):
        t = table(sc, "output.means.reportTitle", i)
        for g in (1, 2, 3):
            x = s(v, D.grp3 == g)
            check(sc, f"{v} g{g} mean", cell(sc, t, [g], "output.col.mean"), x.mean())
            check(sc, f"{v} g{g} n", cell(sc, t, [g], "output.col.n"), len(x))
            check(sc, f"{v} g{g} sd", cell(sc, t, [g], "output.col.stdDeviation"), sd(x))
            check(sc, f"{v} g{g} median", cell(sc, t, [g], "output.col.median"), x.median())

if has("explore-score-income-grp3"):
    sc = "explore-score-income-grp3"
    lw = D.dropna(subset=["score", "income"])  # Explore: listwise over the dependents
    for v in ("score", "income"):
        for g in (1, 2, 3):
            t = table(sc, f"output.explore.descTitle:{v} (grp3 = {g})")
            x = lw.loc[lw.grp3 == g, v].astype(float)
            n = len(x)
            check(sc, f"{v} g{g} n", cell(sc, t, ["output.stat.n"], "output.col.value"), n)
            check(sc, f"{v} g{g} mean", cell(sc, t, ["output.stat.mean"], "output.col.value"), x.mean())
            check(sc, f"{v} g{g} se", cell(sc, t, ["output.stat.seMean"], "output.col.value"),
                  sd(x) / math.sqrt(n))
            for key, ref in (("output.stat.median", x.median()), ("output.stat.variance", x.var(ddof=1)),
                             ("output.stat.skewness", stats.skew(x, bias=False)),
                             ("output.stat.kurtosis", stats.kurtosis(x, bias=False))):
                if t and row(t, key):
                    check(sc, f"{v} g{g} {key}", cell(sc, t, [key], "output.col.value"), ref)
        t = table(sc, f"output.explore.percentilesTitle:{v}")
        for g in (1, 2, 3):
            x = np.sort(lw.loc[lw.grp3 == g, v].astype(float).values)
            n = len(x)
            for p, key in ((5, "pct5"), (25, "pct25"), (50, "pct50"), (75, "pct75"), (95, "pct95")):
                # SPSS HAVERAGE: position (n+1)p
                pos = (n + 1) * p / 100
                k = int(math.floor(pos))
                frac = pos - k
                ref = x[0] if k < 1 else x[-1] if k >= n else x[k - 1] + frac * (x[k] - x[k - 1])
                check(sc, f"{v} g{g} P{p}", cell(sc, t, ["output.explore.pctWeightedAvg", g], key), ref)

if has("report-columns-score-grp3"):
    sc = "report-columns-score-grp3"
    t = table(sc, "output.reportColumns.title")
    for g in (1, 2, 3):
        x = s("score", D.grp3 == g)
        check(sc, f"g{g} n", cell(sc, t, [g], "output.col.n"), len(x))
        check(sc, f"g{g} mean", cell(sc, t, [g], "output.col.mean"), x.mean())
        check(sc, f"g{g} sd", cell(sc, t, [g], "output.col.sd"), sd(x))

if has("olap-cubes-score-income-grp3"):
    sc = "olap-cubes-score-income-grp3"
    t = table(sc, "output.olapCubes.title")
    for g in (1, 2, 3):
        for v in ("score", "income"):
            x = s(v, D.grp3 == g)
            tot = s(v)
            check(sc, f"{v} g{g} sum", cell(sc, t, [g, v], "output.col.sum"), x.sum())
            check(sc, f"{v} g{g} %N", cell(sc, t, [g, v], "output.col.pctTotalN"), 100 * len(x) / len(tot))
            check(sc, f"{v} g{g} %sum", cell(sc, t, [g, v], "output.col.pctTotalSum"), 100 * x.sum() / tot.sum())

if has("case-summaries-score-income-grp3"):
    sc = "case-summaries-score-income-grp3"
    t = table(sc, "output.caseSummaries.summaryTitle")
    first = D.head(100)  # SPSS SUMMARIZE lists / summarises the first 100 cases
    for g in (1, 2, 3):
        for v in ("score", "income"):
            x = first.loc[first.grp3 == g, v].dropna()
            check(sc, f"{v} g{g} n", cell(sc, t, [g, v], "output.col.n"), len(x))
            check(sc, f"{v} g{g} mean", cell(sc, t, [g, v], "output.col.mean"), x.mean())

if has("ratio-income-score-grp3"):
    sc = "ratio-income-score-grp3"
    t = table(sc, "output.ratio.title")
    for g in (1, 2, 3):
        sub = D.loc[D.grp3 == g, ["income", "score"]].dropna()
        r = sub.income / sub.score
        med = r.median()
        check(sc, f"g{g} n", cell(sc, t, [g], "output.col.n"), len(r))
        check(sc, f"g{g} median", cell(sc, t, [g], "output.ratio.median"), med)
        check(sc, f"g{g} mean", cell(sc, t, [g], "output.ratio.mean"), r.mean())
        check(sc, f"g{g} weighted mean", cell(sc, t, [g], "output.ratio.wmean"), sub.income.sum() / sub.score.sum())
        check(sc, f"g{g} COD", cell(sc, t, [g], "output.ratio.cod"), (r - med).abs().mean() / med)
        check(sc, f"g{g} PRD", cell(sc, t, [g], "output.ratio.prd"), r.mean() / (sub.income.sum() / sub.score.sum()))
        check(sc, f"g{g} COV", cell(sc, t, [g], "output.ratio.cov"), 100 * sd(r) / r.mean())

if has("mva-score-income-post"):
    sc = "mva-score-income-post"
    t = table(sc, "output.missing.uniTitle")
    for v in ("score", "income", "post"):
        x = s(v)
        check(sc, f"{v} n", cell(sc, t, [v], "output.col.n"), len(x))
        check(sc, f"{v} mean", cell(sc, t, [v], "output.col.mean"), x.mean())
        check(sc, f"{v} sd", cell(sc, t, [v], "output.col.stdDeviation"), sd(x))
        check(sc, f"{v} missing", cell(sc, t, [v], "output.missing.count"), D[v].isna().sum())

if has("mult-response-d1-d3"):
    sc = "mult-response-d1-d3"
    t = table(sc, "output.mr.title")
    resp = D[["d1", "d2", "d3"]].sum().sum()
    cases = (D[["d1", "d2", "d3"]].sum(axis=1) > 0).sum()
    for v in ("d1", "d2", "d3"):
        n = D[v].sum()
        check(sc, f"{v} n", cell(sc, t, [v], "output.col.n"), n)
        check(sc, f"{v} %responses", cell(sc, t, [v], "output.mr.pctResponses"), 100 * n / resp)
        check(sc, f"{v} %cases", cell(sc, t, [v], "output.mr.pctCases"), 100 * n / cases)

# ── Crosstabs ──────────────────────────────────────────────────────────────


def fisher_rx2(tab):
    """Fisher's exact p for an r x 2 table by full enumeration (scipy's r x c
    result is not exact). p = sum of the probabilities of all tables with the
    same margins that are no more likely than the observed one."""
    rows, c0, n = tab.sum(axis=1), int(tab[:, 0].sum()), int(tab.sum())
    const = sum(math.lgamma(r + 1) for r in rows) + math.lgamma(c0 + 1) + math.lgamma(n - c0 + 1) - math.lgamma(n + 1)

    def lp(first):
        return const - sum(math.lgamma(a + 1) + math.lgamma(r - a + 1) for a, r in zip(first, rows))

    obs = lp(tab[:, 0])
    total = 0.0

    def walk(i, left, acc):
        nonlocal total
        if i == len(rows) - 1:
            if 0 <= left <= rows[i]:
                v = lp(acc + [left])
                if v <= obs + 1e-7 * abs(obs):
                    total += math.exp(v)
            return
        for a in range(0, min(rows[i], left) + 1):
            walk(i + 1, left - a, acc + [a])

    walk(0, c0, [])
    return total


if has("crosstabs-grp3-disease"):
    sc = "crosstabs-grp3-disease"
    ct = pd.crosstab(D.grp3, D.disease)
    chi2, p, dof, exp = stats.chi2_contingency(ct, correction=False)
    t = table(sc, "output.crosstabs.crosstabTitle")
    for i, g in enumerate(ct.index):
        for j, c in enumerate(ct.columns):
            check(sc, f"count {g}x{c}", cell(sc, t, [g, "output.crosstabs.cellCount"], str(c)), ct.iloc[i, j])
            check(sc, f"expected {g}x{c}", cell(sc, t, [g, "output.crosstabs.cellExpected"], str(c)), exp[i, j])
    t = table(sc, "output.crosstabs.chiSqTitle")
    check(sc, "Pearson chi2", cell(sc, t, ["output.col.pearsonChiSq"], "output.col.value"), chi2)
    check(sc, "Pearson p", cell(sc, t, ["output.col.pearsonChiSq"], "output.col.sig"), p, p=True)
    g2, pg, _, _ = stats.chi2_contingency(ct, correction=False, lambda_="log-likelihood")
    check(sc, "LR chi2", cell(sc, t, ["output.col.likelihoodRatio"], "output.col.value"), g2)
    check(sc, "LR p", cell(sc, t, ["output.col.likelihoodRatio"], "output.col.sig"), pg, p=True)
    check(sc, "Fisher exact p", cell(sc, t, ["output.col.fisherExact"], "output.col.sig"), fisher_rx2(ct.values),
          p=True)
    n = ct.values.sum()
    t = table(sc, "output.crosstabs.symTitle")
    check(sc, "phi", cell(sc, t, ["output.col.nominal", "output.col.phi"], "output.col.value"), math.sqrt(chi2 / n))
    check(sc, "Cramer V", cell(sc, t, ["output.col.nominal", "output.col.cramersV"], "output.col.value"),
          math.sqrt(chi2 / (n * (min(ct.shape) - 1))))

# ── T tests ────────────────────────────────────────────────────────────────

if has("ttest-ind-score-income"):
    sc = "ttest-ind-score-income"
    tg = table(sc, "output.ttestInd.groupStatsTitle")
    tt = table(sc, "output.ttestInd.testTitle")
    te = table(sc, "output.ttestInd.effectTitle")
    for v in ("score", "income"):
        a, b = s(v, D.grp2 == 1), s(v, D.grp2 == 2)
        for g, x in ((1, a), (2, b)):
            check(sc, f"{v} g{g} n", cell(sc, tg, [v, g], "output.col.n"), len(x))
            check(sc, f"{v} g{g} mean", cell(sc, tg, [v, g], "output.col.mean"), x.mean())
            check(sc, f"{v} g{g} sd", cell(sc, tg, [v, g], "output.col.stdDeviation"), sd(x))
        lev = stats.levene(a, b, center="mean")
        eq, ne = stats.ttest_ind(a, b), stats.ttest_ind(a, b, equal_var=False)
        ra = [v, "output.col.equalAssumed"]
        rn = [v, "output.col.equalNotAssumed"]
        check(sc, f"{v} Levene F", cell(sc, tt, ra, "output.col.leveneF"), lev.statistic)
        check(sc, f"{v} Levene p", cell(sc, tt, ra, "output.col.leveneSig"), lev.pvalue, p=True)
        check(sc, f"{v} t pooled", cell(sc, tt, ra, "output.col.t"), eq.statistic)
        check(sc, f"{v} p pooled", cell(sc, tt, ra, "output.col.sigTwoTailed"), eq.pvalue, p=True)
        check(sc, f"{v} t Welch", cell(sc, tt, rn, "output.col.t"), ne.statistic)
        check(sc, f"{v} df Welch", cell(sc, tt, rn, "output.col.df"), ne.df)
        check(sc, f"{v} p Welch", cell(sc, tt, rn, "output.col.sigTwoTailed"), ne.pvalue, p=True)
        ci = eq.confidence_interval()
        check(sc, f"{v} CI low", cell(sc, tt, ra, "output.col.ciLower95"), ci.low)
        check(sc, f"{v} CI high", cell(sc, tt, ra, "output.col.ciUpper95"), ci.high)
        ciw = ne.confidence_interval()
        check(sc, f"{v} Welch CI low", cell(sc, tt, rn, "output.col.ciLower95"), ciw.low)
        n1, n2 = len(a), len(b)
        sp = math.sqrt(((n1 - 1) * a.var() + (n2 - 1) * b.var()) / (n1 + n2 - 2))
        d = (a.mean() - b.mean()) / sp
        check(sc, f"{v} Cohen d", cell(sc, te, [v, "output.col.cohensD"], "output.col.pointEstimate"), d)
        J = 1 - 3 / (4 * (n1 + n2) - 9)
        check(sc, f"{v} Hedges g", cell(sc, te, [v, "output.col.hedgesG"], "output.col.pointEstimate"), d * J)

if has("ttest1-score-income"):
    sc = "ttest1-score-income"
    tt = table(sc, "output.ttest1.testTitle")
    for v in ("score", "income"):
        x = s(v)
        r = stats.ttest_1samp(x, 50)
        ci = r.confidence_interval()
        check(sc, f"{v} t", cell(sc, tt, [v], "output.col.t"), r.statistic)
        check(sc, f"{v} df", cell(sc, tt, [v], "output.col.df"), r.df)
        check(sc, f"{v} p", cell(sc, tt, [v], "output.col.sigTwoTailed"), r.pvalue, p=True)
        check(sc, f"{v} CI low", cell(sc, tt, [v], "output.col.ciLower95"), ci.low - 50)
        check(sc, f"{v} CI high", cell(sc, tt, [v], "output.col.ciUpper95"), ci.high - 50)

if has("ttest-paired"):
    sc = "ttest-paired"
    tc = table(sc, "output.ttestPaired.corrTitle")
    tt = table(sc, "output.ttestPaired.testTitle")
    for a_, b_ in (("pre", "post"), ("score", "income")):
        pr = D[[a_, b_]].dropna()
        lab = f"{a_} - {b_}"
        dlt = pr[a_] - pr[b_]
        r = stats.ttest_rel(pr[a_], pr[b_])
        ci = r.confidence_interval()
        rho = stats.pearsonr(pr[a_], pr[b_])
        check(sc, f"{lab} N", cell(sc, tc, [lab], "output.col.n"), len(pr))
        check(sc, f"{lab} r", cell(sc, tc, [lab], "output.col.correlation"), rho.statistic)
        check(sc, f"{lab} mean diff", cell(sc, tt, [lab], "output.col.mean"), dlt.mean())
        check(sc, f"{lab} sd diff", cell(sc, tt, [lab], "output.col.stdDeviation"), sd(dlt))
        check(sc, f"{lab} t", cell(sc, tt, [lab], "output.col.t"), r.statistic)
        check(sc, f"{lab} df", cell(sc, tt, [lab], "output.col.df"), r.df)
        check(sc, f"{lab} CI low", cell(sc, tt, [lab], "output.col.ciLower95"), ci.low)
        check(sc, f"{lab} CI high", cell(sc, tt, [lab], "output.col.ciUpper95"), ci.high)

# ── Correlation ────────────────────────────────────────────────────────────

if has("correlate-spearman"):
    sc = "correlate-spearman"
    t = table(sc, "output.correlate.title")
    for a_, b_ in combinations(("score", "income", "age"), 2):
        pr = D[[a_, b_]].dropna()
        r = stats.spearmanr(pr[a_], pr[b_])
        check(sc, f"rho {a_}-{b_}", cell(sc, t, [a_, "output.col.spearman"], b_), r.statistic)
        check(sc, f"p {a_}-{b_}", cell(sc, t, [a_, "output.col.sigTwoTailed"], b_), r.pvalue, p=True)
        check(sc, f"N {a_}-{b_}", cell(sc, t, [a_, "output.col.n"], b_), len(pr))

if has("partial-corr-score-income-age"):
    sc = "partial-corr-score-income-age"
    t = table(sc, "output.partialCorr.title")
    lw = D[["score", "income", "age"]].dropna()
    ra = sm.OLS(lw.score, sm.add_constant(lw.age)).fit().resid
    rb = sm.OLS(lw.income, sm.add_constant(lw.age)).fit().resid
    r = np.corrcoef(ra, rb)[0, 1]
    df = len(lw) - 3
    tstat = r * math.sqrt(df / (1 - r * r))
    check(sc, "partial r", cell(sc, t, ["score", "output.col.pearsonCorr"], "income"), r)
    check(sc, "df", cell(sc, t, ["score", "output.col.df"], "income"), df)
    check(sc, "p", cell(sc, t, ["score", "output.col.sigTwoTailed"], "income"), 2 * stats.t.sf(abs(tstat), df), p=True)

# ── ANOVA family ───────────────────────────────────────────────────────────


def spss_trimmed_mean(x, p=0.05):
    x = np.sort(np.asarray(x, float))
    n = len(x)
    k = p * n
    lo = int(math.floor(k))
    w = np.ones(n)
    w[:lo] = 0
    w[n - lo:] = 0
    w[lo] -= k - lo
    w[n - lo - 1] -= k - lo
    return float((w * x).sum() / w.sum())


if has("oneway-score-income-grp3"):
    sc = "oneway-score-income-grp3"
    from statsmodels.stats.multicomp import pairwise_tukeyhsd
    from statsmodels.stats.oneway import anova_oneway
    for v in ("score", "income"):
        sub = D[[v, "grp3"]].dropna()
        groups = [sub.loc[sub.grp3 == g, v].astype(float) for g in (1, 2, 3)]
        f = stats.f_oneway(*groups)
        grand = sub[v].mean()
        ssb = sum(len(x) * (x.mean() - grand) ** 2 for x in groups)
        ssw = sum(((x - x.mean()) ** 2).sum() for x in groups)
        t = table(sc, f"output.anova.titleBy:{v}|grp3")
        check(sc, f"{v} SS between", cell(sc, t, ["output.col.betweenGroups"], "output.col.sumSq"), ssb)
        check(sc, f"{v} SS within", cell(sc, t, ["output.col.withinGroups"], "output.col.sumSq"), ssw)
        check(sc, f"{v} F", cell(sc, t, ["output.col.betweenGroups"], "output.col.f"), f.statistic)
        check(sc, f"{v} p", cell(sc, t, ["output.col.betweenGroups"], "output.col.sig"), f.pvalue, p=True)
        t = table(sc, f"output.anova.homogTitle:{v}")
        check(sc, f"{v} Levene mean", cell(sc, t, ["output.anova.leveneBasedOnMean"], "output.col.leveneStatistic"),
              stats.levene(*groups, center="mean").statistic)
        check(sc, f"{v} Levene median", cell(sc, t, ["output.anova.leveneBasedOnMedian"], "output.col.leveneStatistic"),
              stats.levene(*groups, center="median").statistic)
        # SPSS's 5% trimmed mean trims fractionally (scipy drops whole cases)
        z = [np.abs(x.values - spss_trimmed_mean(x.values)) for x in groups]
        check(sc, f"{v} Levene trimmed (5%)", cell(sc, t, ["output.anova.leveneBasedOnTrimmed"], "output.col.leveneStatistic"),
              stats.f_oneway(*z).statistic)
        w = anova_oneway(groups, use_var="unequal")
        t = table(sc, f"output.anova.robustTitle:{v}")
        check(sc, f"{v} Welch F", cell(sc, t, ["output.col.welch"], "output.col.statistic"), w.statistic)
        check(sc, f"{v} Welch df2", cell(sc, t, ["output.col.welch"], "output.col.df2"), w.df[1])
        check(sc, f"{v} Welch p", cell(sc, t, ["output.col.welch"], "output.col.sig"), w.pvalue, p=True)
        tk = pairwise_tukeyhsd(sub[v].astype(float), sub.grp3)
        t = table(sc, f"output.anova.postHocTitle:{v}")
        for (g1, g2), md, pa, lo, hi in zip(combinations(tk.groupsunique, 2), tk.meandiffs, tk.pvalues,
                                            tk.confint[:, 0], tk.confint[:, 1]):
            # statsmodels: mean(g2) - mean(g1); SAI row g1,g2: mean(g1) - mean(g2)
            lab = ["output.col.tukeyHSD", int(g1), int(g2)]
            check(sc, f"{v} Tukey {g1}-{g2} diff", cell(sc, t, lab, "output.col.meanDiff"), -md)
            check(sc, f"{v} Tukey {g1}-{g2} p", cell(sc, t, lab, "output.col.sig"), pa, p=True, rel=1e-3)
            check(sc, f"{v} Tukey {g1}-{g2} CI low", cell(sc, t, lab, "output.col.ciLowerPct"), -hi, rel=1e-3)

if has("glm-uni-score-grp3"):
    sc = "glm-uni-score-grp3"
    sub = D[["score", "grp3"]].dropna()
    m = smf.ols("score ~ C(grp3, Sum)", data=sub).fit()
    a3 = sm.stats.anova_lm(m, typ=3)
    t = table(sc, "output.glmUni.title")
    check(sc, "intercept SS", cell(sc, t, ["output.col.intercept"], "output.col.typeIIISS"), a3.loc["Intercept", "sum_sq"])
    check(sc, "grp3 SS", cell(sc, t, ["grp3"], "output.col.typeIIISS"), a3.loc["C(grp3, Sum)", "sum_sq"])
    check(sc, "grp3 F", cell(sc, t, ["grp3"], "output.col.f"), a3.loc["C(grp3, Sum)", "F"])

if has("glm-multi-score-income-grp3"):
    sc = "glm-multi-score-income-grp3"
    from statsmodels.multivariate.manova import MANOVA
    sub = D[["score", "income", "grp3"]].dropna()
    mv = MANOVA.from_formula("score + income ~ C(grp3)", data=sub).mv_test()
    st = mv.results["C(grp3)"]["stat"]
    t = table(sc, "output.glmMulti.mvTitle")
    for key, nm in (("output.col.pillai", "Pillai's trace"), ("output.col.wilks", "Wilks' lambda"),
                    ("output.col.hotelling", "Hotelling-Lawley trace")):
        check(sc, f"grp3 {nm}", cell(sc, t, ["grp3", key], "output.col.value"), st.loc[nm, "Value"])
        if nm != "Hotelling-Lawley trace":
            check(sc, f"grp3 {nm} F", cell(sc, t, ["grp3", key], "output.col.f"), st.loc[nm, "F Value"])
    # Hotelling-Lawley F: SPSS's approximation 2(sn+1)T / (s²(2m+s+1)); statsmodels uses another
    T_ = st.loc["Hotelling-Lawley trace", "Value"]
    p_, q_, dfe = 2, 2, len(sub) - 3
    s_, m_, n_ = min(p_, q_), (abs(p_ - q_) - 1) / 2, (dfe - p_ - 1) / 2
    check(sc, "grp3 Hotelling-Lawley F (SPSS)", cell(sc, t, ["grp3", "output.col.hotelling"], "output.col.f"),
          2 * (s_ * n_ + 1) * T_ / (s_ * s_ * (2 * m_ + s_ + 1)))
    for i, v in enumerate(("score", "income")):
        m = smf.ols(f"{v} ~ C(grp3, Sum)", data=sub).fit()
        a3 = sm.stats.anova_lm(m, typ=3)
        t = table(sc, f"output.glmUni.title:{v}")
        check(sc, f"{v} grp3 SS (listwise)", cell(sc, t, ["grp3"], "output.col.typeIIISS"), a3.loc["C(grp3, Sum)", "sum_sq"])
        check(sc, f"{v} grp3 F", cell(sc, t, ["grp3"], "output.col.f"), a3.loc["C(grp3, Sum)", "F"])

if has("glm-repeated-q1-q3"):
    sc = "glm-repeated-q1-q3"
    Y = D[["q1", "q2", "q3"]].dropna().values.astype(float)
    n, k = Y.shape
    gm = Y.mean()
    ss_cond = n * ((Y.mean(axis=0) - gm) ** 2).sum()
    ss_subj = k * ((Y.mean(axis=1) - gm) ** 2).sum()
    ss_err = ((Y - gm) ** 2).sum() - ss_cond - ss_subj
    F = (ss_cond / (k - 1)) / (ss_err / ((k - 1) * (n - 1)))
    t = table(sc, "output.glmRep.withinTitle")
    check(sc, "SS factor", cell(sc, t, ["factor1", "output.col.sphericityAssumed"], "output.col.typeIIISS"), ss_cond)
    check(sc, "F sphericity", cell(sc, t, ["factor1", "output.col.sphericityAssumed"], "output.col.f"), F)
    # Greenhouse-Geisser epsilon from orthonormal contrasts
    C = np.array([[-1, 0, 1], [1, -2, 1]], float)
    C = (C.T / np.linalg.norm(C, axis=1)).T
    S = np.cov((Y @ C.T).T)
    eig = np.linalg.eigvalsh(S)
    gg = eig.sum() ** 2 / ((k - 1) * (eig ** 2).sum())
    check(sc, "GG df", cell(sc, t, ["factor1", "output.col.greenhouse"], "output.col.df"), gg * (k - 1))
    mau = np.linalg.det(S) / (np.trace(S) / (k - 1)) ** (k - 1)
    tm = table(sc, "output.glmRep.mauchlyTitle")
    check(sc, "Mauchly W", cell(sc, tm, ["factor1"], "output.col.mauchlyW"), mau)
    tb = table(sc, "output.glmRep.betweenTitle")
    check(sc, "between error SS", cell(sc, tb, ["output.col.error"], "output.col.typeIIISS"), ss_subj)

# ── Regression family ──────────────────────────────────────────────────────

if has("regression-linear"):
    sc = "regression-linear"
    lw = D[["income", "score", "age"]].dropna()
    X = sm.add_constant(lw[["score", "age"]])
    m = sm.OLS(lw.income, X).fit()
    t = table(sc, "output.regression.modelSummaryTitle")
    r0 = t["rows"][0] if t else [None] * 5
    check(sc, "R", r0[col(t, "output.col.rVal")], math.sqrt(m.rsquared))
    check(sc, "R2", r0[col(t, "output.col.rSquare")], m.rsquared)
    check(sc, "adj R2", r0[col(t, "output.col.adjRSquare")], m.rsquared_adj)
    check(sc, "SE est", r0[col(t, "output.col.stdErrEst")], math.sqrt(m.scale))
    from statsmodels.stats.stattools import durbin_watson
    check(sc, "Durbin-Watson", r0[col(t, "output.col.durbinWatson")], durbin_watson(m.resid))
    t = table(sc, "output.regression.anovaTitle")
    check(sc, "SS reg", cell(sc, t, ["output.col.regression"], "output.col.sumSq"), m.ess)
    check(sc, "SS res", cell(sc, t, ["output.col.residual"], "output.col.sumSq"), m.ssr)
    check(sc, "F", cell(sc, t, ["output.col.regression"], "output.col.f"), m.fvalue)
    t = table(sc, "output.regression.coeffTitle")
    for nm, lab in (("const", "output.col.constant"), ("score", "score"), ("age", "age")):
        check(sc, f"B {nm}", cell(sc, t, [lab], "output.col.b"), m.params[nm])
        check(sc, f"SE {nm}", cell(sc, t, [lab], "output.col.stdError"), m.bse[nm])
        check(sc, f"t {nm}", cell(sc, t, [lab], "output.col.t"), m.tvalues[nm])
    for nm in ("score", "age"):
        beta = m.params[nm] * lw[nm].std() / lw.income.std()
        check(sc, f"beta {nm}", cell(sc, t, [nm], "output.col.beta"), beta)
    r2 = np.corrcoef(lw.score, lw.age)[0, 1] ** 2
    check(sc, "tolerance", cell(sc, t, ["score"], "output.col.tolerance"), 1 - r2)
    check(sc, "VIF", cell(sc, t, ["score"], "output.col.vif"), 1 / (1 - r2))

if has("curve-income-score"):
    sc = "curve-income-score"
    lw = D[["income", "score"]].dropna()
    m = sm.OLS(lw.income, sm.add_constant(lw.score)).fit()
    t = table(sc, "output.curve.title")
    lab = ["output.col.mLinear"]
    check(sc, "R2", cell(sc, t, lab, "output.col.rSquare"), m.rsquared)
    check(sc, "F", cell(sc, t, lab, "output.col.f"), m.fvalue)
    check(sc, "b0", cell(sc, t, lab, "output.col.constant"), m.params["const"])
    check(sc, "b1", cell(sc, t, lab, "output.col.b1"), m.params["score"])

if has("logistic-disease-score-age"):
    sc = "logistic-disease-score-age"
    lw = D[["disease", "score", "age"]].dropna()
    m = sm.Logit(lw.disease, sm.add_constant(lw[["score", "age"]])).fit(disp=0)
    n = len(lw)
    ll0 = m.llnull
    cs = 1 - math.exp(2 * (ll0 - m.llf) / n)
    nk = cs / (1 - math.exp(2 * ll0 / n))
    t = table(sc, "output.logistic.modelSummaryTitle")
    r0 = t["rows"][0] if t else [None] * 3
    check(sc, "-2LL", r0[col(t, "output.col.neg2LL")], -2 * m.llf, rel=1e-6)
    check(sc, "Cox & Snell", r0[col(t, "output.col.coxSnell")], cs, rel=1e-4)
    check(sc, "Nagelkerke", r0[col(t, "output.col.nagelkerke")], nk, rel=1e-4)
    t = table(sc, "output.logistic.equationTitle")
    for nm, lab in (("score", "score"), ("age", "age"), ("const", "output.col.constant")):
        check(sc, f"B {nm}", cell(sc, t, [lab], "output.col.b"), m.params[nm], rel=1e-4)
        check(sc, f"SE {nm}", cell(sc, t, [lab], "output.col.stdError"), m.bse[nm], rel=1e-4)
        check(sc, f"Wald {nm}", cell(sc, t, [lab], "output.col.wald"), (m.params[nm] / m.bse[nm]) ** 2, rel=1e-4)
        check(sc, f"p {nm}", cell(sc, t, [lab], "output.col.sig"), m.pvalues[nm], p=True, rel=1e-4)
    pred = (m.predict() >= 0.5).astype(int)
    t = table(sc, "output.logistic.classificationTitle")
    for obs in (0, 1):
        for pr in (0, 1):
            check(sc, f"class {obs}->{pr}", cell(sc, t, [obs], str(pr)),
                  int(((lw.disease == obs) & (pred == pr)).sum()))

if has("x-multinomial-covariates"):
    sc = "x-multinomial-covariates"
    lw = D[["grp3", "score", "age"]].dropna()
    # The dialog's reference is SPSS's default, the LAST category (BASE=LAST);
    # statsmodels' base is code 0, so grp3 = 3 maps to 0
    y = lw.grp3.map({3: 0, 1: 1, 2: 2})
    m = sm.MNLogit(y, sm.add_constant(lw[["score", "age"]])).fit(disp=0, maxiter=200)
    t = table(sc, "output.multinom.fitTitle")
    # NOMREG's -2LL includes the multinomial constant of repeated covariate
    # patterns; it cancels out of the model chi-square
    check(sc, "model chi2", cell(sc, t, ["output.col.final"], "output.col.chiSquare"), 2 * (m.llf - m.llnull), rel=1e-4)
    t = table(sc, "output.multinom.paramTitle")
    for j, cat in ((0, 1), (1, 2)):
        for nm, lab in (("const", "output.col.intercept"), ("score", "score"), ("age", "age")):
            check(sc, f"cat{cat} B {nm}", cell(sc, t, [cat, lab], "output.col.b"), m.params.iloc[:, j][nm], rel=1e-4)
            check(sc, f"cat{cat} SE {nm}", cell(sc, t, [cat, lab], "output.col.stdError"), m.bse.iloc[:, j][nm],
                  rel=1e-4)

if has("x-multinomial-ref-descending"):
    sc = "x-multinomial-ref-descending"
    lw = D[["grp3", "score", "age"]].dropna()
    # ORDER=DESCENDING BASE=LAST: the reference is grp3 = 1
    y = lw.grp3.map({1: 0, 3: 1, 2: 2})
    m = sm.MNLogit(y, sm.add_constant(lw[["score", "age"]])).fit(disp=0, maxiter=200)
    t = table(sc, "output.multinom.paramTitle")
    for j, cat in ((0, 3), (1, 2)):
        for nm, lab in (("const", "output.col.intercept"), ("score", "score"), ("age", "age")):
            check(sc, f"cat{cat} B {nm}", cell(sc, t, [cat, lab], "output.col.b"), m.params.iloc[:, j][nm], rel=1e-4)
    order = [str(r[0]) for r in table(sc, "output.multinom.extra.caseSummary")["rows"][:3]]
    if order != ["3", "2", "1"]:
        failures.append(f"{sc}: case summary order {order}, expected 3, 2, 1")
    else:
        passes += 1

if has("ordinal-grp3-score-age"):
    sc = "ordinal-grp3-score-age"
    from statsmodels.miscmodels.ordinal_model import OrderedModel
    lw = D[["grp3", "score", "age"]].dropna()
    m = OrderedModel(lw.grp3.astype(int), lw[["score", "age"]], distr="logit").fit(method="bfgs", disp=0, maxiter=2000)
    th = m.params.values[2:]
    th = np.concatenate([[th[0]], th[0] + np.cumsum(np.exp(th[1:]))])
    t = table(sc, "output.ordinal.paramTitle")
    check(sc, "threshold 1|2", cell(sc, t, ["output.col.threshold", "1|2"], "output.col.estimate"), th[0], rel=1e-4)
    check(sc, "threshold 2|3", cell(sc, t, ["output.col.threshold", "2|3"], "output.col.estimate"), th[1], rel=1e-4)
    check(sc, "score", cell(sc, t, ["output.col.location", "score"], "output.col.estimate"), m.params["score"], rel=1e-4)
    check(sc, "age", cell(sc, t, ["output.col.location", "age"], "output.col.estimate"), m.params["age"], rel=1e-4)
    t = table(sc, "output.ordinal.fitTitle")
    # PLUM's -2LL kernel (see the header); the model chi-square is convention-free
    cnt = lw.grp3.value_counts()
    ll0 = sum(c * math.log(c / len(lw)) for c in cnt)
    check(sc, "model chi2", cell(sc, t, ["output.col.final"], "output.col.chiSquare"), 2 * (m.llf - ll0), rel=1e-4)

if has("genlin-evt-score-age"):
    sc = "genlin-evt-score-age"
    lw = D[["evt", "score", "age"]].dropna()
    m = sm.GLM(lw.evt, sm.add_constant(lw[["score", "age"]]), family=sm.families.Poisson()).fit()
    t = table(sc, "output.genlin.paramTitle")
    for nm, lab in (("const", "output.col.constant"), ("score", "score"), ("age", "age")):
        check(sc, f"B {nm}", cell(sc, t, [lab], "output.col.b"), m.params[nm], rel=1e-4)
        check(sc, f"SE {nm}", cell(sc, t, [lab], "output.col.stdError"), m.bse[nm], rel=1e-4)
    t = table(sc, "output.genlin.gofTitle")
    check(sc, "deviance", cell(sc, t, ["output.col.deviance"], "output.col.value"), m.deviance)
    check(sc, "Pearson chi2", cell(sc, t, ["output.col.pearsonChi"], "output.col.value"), m.pearson_chi2)
    check(sc, "log-likelihood", cell(sc, t, ["output.col.logLikelihood"], "output.col.value"), m.llf)

if has("gee-score-age-grp3"):
    sc = "gee-score-age-grp3"
    lw = D[["score", "age", "grp3"]].dropna().sort_values("grp3", kind="stable")
    m = sm.GEE(lw.score, sm.add_constant(lw.age), groups=lw.grp3,
               cov_struct=sm.cov_struct.Exchangeable(), family=sm.families.Gaussian()).fit()
    t = table(sc, "output.gee.paramTitle")
    # geepack and statsmodels estimate the exchangeable correlation with
    # slightly different moment estimators — agreement to 1e-3 relative
    check(sc, "B const", cell(sc, t, ["output.col.constant"], "output.col.b"), m.params["const"], rel=1e-3)
    check(sc, "B age", cell(sc, t, ["age"], "output.col.b"), m.params["age"], rel=1e-3)
    check(sc, "robust SE age", cell(sc, t, ["age"], "output.col.stdError"), m.bse["age"], rel=1e-3)

if has("mixed-score-age-grp3"):
    sc = "mixed-score-age-grp3"
    lw = D[["score", "age", "grp3"]].dropna()
    m = smf.mixedlm("score ~ age", lw, groups=lw.grp3).fit(reml=True)
    t = table(sc, "output.mixed.fixedTitle")
    check(sc, "B intercept", cell(sc, t, ["output.col.intercept"], "output.col.b"), m.fe_params["Intercept"], rel=1e-4)
    check(sc, "B age", cell(sc, t, ["age"], "output.col.b"), m.fe_params["age"], rel=1e-4)
    check(sc, "SE age", cell(sc, t, ["age"], "output.col.stdError"), m.bse_fe["age"], rel=1e-3)
    t = table(sc, "output.mixed.covTitle")
    check(sc, "residual var", cell(sc, t, ["output.mixed.residualVar"], "output.col.variance"), m.scale, rel=1e-3)
    check(sc, "intercept var", cell(sc, t, ["output.mixed.interceptVar"], "output.col.variance"),
          float(m.cov_re.iloc[0, 0]), rel=1e-2)

# ── Nonparametric ──────────────────────────────────────────────────────────

if has("npar-chisquare-grp3"):
    sc = "npar-chisquare-grp3"
    obs = D.grp3.value_counts().sort_index()
    r = stats.chisquare(obs)
    t = table(sc, "output.npar.testStatsTitle")
    check(sc, "chi2", cell(sc, t, ["grp3"], "output.col.chiSquare"), r.statistic)
    check(sc, "p", cell(sc, t, ["grp3"], "output.col.asympSig"), r.pvalue, p=True)

if has("npar-binomial-disease"):
    sc = "npar-binomial-disease"
    k = (D.disease == 0).sum()
    r = stats.binomtest(int(k), len(D), 0.5)
    t = table(sc, "output.nparBinomial.title")
    check(sc, "exact p", cell(sc, t, ["disease", "0"], "output.col.exactSig"), r.pvalue, p=True)

if has("npar-ks-score"):
    sc = "npar-ks-score"
    x = s("score")
    n = len(x)
    z = (x - x.mean()) / sd(x)
    ks = stats.kstest(z, "norm")
    xs = np.sort(z.values)
    cdf = stats.norm.cdf(xs)
    dplus = (np.arange(1, n + 1) / n - cdf).max()
    dminus = (cdf - np.arange(0, n) / n).max()
    t = table(sc, "output.nparKS.title")
    check(sc, "|D|", cell(sc, t, ["score"], "output.col.absDiff"), ks.statistic)
    check(sc, "D+", cell(sc, t, ["score"], "output.col.posDiff"), dplus)
    check(sc, "D-", cell(sc, t, ["score"], "output.col.negDiff"), -dminus)
    check(sc, "KS Z", cell(sc, t, ["score"], "output.col.ksZ"), math.sqrt(n) * ks.statistic)
    check(sc, "asymp p", cell(sc, t, ["score"], "output.col.asympSig"), stats.kstwobign.sf(math.sqrt(n) * ks.statistic), p=True)
    # Lilliefors p: every closed form is an approximation above p = .1, so the
    # reference is a Monte Carlo p (20 000 normal samples of the same n);
    # statsmodels' approximation was 0.39 where the simulation says 0.36
    rng = np.random.default_rng(7)

    def dstat(v):
        zz = (v - v.mean()) / v.std(ddof=1)
        return stats.kstest(zz, "norm").statistic

    sims = np.array([dstat(rng.normal(size=n)) for _ in range(20000)])
    mc = float((sims >= ks.statistic).mean())
    sai_l = cell(sc, t, ["score"], "output.col.lillieforsSig")
    if sai_l is None or abs(float(sai_l) - mc) > 0.015:
        failures.append(f"{sc}: Lilliefors p: SAI={sai_l!r} Monte Carlo={mc:.4f}")
    else:
        passes += 1

if has("npar-runs-score"):
    sc = "npar-runs-score"
    x = s("score").values
    med = np.median(x)
    sign = x >= med
    runs = 1 + int((sign[1:] != sign[:-1]).sum())
    n1, n2 = int((~sign).sum()), int(sign.sum())
    n = n1 + n2
    mu = 2 * n1 * n2 / n + 1
    var = 2 * n1 * n2 * (2 * n1 * n2 - n) / (n * n * (n - 1))
    z = (runs - mu) / math.sqrt(var)  # SPSS: continuity correction only for n < 50
    t = table(sc, "output.nparRuns.title")
    check(sc, "test value (median)", cell(sc, t, ["score"], "output.col.testValue"), med)
    check(sc, "runs", cell(sc, t, ["score"], "output.col.numRuns"), runs)
    check(sc, "Z", cell(sc, t, ["score"], "output.col.z"), z)
    check(sc, "p", cell(sc, t, ["score"], "output.col.asympSig"), 2 * stats.norm.sf(abs(z)), p=True)


def mw_z(a, b):
    allv = np.concatenate([a, b])
    rk = stats.rankdata(allv)
    n1, n2 = len(a), len(b)
    n = n1 + n2
    u = rk[:n1].sum() - n1 * (n1 + 1) / 2
    u = min(u, n1 * n2 - u)
    _, cnt = np.unique(allv, return_counts=True)
    tie = (cnt ** 3 - cnt).sum()
    var = n1 * n2 / 12 * ((n + 1) - tie / (n * (n - 1)))
    return u, (u - n1 * n2 / 2) / math.sqrt(var), rk


if has("npar-mw-score-income"):
    sc = "npar-mw-score-income"
    tr = table(sc, "output.npar.ranksTitle")
    tt = table(sc, "output.npar.testStatsTitle")
    te = table(sc, "output.npar.effectSizeTitle")
    for v in ("score", "income"):
        a, b = s(v, D.grp2 == 1).values, s(v, D.grp2 == 2).values
        u, z, rk = mw_z(a, b)
        n1 = len(a)
        check(sc, f"{v} mean rank g1", cell(sc, tr, [v, 1], "output.col.meanRank"), rk[:n1].mean())
        check(sc, f"{v} sum ranks g2", cell(sc, tr, [v, 2], "output.col.sumRanks"), rk[n1:].sum())
        check(sc, f"{v} U", cell(sc, tt, [v], "output.col.mannWhitneyU"), u)
        check(sc, f"{v} Z", cell(sc, tt, [v], "output.col.z"), z)
        check(sc, f"{v} p", cell(sc, tt, [v], "output.col.asympSig"), 2 * stats.norm.sf(abs(z)), p=True)
        hl = np.median(np.subtract.outer(a, b))
        check(sc, f"{v} Hodges-Lehmann", cell(sc, te, [v], "output.npar.hodgesLehmann"), hl)

if has("npar-wilcoxon-pairs"):
    sc = "npar-wilcoxon-pairs"
    tt = table(sc, "output.npar.testStatsTitle")
    for a_, b_ in (("pre", "post"), ("score", "income")):
        pr = D[[a_, b_]].dropna()
        # Round away floating-point noise: 105.05 - 104.46 and 100.59 - 100.00
        # are the same difference, and tie handling must see them as one
        dlt = np.round((pr[b_] - pr[a_]).values, 9)
        dlt = dlt[dlt != 0]
        rk = stats.rankdata(np.abs(dlt))
        wpos, wneg = rk[dlt > 0].sum(), rk[dlt < 0].sum()
        n = len(dlt)
        _, cnt = np.unique(np.abs(dlt), return_counts=True)
        var = n * (n + 1) * (2 * n + 1) / 24 - (cnt ** 3 - cnt).sum() / 48
        z = (min(wpos, wneg) - n * (n + 1) / 4) / math.sqrt(var)
        check(sc, f"{b_} - {a_} Z", cell(sc, tt, [f"{b_} - {a_}"], "output.col.z"), z)

if has("npar-kw-score-income"):
    sc = "npar-kw-score-income"
    tt = table(sc, "output.npar.testStatsTitle")
    tr = table(sc, "output.npar.ranksTitle")
    for v in ("score", "income"):
        sub = D[[v, "grp3"]].dropna()
        r = stats.kruskal(*[sub.loc[sub.grp3 == g, v] for g in (1, 2, 3)])
        check(sc, f"{v} H", cell(sc, tt, [v], "output.col.chiSquare"), r.statistic)
        check(sc, f"{v} p", cell(sc, tt, [v], "output.col.asympSig"), r.pvalue, p=True)
        rk = stats.rankdata(sub[v])
        for g in (1, 2, 3):
            check(sc, f"{v} mean rank g{g}", cell(sc, tr, [v, g], "output.col.meanRank"), rk[(sub.grp3 == g).values].mean())

if has("npar-friedman-q1-q5"):
    sc = "npar-friedman-q1-q5"
    Q = D[["q1", "q2", "q3", "q4", "q5"]].dropna()
    r = stats.friedmanchisquare(*[Q[c] for c in Q.columns])
    t = table(sc, "output.npar.testStatsTitle")
    r0 = t["rows"][0] if t else [None] * 4
    check(sc, "chi2", r0[col(t, "output.col.chiSquare")], r.statistic)
    rk = np.apply_along_axis(stats.rankdata, 1, Q.values)
    tr = table(sc, "output.npar.ranksTitle")
    for i, c in enumerate(Q.columns):
        check(sc, f"mean rank {c}", cell(sc, tr, [c], "output.col.meanRank"), rk[:, i].mean())

# ── Scale / dimension reduction / classification ──────────────────────────

if has("reliability-q1-q5"):
    sc = "reliability-q1-q5"
    Q = D[["q1", "q2", "q3", "q4", "q5"]].dropna().astype(float)
    k = Q.shape[1]

    def alpha(m):
        return m.shape[1] / (m.shape[1] - 1) * (1 - m.var(ddof=1).sum() / m.sum(axis=1).var(ddof=1))

    t = table(sc, "output.reliability.statsTitle")
    check(sc, "alpha", t["rows"][0][col(t, "output.col.cronbachAlpha")] if t else None, alpha(Q))
    t = table(sc, "output.reliability.itemTotalTitle")
    tot = Q.sum(axis=1)
    for c in Q.columns:
        rest = tot - Q[c]
        check(sc, f"{c} corrected item-total", cell(sc, t, [c], "output.col.corrItemTotal"), np.corrcoef(Q[c], rest)[0, 1])
        check(sc, f"{c} alpha if deleted", cell(sc, t, [c], "output.col.alphaDel"), alpha(Q.drop(columns=c)))
        check(sc, f"{c} scale var if deleted", cell(sc, t, [c], "output.col.scaleVarDel"), rest.var(ddof=1))

if has("factor-q1-q5"):
    sc = "factor-q1-q5"
    Q = D[["q1", "q2", "q3", "q4", "q5"]].dropna().astype(float)
    R = np.corrcoef(Q.values.T)
    ev, vec = np.linalg.eigh(R)
    order = np.argsort(ev)[::-1]
    ev, vec = ev[order], vec[:, order]
    t = table(sc, "output.factor.tveTitle")
    for i in range(5):
        check(sc, f"eigenvalue {i + 1}", cell(sc, t, [i + 1], "output.col.eigenvalue"), ev[i])
    load = vec[:, 0] * math.sqrt(ev[0])
    load *= np.sign(load.sum())
    t = table(sc, "output.factor.matrixTitle")
    tc = table(sc, "output.factor.commTitle")
    for i, c in enumerate(Q.columns):
        check(sc, f"loading {c}", cell(sc, t, [c], "output.factor.compHdr:1"), load[i])
        check(sc, f"communality {c}", cell(sc, tc, [c], "output.col.extraction"), load[i] ** 2)

if has("discriminant-grp2-score-age"):
    sc = "discriminant-grp2-score-age"
    lw = D[["grp2", "score", "age"]].dropna()
    X = lw[["score", "age"]].values.astype(float)
    g = lw.grp2.values
    W = sum(np.cov(X[g == k].T, ddof=1) * ((g == k).sum() - 1) for k in (1, 2))
    T_ = np.cov(X.T, ddof=1) * (len(X) - 1)
    B = T_ - W
    ev = np.max(np.real(np.linalg.eigvals(np.linalg.solve(W, B))))
    wilks = np.linalg.det(W) / np.linalg.det(T_)
    n, p_, kk = len(X), 2, 2
    chi = -(n - 1 - (p_ + kk) / 2) * math.log(wilks)
    t = table(sc, "output.discriminant.eigTitle")
    check(sc, "eigenvalue", cell(sc, t, [1], "output.col.eigenvalue"), ev)
    check(sc, "canonical r", cell(sc, t, [1], "output.col.canonicalCorr"), math.sqrt(ev / (1 + ev)))
    t = table(sc, "output.discriminant.wilksTitle")
    r0 = t["rows"][0] if t else [None] * 4
    check(sc, "Wilks lambda", r0[col(t, "output.col.wilksLambda")], wilks)
    check(sc, "chi2", r0[col(t, "output.col.chiSquare")], chi)
    check(sc, "p", r0[col(t, "output.col.sig")], stats.chi2.sf(chi, p_ * (kk - 1)), p=True)

if has("distances-q1-q3"):
    sc = "distances-q1-q3"
    Q = D[["q1", "q2", "q3"]].dropna().astype(float)
    t = table(sc, "output.distances.title")
    for a_, b_ in combinations(Q.columns, 2):
        check(sc, f"euclid {a_}-{b_}", cell(sc, t, [a_], b_), float(np.sqrt(((Q[a_] - Q[b_]) ** 2).sum())))

if has("roc-score-disease"):
    sc = "roc-score-disease"
    lw = D[["score", "disease"]].dropna()
    pos, neg = lw.score[lw.disease == 1].values, lw.score[lw.disease == 0].values
    psi = (np.greater.outer(pos, neg) + 0.5 * np.equal.outer(pos, neg))
    auc = psi.mean()
    v10, v01 = psi.mean(axis=1), psi.mean(axis=0)
    se = math.sqrt(v10.var(ddof=1) / len(pos) + v01.var(ddof=1) / len(neg))  # DeLong
    t = table(sc, "output.roc.aucTitle")
    check(sc, "AUC", cell(sc, t, ["score"], "output.col.area"), auc)
    check(sc, "SE (DeLong)", cell(sc, t, ["score"], "output.col.stdError"), se)
    check(sc, "CI low", cell(sc, t, ["score"], "output.col.ciLowerPct"), auc - 1.959964 * se)

if has("proportions-one-disease"):
    sc = "proportions-one-disease"
    from statsmodels.stats.proportion import proportion_confint
    k, n = int(D.disease.sum()), len(D)
    t = table(sc, "output.proportions.oneTitle")
    check(sc, "observed", cell(sc, t, ["disease"], "output.proportions.observed"), k / n)
    w = proportion_confint(k, n, method="normal")
    check(sc, "Wald low", cell(sc, t, ["disease"], "output.proportions.waldLower"), w[0])
    w = proportion_confint(k, n, method="wilson")
    check(sc, "Wilson low", cell(sc, t, ["disease"], "output.proportions.wilsonLower"), w[0])
    check(sc, "Wilson high", cell(sc, t, ["disease"], "output.proportions.wilsonUpper"), w[1])

# ── Survival ───────────────────────────────────────────────────────────────


def km(time, ev):
    order = np.argsort(time, kind="stable")
    tt, ee = time[order], ev[order]
    s_, out = 1.0, []
    for u in np.unique(tt[ee == 1]):
        n_at = (tt >= u).sum()
        d = ((tt == u) & (ee == 1)).sum()
        s_ *= 1 - d / n_at
        out.append((u, s_, n_at, d))
    return out


def km_median(curve):
    for u, s_, _, _ in curve:
        if s_ <= 0.5 + 1e-12:
            return u
    return float("nan")


def km_mean(curve, tmax):
    area, prev_t, prev_s = 0.0, 0.0, 1.0
    for u, s_, _, _ in curve:
        area += prev_s * (u - prev_t)
        prev_t, prev_s = u, s_
    return area + prev_s * (tmax - prev_t)


if has("km-surv-evt-grp2"):
    sc = "km-surv-evt-grp2"
    t = table(sc, "output.survival.medianTitle")
    for g in (1, 2):
        sub = D[D.grp2 == g]
        c = km(sub.surv.values, sub.evt.values)
        check(sc, f"g{g} median", cell(sc, t, [g], "output.col.medianEst"), km_median(c))
        check(sc, f"g{g} mean (to max time)", cell(sc, t, [g], "output.col.meanEst"), km_mean(c, sub.surv.max()))
    # log-rank
    times = np.unique(D.surv[D.evt == 1])
    o_e, var = 0.0, 0.0
    for u in times:
        at = D.surv >= u
        n, n1 = at.sum(), (at & (D.grp2 == 1)).sum()
        d = ((D.surv == u) & (D.evt == 1)).sum()
        d1 = ((D.surv == u) & (D.evt == 1) & (D.grp2 == 1)).sum()
        o_e += d1 - d * n1 / n
        if n > 1:
            var += d * (n1 / n) * (1 - n1 / n) * (n - d) / (n - 1)
    t = table(sc, "output.survival.logrankTitle")
    check(sc, "log-rank chi2", cell(sc, t, ["output.col.logRank"], "output.col.chiSquare"), o_e ** 2 / var)
    check(sc, "log-rank p", cell(sc, t, ["output.col.logRank"], "output.col.sig"), stats.chi2.sf(o_e ** 2 / var, 1), p=True)

if has("cox-surv-evt-score-age"):
    sc = "cox-surv-evt-score-age"
    from statsmodels.duration.hazard_regression import PHReg
    lw = D[["surv", "evt", "score", "age"]].dropna()
    # Efron ties: R's default, chosen and documented in survival-cox.R (SPSS: Breslow)
    m = PHReg(lw.surv, lw[["score", "age"]], status=lw.evt, ties="efron").fit()
    t = table(sc, "output.cox.equationTitle")
    for i, nm in enumerate(("score", "age")):
        check(sc, f"B {nm} (Efron ties)", cell(sc, t, [nm], "output.col.b"), m.params[i], rel=1e-4)
        check(sc, f"SE {nm}", cell(sc, t, [nm], "output.col.stdError"), m.bse[i], rel=1e-3)
    t = table(sc, "output.cox.omnibusTitle")
    check(sc, "-2LL", t["rows"][0][col(t, "output.col.neg2LL")] if t else None, -2 * m.llf, rel=1e-5)

if has("lifetables-surv-evt"):
    sc = "lifetables-surv-evt"
    t = table(sc, "output.lifetab.title")
    cum = 1.0
    for start in (0, 5, 10, 15):
        inn = D[D.surv >= start]
        within = inn[inn.surv < start + 5]
        withdrawn = (within.evt == 0).sum()
        died = (within.evt == 1).sum()
        exposed = len(inn) - withdrawn / 2
        q = died / exposed
        cum *= 1 - q
        lab = [str(start)]
        check(sc, f"[{start}) entering", cell(sc, t, lab, "output.lifetab.entering"), len(inn))
        check(sc, f"[{start}) exposed", cell(sc, t, lab, "output.lifetab.exposed"), exposed)
        check(sc, f"[{start}) prop terminating", cell(sc, t, lab, "output.lifetab.propTerm"), q)
        check(sc, f"[{start}) cum surv", cell(sc, t, lab, "output.lifetab.cumSurv"), cum)

# ── Extra scenarios (options the SPSS parity run doesn't tick) ─────────────

if has("x-multinomial-covariates"):
    sc = "x-multinomial-covariates"
    lw = D[["grp3", "score", "age"]].dropna()
    y = lw.grp3.map({1: 0, 2: 1, 3: 2})
    full = sm.MNLogit(y, sm.add_constant(lw[["score", "age"]])).fit(disp=0, maxiter=200)
    t = table(sc, "output.multinom.extra.likelihoodRatio")
    for drop in ("score", "age"):
        keep = [c for c in ("score", "age") if c != drop]
        red = sm.MNLogit(y, sm.add_constant(lw[keep])).fit(disp=0, maxiter=200)
        check(sc, f"LR chi2 {drop}", cell(sc, t, [drop], "output.col.chiSquare"), 2 * (full.llf - red.llf), rel=1e-4)

if has("x-crosstabs-2x2"):
    sc = "x-crosstabs-2x2"
    ct = pd.crosstab(D.grp2, D.disease)
    a, b, c, d = ct.values.ravel()
    n = ct.values.sum()
    t = table(sc, "output.crosstabs.chiSqTitle")
    chi_c, p_c, _, _ = stats.chi2_contingency(ct, correction=True)
    check(sc, "continuity chi2", cell(sc, t, ["output.col.continuityCorrection"], "output.col.value"), chi_c)
    check(sc, "continuity p", cell(sc, t, ["output.col.continuityCorrection"], "output.col.sig"), p_c, p=True)
    check(sc, "Fisher 2-sided", cell(sc, t, ["output.col.fisherExact"], "output.col.exactSig2"),
          stats.fisher_exact(ct.values).pvalue, p=True)
    one = min(stats.fisher_exact(ct.values, alternative="less").pvalue,
              stats.fisher_exact(ct.values, alternative="greater").pvalue)
    check(sc, "Fisher 1-sided", cell(sc, t, ["output.col.fisherExact"], "output.col.exactSig1"), one, p=True)
    r = np.corrcoef(D.grp2, D.disease)[0, 1]
    check(sc, "linear-by-linear", cell(sc, t, ["output.col.linearByLinear"], "output.col.value"), (n - 1) * r * r)
    t = table(sc, "output.crosstabs.symTitle")
    check(sc, "phi (signed)", cell(sc, t, ["output.col.nominal", "output.col.phi"], "output.col.value"),
          (a * d - b * c) / math.sqrt((a + b) * (c + d) * (a + c) * (b + d)))
    t = table(sc, "output.crosstabs.riskTitle")
    orr = a * d / (b * c)
    se = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
    check(sc, "odds ratio", cell(sc, t, ["output.col.oddsRatio"], "output.col.value"), orr)
    check(sc, "OR CI low", cell(sc, t, ["output.col.oddsRatio"], "output.col.ciLower95"), math.exp(math.log(orr) - 1.959964 * se))
    check(sc, "OR CI high", cell(sc, t, ["output.col.oddsRatio"], "output.col.ciUpper95"), math.exp(math.log(orr) + 1.959964 * se))
    check(sc, "risk ratio (disease=0)", cell(sc, t, ["output.crosstabs.cohort:0"], "output.col.value"), (a / (a + b)) / (c / (c + d)))
    check(sc, "risk ratio (disease=1)", cell(sc, t, ["output.crosstabs.cohort:1"], "output.col.value"), (b / (a + b)) / (d / (c + d)))
    t = table(sc, "output.crosstabs.crosstabTitle")
    check(sc, "row% 1x1", cell(sc, t, [1, "output.crosstabs.cellRowPct"], "1"), 100 * b / (a + b))

if has("x-correlate-pearson-kendall"):
    sc = "x-correlate-pearson-kendall"
    tp = table(sc, "output.correlate.title:Pearson")
    tk = table(sc, "output.correlate.title:Kendall")
    for a_, b_ in combinations(("score", "income", "age"), 2):
        pr = D[[a_, b_]].dropna()
        r = stats.pearsonr(pr[a_], pr[b_])
        check(sc, f"r {a_}-{b_}", cell(sc, tp, [a_, "output.col.pearsonCorr"], b_), r.statistic)
        check(sc, f"r p {a_}-{b_}", cell(sc, tp, [a_, "output.col.sigTwoTailed"], b_), r.pvalue, p=True)
        k = stats.kendalltau(pr[a_], pr[b_], variant="b", method="asymptotic")
        check(sc, f"tau-b {a_}-{b_}", cell(sc, tk, [a_, "output.col.kendallTaub"], b_), k.statistic)
        check(sc, f"tau-b p {a_}-{b_}", cell(sc, tk, [a_, "output.col.sigTwoTailed"], b_), k.pvalue, p=True)

if has("x-oneway-posthoc"):
    sc = "x-oneway-posthoc"
    from statsmodels.stats.oneway import anova_oneway
    sub = D[["score", "grp3"]].dropna()
    G = {g: sub.loc[sub.grp3 == g, "score"].astype(float).values for g in (1, 2, 3)}
    N, k = len(sub), 3
    mse = sum(((x - x.mean()) ** 2).sum() for x in G.values()) / (N - k)
    t = table(sc, "output.anova.robustTitle")
    bf = anova_oneway(list(G.values()), use_var="bf")
    check(sc, "Brown-Forsythe F", cell(sc, t, ["output.col.brownForsythe"], "output.col.statistic"), bf.statistic)
    check(sc, "Brown-Forsythe df2", cell(sc, t, ["output.col.brownForsythe"], "output.col.df2"), bf.df[1])
    t = table(sc, "output.anova.postHocTitle")
    for i, j in ((1, 2), (1, 3), (2, 3)):
        xi, xj = G[i], G[j]
        diff = xi.mean() - xj.mean()
        se = math.sqrt(mse * (1 / len(xi) + 1 / len(xj)))
        p_lsd = 2 * stats.t.sf(abs(diff / se), N - k)
        check(sc, f"Bonferroni {i}-{j} p", cell(sc, t, ["output.col.bonferroni", i, j], "output.col.sig"),
              min(1.0, 3 * p_lsd), p=True)
        Fs = diff * diff / (se * se * (k - 1))
        check(sc, f"Scheffe {i}-{j} p", cell(sc, t, ["output.col.scheffe", i, j], "output.col.sig"),
              stats.f.sf(Fs, k - 1, N - k), p=True)
        vi, vj = xi.var(ddof=1) / len(xi), xj.var(ddof=1) / len(xj)
        df = (vi + vj) ** 2 / (vi ** 2 / (len(xi) - 1) + vj ** 2 / (len(xj) - 1))
        q = abs(diff) / math.sqrt((vi + vj) / 2)
        check(sc, f"Games-Howell {i}-{j} p", cell(sc, t, ["output.col.gamesHowell", i, j], "output.col.sig"),
              stats.studentized_range.sf(q, k, df), p=True, rel=1e-4)
        check(sc, f"Games-Howell {i}-{j} SE", cell(sc, t, ["output.col.gamesHowell", i, j], "output.col.stdError"),
              math.sqrt(vi + vj))

if has("x-explore-normality"):
    sc = "x-explore-normality"
    t = table(sc, "output.explore.normalityTitle")
    for g in (1, 2):
        x = s("score", D.grp2 == g)
        sw = stats.shapiro(x)
        check(sc, f"g{g} Shapiro W", cell(sc, t, [g], "output.normality.col.swStat"), sw.statistic)
        check(sc, f"g{g} Shapiro p", cell(sc, t, [g], "output.normality.col.swSig"), sw.pvalue, p=True, rel=1e-4)
        z = (x - x.mean()) / sd(x)
        check(sc, f"g{g} Lilliefors D", cell(sc, t, [g], "output.normality.col.ksStat"), stats.kstest(z, "norm").statistic)
        td = table(sc, f"output.explore.descTitle:score (grp2 = {g})")
        check(sc, f"g{g} 5% trimmed mean", cell(sc, td, ["output.stat.trimmedMean"], "output.col.value"),
              spss_trimmed_mean(x.values))
        ci = stats.t.interval(0.95, len(x) - 1, loc=x.mean(), scale=sd(x) / math.sqrt(len(x)))
        check(sc, f"g{g} CI low", cell(sc, td, ["output.stat.ciLower"], "output.col.value"), ci[0])


def replicate(cols):
    """Frequency weights: a case of weight w counts as w cases (SPSS WEIGHT BY)."""
    sub = D[cols + ["wt"]].dropna(subset=["wt"])
    return sub.loc[sub.index.repeat(sub.wt.astype(int))].reset_index(drop=True)


if has("x-frequencies-weighted"):
    sc = "x-frequencies-weighted"
    R_ = replicate(["grp3"])
    t = table(sc, "output.frequencies.tableTitle")
    for g in (1, 2, 3):
        check(sc, f"weighted freq {g}", cell(sc, t, [f"{g:.2f}"], "output.col.frequency"), (R_.grp3 == g).sum())
    t = table(sc, "output.frequencies.statsTitle")
    check(sc, "weighted N", cell(sc, t, ["output.stat.nValid"], "output.col.value"), len(R_))
    check(sc, "weighted mean", cell(sc, t, ["output.stat.mean"], "output.col.value"), R_.grp3.mean())
    check(sc, "weighted sd", cell(sc, t, ["output.stat.sd"], "output.col.value"), R_.grp3.std(ddof=1))

if has("x-descriptives-weighted"):
    sc = "x-descriptives-weighted"
    R_ = replicate(["score", "income"])
    t = table(sc, "output.descriptives.title")
    for v in ("score", "income"):
        x = R_[v].dropna()
        check(sc, f"{v} weighted N", cell(sc, t, [v], "output.col.n"), len(x))
        check(sc, f"{v} weighted mean", cell(sc, t, [v], "output.col.mean"), x.mean())
        check(sc, f"{v} weighted sd", cell(sc, t, [v], "output.col.sd"), x.std(ddof=1))
    check(sc, "weighted valid N listwise", cell(sc, t, ["output.descriptives.validN"], "output.col.n"),
          len(R_.dropna(subset=["score", "income"])))

if has("x-ttest-weighted"):
    sc = "x-ttest-weighted"
    R_ = replicate(["score", "grp2"])
    a = R_.score[R_.grp2 == 1].dropna()
    b = R_.score[R_.grp2 == 2].dropna()
    tg = table(sc, "output.ttestInd.groupStatsTitle")
    tt = table(sc, "output.ttestInd.testTitle")
    check(sc, "weighted n g1", cell(sc, tg, ["score", 1], "output.col.n"), len(a))
    check(sc, "weighted sd g2", cell(sc, tg, ["score", 2], "output.col.stdDeviation"), b.std(ddof=1))
    eq, ne = stats.ttest_ind(a, b), stats.ttest_ind(a, b, equal_var=False)
    check(sc, "weighted t", cell(sc, tt, ["score", "output.col.equalAssumed"], "output.col.t"), eq.statistic)
    check(sc, "weighted df", cell(sc, tt, ["score", "output.col.equalAssumed"], "output.col.df"), eq.df)
    check(sc, "weighted Welch df", cell(sc, tt, ["score", "output.col.equalNotAssumed"], "output.col.df"), ne.df)
    check(sc, "weighted Levene F", cell(sc, tt, ["score", "output.col.equalAssumed"], "output.col.leveneF"),
          stats.levene(a, b, center="mean").statistic)

# ── Power, ROC metrics, report ─────────────────────────────────────────────

if has("power-onesample"):
    sc = "power-onesample"
    from statsmodels.stats.power import TTestIndPower
    t = table(sc, "output.power.title")
    pw = TTestIndPower()
    check(sc, "achieved power (d=.5, n=30/group)", cell(sc, t, ["output.power.achieved"], "output.col.value"),
          pw.power(0.5, 30, 0.05, alternative="two-sided"))
    check(sc, "required n per group", cell(sc, t, ["output.power.reqNPerGroup"], "output.col.value"),
          math.ceil(pw.solve_power(0.5, power=0.8, alpha=0.05, alternative="two-sided")))

if has("roc-analysis-score-disease"):
    sc = "roc-analysis-score-disease"
    lw = D[["score", "disease"]].dropna()
    pos, neg = lw.score[lw.disease == 1], lw.score[lw.disease == 0]
    t = table(sc, "output.rocAnalysis.metricsTitle")
    for rw in (t["rows"] if t else []):
        cut = float(rw[col(t, "output.col.positiveIfGe")])
        check(sc, f"sens @{cut}", rw[col(t, "output.col.sensitivity")], (pos >= cut).mean())
        check(sc, f"spec @{cut}", rw[col(t, "output.col.specificity")], (neg < cut).mean())

if has("report-rows-score-grp3"):
    sc = "report-rows-score-grp3"
    t = table(sc, "output.reportSummaries.title")
    for g in (1, 2, 3):
        x = s("score", D.grp3 == g)
        check(sc, f"g{g} mean", cell(sc, t, [g, "output.col.mean"], "score"), x.mean())
        check(sc, f"g{g} sd", cell(sc, t, [g, "output.col.sd"], "score"), sd(x))
    check(sc, "total mean", cell(sc, t, ["output.col.total", "output.col.mean"], "score"), s("score").mean())

# ── Not compared ───────────────────────────────────────────────────────────

for scn in ("kmeans-score-age", "hierarchical-q1-q3", "knn-disease-score-age", "tree-disease-score-age",
            "mi-score-income", "mds-q1-q3", "glmm-disease-score-grp3", "probit-disease-score",
            "multinomial-grp3-score-age", "chart-histogram-score"):
    if scn in RES:
        notes.append(f"{scn}: not compared (random, algorithm-specific or covered elsewhere)")

for scn, r in RES.items():
    if r.get("error") or r.get("success") is False:
        failures.append(f"{scn}: analysis failed in SAI ({r.get('error')})")

print(f"\n[py-parity] {passes} values agree with Python, {len(failures)} differ")
for f in failures:
    print("  DIFF " + f)
for n_ in notes:
    print("  note " + n_)
sys.exit(1 if failures else 0)
