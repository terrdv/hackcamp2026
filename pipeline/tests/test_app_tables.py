"""monthly_cases / disease_trend / map_points (gold tables read by the web app)."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from visitwell_pipeline.gold.app_tables import classify_trend, disease_trend, map_points, monthly_cases

AS_OF = dt.date(2026, 11, 7)


def measles(iso="AAA", values=(10,) * 12, end="2026-09-01"):
    ps = pd.date_range(end=end, periods=len(values), freq="MS")
    return pd.DataFrame({"location_iso3": iso, "admin1": None, "period_start": ps, "cases": list(values),
                         "source": "WHO", "data_as_of": pd.Timestamp(end)})


def dengue(iso="AAA", admin1=None, values=(5,) * 12, end="2026-09-01", observed=True):
    ps = pd.date_range(end=end, periods=len(values), freq="MS")
    from visitwell_pipeline.countries import admin1_key
    return pd.DataFrame({"location_iso3": iso, "admin1": admin1, "admin1_key": admin1_key(admin1),
                         "period_start": ps, "cases": list(values), "month_observed": observed,
                         "source": "OpenDengue", "data_as_of": pd.Timestamp(end)})


def flu(iso="AAA", end="2026-10-01", latest_week="2026-10-26", values=(100,) * 12):
    ps = pd.date_range(end=end, periods=len(values), freq="MS")
    return pd.DataFrame({"location_iso3": iso, "admin1": None, "period_start": ps, "positives": list(values),
                         "month_observed": True, "source": "FluNet", "data_as_of": pd.Timestamp(latest_week)})


def centroids(rows):
    return pd.DataFrame([dict(location_iso3=i, admin1=a, admin1_key=k, latitude=la, longitude=lo, usable=True)
                         for i, a, k, la, lo in rows])


def test_series_window_and_unknown_destination(cfg):
    cfg["app"]["series_months"] = 6
    m = monthly_cases(None, None, pd.concat([measles(values=range(1, 13)), measles(iso="ZZZ")]), cfg)
    assert set(m.location_iso3) == {"AAA"}
    assert len(m) == 6 and m.cases.tolist() == [7, 8, 9, 10, 11, 12]
    assert m.metric.unique().tolist() == ["reported_cases"]


def test_unobserved_dengue_month_is_null_not_zero(cfg):
    d = dengue(values=(5,) * 12)
    d.loc[d.index[-2], "month_observed"] = False
    m = monthly_cases(None, d, None, cfg)
    assert m.cases.isna().sum() == 1


def test_partial_influenza_month_is_dropped(cfg):
    # latest week starts 2026-11-02: November is partial -> its value is null and October is the latest month
    f = flu(end="2026-11-01", latest_week="2026-11-02")
    m = monthly_cases(f, None, None, cfg)
    assert m.period_start.max() == dt.date(2026, 10, 1)
    t = disease_trend(m, cfg, AS_OF)
    assert t.latest_period.iloc[0] == dt.date(2026, 10, 1)


@pytest.mark.parametrize("recent,prior,expected", [
    (125, 100, "increasing"), (124, 100, "stable"), (80, 100, "decreasing"), (81, 100, "stable"),
    (0, 0, "stable"), (5, 0, "increasing"),
])
def test_classify_trend_boundaries(cfg, recent, prior, expected):
    assert classify_trend(recent, prior, cfg)[0] == expected


def test_trend_from_last_two_windows(cfg):
    vals = (1,) * 6 + (10, 10, 10, 20, 20, 20)
    t = disease_trend(monthly_cases(None, None, measles(values=vals), cfg), cfg, AS_OF)
    r = t.iloc[0]
    assert (r.recent_cases, r.prior_cases, r.trend) == (60, 30, "increasing")
    assert r.latest_cases == 20 and r.latest_period == dt.date(2026, 9, 1)


def test_gap_in_window_gives_unknown_trend(cfg):
    vals = [10.0] * 12
    vals[-4] = np.nan
    t = disease_trend(monthly_cases(None, None, measles(values=vals), cfg), cfg, AS_OF)
    assert t.trend.iloc[0] == "unknown" and "not reported" in t.trend_note.iloc[0]


def test_stale_series_gives_unknown_trend(cfg):
    t = disease_trend(monthly_cases(None, None, measles(end="2024-12-01"), cfg), cfg, AS_OF)
    assert t.trend.iloc[0] == "unknown" and "months old" in t.trend_note.iloc[0]
    assert t.latest_cases.iloc[0] == 10     # the count is still shown, with its period


def test_map_points_prefer_recent_admin1(cfg):
    d = pd.concat([dengue(), dengue(admin1="North", values=(3,) * 12), dengue(admin1="Old", end="2010-12-01"),
                   dengue(admin1="NoCoords")])
    t = disease_trend(monthly_cases(None, d, measles(), cfg), cfg, AS_OF)
    c = centroids([("AAA", None, None, 1.0, 2.0), ("AAA", "North", "NORTH", 3.0, 4.0), ("AAA", "Old", "OLD", 5.0, 6.0)])
    p = map_points(t, c, cfg, AS_OF)
    den = p[p.disease == "dengue"]
    assert den.admin1.tolist() == ["North"] and den.point_type.tolist() == ["admin1"]
    assert (den.latitude.iloc[0], den.longitude.iloc[0], den.cases.iloc[0]) == (3.0, 4.0, 3.0)
    mea = p[p.disease == "measles"]
    assert mea.point_type.tolist() == ["national"] and mea.latitude.iloc[0] == 1.0


def test_map_points_need_coordinates(cfg):
    t = disease_trend(monthly_cases(None, None, measles(), cfg), cfg, AS_OF)
    assert map_points(t, centroids([("BBB", None, None, 1.0, 2.0)]), cfg, AS_OF).empty
