"""Orchestrator: bronze -> silver -> gold. Same functions run locally and on Databricks."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
from pathlib import Path

import pandas as pd

from .clean.dengue import clean_dengue
from .clean.influenza import clean_influenza
from .clean.measles import clean_malaria, clean_measles, clean_population
from .clean.seeds import apply_usability, load_seeds
from .gold.app_tables import disease_trend, map_points, monthly_cases
from .gold.flu_realtime import flu_realtime
from .gold.measles_status import measles_status
from .gold.outlook import build_alerts, build_outlook, build_presence
from .gold.seasonal import seasonal_profile
from .ingest import changed_sources, ingest, previous_hashes
from .quality import quality_markdown, quality_report

log = logging.getLogger(__name__)
STEPS = ("bronze", "silver", "gold")
APP_TABLES = {"destination_outlook", "monthly_cases", "disease_trend", "map_points"}


def _read(sink, layer, name):
    try:
        return sink.read(layer, name)
    except FileNotFoundError:
        return None


def run_bronze(cfg, sink, offline=False, refresh=False):
    return ingest(cfg, sink, offline=offline, refresh=refresh)


def run_silver(cfg, sink, bronze: dict | None = None) -> dict[str, pd.DataFrame]:
    b = bronze or {}
    get = lambda n: b.get(n) if n in b else _read(sink, "bronze", n)
    silver: dict[str, pd.DataFrame] = {}

    flu = get("flunet_raw")
    if flu is not None:
        silver["influenza_weekly"], silver["influenza_monthly"] = clean_influenza(flu, get("flunet_dictionary"), cfg)
    else:
        log.warning("no FluNet data -> influenza will be unknown")
        silver["influenza_weekly"] = pd.DataFrame(columns=["location_iso3", "period_start", "is_valid", "iso_year",
                                                           "iso_week", "percent_positive", "specimens"])
        silver["influenza_monthly"] = pd.DataFrame(columns=["location_iso3", "admin1", "year", "month",
                                                            "percent_positive", "is_complete_year"])
    silver["dengue_monthly"] = clean_dengue(get("opendengue_national_raw"), get("opendengue_spatial_raw"),
                                            get("opendengue_temporal_raw"), cfg)
    silver["population"] = clean_population(get("population_raw"), cfg)
    silver["measles_monthly"] = clean_measles(get("measles_raw"), silver["population"], cfg)
    silver["malaria_annual"] = clean_malaria(get("malaria_who_raw"), get("malaria_map_raw"), cfg)
    for kind, df in load_seeds(cfg).items():
        silver[f"seed_{kind}"] = df

    q = quality_report(silver, cfg)
    silver["quality_report"] = q
    rep = cfg.path("reports")
    rep.mkdir(parents=True, exist_ok=True)
    q.to_csv(rep / "quality_report.csv", index=False)
    (rep / "quality_report.md").write_text(quality_markdown(q, cfg, get("ingest_log")), encoding="utf-8")

    for name, df in silver.items():
        sink.write("silver", name, df, comment=f"VisitWell silver: {name}")
    return silver


def run_gold(cfg, sink, silver: dict | None = None, as_of: dt.date | None = None) -> dict[str, pd.DataFrame]:
    as_of = as_of or dt.date.today()
    s = silver or {}
    _get = lambda n: s.get(n) if n in s else _read(sink, "silver", n)
    get = lambda n: apply_usability(_get(n), cfg) if n.startswith("seed_") else _get(n)
    fm, fw, dm = get("influenza_monthly"), get("influenza_weekly"), get("dengue_monthly")
    dests = pd.DataFrame({"location_iso3": cfg["destinations"], "admin1": None})

    flu_seasonal = seasonal_profile(fm.rename(columns={"percent_positive": "value"}), "value", "influenza", cfg,
                                    cfg["influenza"]["excluded_baseline_years"], locations=dests)
    dmon = dm[["location_iso3", "admin1", "year", "month", "cases", "is_complete_year"]] if len(dm) else \
        pd.DataFrame(columns=["location_iso3", "admin1", "year", "month", "cases", "is_complete_year"])
    dengue_seasonal = seasonal_profile(dmon, "cases", "dengue", cfg, cfg["dengue"]["excluded_baseline_years"],
                                       locations=dests)
    seasonal = pd.concat([flu_seasonal, dengue_seasonal], ignore_index=True)

    rt = flu_realtime(fw, cfg, as_of)
    alerts = build_alerts(None, as_of)   # no alert source since seeds were removed
    measles = measles_status(get("measles_monthly"), alerts, cfg, as_of)
    presence = build_presence(get("malaria_annual"), cfg)
    outlook = build_outlook(cfg, flu_seasonal=flu_seasonal, flu_rt=rt, flu_weekly=fw,
                            dengue_seasonal=dengue_seasonal, dengue_monthly=dm, measles=measles,
                            presence=presence, alerts=alerts, population=get("population"))
    outlook["built_on"] = as_of
    cases = monthly_cases(fm, dm, get("measles_monthly"), cfg)
    trend = disease_trend(cases, cfg, as_of)
    points = map_points(trend, get("seed_centroids"), cfg, as_of)
    gold = {"seasonal_profile": seasonal, "flu_realtime": rt, "measles_status": measles,
            "presence": presence, "destination_outlook": outlook,
            "monthly_cases": cases, "disease_trend": trend, "map_points": points}
    for name, df in gold.items():
        sink.write("gold", name, df, comment=f"VisitWell gold: {name}" +
                   (" (read by the app)" if name in APP_TABLES else ""))
    outlook.to_csv(cfg.path("gold") / "destination_outlook.csv", index=False)
    return gold


def run_all(cfg, sink, steps=STEPS, offline=False, refresh=False, as_of=None):
    bronze = run_bronze(cfg, sink, offline, refresh) if "bronze" in steps else None
    silver = run_silver(cfg, sink, bronze) if "silver" in steps else None
    gold = run_gold(cfg, sink, silver, as_of) if "gold" in steps else None
    return bronze, silver, gold


STATE_FILE = "_last_run.json"


def code_fingerprint(root) -> str:
    """Hash of everything besides raw data that silver depends on: config, pipeline code, seed files."""
    root = Path(root)
    files = [root / "config" / "pipeline.yaml", *sorted((root / "visitwell_pipeline").rglob("*.py")),
             *sorted((root / "data" / "seeds").glob("*"))]
    h = hashlib.sha256()
    for f in files:
        if f.is_file():
            h.update(str(f.relative_to(root)).encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def needs_silver(changed: list[str], code_changed: bool, silver_present: bool, force: bool) -> bool:
    return bool(force or changed or code_changed or not silver_present)


def run_incremental(cfg, sink, *, refresh=True, offline=False, as_of=None, force=False) -> dict:
    """Daily job: re-fetch sources, rebuild silver only if a source / the code changed, always rebuild gold
    (its freshness labels depend on the run date). With a merging sink only changed rows are written."""
    state_path = cfg.path("silver").parent / STATE_FILE
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    # baseline = hashes of the last *successful* run (state is written last); the manifest is only a fallback
    # because ingest rewrites it even when a later step fails.
    prev = state.get("source_hashes") or previous_hashes(cfg.path("raw"))
    fp = code_fingerprint(cfg["_root"])

    bronze = run_bronze(cfg, sink, offline, refresh)
    changed = changed_sources(prev, bronze["ingest_log"])
    silver_present = (cfg.path("silver") / "influenza_monthly.parquet").exists()
    rebuild = needs_silver(changed, state.get("code_fingerprint") != fp, silver_present, force)
    log.info("changed sources: %s | code changed: %s | rebuild silver: %s",
             changed or "none", state.get("code_fingerprint") != fp, rebuild)
    silver = run_silver(cfg, sink, bronze) if rebuild else None
    gold = run_gold(cfg, sink, silver, as_of)

    summary = {"run_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
               "as_of": str(as_of or dt.date.today()), "changed_sources": changed,
               "silver_rebuilt": rebuild, "code_fingerprint": fp,
               "source_hashes": {r.file: r.sha256 for r in bronze["ingest_log"].itertuples(index=False)
                                 if isinstance(r.sha256, str)}}
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(summary, indent=2))
    return {**summary, "bronze": bronze, "silver": silver, "gold": gold}
