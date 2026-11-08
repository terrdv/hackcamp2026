"""Levels from downloaded data only, and the 'missing data -> unknown' rule in destination_outlook."""
import datetime as dt

import pandas as pd

from conftest import build_all, monthly_frame, weekly_frame
from visitwell_pipeline.gold.measles_status import measles_level


def dengue_monthly(iso="AAA"):
    d = monthly_frame(iso=iso).rename(columns={"value": "cases"})
    d["data_as_of"] = pd.Timestamp("2015-12-31")
    return d


def rows(o, disease, iso="AAA"):
    return o[(o.disease == disease) & (o.location_iso3 == iso) & (o.row_type != "reminder")]


def malaria(rows):
    """rows: list of (iso3, year, incidence, is_latest)."""
    return pd.DataFrame([dict(location_iso3=i, admin1=None, admin1_key=None, year=y, incidence=inc,
                              unit="cases per 1,000 population at risk", source="WHO GHO",
                              data_as_of=pd.Timestamp(f"{y}-12-31"), is_latest=lat) for i, y, inc, lat in rows])


def test_dengue_uses_seasonal_rows_without_any_seed(cfg):
    o = build_all(cfg, dengue_monthly=dengue_monthly())
    d = rows(o, "dengue").set_index("month")
    assert len(d) == 12 and d.loc[12, "level"] == "peak" and d.loc[12, "based_on"] == "seasonal"
    assert d.verified.all()


def test_dengue_insufficient_years_is_unknown(cfg):
    dm = dengue_monthly()
    o = build_all(cfg, dengue_monthly=dm[dm.year < 2013])        # 3 complete years
    d = rows(o, "dengue")
    assert (d.level == "unknown").all() and "fewer than 5" in d.notes.iloc[0]


def test_no_dengue_data_is_unknown_not_low(cfg):
    d = rows(build_all(cfg), "dengue")
    assert set(d.level) == {"unknown"} and d.notes.iloc[0] == "no dengue data"


def test_malaria_from_who_incidence(cfg):
    m = malaria([("AAA", 2023, 2.0, False), ("AAA", 2024, 1.5, True), ("BBB", 2024, 0.0, True)])
    o = build_all(cfg, malaria_annual=m)
    a, b = rows(o, "malaria"), rows(o, "malaria", "BBB")
    assert a.level.tolist() == ["present"] and a.based_on.iloc[0] == "estimated_incidence"
    assert "1.5" in a.notes.iloc[0] and str(a.data_as_of.iloc[0]) == "2024-12-31"
    assert b.level.tolist() == ["not_reported"]


def test_malaria_without_estimate_is_unknown_not_none(cfg):
    o = build_all(cfg, malaria_annual=malaria([("AAA", 2024, 1.0, True)]))
    b = rows(o, "malaria", "BBB")
    assert b.level.tolist() == ["unknown"] and "no WHO malaria estimate" in b.notes.iloc[0]


def test_diseases_without_a_source_are_unknown(cfg):
    o = build_all(cfg)
    for disease in ["yellow_fever", "hepatitis_a", "typhoid"]:
        r = rows(o, disease)
        assert r.level.tolist() == ["unknown"], disease
        assert r.notes.iloc[0] == "no data source for this disease yet"


def test_no_influenza_data_is_unknown_not_low(cfg):
    o = build_all(cfg)
    f = rows(o, "influenza")
    assert set(f.level) == {"unknown"}
    assert "low" not in set(f.level)


def test_influenza_rows_with_data(cfg):
    o = build_all(cfg, flu_monthly=monthly_frame(), flu_weekly=weekly_frame())
    f = rows(o, "influenza")
    assert (f.row_type == "seasonal").sum() == 12 and (f.row_type == "realtime").sum() == 1
    assert rows(o, "influenza", "BBB").level.eq("unknown").all()


def test_measles_missing_or_stale_is_unknown(cfg):
    assert measles_level(None, None, cfg) == "unknown"
    assert measles_level(0, 0.0, cfg) == "not_reported"
    assert measles_level(5, 1.0, cfg) == "circulating"
    assert measles_level(500, 50.0, cfg) == "high"
    mm = pd.DataFrame([dict(location_iso3="AAA", period_start=pd.Timestamp("2025-01-01"), cases_12m=500,
                            incidence_12m_per_million=50.0, population=1e7, pop_year=2024, pop_source="t",
                            source="WHO")])
    o = build_all(cfg, measles_monthly=mm, as_of=dt.date(2026, 11, 7))
    m = rows(o, "measles")
    assert m.level.iloc[0] == "unknown" and "months old" in m.notes.iloc[0]
    assert rows(o, "measles", "BBB").level.iloc[0] == "unknown"


def test_measles_alert_overrides_to_outbreak(cfg):
    mm = pd.DataFrame([dict(location_iso3="AAA", period_start=pd.Timestamp("2026-10-01"), cases_12m=0,
                            incidence_12m_per_million=0.0, population=1e7, pop_year=2025, pop_source="t",
                            source="WHO")])
    al = pd.DataFrame([dict(disease="measles", location_iso3="AAA", admin1=None, admin1_key=None, level="level 1",
                            title="Measles in AAA", url="https://example.org/notice",
                            issued=pd.Timestamp("2026-10-15"), expires=pd.NaT, verified=True,
                            source_url="https://example.org/notice", checked_on=pd.Timestamp("2026-10-20"),
                            usable=True)])
    o = build_all(cfg, measles_monthly=mm, alerts=al)
    m = rows(o, "measles")
    assert m.level.iloc[0] == "outbreak" and m.based_on.iloc[0] == "official_alert"


def test_reminders_always_present(cfg):
    o = build_all(cfg)
    rem = o[(o.row_type == "reminder") & (o.location_iso3 == "AAA")]
    assert set(rem.disease) == {"covid19", "measles"}
    assert rem.level.isna().all()
    assert set(rem.card_group) == {"respiratory", "measles"}
