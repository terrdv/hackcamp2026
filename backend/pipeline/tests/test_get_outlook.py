import datetime as dt

import pandas as pd

from conftest import build_all, monthly_frame, weekly_frame
from visitwell_pipeline.api import get_outlook, trip_months, use_realtime

TODAY = dt.date(2026, 11, 7)


def outlook(cfg, latest=dt.date(2026, 10, 26)):
    return build_all(cfg, flu_monthly=monthly_frame(), flu_weekly=weekly_frame(latest=latest, latest_pp=0.5),
                     malaria_annual=pd.DataFrame([dict(location_iso3="AAA", admin1=None, admin1_key=None, year=2024,
                                                       incidence=1.5, unit="per 1,000 at risk", source="WHO GHO",
                                                       data_as_of=pd.Timestamp("2024-12-31"), is_latest=True)]),
                     as_of=TODAY)


def flu_card(res):
    return next(c for c in res["groups"]["respiratory"] if c["disease"] == "influenza")


def test_21_day_switch_boundary():
    assert use_realtime(TODAY + dt.timedelta(days=21), TODAY, 21)
    assert not use_realtime(TODAY + dt.timedelta(days=22), TODAY, 21)
    assert use_realtime(TODAY - dt.timedelta(days=3), TODAY, 21)       # trip already started


def test_realtime_used_when_departing_within_21_days(cfg):
    o = outlook(cfg)
    res = get_outlook("AAA", TODAY + dt.timedelta(days=21), TODAY + dt.timedelta(days=35), today=TODAY,
                      outlook=o, cfg=cfg)
    c = flu_card(res)
    assert c["based_on"] == "realtime" and c["level"] == "much_higher"


def test_seasonal_used_when_departing_later(cfg):
    o = outlook(cfg)
    res = get_outlook("AAA", TODAY + dt.timedelta(days=22), TODAY + dt.timedelta(days=60), today=TODAY,
                      outlook=o, cfg=cfg)
    c = flu_card(res)
    assert c["based_on"] == "seasonal"
    assert [m["month"] for m in c["months"]] == [11, 12, 1]
    assert c["level"] == "peak"                       # December in the trip window


def test_stale_realtime_falls_back_to_seasonal_with_reason(cfg):
    o = outlook(cfg, latest=dt.date(2026, 9, 1))
    res = get_outlook("AAA", TODAY + dt.timedelta(days=5), TODAY + dt.timedelta(days=12), today=TODAY,
                      outlook=o, cfg=cfg)
    c = flu_card(res)
    assert c["based_on"] == "seasonal" and c["method_reason"] == "fallback_to_seasonal"
    assert "days old" in c["fallback_reason"]


def test_realtime_goes_stale_relative_to_today(cfg):
    o = outlook(cfg)                                  # fresh at build time ...
    later = TODAY + dt.timedelta(days=30)             # ... but the app is queried a month later
    res = get_outlook("AAA", later + dt.timedelta(days=3), later + dt.timedelta(days=10), today=later,
                      outlook=o, cfg=cfg)
    assert flu_card(res)["method_reason"] == "fallback_to_seasonal"


def test_reminders_and_groups(cfg):
    res = get_outlook("AAA", TODAY + dt.timedelta(days=60), TODAY + dt.timedelta(days=70), today=TODAY,
                      outlook=outlook(cfg), cfg=cfg)
    g = res["groups"]
    assert any(c["disease"] == "covid19" and c["level"] is None for c in g["respiratory"])
    assert any(c["based_on"] == "vaccine_reminder" for c in g["measles"])
    assert any(c["disease"] == "malaria" and c["level"] == "present" for c in g["mosquito"])
    assert all(c["level"] == "unknown" for c in g["food_water"])   # no data source -> unknown


def test_unknown_destination(cfg):
    res = get_outlook("ZZZ", TODAY, TODAY, today=TODAY, outlook=outlook(cfg), cfg=cfg)
    cards = [c for v in res["groups"].values() for c in v]
    assert cards and cards[0]["level"] == "unknown"


def test_trip_months_cross_year():
    assert trip_months(dt.date(2026, 12, 20), dt.date(2027, 2, 2)) == [(2026, 12), (2027, 1), (2027, 2)]
