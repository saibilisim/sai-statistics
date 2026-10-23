# SPDX-FileCopyrightText: 2026 SAI Bilişim
# SPDX-License-Identifier: AGPL-3.0-only
# Build the shared dataset for the SPSS-vs-SAI parity runs.
#
# One CSV feeds both sides: SPSS reads it with GET DATA, our R scripts read the
# same rows through the r-validation harness. Deterministic seed, so a
# disagreement is always about the statistics and never about the data.
#
# Shape is chosen to exercise the common analyses at once:
#   score   continuous, roughly normal, with missing values
#   income  continuous, right-skewed (so skewness/kurtosis are not ~0)
#   age     integer with heavy ties (grouped median, percentiles)
#   grp2    two groups (independent t-test, crosstab)
#   grp3    three groups (one-way ANOVA)
#   region  string categories (crosstab, string statistics)
#   pre/post paired measurements (paired t-test)

set.seed(20260808)
n <- 120

df <- data.frame(
  id = seq_len(n),
  score = round(rnorm(n, 50, 12), 2),
  income = round(exp(rnorm(n, 10.2, 0.55))),
  age = sample(20:70, n, replace = TRUE),
  grp2 = rep(c(1, 2), length.out = n),
  grp3 = rep(c(1, 2, 3), length.out = n),
  # Sampled, not cycled: a period-4 cycle against grp2's period-2 cycle made
  # region determine grp2 exactly, which left the crosstab a degenerate
  # Phi = 1 instead of testing anything.
  region = sample(c("North", "South", "East", "West"), n, replace = TRUE),
  pre = round(rnorm(n, 100, 15), 2),
  stringsAsFactors = FALSE
)
# A real treatment effect so the paired test is not testing noise.
df$post <- round(df$pre + rnorm(n, 4, 8), 2)
# Group differences, so the t-test and ANOVA have something to find.
df$score <- round(df$score + ifelse(df$grp2 == 2, 5.5, 0), 2)
df$income <- round(df$income * ifelse(df$grp3 == 3, 1.25, 1))

# Missing values, deliberately in different rows per variable so listwise and
# analysis-by-analysis deletion give different Ns.
df$score[c(7, 23, 61)] <- NA
df$income[c(4, 23, 88, 99)] <- NA
df$post[c(15, 61)] <- NA

# ── Second wave of variables ────────────────────────────────────────────────
# Appended AFTER everything above, and drawing from the RNG only after it, so
# every column built above keeps the exact values the earlier comparisons were
# validated against. Adding columns cannot change a per-variable statistic.
#
#   q1..q5    correlated Likert items (Reliability's alpha, Factor's loadings)
#   surv/evt  right-censored survival time + event indicator (KM, Cox, life tables)
#   disease   binary state for ROC, predicted by `score`
#   grp4      a second factor, crossed with grp3 (two-way GLM)
#   items     a set of 0/1 responses (multiple response, binomial)
lat <- rnorm(n)                       # the common factor the items load on
for (i in 1:5) {
  df[[paste0("q", i)]] <- pmin(5, pmax(1, round(3 + 0.9 * lat + rnorm(n, 0, 0.8))))
}
# Exponential survival whose hazard really depends on grp2, censored at 24.
rate <- ifelse(df$grp2 == 2, 0.08, 0.05)
raw_t <- rexp(n, rate)
df$surv <- round(pmin(raw_t, 24), 2)
df$evt <- as.integer(raw_t <= 24)
# A state ROC can actually discriminate: higher score → more likely 1.
p <- 1 / (1 + exp(-(df$score - 52) / 8))
df$disease <- as.integer(runif(n) < ifelse(is.na(p), 0.5, p))
df$grp4 <- rep(c(1, 2), length.out = n)
# A multiple-dichotomy set (SPSS MULT RESPONSE): three 0/1 indicators derived
# from the items. Deterministic — no RNG draw — so adding them cannot disturb
# any column above even in principle.
df$d1 <- as.integer(df$q1 >= 4)
df$d2 <- as.integer(df$q2 >= 4)
df$d3 <- as.integer(df$q3 >= 4)

# Case weighting and case filtering, for the WEIGHT / SPLIT FILE / FILTER
# combination matrix. Both deterministic, both appended last, so nothing above
# moves.
#   wt    integer frequency weight 1..3 — integer so SPSS's WEIGHT BY is exactly
#         case replication and the two sides cannot disagree over how a
#         fractional weight is rounded
#   keep  0/1 filter flag that removes a bit over a third of the cases, and is
#         NOT balanced across grp2 (id %% 3 against grp2's alternating parity),
#         so filtering actually changes each group's composition rather than
#         just its size
df$wt <- as.integer(df$id %% 3) + 1L
df$keep <- as.integer(df$id %% 3 != 0)

out <- commandArgs(trailingOnly = TRUE)[1]
write.csv(df, out, row.names = FALSE, na = "", quote = FALSE)
cat(sprintf("wrote %d rows to %s\n", nrow(df), out))
cat("missing: score", sum(is.na(df$score)),
    "| income", sum(is.na(df$income)),
    "| post", sum(is.na(df$post)), "\n")
cat("columns:", paste(names(df), collapse = " "), "\n")
cat("events:", sum(df$evt), "of", nrow(df),
    "| disease:", sum(df$disease), "\n")
