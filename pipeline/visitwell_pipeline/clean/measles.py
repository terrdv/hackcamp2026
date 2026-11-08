"""Population, measles and malaria -> silver."""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..countries import admin1_key
from . import iso3_series, months_grid


def clean_population(raw: pd.DataFrame | None, cfg) -> pd.DataFrame:
    cols = ["location_iso3", "year", "population", "source", "source_year", "source_last_updated"]
    if raw is None or raw.empty:
        return pd.DataFrame(columns=cols)
    df = pd.DataFrame({
        "location_iso3": raw.countryiso3code,
        "year": pd.to_numeric(raw.date, errors="coerce"),
        "population": pd.to_numeric(raw.value, errors="coerce"),
        "source": cfg["sources"]["population"]["name"],
        "source_last_updated": raw.lastupdated,
    })
    df = df[df.location_iso3.isin(cfg["destinations"]) & df.population.notna()].copy()
    df["year"] = df.year.astype(int)
    df["source_year"] = df.year
    return df[cols].sort_values(["location_iso3", "year"]).reset_index(drop=True)


def clean_measles(raw: pd.DataFrame | None, population: pd.DataFrame, cfg) -> pd.DataFrame:
    """Monthly cases -> rolling 12-month incidence per million.

    Months a country did not report are kept as NaN (never 0). Any 12-month window containing an
    unreported month has a null incidence, which downstream becomes "unknown".
    """
    cols = ["disease", "location_iso3", "admin1", "period_start", "period_type", "year", "month", "cases",
            "reported", "cases_12m", "months_in_window", "population", "pop_year", "pop_source",
            "incidence_12m_per_million", "source", "data_as_of", "is_complete_year", "low_sample_flag"]
    if raw is None or raw.empty:
        return pd.DataFrame(columns=cols)
    ccol = cfg["measles"]["case_column"]
    df = pd.DataFrame({
        "location_iso3": iso3_series(raw["ISO3"]).fillna(raw["ISO3"]),
        "year": pd.to_numeric(raw["Year"], errors="coerce"),
        "month": pd.to_numeric(raw["Month"], errors="coerce"),
        "cases": pd.to_numeric(raw[ccol], errors="coerce"),
    }).dropna(subset=["year", "month"])
    df = df[df.location_iso3.isin(cfg["destinations"])]
    df[["year", "month"]] = df[["year", "month"]].astype(int)
    df = df.groupby(["location_iso3", "year", "month"], as_index=False).cases.sum(min_count=1)
    df["period_start"] = pd.to_datetime(dict(year=df.year, month=df.month, day=1))
    last = df.dropna(subset=["cases"]).groupby("location_iso3").period_start.max().rename("data_as_of")

    grid = months_grid(df, ["location_iso3"])
    df = grid.merge(df.drop(columns="period_start"), how="left", on=["location_iso3", "year", "month"])
    df["period_start"] = pd.to_datetime(dict(year=df.year, month=df.month, day=1))
    df = df.merge(last, how="left", on="location_iso3")
    df = df[df.period_start <= df.data_as_of].copy()   # drop future grid months
    df["reported"] = df.cases.notna()
    df = df.sort_values(["location_iso3", "period_start"])
    g = df.groupby("location_iso3")
    df["cases_12m"] = g.cases.transform(lambda s: s.rolling(12, min_periods=12).sum())
    df["months_in_window"] = g.reported.transform(lambda s: s.astype(int).rolling(12, min_periods=1).sum())

    # population: same year, else latest earlier year available, else earliest later year
    pop = population[["location_iso3", "year", "population", "source"]].rename(
        columns={"year": "pop_year", "source": "pop_source"})
    out = []
    for iso, gdf in df.groupby("location_iso3"):
        p = pop[pop.location_iso3 == iso].sort_values("pop_year")
        if p.empty:
            gdf = gdf.assign(population=np.nan, pop_year=np.nan, pop_source=None)
        else:
            gdf = pd.merge_asof(gdf.sort_values("year"), p.drop(columns="location_iso3"),
                                left_on="year", right_on="pop_year", direction="backward")
            miss = gdf.population.isna()
            if miss.any():
                first = p.iloc[0]
                gdf.loc[miss, ["population", "pop_year", "pop_source"]] = [first.population, first.pop_year, first.pop_source]
        out.append(gdf)
    df = pd.concat(out, ignore_index=True)
    df["incidence_12m_per_million"] = df.cases_12m / df.population * 1e6
    df["is_complete_year"] = df.groupby(["location_iso3", "year"]).reported.transform(lambda s: s.all() and len(s) == 12)
    df["disease"] = "measles"
    df["admin1"] = None
    df["period_type"] = "month"
    df["source"] = raw["_source"].iloc[0] if "_source" in raw else cfg["sources"]["measles"]["name"]
    df["low_sample_flag"] = False
    return df[cols].sort_values(["location_iso3", "period_start"]).reset_index(drop=True)


def clean_malaria(who_raw: pd.DataFrame | None, map_raw: pd.DataFrame | None, cfg) -> pd.DataFrame:
    """Annual malaria incidence (supporting evidence only), flagged with is_latest per location."""
    cols = ["disease", "location_iso3", "admin1", "admin1_key", "period_start", "period_type", "year",
            "incidence", "incidence_low", "incidence_high", "unit", "metric", "is_latest", "source",
            "data_as_of", "is_complete_year", "low_sample_flag"]
    frames = []
    if who_raw is not None and not who_raw.empty:
        w = who_raw[(who_raw.SpatialDimType == "COUNTRY")]
        frames.append(pd.DataFrame({
            "location_iso3": w.SpatialDim, "admin1": None,
            "year": pd.to_numeric(w.TimeDim, errors="coerce"),
            "incidence": pd.to_numeric(w.NumericValue, errors="coerce"),
            "incidence_low": pd.to_numeric(w.Low, errors="coerce"),
            "incidence_high": pd.to_numeric(w.High, errors="coerce"),
            "unit": "cases per 1,000 population at risk", "metric": "estimated incidence",
            "source": cfg["sources"]["malaria_who"]["name"],
        }))
    if map_raw is not None and not map_raw.empty:
        c = cfg["sources"]["malaria_map"]["columns"]
        lvl = map_raw.get(c["admin_level"], pd.Series(["admin1"] * len(map_raw)))
        frames.append(pd.DataFrame({
            "location_iso3": iso3_series(map_raw[c["iso3"]]),
            "admin1": np.where(lvl.astype(str).str.contains("1"), map_raw[c["admin1"]], None),
            "year": pd.to_numeric(map_raw[c["year"]], errors="coerce"),
            "incidence": pd.to_numeric(map_raw[c["value"]], errors="coerce"),
            "incidence_low": np.nan, "incidence_high": np.nan,
            "unit": "per MAP export", "metric": map_raw.get(c["metric"], "MAP incidence"),
            "source": cfg["sources"]["malaria_map"]["name"],
        }))
    if not frames:
        return pd.DataFrame(columns=cols)
    df = pd.concat(frames, ignore_index=True)
    df = df[df.location_iso3.isin(cfg["destinations"]) & df.year.notna() & df.incidence.notna()].copy()
    df["year"] = df.year.astype(int)
    df["admin1_key"] = df.admin1.map(admin1_key)
    df["is_latest"] = df.year == df.groupby(["location_iso3", "admin1_key", "source"], dropna=False).year.transform("max")
    df["period_start"] = pd.to_datetime(dict(year=df.year, month=1, day=1))
    df["period_type"] = "year"
    df["data_as_of"] = pd.to_datetime(dict(year=df.year, month=12, day=31))
    df["is_complete_year"] = True
    df["low_sample_flag"] = False
    df["disease"] = "malaria"
    return df[cols].sort_values(["location_iso3", "admin1", "year"], na_position="first").reset_index(drop=True)
