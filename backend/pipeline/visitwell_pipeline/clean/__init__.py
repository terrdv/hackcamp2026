"""Silver layer: cleaned, long-format tables (one row per disease x location x period)."""
from __future__ import annotations

import pandas as pd

from ..countries import to_iso3

QUALITY_COLS = ["source", "data_as_of", "is_complete_year", "low_sample_flag"]


def iso3_series(s: pd.Series) -> pd.Series:
    """Vectorised ISO3 standardisation (resolves each distinct value once)."""
    uniq = {v: to_iso3(v) for v in s.dropna().unique()}
    return s.map(uniq)


def months_grid(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """All (keys, year, month) from each group's first to last year (Jan-Dec)."""
    rows = []
    for k, g in df.groupby(keys, dropna=False):
        k = k if isinstance(k, tuple) else (k,)
        for y in range(int(g["year"].min()), int(g["year"].max()) + 1):
            for m in range(1, 13):
                rows.append((*k, y, m))
    return pd.DataFrame(rows, columns=[*keys, "year", "month"])
