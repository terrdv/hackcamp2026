"""Baseline for burden x timing levels (no gap-filling / imputation).

    python baseline_report.py [--before data/reports/destination_outlook_before_burden.parquet]

Reads data/gold/destination_outlook.parquet (new logic) and, if given, a copy of the table built with the old
logic. Writes reports/baseline_burden_levels.md and prints the summary tables. National rows only (the app
queries admin1 IS NULL); reminder and influenza real-time rows are excluded (unchanged logic).

Counting units
* final_level counts: country-months for seasonal diseases (influenza, dengue), countries for status diseases.
* "unknown" countries: every non-reminder national row for that disease is unknown.
* before/after: compared in the frontend's activity vocabulary (report-mapping.ts: elevated/moderate/low/unknown),
  per country-month (seasonal) or per country (status), plus the number of countries with any change.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
NEW = ROOT / "data" / "gold" / "destination_outlook.parquet"
BEFORE = ROOT / "data" / "reports" / "destination_outlook_before_burden.parquet"
OUT = ROOT / "reports" / "baseline_burden_levels.md"
LEVELS = ["none", "low", "moderate", "high", "unknown"]
# copy of the LEVEL map in frontend/src/data/report-mapping.ts (anything else -> unknown)
UI = {"peak": "elevated", "much_higher": "elevated", "high": "elevated", "outbreak": "elevated",
      "widespread": "elevated", "moderate": "moderate", "higher_than_usual": "moderate", "circulating": "moderate",
      "present": "moderate", "low": "low", "typical": "low", "not_reported": "low", "some_areas": "low"}
ROW_DISEASES = ["influenza", "dengue", "measles", "malaria"]


def ui(level) -> str:
    return UI.get(level, "unknown") if isinstance(level, str) else "unknown"


def national(o: pd.DataFrame) -> pd.DataFrame:
    return o[o.admin1.isna() & ~o.row_type.isin(["reminder", "realtime"])].copy()


def md_table(df: pd.DataFrame) -> str:
    cols = [str(c) for c in df.columns]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join("" if pd.isna(v) else str(v) for v in r) + " |" for r in df.itertuples(index=False)]
    return "\n".join(lines)


def final_counts(n: pd.DataFrame) -> pd.DataFrame:
    t = n.groupby("disease").final_level.value_counts().unstack(fill_value=0).reindex(columns=LEVELS, fill_value=0)
    t = t.reindex([d for d in ROW_DISEASES if d in t.index])
    t["unit"] = ["country-months" if d in ("influenza", "dengue") else "countries" for d in t.index]
    return t.reset_index()


def unknown_reasons(n: pd.DataFrame) -> pd.DataFrame:
    n = n.assign(reason=n.details.map(lambda s: (json.loads(s) if isinstance(s, str) else {}).get("unknown_reason")))
    out = []
    for d, g in n.groupby("disease"):
        per = g.groupby("location_iso3").agg(all_unknown=("final_level", lambda s: (s == "unknown").all()),
                                             reason=("reason", lambda s: s.dropna().iloc[0] if s.notna().any()
                                                     else "none_recorded"))
        unk = per[per.all_unknown]
        row = {"disease": d, "countries": len(per), "unknown_countries": len(unk)}
        row.update(unk.reason.value_counts().to_dict())
        out.append(row)
    t = pd.DataFrame(out).fillna(0)
    for c in t.columns[3:]:
        t[c] = t[c].astype(int)
    return t.set_index("disease").reindex([d for d in ROW_DISEASES if d in set(t.disease)]).reset_index()


def compare(before: pd.DataFrame, n: pd.DataFrame):
    b = national(before)
    keys = ["location_iso3", "disease", "month"]
    b = b.assign(month=b.month.astype("Int64"), ui_before=b.level.map(ui))[keys + ["level", "ui_before"]]
    a = n.assign(month=n.month.astype("Int64"), ui_after=n.level.map(ui))[keys + ["level", "ui_after"]]
    m = b.merge(a, how="outer", on=keys, suffixes=("_before", "_after"))
    m["ui_before"] = m.ui_before.fillna("removed")
    m["ui_after"] = m.ui_after.fillna("removed")
    m["changed"] = m.ui_before != m.ui_after
    rows = []
    for d, g in m.groupby("disease"):
        rows.append({"disease": d, "rows": len(g), "rows_changed": int(g.changed.sum()),
                     "countries_changed": int(g[g.changed].location_iso3.nunique()),
                     "shown_before": int(g[g.ui_before.isin(["low", "moderate", "elevated"])].location_iso3.nunique()),
                     "shown_after": int(g[g.ui_after.isin(["low", "moderate", "elevated"])].location_iso3.nunique())})
    summary = pd.DataFrame(rows)
    trans = (m[m.changed & (m.ui_before != "removed")].groupby(["disease", "ui_before", "ui_after"]).size()
             .rename("rows").reset_index().sort_values(["disease", "rows"], ascending=[True, False]))
    return m, summary, trans


def examples(m: pd.DataFrame, n: pd.DataFrame) -> dict[str, pd.DataFrame]:
    ex = {}
    d = m[(m.disease == "dengue") & (m.level_before == "peak") & (m.ui_after != "elevated")]
    if len(d):
        info = n[n.disease == "dengue"].drop_duplicates("location_iso3").set_index("location_iso3")
        g = (d.groupby("location_iso3").agg(peak_months_capped=("month", "size"), now=("level_after", "first"))
             .join(info[["burden_value", "burden_tier"]]).reset_index().sort_values("burden_value"))
        g["burden_value"] = g.burden_value.round(1)
        ex["Dengue: old peak months no longer elevated (capped by burden)"] = g.head(10)
    mal = n[(n.disease == "malaria") & (n.final_level == "high")][["location_iso3", "burden_value", "confidence"]]
    if len(mal):
        mb = m[m.disease == "malaria"].set_index("location_iso3").level_before
        mal = mal.assign(before=mal.location_iso3.map(mb), burden_value=mal.burden_value.round(1))
        ex["Malaria: countries now high (> 50 per 1,000 at risk)"] = mal.sort_values("burden_value", ascending=False).head(10)
    low = n[(n.disease == "malaria") & (n.final_level == "low")][["location_iso3", "burden_value", "confidence"]]
    if len(low):
        ex["Malaria: countries now low (< 1 per 1,000; were 'present' -> moderate)"] = \
            low.assign(burden_value=low.burden_value.round(3)).sort_values("burden_value").head(10)
    fl = m[(m.disease == "influenza") & (m.ui_before == "unknown") & (m.ui_after == "moderate")]
    if len(fl):
        ex["Influenza: now shown as moderate with no seasonal pattern (< 5 complete years)"] = pd.DataFrame(
            {"countries": [fl.location_iso3.nunique()], "examples": [", ".join(sorted(fl.location_iso3.unique())[:12])]})
    me = m[(m.disease == "measles") & m.changed]
    if len(me):
        ex["Measles: changed countries (sample)"] = me[["location_iso3", "level_before", "level_after"]].head(10)
    return ex


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--after", default=str(NEW))
    ap.add_argument("--before", default=str(BEFORE))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args(argv)
    o = pd.read_parquet(a.after)
    n = national(o)
    built = str(o.built_on.iloc[0]) if "built_on" in o and len(o) else "?"
    parts = [f"# Baseline: burden x timing levels (no imputation)\n",
             f"Built from `data/gold/destination_outlook.parquet` (built_on {built}); {o.location_iso3.nunique()} "
             "destinations, national rows only. Generated by `python baseline_report.py`. Thresholds: "
             "`burden:` in config/pipeline.yaml (all placeholders, needs_review).\n"]
    fc, ur = final_counts(n), unknown_reasons(n)
    print("\nfinal_level counts\n" + fc.to_string(index=False))
    print("\nunknown countries by reason\n" + ur.to_string(index=False))
    parts += ["## final_level counts\n", md_table(fc), "",
              "## Countries with unknown level, by reason\n",
              "A country counts as unknown when every row for that disease is unknown. Reasons: `no_data` (no rows in "
              "the source), `too_few_years` (dengue: < 3 complete years), `no_population`, `stale` (measles latest "
              "month > 6 months old), `unreported_month` (measles 12-month window has an unreported month).\n",
              md_table(ur), ""]
    d = n[n.disease == "dengue"].drop_duplicates("location_iso3")
    reasons = d.details.map(lambda s: json.loads(s).get("unknown_reason") if isinstance(s, str) else None)
    nopop = sorted(d[reasons == "no_population"].location_iso3)
    yrs = d.details.map(lambda s: json.loads(s).get("burden_years") if isinstance(s, str) else None)
    last = yrs.map(lambda y: int(y.split(",")[-1]) if isinstance(y, str) and y else None)
    old = d.assign(last=last)[last.notna() & (last < pd.Timestamp(built).year - 5)]
    obs = [f"* Dengue burden unknown for lack of a World Bank population figure: {', '.join(nopop) or 'none'}.",
           "* Dengue burden based on years ending more than 5 years before the build: "
           + (", ".join(f"{r.location_iso3} (to {int(r['last'])})" for _, r in old.iterrows()) or "none") + "."]
    print("\nobservations\n" + "\n".join(obs))
    parts += ["## Observations\n", *obs, ""]
    bp = Path(a.before)
    if bp.exists():
        m, summary, trans = compare(pd.read_parquet(bp), n)
        print("\nbefore vs after (frontend activity level)\n" + summary.to_string(index=False))
        parts += ["## Before vs after\n",
                  "Compared in the frontend's activity vocabulary (elevated / moderate / low / unknown). `rows` are "
                  "country-months for influenza/dengue and countries otherwise; `shown` = countries with at least one "
                  "non-unknown row (the app hides unknown cards). Yellow fever, hepatitis A and typhoid were always "
                  "unknown (never shown) and are now removed.\n",
                  md_table(summary), "", "### Transitions (rows)\n", md_table(trans), ""]
        for title, df in examples(m, n).items():
            print(f"\n{title}\n" + df.to_string(index=False))
            parts += [f"### {title}\n", md_table(df), ""]
    else:
        parts.append(f"_No before table at {bp}; comparison skipped._\n")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts), encoding="utf-8")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
