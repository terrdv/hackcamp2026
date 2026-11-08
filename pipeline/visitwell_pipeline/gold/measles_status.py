"""Measles recent-activity status per country."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from .levels import level_label, measles_tier


def measles_level(cases_12m, incidence_per_million, cfg) -> str:
    """12-month incidence -> `level` label via the burden tiers (config `burden.measles`).

    0 cases -> not_reported (tier none); < 1 per million -> low; 1-10 -> moderate; > 10 -> high; missing -> unknown.
    """
    return level_label(measles_tier(cases_12m, incidence_per_million, cfg))


def measles_status(monthly: pd.DataFrame, alerts: pd.DataFrame, cfg, as_of: dt.date) -> pd.DataFrame:
    rows = []
    max_age = cfg["measles"]["max_age_months"]
    for iso in cfg["destinations"]:
        g = monthly[monthly.location_iso3 == iso] if len(monthly) else monthly
        rec = dict(disease="measles", location_iso3=iso, admin1=None, latest_month=None, cases_12m=np.nan,
                   incidence_12m_per_million=np.nan, population=np.nan, pop_year=None, pop_source=None,
                   computed_status="unknown", status="unknown", based_on="unknown", age_months=None,
                   burden_tier="unknown", computed_tier="unknown", unknown_reason="no_data",
                   notes=None, alert_title=None, alert_url=None,
                   source=(g.source.iloc[0] if g is not None and len(g) else cfg["sources"]["measles"]["name"]))
        if g is not None and len(g):
            last = g.sort_values("period_start").iloc[-1]
            lm = pd.Timestamp(last.period_start)
            age = (pd.Timestamp(as_of).year - lm.year) * 12 + (pd.Timestamp(as_of).month - lm.month)
            tier = measles_tier(last.cases_12m, last.incidence_12m_per_million, cfg)
            st = level_label(tier)
            rec.update(latest_month=lm.date(), cases_12m=last.cases_12m,
                       incidence_12m_per_million=last.incidence_12m_per_million, population=last.population,
                       pop_year=last.pop_year, pop_source=last.pop_source, computed_status=st, age_months=age,
                       computed_tier=tier, unknown_reason=None)
            notes = []
            if tier == "unknown":
                notes.append(f"12-month window ending {lm:%Y-%m} has unreported months")
                rec["unknown_reason"] = "unreported_month"
            if age > max_age:
                notes.append(f"latest WHO data is {lm:%Y-%m} ({age} months old); last computed status was '{st}'")
                st, tier = "unknown", "unknown"
                rec["unknown_reason"] = "stale"
            rec.update(status=st, burden_tier=tier, based_on="recent_activity" if st != "unknown" else "unknown",
                       notes="; ".join(notes) or None)
        else:
            rec["notes"] = "no measles data for this country"
        a = alerts[(alerts.disease == "measles") & (alerts.location_iso3 == iso)] if len(alerts) else alerts
        if a is not None and len(a):
            top = a.sort_values("issued", ascending=False).iloc[0]
            rec.update(status="outbreak", based_on="official_alert", alert_title=top.title, alert_url=top.url,
                       notes="; ".join(filter(None, [rec["notes"], f"official alert: {top.title}"])))
        rows.append(rec)
    out = pd.DataFrame(rows)
    out["computed_on"] = as_of
    return out
