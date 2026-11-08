"""Shared synthetic fixtures. No test touches the network or data/raw."""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from visitwell_pipeline.config import load_config  # noqa: E402

PATTERN = {m: 1.0 for m in range(1, 13)} | {1: 1.5, 12: 3.0}   # Jan moderate, Dec peak, rest low


@pytest.fixture
def cfg(tmp_path):
    c = load_config(overrides={"destinations": ["AAA", "BBB"]}, root=tmp_path)
    return c


def monthly_frame(iso="AAA", years=range(2010, 2016), pattern=PATTERN, admin1=None, complete=True):
    rows = [dict(location_iso3=iso, admin1=admin1, year=y, month=m, value=pattern[m], is_complete_year=complete)
            for y in years for m in range(1, 13)]
    return pd.DataFrame(rows)


def weekly_frame(iso="AAA", latest=dt.date(2026, 10, 26), years=range(2012, 2026), base_pp=0.10, latest_pp=0.10,
                 specimens=100.0):
    """One valid week per year at the ISO week of `latest`, plus the latest week itself."""
    iso_year, iso_week, _ = latest.isocalendar()
    rows = []
    for i, y in enumerate(years):
        ws = dt.date.fromisocalendar(y, min(iso_week, 52), 1)
        rows.append(dict(location_iso3=iso, period_start=pd.Timestamp(ws), iso_year=y, iso_week=min(iso_week, 52),
                         percent_positive=base_pp + 0.01 * i, specimens=specimens, is_valid=True))
    rows.append(dict(location_iso3=iso, period_start=pd.Timestamp(latest), iso_year=iso_year, iso_week=iso_week,
                     percent_positive=latest_pp, specimens=specimens, is_valid=True))
    return pd.DataFrame(rows)


def empty_like_silver():
    return {
        "dengue_monthly": pd.DataFrame(columns=["location_iso3", "admin1", "year", "month", "cases",
                                                "is_complete_year", "data_as_of"]),
        "measles_monthly": pd.DataFrame(columns=["location_iso3", "period_start", "cases_12m",
                                                 "incidence_12m_per_million", "population", "pop_year",
                                                 "pop_source", "source"]),
        "malaria_annual": pd.DataFrame(columns=["location_iso3", "admin1", "admin1_key", "year", "incidence",
                                                "unit", "source", "data_as_of", "is_latest"]),
    }


def build_all(cfg, *, flu_monthly=None, flu_weekly=None, dengue_monthly=None, measles_monthly=None,
              malaria_annual=None, alerts=None, as_of=dt.date(2026, 11, 7)):
    """Run the gold builders on synthetic silver inputs and return destination_outlook."""
    from visitwell_pipeline.gold.flu_realtime import flu_realtime
    from visitwell_pipeline.gold.measles_status import measles_status
    from visitwell_pipeline.gold.outlook import build_alerts, build_outlook, build_presence
    from visitwell_pipeline.gold.seasonal import seasonal_profile

    e = empty_like_silver()
    dests = pd.DataFrame({"location_iso3": cfg["destinations"], "admin1": None})
    fm = flu_monthly if flu_monthly is not None else pd.DataFrame(
        columns=["location_iso3", "admin1", "year", "month", "value", "is_complete_year"])
    fw = flu_weekly if flu_weekly is not None else pd.DataFrame(
        columns=["location_iso3", "period_start", "iso_year", "iso_week", "percent_positive", "specimens", "is_valid"])
    dm = dengue_monthly if dengue_monthly is not None else e["dengue_monthly"]
    mm = measles_monthly if measles_monthly is not None else e["measles_monthly"]
    fs = seasonal_profile(fm, "value", "influenza", cfg, cfg["influenza"]["excluded_baseline_years"], locations=dests)
    ds = seasonal_profile(dm.rename(columns={"cases": "value"}), "value", "dengue", cfg, [], locations=dests)
    al = build_alerts(alerts, as_of)
    ms = measles_status(mm, al, cfg, as_of)
    pres = build_presence(malaria_annual if malaria_annual is not None else e["malaria_annual"], cfg)
    return build_outlook(cfg, flu_seasonal=fs, flu_rt=flu_realtime(fw, cfg, as_of), flu_weekly=fw,
                         dengue_seasonal=ds, dengue_monthly=dm, measles=ms, presence=pres, alerts=al)


@pytest.fixture
def np_rng():
    return np.random.default_rng(0)
