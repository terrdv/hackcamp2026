"""Data-quality report per disease x country (CSV + short markdown)."""
from __future__ import annotations

import pandas as pd


def _summ(df: pd.DataFrame, disease: str, observed_col: str | None, cfg, level: str = "national") -> list[dict]:
    rows = []
    for iso in cfg["destinations"]:
        g = df[df.location_iso3 == iso] if len(df) else df
        if observed_col and len(g):
            obs = g[g[observed_col].astype(bool)]
        else:
            obs = g
        if obs is None or obs.empty:
            rows.append(dict(disease=disease, location_iso3=iso, level=level, first_period=None, last_period=None,
                             n_periods=0, pct_missing_months=None, complete_years=0, complete_year_list="",
                             data_as_of=None, status="no data"))
            continue
        first, last = obs.period_start.min(), obs.period_start.max()
        span = pd.period_range(first, last, freq="M") if g.period_type.iloc[0] != "year" else None
        if span is not None:
            seen = obs.period_start.dt.to_period("M").nunique()
            pct_missing = round(100 * (1 - seen / len(span)), 1)
        else:
            pct_missing = None
        cy = sorted(g[g.is_complete_year.astype(bool)].period_start.dt.year.unique().tolist()) \
            if "is_complete_year" in g else []
        rows.append(dict(disease=disease, location_iso3=iso, level=level, first_period=first.date(),
                         last_period=last.date(), n_periods=len(obs), pct_missing_months=pct_missing,
                         complete_years=len(cy), complete_year_list=",".join(map(str, cy)),
                         data_as_of=pd.to_datetime(g.data_as_of).max(), status="ok"))
    return rows


def quality_report(silver: dict[str, pd.DataFrame], cfg) -> pd.DataFrame:
    rows = []
    rows += _summ(silver.get("influenza_monthly", pd.DataFrame()), "influenza", "month_observed", cfg)
    d = silver.get("dengue_monthly", pd.DataFrame())
    rows += _summ(d[d.admin1.isna()] if len(d) else d, "dengue", "month_observed", cfg)
    if len(d) and d.admin1.notna().any():
        a = d[d.admin1.notna()]
        for iso, g in a.groupby("location_iso3"):
            cy = g[g.is_complete_year].groupby("admin1").year.nunique()
            rows.append(dict(disease="dengue", location_iso3=iso, level="admin1",
                             first_period=g[g.month_observed].period_start.min(),
                             last_period=g[g.month_observed].period_start.max(),
                             n_periods=int(g.month_observed.sum()), pct_missing_months=None,
                             complete_years=int(cy.median()) if len(cy) else 0,
                             complete_year_list=f"{g.admin1.nunique()} admin1 units; median complete years shown",
                             data_as_of=g.data_as_of.max(), status="ok"))
    rows += _summ(silver.get("measles_monthly", pd.DataFrame()), "measles", "reported", cfg)
    m = silver.get("malaria_annual", pd.DataFrame())
    rows += _summ(m[m.admin1.isna()] if len(m) else m, "malaria", None, cfg)
    out = pd.DataFrame(rows)
    for c in ("first_period", "last_period", "data_as_of"):
        out[c] = pd.to_datetime(out[c]).dt.date
    return out


def quality_markdown(q: pd.DataFrame, cfg, ingest_log: pd.DataFrame | None = None) -> str:
    lines = ["# VisitWell data quality report", ""]
    if ingest_log is not None and len(ingest_log):
        lines += ["## Sources", "", "| source | status | retrieved_at | sha256 |", "|---|---|---|---|"]
        for _, r in ingest_log.iterrows():
            ra = "" if pd.isna(r.retrieved_at) else r.retrieved_at
            sh = "" if pd.isna(r.sha256) else str(r.sha256)[:12]
            lines.append(f"| {r.source} | {r.status} | {ra} | {sh} |")
        lines.append("")
    lines += ["## Coverage per disease x country", "",
              "| disease | iso3 | level | first | last | % missing months | complete years | data as of |",
              "|---|---|---|---|---|---|---|---|"]
    for _, r in q.iterrows():
        pm = "" if pd.isna(r.pct_missing_months) else f"{r.pct_missing_months}"
        lines.append(f"| {r.disease} | {r.location_iso3} | {r.level} | {r.first_period or ''} | {r.last_period or ''} "
                     f"| {pm} | {r.complete_years} | {r.data_as_of or ''} |")
    nod = q[q.status == "no data"]
    lines += ["", "## Notes", ""]
    if len(nod):
        lines.append("No data (these become `unknown` in the outlook): " +
                     ", ".join(f"{a}/{b}" for a, b in zip(nod.disease, nod.location_iso3)))
    few = q[(q.status == "ok") & (q.complete_years < cfg["seasonal"]["min_years"]) & q.disease.isin(["influenza", "dengue"])
            & (q.level == "national")]
    if len(few):
        lines.append(f"Fewer than {cfg['seasonal']['min_years']} complete years (seasonal profile = insufficient_data): " +
                     ", ".join(f"{a}/{b}" for a, b in zip(few.disease, few.location_iso3)))
    lines.append("")
    lines.append("Influenza complete-year counts include the excluded baseline years "
                 f"{cfg['influenza']['excluded_baseline_years']}, which are dropped later in the seasonal profile.")
    return "\n".join(lines) + "\n"
