"""Presence (from downloaded data), alerts and the final `destination_outlook` table read by the app."""
from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd

from ..countries import admin1_key
from .levels import (SEASON_LABELS, SEASON_PHRASE, combine_level, dengue_burden, fmt_rate, influenza_tier,
                     level_label, malaria_confidence, malaria_tier)

SEASONAL_LEVELS = {"peak", "moderate", "low"}
OUTLOOK_COLS = ["location_iso3", "admin1", "admin1_key", "disease", "card_group", "row_type", "month", "level",
                "based_on", "consistency", "consistency_score", "seasonal_index", "data_as_of", "source",
                "source_url", "verified", "notes", "details",
                # burden x timing (gold/levels.py)
                "burden_value", "burden_unit", "burden_tier", "season_label", "season_source", "final_level",
                "confidence", "based_on_text"]
FLOAT_COLS = ["consistency_score", "seasonal_index", "burden_value"]


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
PRESENCE_DISEASES = ["malaria"]   # the only presence-type disease with a data source


def build_presence(malaria: pd.DataFrame | None, cfg) -> pd.DataFrame:
    """Malaria presence + burden tier from WHO estimated incidence (latest year).

    * presence: > 0 -> present, 0 -> not_reported, no estimate -> unknown (kept for reference)
    * burden_tier from `burden.malaria`; tiers of WHO's low/high bounds set confidence (different -> lower)
    * rows whose unit is not WHO's per-1,000-at-risk (e.g. a manual MAP export) get burden unknown
    """
    url = cfg["sources"]["malaria_who"].get("url")
    latest = malaria[malaria.is_latest & malaria.incidence.notna()] if malaria is not None and len(malaria) else None
    rows = []
    for iso in cfg["destinations"]:
        base = dict(disease="malaria", location_iso3=iso, admin1=None, admin1_key=None, presence="unknown",
                    based_on="unknown", incidence=np.nan, incidence_low=np.nan, incidence_high=np.nan,
                    incidence_year=None, unit=None, burden_tier="unknown", burden_tier_low=None,
                    burden_tier_high=None, confidence=None, unknown_reason="no_data", source=None,
                    source_url=None, data_as_of=None, notes="no WHO malaria estimate for this country")
        m = latest[latest.location_iso3 == iso] if latest is not None else None
        if m is None or m.empty:
            rows.append(base)
            continue
        for r in m.itertuples():
            a1 = None if _isna(r.admin1) else r.admin1
            lo = getattr(r, "incidence_low", np.nan)
            hi = getattr(r, "incidence_high", np.nan)
            comparable = "1,000" in str(r.unit)   # WHO per-1,000-at-risk; other units (MAP export) not graded
            tier = malaria_tier(r.incidence, cfg) if comparable else "unknown"
            rows.append({**base, "admin1": a1, "admin1_key": admin1_key(a1),
                         "presence": "present" if r.incidence > 0 else "not_reported",
                         "based_on": "estimated_incidence", "incidence": float(r.incidence),
                         "incidence_low": lo, "incidence_high": hi,
                         "incidence_year": int(r.year), "unit": r.unit, "burden_tier": tier,
                         "burden_tier_low": malaria_tier(lo, cfg) if comparable else None,
                         "burden_tier_high": malaria_tier(hi, cfg) if comparable else None,
                         "confidence": malaria_confidence(lo, hi, cfg) if comparable else None,
                         "unknown_reason": None if comparable else "unit_not_comparable",
                         "source": r.source, "source_url": url, "data_as_of": _date(r.data_as_of), "notes": None})
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
def _season(label) -> tuple[str | None, str]:
    """seasonal_profile label -> (season_label, season_source)."""
    return (label, "observed") if label in SEASON_LABELS else (None, "none")


def _years_span(first, last) -> str:
    return str(first) if first == last else f"{first}\u2013{last}"


def build_outlook(cfg, *, flu_seasonal: pd.DataFrame, flu_rt: pd.DataFrame, flu_weekly: pd.DataFrame,
                  dengue_seasonal: pd.DataFrame, dengue_monthly: pd.DataFrame, measles: pd.DataFrame,
                  presence: pd.DataFrame, alerts: pd.DataFrame, population: pd.DataFrame | None = None) -> pd.DataFrame:
    """One table for the app. `level` keeps the labels the frontend maps; the burden x timing columns explain it.

    Final level = combine_level(burden tier, seasonal label, disease) (gold/levels.py). `notes` carries
    based_on_text (plus any alert note) so existing readers see the explanation.
    """
    cg = cfg["card_groups"]
    rows: list[dict] = []
    min_years = cfg["seasonal"]["min_years"]
    bcfg = cfg["burden"]

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
    flu_tier = influenza_tier(cfg)
    dburden = dengue_burden(dengue_monthly, population, cfg).set_index("location_iso3")
    dmin = bcfg["dengue"]["min_years"]

    for iso in cfg["destinations"]:
        # ---------------- influenza: burden fixed (circulates everywhere), timing decides the level.
        # No FluNet data at all -> unknown (not imputed); data but < min_years -> season unavailable -> burden.
        fs = flu_seasonal[(flu_seasonal.location_iso3 == iso) & flu_seasonal.admin1.isna()]
        for _, r in fs.iterrows():
            season, ssrc = _season(r.label)
            has_data = r.label != "unknown"
            tier = flu_tier if has_data else "unknown"
            final = combine_level(tier, season, "influenza")
            if season:
                text = (SEASON_PHRASE[season].format(d="influenza") +
                        " Influenza circulates everywhere, so the level follows the usual season.")
            elif has_data:
                text = (f"Influenza circulates everywhere. Fewer than {min_years} complete years of surveillance data, "
                        "so there is no seasonal pattern yet.")
            else:
                text = "No influenza surveillance data for this country."
            add(location_iso3=iso, disease="influenza", row_type="seasonal", month=int(r.month),
                level=level_label(final), based_on="seasonal" if season else "unknown",
                consistency=r.consistency, consistency_score=r.consistency_score, seasonal_index=r.median_index,
                data_as_of=_date(flu_asof.get(iso)), source=flu_src, verified=True, notes=text,
                burden_value=None, burden_unit=None, burden_tier=tier, season_label=season, season_source=ssrc,
                final_level=final, confidence="normal" if final != "unknown" else None, based_on_text=text,
                details=_json({"n_years": r.n_years, "years_used": r.years_used, "excluded_years": r.excluded_years,
                               "seasonal_label": r.label,
                               "unknown_reason": None if has_data else "no_data"}))
        # real-time row: unchanged logic (flu_realtime); burden x timing columns left empty
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

        # ---------------- dengue: burden = average yearly cases per 100k (national), timing = seasonal label
        an, ad = alert_note("dengue", iso)
        b = dburden.loc[iso] if iso in dburden.index else None
        if b is None:
            tier, bval, reason = "unknown", None, "no_data"
            btext = "No dengue data for this country."
        elif b.burden_tier == "unknown":
            tier, bval, reason = "unknown", None, b.unknown_reason
            btext = (f"Fewer than {dmin} complete years of dengue data ({int(b.n_years)}), "
                     "so the yearly level can't be estimated." if reason == "too_few_years"
                     else "No population figure for this country, so the yearly dengue rate can't be computed.")
        else:
            tier, bval, reason = b.burden_tier, float(b.burden_value), None
            btext = (f"Average {fmt_rate(bval)} cases per 100,000 per year "
                     f"({_years_span(int(b.first_year), int(b.last_year))}).")
        ds = dengue_seasonal[(dengue_seasonal.location_iso3 == iso) & dengue_seasonal.admin1.isna()]
        for _, r in ds.iterrows():
            season, ssrc = _season(r.label)
            final = combine_level(tier, season, "dengue")
            if tier == "unknown":
                text = btext
            elif season:
                text = f"{SEASON_PHRASE[season].format(d='dengue')} {btext}"
            else:
                text = f"{btext} Not enough years of monthly data for a seasonal pattern."
            add(location_iso3=iso, disease="dengue", row_type="seasonal", month=int(r.month),
                level=level_label(final), based_on="seasonal" if season and tier != "unknown" else
                ("burden" if tier != "unknown" else "unknown"),
                consistency=r.consistency, consistency_score=r.consistency_score, seasonal_index=r.median_index,
                data_as_of=_date(den_asof.get(iso)), source=den_src, verified=True,
                notes="; ".join(filter(None, [text, an])),
                burden_value=bval, burden_unit=bcfg["dengue"]["unit"], burden_tier=tier, season_label=season,
                season_source=ssrc, final_level=final, confidence="normal" if final != "unknown" else None,
                based_on_text=text,
                details=_json({"n_years": r.n_years, "years_used": r.years_used, "seasonal_label": r.label,
                               "burden_years": None if b is None else b.years_used,
                               "burden_pop_years": None if b is None else b.pop_years,
                               "unknown_reason": reason, **ad}))
        # admin1 rows (only where a complete admin1 seasonal profile exists). No admin1 population yet, so no
        # burden: these keep the seasonal label as `level`, exactly as before.
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
                    source=den_src, verified=True, season_label=r.label, season_source="observed",
                    based_on_text=(f"{SEASON_PHRASE[r.label].format(d='dengue')} "
                                   "Regional seasonal pattern only; no regional burden estimate yet."),
                    details=_json({"n_years": r.n_years, "years_used": r.years_used}))

        # ---------------- measles: burden only (12-month incidence), no timing; alert override kept
        m = measles[measles.location_iso3 == iso]
        if len(m):
            r = m.iloc[0]
            tier = "high" if r.status == "outbreak" else r.burden_tier
            final = combine_level(tier, None, "measles")
            lm = pd.Timestamp(r.latest_month) if not _isna(r.latest_month) else None
            if r.status == "outbreak":
                text = f"Official measles alert: {r.alert_title}."
            elif final == "none":
                text = f"No measles cases reported in the 12 months to {lm:%B %Y} (WHO)."
            elif final != "unknown":
                text = (f"{fmt_rate(r.incidence_12m_per_million)} cases per million people in the 12 months to "
                        f"{lm:%B %Y} (WHO).")
            elif r.unknown_reason == "stale":
                text = f"Latest WHO measles data is from {lm:%B %Y}, too old to show a current level."
            elif r.unknown_reason == "unreported_month":
                text = f"Some months in the 12 months to {lm:%B %Y} were not reported to WHO."
            else:
                text = "No measles data for this country."
            add(location_iso3=iso, disease="measles", row_type="recent_activity", month=None,
                level=r.status if r.status == "outbreak" else level_label(final),
                based_on=r.based_on, data_as_of=_date(r.latest_month), source=r.source,
                source_url=r.alert_url if r.based_on == "official_alert" else cfg["sources"]["measles"]["page_url"],
                verified=True, notes="; ".join(filter(None, [text, None if _isna(r.notes) else r.notes])),
                burden_value=None if _isna(r.incidence_12m_per_million) else float(r.incidence_12m_per_million),
                burden_unit=bcfg["measles"]["unit"], burden_tier=tier, season_label=None, season_source="none",
                final_level=final, confidence="normal" if final != "unknown" else None, based_on_text=text,
                details=_json({**{k: r[k] for k in ["cases_12m", "incidence_12m_per_million", "population", "pop_year",
                                                    "pop_source", "computed_status", "computed_tier", "age_months",
                                                    "computed_on"]}, "unknown_reason": r.unknown_reason}))
        else:
            text = "No measles data for this country."
            add(location_iso3=iso, disease="measles", row_type="recent_activity", level="unknown",
                based_on="unknown", notes=text, burden_tier="unknown", season_source="none", final_level="unknown",
                based_on_text=text, details=_json({"unknown_reason": "no_data"}))

        # ---------------- malaria: burden from WHO incidence; written as one status row (row_type presence).
        # HOOK (not built yet): when a monthly malaria seasonal profile exists (rainfall-based, or Brazil/Malawi
        # case data), emit 12 row_type="seasonal" rows here with
        # combine_level(p.burden_tier, <month label>, "malaria") -- the malaria floor keeps them >= moderate.
        an, ad = alert_note("malaria", iso)
        for _, p in presence[(presence.disease == "malaria") & (presence.location_iso3 == iso)].iterrows():
            extra = dict(ad)
            tier = p.burden_tier
            final = combine_level(tier, None, "malaria")
            if not _isna(p.incidence):
                extra.update(incidence=p.incidence, incidence_low=p.incidence_low, incidence_high=p.incidence_high,
                             incidence_year=p.incidence_year, unit=p.unit, burden_tier_low=p.burden_tier_low,
                             burden_tier_high=p.burden_tier_high)
            extra["unknown_reason"] = p.unknown_reason
            if final == "unknown":
                text = ("No WHO malaria estimate for this country." if p.unknown_reason == "no_data"
                        else f"Malaria estimate is not in WHO's per-1,000-at-risk unit ({p.unit}).")
            elif final == "none":
                text = f"WHO estimates no local malaria cases ({p.incidence_year})."
            else:
                text = (f"About {fmt_rate(p.incidence)} cases per 1,000 at risk (WHO, {p.incidence_year}). "
                        "No seasonal data yet; precautions apply year-round.")
                if p.confidence == "lower":
                    text += (f" WHO's range ({fmt_rate(p.incidence_low)}\u2013{fmt_rate(p.incidence_high)}) "
                             "spans more than one level.")
            add(location_iso3=iso, admin1=p.admin1, admin1_key=p.admin1_key, disease="malaria", row_type="presence",
                month=None, level=level_label(final), based_on=p.based_on, data_as_of=_date(p.data_as_of),
                source=p.source, source_url=p.source_url, verified=p.based_on != "unknown",
                notes="; ".join(filter(None, [text, an])),
                burden_value=None if _isna(p.incidence) else float(p.incidence), burden_unit=bcfg["malaria"]["unit"],
                burden_tier=tier, season_label=None, season_source="none", final_level=final,
                confidence=p.confidence if final != "unknown" else None, based_on_text=text, details=_json(extra))

        # ---------------- reminders (no level)
        for rem in cfg["reminders"]:
            add(location_iso3=iso, disease=rem["disease"], card_group=rem["card_group"], row_type="reminder",
                level=None, based_on="vaccine_reminder", source=rem["source"], source_url=rem["source_url"],
                verified=not rem.get("needs_review", False), notes=rem["text"])

    out = pd.DataFrame(rows, columns=OUTLOOK_COLS)
    for r in cfg["reminders"]:   # reminder card_group from config (covid19 respiratory, measles measles)
        out.loc[(out.row_type == "reminder") & (out.disease == r["disease"]), "card_group"] = r["card_group"]
    out["month"] = out.month.astype("Int64")
    for c in FLOAT_COLS:
        out[c] = pd.to_numeric(out[c], errors="coerce").astype("float64")
    return out
