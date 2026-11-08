"""Seasonal profile per disease x location x month."""
from __future__ import annotations

import numpy as np
import pandas as pd

KEYS = ["location_iso3", "admin1"]


def label_index(idx: float, cfg) -> str:
    s = cfg["seasonal"]
    if idx is None or (isinstance(idx, float) and np.isnan(idx)):
        return "unknown"
    if idx >= s["peak_min"]:
        return "peak"
    if idx >= s["moderate_min"]:
        return "moderate"
    return "low"


def seasonal_profile(monthly: pd.DataFrame, value_col: str, disease: str, cfg,
                     excluded_years: list[int] | None = None,
                     locations: pd.DataFrame | None = None) -> pd.DataFrame:
    """monthly needs: location_iso3, admin1, year, month, <value_col>, is_complete_year.

    * per complete (non-excluded) year: index = month value / that year's monthly mean
    * median index across years; < min_years usable years -> insufficient_data (0 years -> unknown)
    * consistency = share of years in which the month ranked in that year's top-N months
    `locations` (location_iso3, admin1) forces rows for places without any data (-> unknown).
    """
    s = cfg["seasonal"]
    excluded = set(excluded_years or [])
    df = monthly.copy()
    if "admin1" not in df:
        df["admin1"] = None
    df["admin1"] = df.admin1.astype(object).where(df.admin1.notna(), "__national__")
    use = df[df.is_complete_year.astype(bool) & ~df.year.isin(excluded) & df[value_col].notna()]
    # guard: a complete year must have all 12 values
    n = use.groupby([*KEYS, "year"])[value_col].transform("size")
    use = use[n == 12].copy()
    mean = use.groupby([*KEYS, "year"])[value_col].transform("mean")
    use = use[mean > 0].copy()
    use["index"] = use[value_col] / mean[mean > 0]
    use["rank"] = use.groupby([*KEYS, "year"])[value_col].rank(method="max", ascending=False)  # ties are not "top"
    use["in_top"] = use["rank"] <= s["top_n_months"]

    agg = (use.groupby([*KEYS, "month"], as_index=False)
           .agg(n_years=("year", "nunique"), median_index=("index", "median"),
                consistency_score=("in_top", "mean"),
                years_used=("year", lambda y: ",".join(map(str, sorted(y))))))

    places = df[KEYS].drop_duplicates()
    if locations is not None:
        loc = locations.copy()
        loc["admin1"] = loc.admin1.astype(object).where(loc.admin1.notna(), "__national__")
        places = pd.concat([places, loc[KEYS]]).drop_duplicates()
    grid = places.merge(pd.DataFrame({"month": range(1, 13)}), how="cross")
    out = grid.merge(agg, how="left", on=[*KEYS, "month"])
    out["n_years"] = out.n_years.fillna(0).astype(int)
    has_data = df[df[value_col].notna()][KEYS].drop_duplicates().assign(_has=True)
    out = out.merge(has_data, how="left", on=KEYS)
    out["_has"] = out["_has"].fillna(False).astype(bool)

    def lab(r):
        if r.n_years == 0 and not r._has:
            return "unknown"
        if r.n_years < s["min_years"]:
            return "insufficient_data"
        return label_index(r.median_index, cfg)
    out["label"] = out.apply(lab, axis=1)
    ok = out.n_years >= s["min_years"]
    out.loc[~ok, ["median_index", "consistency_score"]] = np.nan
    out["consistency"] = np.where(~ok, None,
                                  np.where(out.consistency_score >= s["consistency_min"], "consistent", "variable"))
    out["admin1"] = out.admin1.replace("__national__", None)
    out["disease"] = disease
    out["excluded_years"] = ",".join(map(str, sorted(excluded)))
    return out[["disease", "location_iso3", "admin1", "month", "n_years", "years_used", "excluded_years",
                "median_index", "label", "consistency_score", "consistency"]]
