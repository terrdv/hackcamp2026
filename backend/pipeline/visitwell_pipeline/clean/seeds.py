"""Seed CSVs (hand-curated from official sources) -> validated silver tables.

A seed row is *usable* only if verified=true AND it has a source_url and checked_on date.
With `seeds.use_unverified: true` unverified rows are also usable, but stay flagged
verified=false so the app can label them "pending review".
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from ..countries import admin1_key, to_iso3

PRESENCE_VALUES = {"none", "some_areas", "present", "widespread", "unknown"}
YF_VALUES = {"yes", "no", "conditional", "unknown"}
COMMON = ["source_name", "source_url", "checked_on", "verified", "needs_review", "notes"]
SCHEMAS = {
    "presence": ["disease", "location_iso3", "admin1", "presence", *COMMON],
    "yellow_fever_entry": ["location_iso3", "certificate_required", "condition", "min_age_years", *COMMON],
    "vaccines": ["disease", "location_iso3", "recommendation", "audience", *COMMON],
    "alerts": ["disease", "location_iso3", "admin1", "level", "title", "url", "issued", "expires", *COMMON],
    "centroids": ["location_iso3", "admin1", "latitude", "longitude", *COMMON],
}
DISEASES = {"influenza", "covid19", "dengue", "malaria", "yellow_fever", "measles", "hepatitis_a", "typhoid"}


def _bool(v) -> bool:
    return str(v).strip().lower() in {"true", "1", "yes", "y", "t"}


def read_seed(path: Path, kind: str) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=SCHEMAS[kind])
    df = pd.read_csv(path, dtype=str, keep_default_na=False, comment=None)
    missing = [c for c in SCHEMAS[kind] if c not in df.columns]
    if missing:
        raise ValueError(f"seed {path.name} is missing columns {missing}")
    return df.replace({"": None})


def clean_seed(df: pd.DataFrame, kind: str, cfg) -> pd.DataFrame:
    df = df.copy()
    issues = [[] for _ in range(len(df))]
    dests = set(cfg["destinations"])
    df["location_iso3"] = df.location_iso3.map(
        lambda v: str(v).strip().upper() if v is not None and str(v).strip().upper() in dests else to_iso3(v))
    for i, v in enumerate(df.location_iso3):
        if v is None:
            issues[i].append("unresolved location")
    if "disease" in df:
        df["disease"] = df.disease.str.strip().str.lower()
        for i, v in enumerate(df.disease):
            if v not in DISEASES:
                issues[i].append(f"unknown disease {v!r}")
    if "admin1" in df:
        df["admin1_key"] = df.admin1.map(admin1_key)
    if kind == "presence":
        df["presence"] = df.presence.fillna("unknown").str.strip().str.lower()
        for i, v in enumerate(df.presence):
            if v not in PRESENCE_VALUES:
                issues[i].append(f"invalid presence {v!r}")
        df.loc[~df.presence.isin(PRESENCE_VALUES), "presence"] = "unknown"
    if kind == "yellow_fever_entry":
        df["certificate_required"] = df.certificate_required.fillna("unknown").str.strip().str.lower()
        df.loc[~df.certificate_required.isin(YF_VALUES), "certificate_required"] = "unknown"
    if kind == "centroids":
        for c, lim in (("latitude", 90), ("longitude", 180)):
            df[c] = pd.to_numeric(df[c], errors="coerce")
            for i, v in enumerate(df[c]):
                if pd.isna(v) or abs(v) > lim:
                    issues[i].append(f"invalid {c}")
    for c in ("issued", "expires"):
        if c in df:
            df[c] = pd.to_datetime(df[c], errors="coerce")
    df["checked_on"] = pd.to_datetime(df.checked_on, errors="coerce")
    df["verified"] = df.verified.map(_bool)
    df["needs_review"] = df.needs_review.map(_bool)
    for i, (ver, url, chk) in enumerate(zip(df.verified, df.source_url, df.checked_on)):
        if ver and (not url or pd.isna(chk)):
            issues[i].append("verified row lacks source_url/checked_on -> treated as unverified")
    df.loc[df.source_url.isna() | df.checked_on.isna(), "verified"] = False
    df["validation_issues"] = ["; ".join(x) or None for x in issues]
    fatal = ("unresolved", "unknown disease", "invalid latitude", "invalid longitude")
    valid = pd.Series([not any(f in x for x in iss for f in fatal) for iss in issues],
                      index=df.index, dtype=bool)
    df["is_valid"] = valid
    df = apply_usability(df, cfg)
    df = df[df.location_iso3.isin(cfg["destinations"]) | df.location_iso3.isna()]
    return df.reset_index(drop=True)


def apply_usability(df: pd.DataFrame, cfg) -> pd.DataFrame:
    """usable = valid AND (verified OR seeds.use_unverified). Re-applied in gold so the flag can change."""
    if df is None:
        return df
    df = df.copy()
    if len(df) == 0:
        df["usable"] = pd.Series(dtype=bool)
        return df
    df["usable"] = df.is_valid.astype(bool) & (df.verified.astype(bool) | bool(cfg["seeds"]["use_unverified"]))
    return df


def load_seeds(cfg) -> dict[str, pd.DataFrame]:
    return {kind: clean_seed(read_seed(cfg.seed(kind), kind), kind, cfg) for kind in SCHEMAS}
