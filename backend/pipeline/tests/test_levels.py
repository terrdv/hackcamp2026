"""Burden x timing (gold/levels.py): combination matrix, tier boundaries, malaria confidence, dengue burden,
removed diseases and the `level` vocabulary the frontend maps."""
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from conftest import build_all, monthly_frame, population_frame, weekly_frame
from visitwell_pipeline.gold.levels import (combine_level, dengue_burden, dengue_tier, influenza_tier,
                                            malaria_confidence, malaria_tier, measles_tier)
from visitwell_pipeline.gold.measles_status import measles_level

REMOVED = {"yellow_fever", "hepatitis_a", "typhoid"}
MAPPING_TS = Path(__file__).resolve().parents[3] / "frontend" / "src" / "data" / "report-mapping.ts"


# ---------------------------------------------------------------------------- combination matrix
@pytest.mark.parametrize("burden,season,expected", [
    ("none", "peak", "none"), ("none", "moderate", "none"), ("none", "low", "none"), ("none", None, "none"),
    ("low", "peak", "low"), ("low", "moderate", "low"), ("low", "low", "low"), ("low", None, "low"),
    ("moderate", "peak", "high"), ("moderate", "moderate", "moderate"), ("moderate", "low", "low"),
    ("moderate", None, "moderate"),
    ("high", "peak", "high"), ("high", "moderate", "high"), ("high", "low", "moderate"), ("high", None, "high"),
    ("unknown", "peak", "unknown"), ("unknown", "low", "unknown"), ("unknown", None, "unknown"),
    (None, "peak", "unknown"),
])
def test_matrix(burden, season, expected):
    assert combine_level(burden, season, "dengue") == expected


@pytest.mark.parametrize("season", ["insufficient_data", "unknown", None, np.nan])
def test_season_unavailable_gives_burden_tier(season):
    for b in ["none", "low", "moderate", "high"]:
        assert combine_level(b, season, "dengue") == b


@pytest.mark.parametrize("burden,season,expected", [
    ("moderate", "low", "moderate"),      # floor (would be low)
    ("moderate", "moderate", "moderate"), ("moderate", "peak", "high"),
    ("high", "low", "moderate"), ("high", "moderate", "high"), ("high", "peak", "high"),
    ("low", "peak", "low"), ("low", "low", "low"),   # floor only for moderate / high burden
    ("none", "low", "none"), ("unknown", "low", "unknown"),
    ("moderate", None, "moderate"), ("high", None, "high"),
])
def test_malaria_floor(burden, season, expected):
    assert combine_level(burden, season, "malaria") == expected


def test_influenza_exception(cfg):
    assert influenza_tier(cfg) == "moderate"
    for b in ["moderate", "low", "high", "none"]:       # burden is forced to moderate for influenza
        assert combine_level(b, "peak", "influenza") == "high"
        assert combine_level(b, "moderate", "influenza") == "moderate"
        assert combine_level(b, "low", "influenza") == "low"
        assert combine_level(b, None, "influenza") == "moderate"
    assert combine_level("unknown", "peak", "influenza") == "unknown"


def test_influenza_levels_in_outlook(cfg):
    o = build_all(cfg, flu_monthly=monthly_frame(), flu_weekly=weekly_frame())
    f = o[(o.disease == "influenza") & (o.location_iso3 == "AAA") & (o.row_type == "seasonal")].set_index("month")
    assert f.loc[12, "level"] == "high" and f.loc[1, "level"] == "moderate" and f.loc[6, "level"] == "low"
    assert (f.burden_tier == "moderate").all() and (f.season_source == "observed").all()
    rt = o[(o.disease == "influenza") & (o.location_iso3 == "AAA") & (o.row_type == "realtime")]
    assert len(rt) == 1 and rt.level.iloc[0] in {"typical", "higher_than_usual", "much_higher", "unknown"}
    b = o[(o.disease == "influenza") & (o.location_iso3 == "BBB") & (o.row_type == "seasonal")]
    assert set(b.level) == {"unknown"}                 # no FluNet data at all -> unknown, not imputed


def test_influenza_too_few_years_is_fixed_burden(cfg):
    o = build_all(cfg, flu_monthly=monthly_frame(years=range(2012, 2015)))
    f = o[(o.disease == "influenza") & (o.location_iso3 == "AAA") & (o.row_type == "seasonal")]
    assert set(f.level) == {"moderate"} and f.season_label.isna().all()


# ---------------------------------------------------------------------------- tier boundaries
@pytest.mark.parametrize("v,expected", [(0, "none"), (0.0001, "low"), (0.999, "low"), (1, "moderate"),
                                        (50, "moderate"), (50.0001, "high"), (300, "high"),
                                        (None, "unknown"), (np.nan, "unknown")])
def test_malaria_tiers(cfg, v, expected):
    assert malaria_tier(v, cfg) == expected


@pytest.mark.parametrize("v,expected", [(0, "low"), (9.999, "low"), (10, "moderate"), (100, "moderate"),
                                        (100.001, "high"), (None, "unknown")])
def test_dengue_tiers(cfg, v, expected):
    assert dengue_tier(v, cfg) == expected


@pytest.mark.parametrize("cases,inc,expected", [(0, 0.0, "none"), (1, 0.01, "low"), (5, 0.999, "low"),
                                                (5, 1.0, "moderate"), (50, 10.0, "moderate"),
                                                (51, 10.0001, "high"), (None, None, "unknown"),
                                                (5, np.nan, "unknown")])
def test_measles_tiers(cfg, cases, inc, expected):
    assert measles_tier(cases, inc, cfg) == expected
    assert measles_level(cases, inc, cfg) == {"none": "not_reported"}.get(expected, expected)


# ---------------------------------------------------------------------------- malaria confidence
@pytest.mark.parametrize("lo,hi,expected", [(0.5, 0.9, "normal"), (0.5, 2.0, "lower"), (2, 40, "normal"),
                                            (40, 60, "lower"), (0, 0, "normal"), (0, 0.5, "lower"),
                                            (np.nan, np.nan, "normal"), (None, 3.0, "normal")])
def test_malaria_confidence(cfg, lo, hi, expected):
    assert malaria_confidence(lo, hi, cfg) == expected


def test_malaria_confidence_in_outlook(cfg):
    m = pd.DataFrame([dict(location_iso3="AAA", admin1=None, admin1_key=None, year=2024, incidence=45.0,
                           incidence_low=30.0, incidence_high=80.0, unit="cases per 1,000 population at risk",
                           source="WHO GHO", data_as_of=pd.Timestamp("2024-12-31"), is_latest=True),
                      dict(location_iso3="BBB", admin1=None, admin1_key=None, year=2024, incidence=120.0,
                           incidence_low=90.0, incidence_high=160.0, unit="cases per 1,000 population at risk",
                           source="WHO GHO", data_as_of=pd.Timestamp("2024-12-31"), is_latest=True)])
    o = build_all(cfg, malaria_annual=m)
    a = o[(o.disease == "malaria") & (o.location_iso3 == "AAA")].iloc[0]
    b = o[(o.disease == "malaria") & (o.location_iso3 == "BBB")].iloc[0]
    assert a.level == "moderate" and a.confidence == "lower" and "spans more than one level" in a.based_on_text
    assert b.level == "high" and b.confidence == "normal" and b.season_source == "none"
    assert b.based_on_text.startswith("About 120 cases per 1,000 at risk (WHO, 2024).")


# ---------------------------------------------------------------------------- dengue burden
def _dengue(years, iso="AAA", cases=10.0):
    rows = [dict(location_iso3=iso, admin1=None, year=y, month=m, cases=cases, is_complete_year=True)
            for y in years for m in range(1, 13)]
    return pd.DataFrame(rows)


def test_dengue_burden_unknown_with_fewer_than_3_years(cfg):
    b = dengue_burden(_dengue([2023, 2024]), population_frame(), cfg).set_index("location_iso3")
    assert b.loc["AAA", "burden_tier"] == "unknown" and b.loc["AAA", "unknown_reason"] == "too_few_years"
    o = build_all(cfg, dengue_monthly=_dengue([2023, 2024]).assign(data_as_of=pd.Timestamp("2024-12-31")),
                  population=population_frame())
    d = o[(o.disease == "dengue") & (o.location_iso3 == "AAA")]
    assert set(d.level) == {"unknown"} and "Fewer than 3 complete years" in d.notes.iloc[0]


def test_dengue_burden_uses_last_5_complete_years(cfg):
    dm = _dengue(range(2015, 2025))                      # 120 cases/year, pop 1e6 -> 12 per 100k
    dm.loc[(dm.year == 2024) & (dm.month == 5), "is_complete_year"] = False
    dm.loc[dm.year == 2024, "is_complete_year"] = False  # incomplete year is skipped
    b = dengue_burden(dm, population_frame(population=1e6), cfg).iloc[0]
    assert b.years_used == "2019,2020,2021,2022,2023" and b.n_years == 5
    assert b.burden_value == pytest.approx(12.0) and b.burden_tier == "moderate"


def test_dengue_burden_exactly_3_years_and_admin1_ignored(cfg):
    dm = pd.concat([_dengue([2020, 2021, 2022]),
                    _dengue([2020, 2021, 2022], cases=1e6).assign(admin1="Region")])
    b = dengue_burden(dm, population_frame(population=1e6), cfg).iloc[0]
    assert b.n_years == 3 and b.burden_value == pytest.approx(12.0)


# ---------------------------------------------------------------------------- removed diseases / vocabulary
def _full(cfg):
    m = pd.DataFrame([dict(location_iso3="AAA", admin1=None, admin1_key=None, year=2024, incidence=0.0,
                           incidence_low=0.0, incidence_high=0.0, unit="cases per 1,000 population at risk",
                           source="WHO GHO", data_as_of=pd.Timestamp("2024-12-31"), is_latest=True)])
    dm = monthly_frame().rename(columns={"value": "cases"}).assign(data_as_of=pd.Timestamp("2015-12-31"))
    return build_all(cfg, flu_monthly=monthly_frame(), flu_weekly=weekly_frame(), dengue_monthly=dm,
                     malaria_annual=m, population=population_frame())


def test_removed_diseases_absent(cfg):
    from visitwell_pipeline.gold.outlook import build_presence
    o = _full(cfg)
    assert not REMOVED & set(o.disease)
    assert set(build_presence(None, cfg).disease) == {"malaria"}
    assert not REMOVED & set(cfg["card_groups"]) and "static_presence_diseases" not in cfg


def _frontend_levels() -> set[str]:
    if not MAPPING_TS.exists():
        pytest.skip("frontend/src/data/report-mapping.ts not available")
    src = MAPPING_TS.read_text(encoding="utf-8")
    block = re.search(r"const LEVEL: Record<string, ActivityLevel> = \{(.*?)\};", src, re.S).group(1)
    return set(re.findall(r"^\s*(\w+):", block, re.M))


def test_level_column_uses_frontend_vocabulary(cfg):
    o = _full(cfg)
    known = _frontend_levels() | {"unknown"}            # unknown = not in the map -> hidden card
    lv = set(o.level.dropna())
    assert lv <= known, lv - known
    assert o[o.row_type == "reminder"].level.isna().all()
    assert o[o.row_type != "reminder"].level.notna().all()


def test_new_columns_present_and_typed(cfg):
    o = _full(cfg)
    for c in ["burden_value", "burden_unit", "burden_tier", "season_label", "season_source", "final_level",
              "confidence", "based_on_text"]:
        assert c in o.columns
    assert o.burden_value.dtype == "float64"
    nat = o[(o.row_type.isin(["seasonal", "presence", "recent_activity"])) & o.admin1.isna()]
    assert nat.final_level.isin(["none", "low", "moderate", "high", "unknown"]).all()
    assert nat.season_source.isin(["observed", "estimated", "none"]).all()
    assert nat.based_on_text.notna().all()
