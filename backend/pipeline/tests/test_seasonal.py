import numpy as np
import pandas as pd
import pytest

from conftest import PATTERN, monthly_frame
from visitwell_pipeline.gold.seasonal import label_index, seasonal_profile


def prof(df, cfg, excluded=()):
    return seasonal_profile(df, "value", "influenza", cfg, list(excluded)).set_index("month")


def test_seasonal_index_is_median_of_month_over_yearly_mean(cfg):
    p = prof(monthly_frame(), cfg)
    mean = np.mean(list(PATTERN.values()))
    assert p.loc[12, "median_index"] == pytest.approx(3.0 / mean)
    assert p.loc[1, "median_index"] == pytest.approx(1.5 / mean)
    assert p.loc[12, "label"] == "peak"          # 2.48
    assert p.loc[1, "label"] == "moderate"       # 1.24
    assert p.loc[6, "label"] == "low"            # 0.83
    assert (p.n_years == 6).all()


def test_label_thresholds_come_from_config(cfg):
    assert label_index(1.5, cfg) == "peak"
    assert label_index(1.0, cfg) == "moderate"
    assert label_index(0.99, cfg) == "low"
    assert label_index(float("nan"), cfg) == "unknown"


def test_fewer_than_min_years_is_insufficient(cfg):
    p = prof(monthly_frame(years=range(2010, 2014)), cfg)   # 4 years
    assert (p.label == "insufficient_data").all()
    assert p.consistency.isna().all()


def test_incomplete_years_are_not_used(cfg):
    df = pd.concat([monthly_frame(years=range(2010, 2014)), monthly_frame(years=[2014], complete=False)])
    assert (prof(df, cfg).label == "insufficient_data").all()


def test_excluded_years_are_dropped(cfg):
    df = monthly_frame(years=range(2016, 2022))             # 6 years incl. 2020, 2021
    p = prof(df, cfg, excluded=[2020, 2021])
    assert (p.n_years == 4).all() and (p.label == "insufficient_data").all()
    assert "2020" not in p.years_used.iloc[0]


def test_consistency_consistent_vs_variable(cfg):
    years = list(range(2010, 2020))
    rows = []
    for i, y in enumerate(years):
        for m in range(1, 13):
            v = 1.0
            if m == 12:
                v = 5.0                                    # always top
            if m == (3 if i < 5 else 7):
                v = 4.0                                    # top only half the time
            if m == 9 and i % 3 == 0:
                v = 3.0
            rows.append(dict(location_iso3="AAA", admin1=None, year=y, month=m, value=v, is_complete_year=True))
    p = prof(pd.DataFrame(rows), cfg)
    assert p.loc[12, "consistency_score"] == 1.0 and p.loc[12, "consistency"] == "consistent"
    assert p.loc[3, "consistency_score"] == 0.5 and p.loc[3, "consistency"] == "variable"
    # tied ordinary months never count as "top 3"
    assert p.loc[5, "consistency_score"] == 0.0


def test_location_without_data_is_unknown_not_low(cfg):
    locs = pd.DataFrame({"location_iso3": ["AAA", "BBB"], "admin1": None})
    p = seasonal_profile(monthly_frame(), "value", "influenza", cfg, [], locations=locs)
    b = p[p.location_iso3 == "BBB"]
    assert len(b) == 12 and (b.label == "unknown").all()
