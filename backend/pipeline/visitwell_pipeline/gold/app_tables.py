"""Gold tables shaped for the web app's charts, case counts, trend badges and map dots.

* monthly_cases : one row per disease x location x admin1 x month (last `app.series_months` months of each series)
* disease_trend : latest month's count + trend per disease x location x admin1
* map_points    : one point per disease x place with coordinates from the centroids seed

Counts are what the source reports: influenza = lab-confirmed positive specimens (WHO FluNet),
dengue / measles = reported cases. Unreported months stay null and make the trend `unknown`.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

SERIES = ["disease", "location_iso3", "admin1", "admin1_key"]
MONTHLY_COLS = [*SERIES, "period_start", "year", "month", "cases", "metric", "source", "data_as_of"]
TREND_COLS = [*SERIES, "metric", "latest_period", "latest_cases", "recent_cases", "prior_cases", "trend_ratio",
              "trend", "trend_note", "source", "data_as_of"]
POINT_COLS = ["point_id", *SERIES, "point_type", "latitude", "longitude", "cases", "period_start", "metric",
              "source", "data_as_of"]


def _months_between(a: pd.Timestamp, b: pd.Timestamp) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _std(df: pd.DataFrame | None, disease: str, cases: pd.Series | None, metric: str) -> pd.DataFrame:
    if df is None or df.empty or cases is None:
        return pd.DataFrame(columns=MONTHLY_COLS)
    out = pd.DataFrame({
        "disease": disease,
        "location_iso3": df.location_iso3.values,
        "admin1": df.admin1.values if "admin1" in df else None,
        "admin1_key": df.admin1_key.values if "admin1_key" in df else None,
        "period_start": pd.to_datetime(df.period_start).values,
        "cases": pd.to_numeric(cases, errors="coerce").values,
        "metric": metric,
        "source": df.source.values if "source" in df else None,
        "data_as_of": pd.to_datetime(df.data_as_of).values if "data_as_of" in df else pd.NaT,
    })
    out["admin1"] = out.admin1.astype(object).where(out.admin1.notna(), None)
    out["admin1_key"] = out.admin1_key.astype(object).where(out.admin1_key.notna(), None)
    return out


def monthly_cases(influenza_monthly: pd.DataFrame | None, dengue_monthly: pd.DataFrame | None,
                  measles_monthly: pd.DataFrame | None, cfg) -> pd.DataFrame:
    frames = []
    fm = influenza_monthly
    if fm is not None and len(fm):
        fm = fm.copy()
        ps, asof = pd.to_datetime(fm.period_start), pd.to_datetime(fm.data_as_of)
        # the month holding the latest week is only complete once that week reaches the month's last days
        month_end = ps + pd.offsets.MonthEnd(0)
        partial = (ps.dt.to_period("M") == asof.dt.to_period("M")) & (asof + pd.Timedelta(days=6) < month_end)
        cases = fm.positives.where(fm.month_observed.astype(bool) & ~partial)
        frames.append(_std(fm, "influenza", cases, "lab_confirmed_positives"))
    dm = dengue_monthly
    if dm is not None and len(dm):
        cases = dm.cases.where(dm.month_observed.astype(bool)) if "month_observed" in dm else dm.cases
        frames.append(_std(dm, "dengue", cases, "reported_cases"))
    mm = measles_monthly
    if mm is not None and len(mm):
        frames.append(_std(mm, "measles", mm.cases, "reported_cases"))
    frames = [f for f in frames if len(f)]
    if not frames:
        return pd.DataFrame(columns=MONTHLY_COLS)
    df = pd.concat(frames, ignore_index=True)
    df = df[df.location_iso3.isin(cfg["destinations"])]

    keys = df[SERIES].fillna("__none__")
    df["_k"] = keys.agg("|".join, axis=1)
    latest = df[df.cases.notna()].groupby("_k").period_start.max().rename("_latest")
    df = df.merge(latest, how="inner", left_on="_k", right_index=True)   # series with no data at all are dropped
    n = int(cfg["app"]["series_months"])
    first = df._latest - pd.DateOffset(months=n - 1)
    df = df[(df.period_start >= first) & (df.period_start <= df._latest)].copy()
    df["year"], df["month"] = df.period_start.dt.year, df.period_start.dt.month
    df["period_start"] = df.period_start.dt.date
    df["data_as_of"] = pd.to_datetime(df.data_as_of).dt.date
    return (df[MONTHLY_COLS].sort_values([*SERIES, "period_start"], na_position="first")
            .reset_index(drop=True))


def classify_trend(recent: float, prior: float, cfg) -> tuple[str, float | None]:
    a = cfg["app"]
    if recent == 0 and prior == 0:
        return "stable", None
    if prior == 0:
        return "increasing", None
    ratio = recent / prior
    if ratio >= a["trend_increase_ratio"]:
        return "increasing", ratio
    if ratio <= a["trend_decrease_ratio"]:
        return "decreasing", ratio
    return "stable", ratio


def disease_trend(monthly: pd.DataFrame, cfg, as_of: dt.date) -> pd.DataFrame:
    a = cfg["app"]
    w = int(a["trend_window_months"])
    rows = []
    if monthly is None or monthly.empty:
        return pd.DataFrame(columns=TREND_COLS)
    m = monthly.copy()
    m["period_start"] = pd.to_datetime(m.period_start)
    for _, g in m.groupby(m[SERIES].fillna("__none__").agg("|".join, axis=1), sort=False):
        g = g.sort_values("period_start")
        obs = g[g.cases.notna()]
        last = obs.iloc[-1]
        latest = pd.Timestamp(last.period_start)
        # a full calendar grid back from the latest month, so unreported months show up as gaps
        grid = pd.date_range(latest - pd.DateOffset(months=2 * w - 1), latest, freq="MS")
        vals = g.set_index("period_start").cases.reindex(grid)
        recent, prior = vals.iloc[w:], vals.iloc[:w]
        rec = dict(zip(SERIES, last[SERIES]), metric=last.metric, latest_period=latest.date(),
                   latest_cases=float(last.cases), recent_cases=np.nan, prior_cases=np.nan, trend_ratio=np.nan,
                   trend="unknown", trend_note=None, source=last.source, data_as_of=last.data_as_of)
        age = _months_between(latest, pd.Timestamp(as_of))
        if recent.isna().any() or prior.isna().any():
            rec["trend_note"] = f"a month in the last {2 * w} months was not reported"
        elif age > a["trend_max_age_months"]:
            rec["trend_note"] = f"latest data is {age} months old"
            rec["recent_cases"], rec["prior_cases"] = float(recent.sum()), float(prior.sum())
        else:
            rec["recent_cases"], rec["prior_cases"] = float(recent.sum()), float(prior.sum())
            rec["trend"], ratio = classify_trend(rec["recent_cases"], rec["prior_cases"], cfg)
            rec["trend_ratio"] = np.nan if ratio is None else ratio
        rows.append(rec)
    return pd.DataFrame(rows, columns=TREND_COLS).reset_index(drop=True)


def map_points(trend: pd.DataFrame, centroids: pd.DataFrame | None, cfg, as_of: dt.date) -> pd.DataFrame:
    """Admin1 points where the series is recent and has coordinates; otherwise one national point."""
    if trend is None or trend.empty or centroids is None or centroids.empty:
        return pd.DataFrame(columns=POINT_COLS)
    c = centroids[centroids.usable.astype(bool)] if "usable" in centroids else centroids
    nat_xy = c[c.admin1_key.isna()].set_index("location_iso3")[["latitude", "longitude"]]
    a1_xy = c[c.admin1_key.notna()].set_index(["location_iso3", "admin1_key"])[["latitude", "longitude"]]
    max_age = int(cfg["app"]["map_max_age_months"])
    rows = []

    def point(r, kind, lat, lon):
        rows.append(dict(point_id=f"{r.disease}:{r.location_iso3}:{r.admin1_key or 'national'}",
                         disease=r.disease, location_iso3=r.location_iso3, admin1=r.admin1,
                         admin1_key=r.admin1_key, point_type=kind, latitude=float(lat), longitude=float(lon),
                         cases=r.latest_cases, period_start=r.latest_period, metric=r.metric, source=r.source,
                         data_as_of=r.data_as_of))

    for (disease, iso), g in trend.groupby(["disease", "location_iso3"], sort=False):
        sub = g[g.admin1_key.notna()]
        sub = sub[[(_months_between(pd.Timestamp(p), pd.Timestamp(as_of)) <= max_age) and
                   ((iso, k) in a1_xy.index) for p, k in zip(sub.latest_period, sub.admin1_key)]]
        if len(sub):
            for r in sub.itertuples():
                xy = a1_xy.loc[(iso, r.admin1_key)]
                point(r, "admin1", xy.latitude, xy.longitude)
            continue
        nat = g[g.admin1_key.isna()]
        if len(nat) and iso in nat_xy.index:
            xy = nat_xy.loc[iso]
            point(nat.iloc[0], "national", xy.latitude, xy.longitude)
    return pd.DataFrame(rows, columns=POINT_COLS)
