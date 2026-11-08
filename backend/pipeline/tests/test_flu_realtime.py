import datetime as dt

import numpy as np

from conftest import weekly_frame
from visitwell_pipeline.gold.flu_realtime import flu_realtime, freshness, percentile_label


def test_percentile_labels_and_boundaries():
    assert percentile_label(0.10, 0.20, 0.30) == "typical"
    assert percentile_label(0.20, 0.20, 0.30) == "higher_than_usual"    # p75 inclusive
    assert percentile_label(0.30, 0.20, 0.30) == "higher_than_usual"    # p90 inclusive
    assert percentile_label(0.31, 0.20, 0.30) == "much_higher"
    assert percentile_label(np.nan, 0.20, 0.30) == "unknown"


def test_realtime_percentiles_against_same_iso_week(cfg):
    w = weekly_frame(latest_pp=0.50)                 # baseline 0.10 .. 0.23 (2020/21 excluded)
    r = flu_realtime(w, cfg, dt.date(2026, 11, 7)).set_index("location_iso3").loc["AAA"]
    assert r.n_baseline_years == 12                  # 14 years minus 2020, 2021
    assert "2020" not in r.baseline_years and "2021" not in r.baseline_years
    assert r.label == "much_higher"
    assert not r.is_stale and not r.use_seasonal_fallback
    t = flu_realtime(weekly_frame(latest_pp=0.12), cfg, dt.date(2026, 11, 7)).iloc[0]
    assert t.label == "typical"


def test_stale_data_falls_back_to_seasonal_with_reason(cfg):
    w = weekly_frame(latest=dt.date(2026, 9, 7))
    r = flu_realtime(w, cfg, dt.date(2026, 11, 7)).set_index("location_iso3").loc["AAA"]
    assert r.is_stale and r.use_seasonal_fallback
    assert "days old" in r.fallback_reason


def test_freshness_boundary():
    assert freshness(dt.date(2026, 10, 10), dt.date(2026, 11, 7), 4)[0] is False   # 28 days
    assert freshness(dt.date(2026, 10, 9), dt.date(2026, 11, 7), 4)[0] is True     # 29 days
    assert freshness(None, dt.date(2026, 11, 7), 4)[0] is True


def test_too_few_baseline_years_falls_back(cfg):
    w = weekly_frame(years=range(2023, 2026))
    r = flu_realtime(w, cfg, dt.date(2026, 11, 7)).set_index("location_iso3").loc["AAA"]
    assert r.label == "insufficient_data" and r.use_seasonal_fallback


def test_no_data_is_unknown(cfg):
    r = flu_realtime(weekly_frame().iloc[0:0], cfg, dt.date(2026, 11, 7)).set_index("location_iso3")
    assert (r.label == "unknown").all() and r.use_seasonal_fallback.all()
