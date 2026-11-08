"""FluNet -> silver influenza_weekly and influenza_monthly."""
from __future__ import annotations

import pandas as pd

from . import iso3_series, months_grid


def validate_columns(cfg, raw: pd.DataFrame, dictionary: pd.DataFrame | None) -> dict:
    mapping = cfg["sources"]["flunet"]["columns"]
    if dictionary is not None:
        fields = set(dictionary["FieldName"].astype(str).str.strip())
        bad = {k: v for k, v in mapping.items() if v not in fields}
        if bad:
            raise ValueError(f"FluNet column mapping not found in data dictionary: {bad}")
    missing = {k: v for k, v in mapping.items() if v not in raw.columns}
    if missing:
        raise ValueError(f"FluNet columns missing from data file: {missing}")
    return mapping


def clean_influenza(raw: pd.DataFrame, dictionary: pd.DataFrame | None, cfg) -> tuple[pd.DataFrame, pd.DataFrame]:
    c = validate_columns(cfg, raw, dictionary)
    icfg = cfg["influenza"]
    src = cfg["sources"]["flunet"]["name"]

    df = pd.DataFrame({
        "location_iso3": iso3_series(raw[c["iso3"]]).fillna(raw[c["iso3"]]),
        "week_start": pd.to_datetime(raw[c["week_start"]], errors="coerce").dt.normalize(),
        "iso_year": pd.to_numeric(raw[c["iso_year"]], errors="coerce"),
        "iso_week": pd.to_numeric(raw[c["iso_week"]], errors="coerce"),
        "origin_source": raw[c["origin_source"]],
        "specimens": pd.to_numeric(raw[c["specimens_processed"]], errors="coerce"),
        "positives": pd.to_numeric(raw[c["influenza_positive"]], errors="coerce"),
    })
    df = df[df.location_iso3.isin(cfg["destinations"]) & df.week_start.notna()]

    # FluNet reports one row per surveillance-site type (SENTINEL / NONSENTINEL / NOTDEFINED);
    # sum them to get the country-week total.
    wk = (df.groupby(["location_iso3", "iso_year", "iso_week", "week_start"], as_index=False)
          .agg(specimens=("specimens", lambda s: s.sum(min_count=1)),
               positives=("positives", lambda s: s.sum(min_count=1)),
               origin_sources=("origin_source", lambda s: ",".join(sorted(set(s.dropna()))))))
    bad = wk.positives > wk.specimens
    wk["quality_note"] = None
    wk.loc[bad, "quality_note"] = "positives exceed specimens"
    wk["percent_positive"] = (wk.positives / wk.specimens).where((wk.specimens > 0) & ~bad)
    wk["low_sample_flag"] = wk.specimens.isna() | (wk.specimens < icfg["min_specimens"])
    wk["is_valid"] = ~wk.low_sample_flag & wk.percent_positive.notna()
    mid = wk.week_start + pd.Timedelta(days=3)          # ISO-week Thursday decides the month
    wk["year"], wk["month"] = mid.dt.year, mid.dt.month

    as_of = wk[wk.is_valid].groupby("location_iso3").week_start.max().rename("data_as_of")

    # monthly (pooled positives / specimens over valid weeks)
    v = wk[wk.is_valid]
    mo = (v.groupby(["location_iso3", "year", "month"], as_index=False)
          .agg(positives=("positives", "sum"), specimens=("specimens", "sum"),
               n_valid_weeks=("week_start", "size")))
    grid = months_grid(wk, ["location_iso3"])
    mo = grid.merge(mo, how="left", on=["location_iso3", "year", "month"])
    mo["n_valid_weeks"] = mo.n_valid_weeks.fillna(0).astype(int)
    mo["month_observed"] = mo.n_valid_weeks >= icfg["min_valid_weeks_per_month"]
    mo["percent_positive"] = (mo.positives / mo.specimens).where(mo.month_observed)
    complete = mo.groupby(["location_iso3", "year"]).month_observed.transform("all")
    mo["is_complete_year"] = complete
    mo["period_start"] = pd.to_datetime(dict(year=mo.year, month=mo.month, day=1))
    mo["period_type"] = "month"
    mo["low_sample_flag"] = False      # only valid weeks are pooled
    mo = mo.merge(as_of, how="left", on="location_iso3")

    yc = mo.groupby(["location_iso3", "year"]).is_complete_year.first().reset_index()
    wk = wk.merge(yc, how="left", on=["location_iso3", "year"]).merge(as_of, how="left", on="location_iso3")
    wk["is_complete_year"] = wk.is_complete_year.fillna(False).astype(bool)
    wk["period_start"] = wk.week_start
    wk["period_type"] = "week"

    for t in (wk, mo):
        t["disease"] = "influenza"
        t["admin1"] = None
        t["source"] = src
    wk_cols = ["disease", "location_iso3", "admin1", "period_start", "period_type", "iso_year", "iso_week",
               "year", "month", "specimens", "positives", "percent_positive", "origin_sources", "is_valid",
               "quality_note", "source", "data_as_of", "is_complete_year", "low_sample_flag"]
    mo_cols = ["disease", "location_iso3", "admin1", "period_start", "period_type", "year", "month",
               "specimens", "positives", "n_valid_weeks", "month_observed", "percent_positive",
               "source", "data_as_of", "is_complete_year", "low_sample_flag"]
    return (wk[wk_cols].sort_values(["location_iso3", "period_start"]).reset_index(drop=True),
            mo[mo_cols].sort_values(["location_iso3", "period_start"]).reset_index(drop=True))
