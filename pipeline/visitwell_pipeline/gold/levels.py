"""Burden x timing: how disease levels are decided.

Every disease gets two separate measurements:

* burden (how much): an absolute yearly rate graded none / low / moderate / high (cut-offs: `burden:` in
  config/pipeline.yaml, all placeholders that need review);
* timing (when): the relative seasonal label per month (peak / moderate / low) from gold/seasonal.py.

combine_level() merges them with one shared rule. The final level is then written to the `level` column in
the vocabulary the frontend already maps (see LEVEL_LABEL).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

TIERS = ("none", "low", "moderate", "high")
RANK = {"none": 0, "low": 1, "moderate": 2, "high": 3}
SEASON_LABELS = ("peak", "moderate", "low")

# final level -> `level` column value. Only labels frontend/src/data/report-mapping.ts already maps:
#   high -> elevated, moderate -> moderate, low -> low, not_reported -> low (!), anything else -> unknown.
LEVEL_LABEL = {"high": "high", "moderate": "moderate", "low": "low", "none": "not_reported", "unknown": "unknown"}

# burden tier x season label -> final level (burden none/low are flat, see combine_level)
MATRIX = {
    "moderate": {"peak": "high", "moderate": "moderate", "low": "low"},
    "high": {"peak": "high", "moderate": "high", "low": "moderate"},
}
# Diseases whose precautions apply all year: the final level never drops below moderate when the burden is
# moderate or high, whatever the season says.
YEAR_ROUND_FLOOR = {"malaria"}


def _missing(v) -> bool:
    return v is None or (not isinstance(v, str) and pd.isna(v))


def tier_from_value(value, c: dict) -> str:
    """Grade an absolute rate with one `burden.<disease>` config block. Missing value -> unknown."""
    if _missing(value):
        return "unknown"
    v = float(value)
    if v < 0:
        return "unknown"
    if v == 0 and c.get("zero_is_none", False):
        return "none"
    if v < c["low_max"]:
        return "low"
    if v <= c["moderate_max"]:
        return "moderate"
    return "high"


def malaria_tier(incidence, cfg) -> str:
    """WHO estimated incidence per 1,000 population at risk (latest year)."""
    return tier_from_value(incidence, cfg["burden"]["malaria"])


def malaria_confidence(incidence_low, incidence_high, cfg) -> str:
    """'lower' when WHO's low and high bounds fall in different tiers, else 'normal' (also when bounds missing)."""
    lo, hi = malaria_tier(incidence_low, cfg), malaria_tier(incidence_high, cfg)
    if "unknown" in (lo, hi):
        return "normal"
    return "lower" if lo != hi else "normal"


def dengue_tier(avg_per_100k, cfg) -> str:
    """Average yearly cases per 100,000 over the last 3-5 complete years. Dengue has no `none` tier."""
    return tier_from_value(avg_per_100k, cfg["burden"]["dengue"])


def measles_tier(cases_12m, incidence_per_million, cfg) -> str:
    """Rolling 12-month incidence per million; 0 cases -> none. Missing -> unknown."""
    if _missing(cases_12m) or _missing(incidence_per_million):
        return "unknown"
    if cases_12m == 0:
        return "none"
    return tier_from_value(incidence_per_million, {**cfg["burden"]["measles"], "zero_is_none": False})


def influenza_tier(cfg) -> str:
    """EXCEPTION: influenza has no burden metric. It circulates everywhere, so the burden is fixed (moderate)
    and the seasonal timing alone decides the level."""
    return cfg["burden"]["influenza"]["fixed_tier"]


def combine_level(burden_tier: str | None, season_label: str | None, disease: str) -> str:
    """Final level from burden tier x seasonal label.

    burden none -> none, low -> low (every month); moderate -> peak high / moderate moderate / low low;
    high -> peak high / moderate high / low moderate; unknown -> unknown.
    No seasonal label (insufficient / unknown / None) -> the burden tier itself.
    Malaria: never below moderate when burden is moderate or high (precautions apply year-round).
    Influenza: burden is fixed at moderate (see influenza_tier), so the season decides.
    """
    if _missing(burden_tier) or burden_tier not in RANK:
        return "unknown"
    if disease == "influenza":
        burden_tier = "moderate"
    if burden_tier in ("none", "low") or season_label not in SEASON_LABELS:
        level = burden_tier
    else:
        level = MATRIX[burden_tier][season_label]
    if disease in YEAR_ROUND_FLOOR and RANK[burden_tier] >= RANK["moderate"] and RANK[level] < RANK["moderate"]:
        level = "moderate"
    return level


def level_label(final_level: str | None) -> str:
    """final level -> value for the existing `level` column (labels the frontend already maps)."""
    return LEVEL_LABEL.get(final_level or "unknown", "unknown")


# ---------------------------------------------------------------------------- dengue burden
DENGUE_BURDEN_COLS = ["location_iso3", "burden_value", "burden_tier", "years_used", "n_years", "first_year",
                      "last_year", "pop_years", "unknown_reason"]


def dengue_burden(monthly: pd.DataFrame, population: pd.DataFrame | None, cfg) -> pd.DataFrame:
    """Average yearly dengue cases per 100,000, national rows only (no admin1 population yet).

    * a year counts if it is flagged complete, has 12 non-null months and is not an excluded baseline year
    * the most recent `max_years` such years are used; fewer than `min_years` -> unknown (too_few_years)
    * population: same year, else the latest earlier year, else the earliest later year (as for measles)
    One row per country that has any national dengue rows; countries without rows are absent (-> no_data).
    """
    c = cfg["burden"]["dengue"]
    excluded = set(cfg["dengue"].get("excluded_baseline_years") or [])
    if monthly is None or monthly.empty:
        return pd.DataFrame(columns=DENGUE_BURDEN_COLS)
    nat = monthly[monthly.admin1.isna()] if "admin1" in monthly else monthly
    rows = []
    pop = population if population is not None else pd.DataFrame(columns=["location_iso3", "year", "population"])
    for iso, g in nat.groupby("location_iso3"):
        use = g[g.is_complete_year.astype(bool) & ~g.year.isin(excluded) & g.cases.notna()]
        yearly = use.groupby("year").agg(n=("cases", "size"), cases=("cases", "sum"))
        yearly = yearly[yearly.n == 12].sort_index().tail(c["max_years"])
        rec = dict(location_iso3=iso, burden_value=np.nan, burden_tier="unknown", years_used=None,
                   n_years=len(yearly), first_year=None, last_year=None, pop_years=None, unknown_reason=None)
        if len(yearly) < c["min_years"]:
            rec["unknown_reason"] = "too_few_years"
            rows.append(rec)
            continue
        p = pop[pop.location_iso3 == iso].dropna(subset=["population"]).sort_values("year")
        if p.empty:
            rec["unknown_reason"] = "no_population"
            rows.append(rec)
            continue
        rates, pyears = [], []
        for y, r in yearly.iterrows():
            earlier = p[p.year <= y]
            pr = earlier.iloc[-1] if len(earlier) else p.iloc[0]
            rates.append(r.cases / pr.population * 1e5)
            pyears.append(int(pr.year))
        val = float(np.mean(rates))
        yrs = [int(y) for y in yearly.index]
        rec.update(burden_value=val, burden_tier=dengue_tier(val, cfg), years_used=",".join(map(str, yrs)),
                   first_year=min(yrs), last_year=max(yrs), pop_years=",".join(map(str, pyears)))
        rows.append(rec)
    return pd.DataFrame(rows, columns=DENGUE_BURDEN_COLS)


# ---------------------------------------------------------------------------- explanation text
def fmt_rate(v) -> str:
    """Readable rate: 340, 12, 3.4, 0.27."""
    v = float(v)
    if v >= 10:
        return f"{v:,.0f}"
    if v >= 1:
        return f"{v:.1f}".rstrip("0").rstrip(".")
    return f"{v:.2g}"


SEASON_PHRASE = {"peak": "Usually a peak month for {d} here.",
                 "moderate": "Usually a moderate month for {d} here.",
                 "low": "Usually a quieter month for {d} here."}
