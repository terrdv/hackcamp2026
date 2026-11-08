"""Presence (from downloaded data), alerts and the final `destination_outlook` table read by the app."""
from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd

from ..countries import admin1_key

SEASONAL_LEVELS = {"peak", "moderate", "low"}
OUTLOOK_COLS = ["location_iso3", "admin1", "admin1_key", "disease", "card_group", "row_type", "month", "level",
                "based_on", "consistency", "consistency_score", "seasonal_index", "data_as_of", "source",
                "source_url", "verified", "notes", "details"]


def _isna(v) -> bool:
    return v is None or (isinstance(v, float) and np.isnan(v)) or v is pd.NaT or (not isinstance(v, str) and pd.isna(v))


def _json(d: dict) -> str:
    def conv(v):
        if _isna(v):
            return None
        if isinstance(v, np.bool_):
            return bool(v)
        if isinstance(v, (np.integer,)):
            return int(v)
        if isinstance(v, (np.floating,)):
            return float(v)
        if isinstance(v, (dt.date, pd.Timestamp)):
            return str(pd.Timestamp(v).date())
        return v
    return json.dumps({k: conv(v) for k, v in d.items()}, default=str)


def _date(v):
    return None if _isna(v) else pd.Timestamp(v).date()


# ---------------------------------------------------------------------------- presence
def build_presence(malaria: pd.DataFrame | None, cfg) -> pd.DataFrame:
    """Presence from downloaded data only (no hand-written seeds).

    * malaria: WHO estimated incidence, latest year: > 0 -> present, 0 -> not_reported; no estimate -> unknown
    * yellow fever, hepatitis A, typhoid: no data source yet -> unknown (the app hides unknown cards)
    """
    url = cfg["sources"]["malaria_who"].get("url")
    latest = malaria[malaria.is_latest & malaria.incidence.notna()] if malaria is not None and len(malaria) else None
    rows = []
    for iso in cfg["destinations"]:
        for d in cfg["static_presence_diseases"]:
            base = dict(disease=d, location_iso3=iso, admin1=None, admin1_key=None, presence="unknown",
                        based_on="unknown", incidence=np.nan, incidence_year=None, unit=None, source=None,
                        source_url=None, data_as_of=None, notes="no data source for this disease yet")
            if d != "malaria":
                rows.append(base)
                continue
            m = latest[latest.location_iso3 == iso] if latest is not None else None
            if m is None or m.empty:
                rows.append({**base, "notes": "no WHO malaria estimate for this country"})
                continue
            for r in m.itertuples():
                a1 = None if _isna(r.admin1) else r.admin1
                rows.append({**base, "admin1": a1, "admin1_key": admin1_key(a1),
                             "presence": "present" if r.incidence > 0 else "not_reported",
                             "based_on": "estimated_incidence", "incidence": float(r.incidence),
                             "incidence_year": int(r.year), "unit": r.unit, "source": r.source, "source_url": url,
                             "data_as_of": _date(r.data_as_of), "notes": None})
    return pd.DataFrame(rows)


def build_alerts(seed: pd.DataFrame | None, as_of: dt.date) -> pd.DataFrame:
    """Active official alerts. No alert source is wired in since the seeds were removed, so this is empty
    unless a caller passes one (kept so the measles `outbreak` override still works when a source is added)."""
    cols = ["disease", "location_iso3", "admin1", "admin1_key", "level", "title", "url", "issued", "expires",
            "verified", "source_url", "checked_on"]
    if seed is None or seed.empty:
        return pd.DataFrame(columns=cols)
    a = seed[seed.usable].copy() if "usable" in seed else seed.copy()
    t = pd.Timestamp(as_of)
    a = a[(a.issued.isna() | (a.issued <= t)) & (a.expires.isna() | (a.expires >= t))]
    return a[cols].reset_index(drop=True)


# ---------------------------------------------------------------------------- outlook
def build_outlook(cfg, *, flu_seasonal: pd.DataFrame, flu_rt: pd.DataFrame, flu_weekly: pd.DataFrame,
                  dengue_seasonal: pd.DataFrame, dengue_monthly: pd.DataFrame, measles: pd.DataFrame,
                  presence: pd.DataFrame, alerts: pd.DataFrame) -> pd.DataFrame:
    cg = cfg["card_groups"]
    rows: list[dict] = []
    min_years = cfg["seasonal"]["min_years"]

    def add(**kw):
        r = {c: None for c in OUTLOOK_COLS}
        r.update(kw)
        r["card_group"] = cg.get(r["disease"], r.get("card_group"))
        rows.append(r)

    def alert_note(disease, iso):
        a = alerts[(alerts.disease == disease) & (alerts.location_iso3 == iso)] if len(alerts) else alerts
        if a is None or a.empty:
            return None, {}
        top = a.sort_values("issued", ascending=False).iloc[0]
        return f"Official notice: {top.title}", {"alert_title": top.title, "alert_url": top.url,
                                                 "alert_level": top.level, "alert_issued": top.issued}


    flu_asof = (flu_weekly[flu_weekly.is_valid.astype(bool)].groupby("location_iso3").period_start.max()
                if len(flu_weekly) else pd.Series(dtype="datetime64[ns]"))
    den_asof = dengue_monthly.groupby(["location_iso3"]).data_as_of.max() if len(dengue_monthly) else pd.Series(dtype=object)
    flu_src = cfg["sources"]["flunet"]["name"]
    den_src = cfg["sources"]["opendengue"]["name"]

    for iso in cfg["destinations"]:
        # ---------------- influenza (no presence gate: influenza circulates everywhere)
        fs = flu_seasonal[(flu_seasonal.location_iso3 == iso) & flu_seasonal.admin1.isna()]
        for _, r in fs.iterrows():
            ok = r.label in SEASONAL_LEVELS
            note = None if ok else (f"fewer than {min_years} complete years of data" if r.label == "insufficient_data"
                                    else "no influenza data")
            add(location_iso3=iso, disease="influenza", row_type="seasonal", month=int(r.month),
                level=r.label if ok else "unknown", based_on="seasonal" if ok else "unknown",
                consistency=r.consistency, consistency_score=r.consistency_score, seasonal_index=r.median_index,
                data_as_of=_date(flu_asof.get(iso)), source=flu_src, verified=True, notes=note,
                details=_json({"n_years": r.n_years, "years_used": r.years_used, "excluded_years": r.excluded_years}))
        rt = flu_rt[flu_rt.location_iso3 == iso]
        if len(rt):
            r = rt.iloc[0]
            ok = r.label in ("typical", "higher_than_usual", "much_higher")
            add(location_iso3=iso, disease="influenza", row_type="realtime", month=None,
                level=r.label if ok else "unknown", based_on="realtime" if ok else "unknown",
                data_as_of=_date(r.latest_week_start), source=flu_src, verified=True, notes=r.fallback_reason,
                details=_json({k: r[k] for k in ["iso_year", "iso_week", "percent_positive", "specimens", "p50", "p75",
                                                 "p90", "n_baseline_years", "is_stale", "age_days",
                                                 "use_seasonal_fallback", "fallback_reason", "computed_on"]}))

        # ---------------- dengue (seasonal pattern straight from the case data)
        an, ad = alert_note("dengue", iso)
        ds = dengue_seasonal[(dengue_seasonal.location_iso3 == iso) & dengue_seasonal.admin1.isna()]
        for _, r in ds.iterrows():
            ok = r.label in SEASONAL_LEVELS
            note = None if ok else (f"fewer than {min_years} complete years of data"
                                    if r.label == "insufficient_data" else "no dengue data")
            add(location_iso3=iso, disease="dengue", row_type="seasonal", month=int(r.month),
                level=r.label if ok else "unknown", based_on="seasonal" if ok else "unknown",
                consistency=r.consistency, consistency_score=r.consistency_score, seasonal_index=r.median_index,
                data_as_of=_date(den_asof.get(iso)), source=den_src, verified=True,
                notes="; ".join(filter(None, [note, an])) or None,
                details=_json({"n_years": r.n_years, "years_used": r.years_used, **ad}))
        # admin1 rows (only where a complete admin1 seasonal profile exists)
        a1 = dengue_seasonal[(dengue_seasonal.location_iso3 == iso) & dengue_seasonal.admin1.notna()]
        for name, g in a1.groupby("admin1"):
            if not g.label.isin(SEASONAL_LEVELS).all():
                continue
            key = admin1_key(name)
            for _, r in g.iterrows():
                add(location_iso3=iso, admin1=name, admin1_key=key, disease="dengue", row_type="seasonal",
                    month=int(r.month), level=r.label, based_on="seasonal", consistency=r.consistency,
                    consistency_score=r.consistency_score, seasonal_index=r.median_index,
                    data_as_of=_date(dengue_monthly[(dengue_monthly.location_iso3 == iso) &
                                                    (dengue_monthly.admin1 == name)].data_as_of.max()),
                    source=den_src, verified=True,
                    details=_json({"n_years": r.n_years, "years_used": r.years_used}))

        # ---------------- measles (recent activity; alert override already applied)
        m = measles[measles.location_iso3 == iso]
        if len(m):
            r = m.iloc[0]
            add(location_iso3=iso, disease="measles", row_type="recent_activity", month=None, level=r.status,
                based_on=r.based_on, data_as_of=_date(r.latest_month), source=r.source,
                source_url=r.alert_url if r.based_on == "official_alert" else cfg["sources"]["measles"]["page_url"],
                verified=True, notes=r.notes,
                details=_json({k: r[k] for k in ["cases_12m", "incidence_12m_per_million", "population", "pop_year",
                                                 "pop_source", "computed_status", "age_months", "computed_on"]}))
        else:
            add(location_iso3=iso, disease="measles", row_type="recent_activity", level="unknown",
                based_on="unknown", notes="no measles data")

        # ---------------- presence diseases (from downloaded data; see build_presence)
        for d in cfg["static_presence_diseases"]:
            an, ad = alert_note(d, iso)
            for _, p in presence[(presence.disease == d) & (presence.location_iso3 == iso)].iterrows():
                extra, notes = dict(ad), [None if _isna(p.notes) else p.notes]
                if not _isna(p.incidence):
                    extra.update(incidence=p.incidence, incidence_year=p.incidence_year, unit=p.unit)
                    notes.append(f"WHO estimate: {p.incidence:.3g} {p.unit} ({p.incidence_year})")
                notes.append(an)
                add(location_iso3=iso, admin1=p.admin1, admin1_key=p.admin1_key, disease=d, row_type="presence",
                    month=None, level=p.presence, based_on=p.based_on, data_as_of=_date(p.data_as_of),
                    source=p.source, source_url=p.source_url, verified=p.based_on != "unknown",
                    notes="; ".join(filter(None, notes)) or None, details=_json(extra))

        # ---------------- reminders (no level)
        for rem in cfg["reminders"]:
            add(location_iso3=iso, disease=rem["disease"], card_group=rem["card_group"], row_type="reminder",
                level=None, based_on="vaccine_reminder", source=rem["source"], source_url=rem["source_url"],
                verified=not rem.get("needs_review", False), notes=rem["text"])

    out = pd.DataFrame(rows, columns=OUTLOOK_COLS)
    for r in cfg["reminders"]:   # reminder card_group from config (covid19 respiratory, measles measles)
        out.loc[(out.row_type == "reminder") & (out.disease == r["disease"]), "card_group"] = r["card_group"]
    out["month"] = out.month.astype("Int64")
    return out
