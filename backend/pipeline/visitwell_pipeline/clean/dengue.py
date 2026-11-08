"""OpenDengue V1.3 -> silver dengue_monthly (national + admin1).

* National series: Admin0 rows from the National and Temporal extracts.
* Admin1 series: Admin1 rows from the Spatial extract, plus Admin2 rows summed to Admin1.
* Weekly (or other sub-annual) records are split across calendar months in proportion to the
  number of days that fall in each month.
* Several overlapping series can exist for the same place and year (e.g. weekly from one
  source, monthly from another). For each location-year we keep the single series that covers
  the most days, so cases are never double counted.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..countries import admin1_key
from . import months_grid

SUBANNUAL = {"Week", "Month"}
T_RANK = {"Week": 0, "Month": 1}
EXTRACT_RANK = {"national": 0, "temporal": 1, "spatial": 2}


def _records(raw: pd.DataFrame | None, extract: str) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame()
    df = pd.DataFrame({
        "location_iso3": raw["ISO_A0"].str.upper(),
        "adm1": raw["adm_1_name"],
        "adm2": raw["adm_2_name"],
        "start": pd.to_datetime(raw["calendar_start_date"], errors="coerce"),
        "end": pd.to_datetime(raw["calendar_end_date"], errors="coerce"),
        "cases": pd.to_numeric(raw["dengue_total"], errors="coerce"),
        "T_res": raw["T_res"], "S_res": raw["S_res"],
        "extract": extract,
    })
    return df[df.T_res.isin(SUBANNUAL) & df.start.notna() & df.end.notna() & df.cases.notna()
              & (df.end >= df.start)]


def split_to_months(rec: pd.DataFrame) -> pd.DataFrame:
    """Split each record (start, end, cases) across calendar months by day share."""
    rec = rec.reset_index(drop=True).copy()
    rec["days"] = (rec.end - rec.start).dt.days + 1
    sp, ep = rec.start.dt.to_period("M"), rec.end.dt.to_period("M")
    span = (ep.dt.year - sp.dt.year) * 12 + (ep.dt.month - sp.dt.month)
    pieces = []
    one = rec[span == 0]
    pieces.append(one.assign(pstart=one.start, pdays=one.days))
    two = rec[span == 1]
    if len(two):
        first_end = two.start.dt.to_period("M").dt.end_time.dt.normalize()
        d1 = (first_end - two.start).dt.days + 1
        pieces.append(two.assign(pstart=two.start, pdays=d1))
        pieces.append(two.assign(pstart=first_end + pd.Timedelta(days=1), pdays=two.days - d1))
    many = rec[span > 1]
    for _, r in many.iterrows():
        for per in pd.period_range(r.start, r.end, freq="M"):
            a, b = max(r.start, per.start_time), min(r.end, per.end_time.normalize())
            pieces.append(pd.DataFrame([{**r.to_dict(), "pstart": a, "pdays": (b - a).days + 1}]))
    out = pd.concat(pieces, ignore_index=True)
    out["year"], out["month"] = out.pstart.dt.year, out.pstart.dt.month
    out["cases_m"] = out.cases * out.pdays / out.days
    return out


def _monthly_for_level(rec: pd.DataFrame, keys: list[str], cfg) -> pd.DataFrame:
    rec = rec.drop_duplicates(subset=[*keys, "start", "end", "series"])
    parts = split_to_months(rec)
    m = (parts.groupby([*keys, "series", "T_res", "extract", "year", "month"], as_index=False)
         .agg(cases=("cases_m", "sum"), covered_days=("pdays", "sum")))
    m["dim"] = pd.to_datetime(dict(year=m.year, month=m.month, day=1)).dt.days_in_month
    m["coverage"] = (m.covered_days / m.dim).clip(upper=1.0)
    # choose one series per location-year
    score = (m.groupby([*keys, "series", "T_res", "extract", "year"], as_index=False).coverage.sum())
    score["t_rank"] = score.T_res.map(T_RANK)
    score["e_rank"] = score.extract.map(EXTRACT_RANK)
    best = (score.sort_values([*keys, "year", "coverage", "t_rank", "e_rank"],
                              ascending=[True] * len(keys) + [True, False, True, True])
            .drop_duplicates([*keys, "year"]))[[*keys, "year", "series"]]
    m = m.merge(best, on=[*keys, "year", "series"])
    grid = months_grid(m, keys)
    m = grid.merge(m.drop(columns=["dim"]), how="left", on=[*keys, "year", "month"])
    m["coverage"] = m.coverage.fillna(0.0)
    m["month_observed"] = m.coverage >= cfg["dengue"]["month_coverage_min"]
    m.loc[~m.month_observed, "cases"] = np.nan
    m["is_complete_year"] = m.groupby([*keys, "year"]).month_observed.transform("all")
    as_of = rec.groupby(keys).end.max().rename("data_as_of").reset_index()
    return m.merge(as_of, how="left", on=keys)


def clean_dengue(national: pd.DataFrame | None, spatial: pd.DataFrame | None,
                 temporal: pd.DataFrame | None, cfg) -> pd.DataFrame:
    src = cfg["sources"]["opendengue"]["name"]
    dest = cfg["destinations"]
    recs = pd.concat([_records(national, "national"), _records(temporal, "temporal"),
                      _records(spatial, "spatial")], ignore_index=True)
    if recs.empty:
        return pd.DataFrame(columns=["disease", "location_iso3", "admin1", "admin1_key", "period_start",
                                     "period_type", "year", "month", "cases", "coverage", "month_observed",
                                     "series", "source", "data_as_of", "is_complete_year", "low_sample_flag"])
    recs = recs[recs.location_iso3.isin(dest)]
    recs["series"] = recs.extract + "|" + recs.T_res + "|" + recs.S_res

    nat = recs[(recs.S_res == "Admin0") & recs.extract.isin(["national", "temporal"])].copy()
    nat["admin1"] = None
    nat_m = _monthly_for_level(nat.assign(admin1="__national__"), ["location_iso3", "admin1"], cfg)
    nat_m["admin1"] = None

    sp = recs[recs.extract == "spatial"]
    a1 = sp[(sp.S_res == "Admin1") & sp.adm1.notna()].assign(admin1=lambda d: d.adm1)
    a2 = sp[(sp.S_res == "Admin2") & sp.adm1.notna()]
    if len(a2):
        a2 = (a2.groupby(["location_iso3", "adm1", "start", "end", "T_res", "extract"], as_index=False)
              .cases.sum().assign(admin1=lambda d: d.adm1, S_res="Admin2rollup"))
        a2["series"] = a2.extract + "|" + a2.T_res + "|" + a2.S_res
    adm = pd.concat([a1, a2], ignore_index=True)
    frames = [nat_m]
    if len(adm):
        frames.append(_monthly_for_level(adm, ["location_iso3", "admin1"], cfg))
    out = pd.concat(frames, ignore_index=True)

    out["admin1"] = out.admin1.map(lambda v: None if v is None or (isinstance(v, float) and np.isnan(v))
                                   else str(v).title())
    out["admin1_key"] = out.admin1.map(admin1_key)
    out["disease"] = "dengue"
    out["period_start"] = pd.to_datetime(dict(year=out.year, month=out.month, day=1))
    out["period_type"] = "month"
    out["source"] = src
    out["low_sample_flag"] = False
    cols = ["disease", "location_iso3", "admin1", "admin1_key", "period_start", "period_type", "year", "month",
            "cases", "coverage", "month_observed", "series", "source", "data_as_of", "is_complete_year",
            "low_sample_flag"]
    return out[cols].sort_values(["location_iso3", "admin1", "period_start"], na_position="first").reset_index(drop=True)
