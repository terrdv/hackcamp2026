"""Levels from downloaded data only, and the 'missing data -> unknown' rule in destination_outlook."""
import datetime as dt

import pandas as pd

from conftest import build_all, monthly_frame, population_frame, weekly_frame
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


def test_dengue_burden_x_season(cfg):
    # fixture: ~14 cases/year, population 1,000 -> ~1,400 per 100k -> burden high
    o = build_all(cfg, dengue_monthly=dengue_monthly(), population=population_frame())
    d = rows(o, "dengue").set_index("month")
    assert len(d) == 12 and (d.burden_tier == "high").all()
    assert d.loc[12, "season_label"] == "peak" and d.loc[12, "level"] == "high"
    assert d.loc[1, "season_label"] == "moderate" and d.loc[1, "level"] == "high"
    assert d.loc[6, "season_label"] == "low" and d.loc[6, "level"] == "moderate"
    assert d.loc[12, "based_on"] == "seasonal" and d.verified.all()
    assert "peak month for dengue" in d.loc[12, "notes"] and "2011\u20132015" in d.loc[12, "notes"]
    assert (d.notes == d.based_on_text).all()


def test_dengue_low_burden_caps_peak(cfg):
    o = build_all(cfg, dengue_monthly=dengue_monthly(), population=population_frame(population=1e6))  # ~1.4/100k
    d = rows(o, "dengue").set_index("month")
    assert (d.burden_tier == "low").all() and set(d.level) == {"low"} and d.loc[12, "season_label"] == "peak"


def test_dengue_too_few_years_for_season_uses_burden(cfg):
    dm = dengue_monthly()
    o = build_all(cfg, dengue_monthly=dm[dm.year < 2013], population=population_frame())   # 3 complete years
    d = rows(o, "dengue")
    assert d.season_label.isna().all() and (d.season_source == "none").all()
    assert set(d.level) == {"high"} and d.based_on.eq("burden").all()


def test_dengue_burden_unknown_without_population(cfg):
    d = rows(build_all(cfg, dengue_monthly=dengue_monthly()), "dengue")
    assert set(d.level) == {"unknown"} and "population" in d.notes.iloc[0]


def test_no_dengue_data_is_unknown_not_low(cfg):
    d = rows(build_all(cfg), "dengue")
    assert set(d.level) == {"unknown"} and d.notes.iloc[0] == "No dengue data for this country."


def test_malaria_from_who_incidence(cfg):
    m = malaria([("AAA", 2023, 2.0, False), ("AAA", 2024, 1.5, True), ("BBB", 2024, 0.0, True)])
    o = build_all(cfg, malaria_annual=m)
    a, b = rows(o, "malaria"), rows(o, "malaria", "BBB")
    assert a.level.tolist() == ["moderate"] and a.based_on.iloc[0] == "estimated_incidence"
    assert a.burden_tier.iloc[0] == "moderate" and a.burden_value.iloc[0] == 1.5
    assert "1.5 cases per 1,000 at risk (WHO, 2024)" in a.notes.iloc[0] and str(a.data_as_of.iloc[0]) == "2024-12-31"
    assert b.level.tolist() == ["not_reported"] and b.final_level.iloc[0] == "none"


def test_malaria_without_estimate_is_unknown_not_none(cfg):
    o = build_all(cfg, malaria_annual=malaria([("AAA", 2024, 1.0, True)]))
    b = rows(o, "malaria", "BBB")
    assert b.level.tolist() == ["unknown"] and "No WHO malaria estimate" in b.notes.iloc[0]


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
    assert measles_level(5, 1.0, cfg) == "moderate"
    assert measles_level(2, 0.5, cfg) == "low"
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
