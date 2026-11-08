"""Influenza real-time: latest week vs the same ISO week in previous years."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd


def percentile_label(value: float, p75: float, p90: float) -> str:
    if value is None or p75 is None or p90 is None or any(np.isnan(x) for x in (value, p75, p90)):
        return "unknown"
    if value < p75:
        return "typical"
    if value <= p90:
        return "higher_than_usual"
    return "much_higher"


def freshness(latest_week_start, today, max_age_weeks: int) -> tuple[bool, int | None, str | None]:
    """(is_stale, age_days, reason)."""
    if latest_week_start is None or pd.isna(latest_week_start):
        return True, None, "no valid influenza data"
    age = (pd.Timestamp(today) - pd.Timestamp(latest_week_start)).days
    if age > max_age_weeks * 7:
        return True, age, f"latest valid week ({pd.Timestamp(latest_week_start).date()}) is {age} days old (> {max_age_weeks} weeks)"
    return False, age, None


def flu_realtime(weekly: pd.DataFrame, cfg, as_of: dt.date) -> pd.DataFrame:
    rcfg = cfg["influenza"]["realtime"]
    excluded = set(cfg["influenza"]["excluded_baseline_years"])
    rows = []
    for iso in cfg["destinations"]:
        g = weekly[(weekly.location_iso3 == iso) & weekly.is_valid.astype(bool)] if len(weekly) else weekly
        base = dict(disease="influenza", location_iso3=iso, admin1=None, latest_week_start=None, iso_year=None,
                    iso_week=None, percent_positive=np.nan, specimens=np.nan, p50=np.nan, p75=np.nan, p90=np.nan,
                    n_baseline_years=0, baseline_years="", label="unknown", age_days=None, is_stale=True,
                    use_seasonal_fallback=True, fallback_reason=None, source=cfg["sources"]["flunet"]["name"])
        if g is None or g.empty:
            rows.append({**base, "fallback_reason": "no valid influenza data"})
            continue
        last = g.sort_values("period_start").iloc[-1]
        wk = int(last.iso_week)
        target = min(wk, 52)
        hist = g[(g.iso_year < last.iso_year) & ~g.iso_year.isin(excluded) & (g.iso_week.clip(upper=52) == target)]
        hist = hist.groupby("iso_year").percent_positive.mean()
        stale, age, reason = freshness(last.period_start, as_of, rcfg["max_age_weeks"])
        rec = {**base, "latest_week_start": pd.Timestamp(last.period_start).date(), "iso_year": int(last.iso_year),
               "iso_week": wk, "percent_positive": float(last.percent_positive), "specimens": float(last.specimens),
               "n_baseline_years": int(len(hist)), "baseline_years": ",".join(map(str, hist.index.astype(int))),
               "age_days": age, "is_stale": stale}
        if len(hist) >= rcfg["min_baseline_years"]:
            p50, p75, p90 = np.percentile(hist.values, [50, 75, 90])
            rec.update(p50=p50, p75=p75, p90=p90, label=percentile_label(rec["percent_positive"], p75, p90))
        else:
            rec["label"] = "insufficient_data"
            reason = reason or f"only {len(hist)} baseline years for ISO week {wk} (< {rcfg['min_baseline_years']})"
        rec["use_seasonal_fallback"] = bool(stale or rec["label"] in ("insufficient_data", "unknown"))
        rec["fallback_reason"] = reason if rec["use_seasonal_fallback"] else None
        rows.append(rec)
    out = pd.DataFrame(rows)
    out["computed_on"] = as_of
    return out
