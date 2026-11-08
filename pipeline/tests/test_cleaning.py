import numpy as np
import pandas as pd
import pytest

from visitwell_pipeline.clean.dengue import split_to_months
from visitwell_pipeline.clean.influenza import clean_influenza
from visitwell_pipeline.clean.measles import clean_measles
from visitwell_pipeline.sinks import prepare_for_parquet, sanitize_columns


def test_week_spanning_two_months_is_split_by_days():
    rec = pd.DataFrame([dict(start=pd.Timestamp("2024-01-29"), end=pd.Timestamp("2024-02-04"), cases=70.0)])
    out = split_to_months(rec).set_index("month")
    assert out.loc[1, "cases_m"] == pytest.approx(30.0)   # Jan 29-31 = 3 days
    assert out.loc[2, "cases_m"] == pytest.approx(40.0)   # Feb 1-4 = 4 days
    assert out.cases_m.sum() == pytest.approx(70.0)


def flunet_raw(cfg, specimens):
    c = cfg["sources"]["flunet"]["columns"]
    rows = []
    for i, s in enumerate(specimens):
        ws = pd.Timestamp("2024-01-01") + pd.Timedelta(weeks=i)
        y, w, _ = ws.isocalendar()
        for origin in ("SENTINEL", "NONSENTINEL"):          # two site types per week -> summed
            rows.append({c["iso3"]: "AAA", c["week_start"]: str(ws.date()), c["iso_year"]: str(y),
                         c["iso_week"]: str(w), c["origin_source"]: origin,
                         c["specimens_processed"]: None if s is None else str(s / 2),
                         c["influenza_positive"]: None if s is None else str(s / 10)})
    return pd.DataFrame(rows)


def test_influenza_percent_positive_and_low_sample_flag(cfg):
    raw = flunet_raw(cfg, [100, 10, None])
    dic = pd.DataFrame({"FieldName": list(cfg["sources"]["flunet"]["columns"].values())})
    wk, mo = clean_influenza(raw, dic, cfg)
    assert len(wk) == 3
    assert wk.percent_positive.iloc[0] == pytest.approx(0.2)        # (10)/(100/2*2) ... 20/100
    assert not wk.low_sample_flag.iloc[0]
    assert wk.low_sample_flag.iloc[1]                               # 10 < 20 specimens
    assert wk.low_sample_flag.iloc[2] and np.isnan(wk.percent_positive.iloc[2])   # missing != 0
    assert set(["source", "data_as_of", "is_complete_year", "low_sample_flag"]) <= set(wk.columns)


def test_influenza_mapping_checked_against_dictionary(cfg):
    raw = flunet_raw(cfg, [100])
    with pytest.raises(ValueError, match="dictionary"):
        clean_influenza(raw, pd.DataFrame({"FieldName": ["SOMETHING_ELSE"]}), cfg)


def test_measles_missing_month_gives_null_incidence(cfg):
    months = pd.period_range("2024-01", "2025-06", freq="M")
    raw = pd.DataFrame({"ISO3": "AAA", "Year": [str(p.year) for p in months], "Month": [f"{p.month:02d}" for p in months],
                        "Measles total": ["10"] * len(months), "_source": "WHO"})
    raw = raw[~((raw.Year == "2025") & (raw.Month == "03"))]       # one month not reported
    pop = pd.DataFrame({"location_iso3": ["AAA"], "year": [2024], "population": [1_000_000.0], "source": ["WB"]})
    m = clean_measles(raw, pop, cfg).set_index("period_start")
    assert m.loc["2024-12-01", "cases_12m"] == 120
    assert m.loc["2024-12-01", "incidence_12m_per_million"] == pytest.approx(120.0)
    assert np.isnan(m.loc["2025-03-01", "cases"])                     # kept as missing, not 0
    assert np.isnan(m.loc["2025-06-01", "incidence_12m_per_million"])  # window includes the gap
    assert m.loc["2025-06-01", "pop_year"] == 2024                    # latest earlier population year


def test_delta_safe_columns():
    df = pd.DataFrame({"Measles total": [1], "a,b": [2], "x": [None]})
    out = prepare_for_parquet(df)
    assert list(out.columns) == ["measles_total", "a_b", "x"]
    assert str(out.x.dtype) == "string"                               # no void columns
    assert list(sanitize_columns(pd.DataFrame(columns=["A B", "a_b"])).columns) == ["a_b", "a_b_1"]
