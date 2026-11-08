"""Presence gate and the 'missing data -> unknown' rule in destination_outlook."""
import datetime as dt

import pandas as pd

from conftest import build_all, monthly_frame, weekly_frame
from visitwell_pipeline.config import deep_merge, load_config
from visitwell_pipeline.gold.measles_status import measles_level


def dengue_monthly(iso="AAA"):
    d = monthly_frame(iso=iso).rename(columns={"value": "cases"})
    d["data_as_of"] = pd.Timestamp("2015-12-31")
    return d


def rows(o, disease, iso="AAA"):
    return o[(o.disease == disease) & (o.location_iso3 == iso) & (o.row_type != "reminder")]


def test_presence_none_gives_no_row(cfg):
    o = build_all(cfg, dengue_monthly=dengue_monthly(), seed_rows=[("dengue", "AAA", "none", True),
                                                                   ("malaria", "AAA", "none", True)])
    assert rows(o, "dengue").empty
    assert rows(o, "malaria").empty


def test_presence_unknown_gives_unknown_level(cfg):
    o = build_all(cfg, dengue_monthly=dengue_monthly(), seed_rows=[("dengue", "AAA", "unknown", True)])
    d = rows(o, "dengue")
    assert len(d) == 1 and d.level.iloc[0] == "unknown" and d.based_on.iloc[0] == "unknown"


def test_present_dengue_uses_seasonal_rows(cfg):
    o = build_all(cfg, dengue_monthly=dengue_monthly(), seed_rows=[("dengue", "AAA", "present", True)])
    d = rows(o, "dengue").set_index("month")
    assert len(d) == 12 and d.loc[12, "level"] == "peak" and d.loc[12, "based_on"] == "seasonal"


def test_present_but_insufficient_seasonal_shows_presence(cfg):
    dm = dengue_monthly()
    dm = dm[dm.year < 2013]                          # 3 years
    o = build_all(cfg, dengue_monthly=dm, seed_rows=[("dengue", "AAA", "some_areas", True)])
    d = rows(o, "dengue")
    assert (d.level == "some_areas").all() and (d.based_on == "static_presence").all()


def test_missing_seed_row_is_unknown_not_none(cfg):
    o = build_all(cfg)                                # no seed rows at all
    for disease in ["dengue", "malaria", "yellow_fever", "hepatitis_a", "typhoid"]:
        r = rows(o, disease)
        assert len(r) == 1, disease
        assert r.level.iloc[0] == "unknown", disease


def test_unverified_seed_is_unknown_by_default(cfg):
    o = build_all(cfg, seed_rows=[("malaria", "AAA", "present", False)])
    r = rows(o, "malaria")
    assert r.level.iloc[0] == "unknown" and "pending review" in r.notes.iloc[0]


def test_unverified_seed_shown_but_flagged_when_enabled(tmp_path):
    cfg = load_config(overrides={"destinations": ["AAA"], "seeds": {"use_unverified": True}}, root=tmp_path)
    o = build_all(cfg, seed_rows=[("malaria", "AAA", "present", False)])
    r = rows(o, "malaria")
    assert r.level.iloc[0] == "present" and not r.verified.iloc[0] and "UNVERIFIED" in r.notes.iloc[0]


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
    from visitwell_pipeline.clean.seeds import SCHEMAS
    mm = pd.DataFrame([dict(location_iso3="AAA", period_start=pd.Timestamp("2026-10-01"), cases_12m=0,
                            incidence_12m_per_million=0.0, population=1e7, pop_year=2025, pop_source="t",
                            source="WHO")])
    al = pd.DataFrame([dict(disease="measles", location_iso3="AAA", admin1=None, level="level 1",
                            title="Measles in AAA", url="https://example.org/notice", issued="2026-10-15",
                            expires=None, source_name="PHAC", source_url="https://example.org/notice",
                            checked_on="2026-10-20", verified="true", needs_review="false", notes=None)],
                      columns=SCHEMAS["alerts"])
    o = build_all(cfg, measles_monthly=mm, alerts=al)
    m = rows(o, "measles")
    assert m.level.iloc[0] == "outbreak" and m.based_on.iloc[0] == "official_alert"


def test_reminders_always_present(cfg):
    o = build_all(cfg)
    rem = o[(o.row_type == "reminder") & (o.location_iso3 == "AAA")]
    assert set(rem.disease) == {"covid19", "measles"}
    assert rem.level.isna().all()
    assert set(rem.card_group) == {"respiratory", "measles"}
