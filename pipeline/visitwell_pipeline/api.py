"""get_outlook(): what the app calls. Reads only the `destination_outlook` table."""
from __future__ import annotations

import datetime as dt
import json

import pandas as pd

from .config import load_config
from .countries import admin1_key
from .gold.flu_realtime import freshness

SEASONAL_RANK = {"low": 1, "moderate": 2, "peak": 3, "high": 3}   # "high" = burden x timing final level
GROUP_ORDER = ["respiratory", "mosquito", "measles", "food_water"]


def trip_months(start_date: dt.date, end_date: dt.date) -> list[tuple[int, int]]:
    if end_date < start_date:
        raise ValueError("end_date is before start_date")
    return [(p.year, p.month) for p in pd.period_range(start_date, end_date, freq="M")]


def use_realtime(start_date: dt.date, today: dt.date, window_days: int) -> bool:
    """Real-time influenza only when departure is within `window_days` of today (incl. trips already started)."""
    return (pd.Timestamp(start_date) - pd.Timestamp(today)).days <= window_days


def _pick(rows: pd.DataFrame, admin1: str | None) -> pd.DataFrame:
    """Prefer admin1 rows when present for this disease, else national rows."""
    key = admin1_key(admin1)
    if key is not None and (rows.admin1_key == key).any():
        return rows[rows.admin1_key == key]
    return rows[rows.admin1_key.isna()]


def _clean(v):
    if v is None or (not isinstance(v, (str, list, dict)) and pd.isna(v)):
        return None
    if isinstance(v, (pd.Timestamp, dt.datetime)):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if hasattr(v, "item"):
        return v.item()
    return v


def _card(row: pd.Series, **over) -> dict:
    d = {k: _clean(row.get(k)) for k in ["disease", "card_group", "level", "based_on", "consistency",
                                          "data_as_of", "source", "source_url", "verified", "notes", "admin1"]}
    d["details"] = json.loads(row["details"]) if isinstance(row.get("details"), str) else {}
    d.update(over)
    return d


def _seasonal_card(rows: pd.DataFrame, months: list[tuple[int, int]], extra_note: str | None = None) -> dict:
    by_m = {int(r.month): r for _, r in rows.iterrows() if not pd.isna(r.month)}
    per_month, levels = [], []
    for y, m in months:
        r = by_m.get(m)
        lvl = r.level if r is not None else "unknown"
        per_month.append({"year": y, "month": m, "level": lvl, "based_on": r.based_on if r is not None else "unknown",
                          "consistency": _clean(r.consistency) if r is not None else None,
                          "seasonal_index": _clean(r.seasonal_index) if r is not None else None})
        levels.append(lvl)
    ranked = [lv for lv in levels if lv in SEASONAL_RANK]
    first = by_m.get(months[0][1])
    first = first if first is not None else (rows.iloc[0] if len(rows) else None)
    if ranked:
        level = max(ranked, key=SEASONAL_RANK.get)
        top = next(r for (y, m), r in zip(months, per_month) if r["level"] == level)
        base = by_m[top["month"]]
        card = _card(base, level=level)
        if any(lv not in SEASONAL_RANK for lv in levels):
            card["notes"] = "; ".join(filter(None, [card["notes"], "some trip months have no seasonal estimate"]))
    elif first is not None:
        known = [lv for lv in levels if lv != "unknown"]
        card = _card(first, level=known[0] if known else "unknown")
    else:
        return {}
    if extra_note:
        card["notes"] = "; ".join(filter(None, [card["notes"], extra_note]))
    card["months"] = per_month
    return card


def get_outlook(location_iso3: str, start_date: dt.date, end_date: dt.date, today: dt.date | None = None,
                admin1: str | None = None, outlook: pd.DataFrame | None = None, cfg=None) -> dict:
    cfg = cfg or load_config()
    today = today or dt.date.today()
    if outlook is None:
        outlook = pd.read_parquet(cfg.path("gold") / "destination_outlook.parquet")
    iso = location_iso3.strip().upper()
    df = outlook[outlook.location_iso3 == iso]
    months = trip_months(start_date, end_date)
    rcfg = cfg["influenza"]["realtime"]
    cards: list[dict] = []

    if df.empty:
        cards.append({"disease": None, "card_group": None, "level": "unknown", "based_on": "unknown",
                      "notes": f"{iso} is not a configured destination", "data_as_of": None})
    for disease, g in df[df.row_type != "reminder"].groupby("disease", sort=False):
        if disease == "influenza":
            seasonal = _pick(g[g.row_type == "seasonal"], None)
            rt = g[g.row_type == "realtime"]
            if use_realtime(start_date, today, rcfg["departure_window_days"]):
                reason = None
                if rt.empty:
                    reason = "no real-time influenza row"
                else:
                    r = rt.iloc[0]
                    det = json.loads(r.details) if isinstance(r.details, str) else {}
                    stale, _, why = freshness(r.data_as_of, today, rcfg["max_age_weeks"])
                    if r.based_on != "realtime":
                        reason = det.get("fallback_reason") or "real-time comparison unavailable"
                    elif stale:
                        reason = why
                if reason is None:
                    c = _card(rt.iloc[0])
                    c["method_reason"] = f"departure within {rcfg['departure_window_days']} days: real-time data"
                    cards.append(c)
                    continue
                c = _seasonal_card(seasonal, months, extra_note=f"real-time unavailable ({reason}); using seasonal pattern")
                c["method_reason"] = "fallback_to_seasonal"
                c["fallback_reason"] = reason
                cards.append(c)
            else:
                c = _seasonal_card(seasonal, months)
                c["method_reason"] = f"departure more than {rcfg['departure_window_days']} days away: seasonal pattern"
                cards.append(c)
            continue
        rows = _pick(g, admin1)
        if rows.empty:
            continue
        if rows.month.notna().any():                 # month-resolved (dengue)
            cards.append(_seasonal_card(rows, months))
        else:
            cards.append(_card(rows.iloc[0]))

    for _, r in df[df.row_type == "reminder"].iterrows():
        cards.append(_card(r, level=None))

    groups: dict[str, list] = {g: [] for g in GROUP_ORDER}
    for c in cards:
        if c:
            groups.setdefault(c.get("card_group") or "other", []).append(c)
    return {"location_iso3": iso, "admin1": admin1, "start_date": str(start_date), "end_date": str(end_date),
            "today": str(today), "months": [f"{y}-{m:02d}" for y, m in months],
            "groups": {k: v for k, v in groups.items() if v}}
