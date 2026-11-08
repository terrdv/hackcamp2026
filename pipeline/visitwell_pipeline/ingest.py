"""Bronze layer: download / load raw files unchanged and record provenance.

Every bronze row carries _source, _source_url, _file, _file_sha256 and _retrieved_at.
Raw values are kept as strings. The only changes are (a) column names are made Delta-safe when
written, and (b) the two ~500 MB OpenDengue extracts are filtered to the configured destinations
(the full file is archived in the volume and its hash recorded in ingest_log).
"""
from __future__ import annotations

import datetime as dt
import glob
import hashlib
import json
import logging
import zipfile
from pathlib import Path

import pandas as pd
import requests

log = logging.getLogger(__name__)
USER_AGENT = "VisitWell-pipeline/0.1 (HackCamp 2026)"
MANIFEST = "_manifest.json"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


class RawStore:
    def __init__(self, cfg, offline: bool = False, refresh: bool = False):
        self.cfg, self.offline, self.refresh = cfg, offline, refresh
        self.root = cfg.path("raw")
        self.root.mkdir(parents=True, exist_ok=True)
        mp = self.root / MANIFEST
        self.manifest = json.loads(mp.read_text()) if mp.exists() else {}
        self.log_rows: list[dict] = []

    def save_manifest(self):
        (self.root / MANIFEST).write_text(json.dumps(self.manifest, indent=2))

    def fetch(self, source: str, url: str | None, rel: str, manual: bool = False,
              static: bool = False) -> Path | None:
        """Return local path to the raw file, downloading it if needed. None if unavailable.

        `static` sources (versioned releases) are never re-downloaded once present, even with refresh.
        """
        p = self.root / rel
        wanted = not p.exists() or (self.refresh and not static)
        if url and not manual and not self.offline and wanted:
            p.parent.mkdir(parents=True, exist_ok=True)
            log.info("download %s -> %s", url, p)
            try:
                with requests.get(url, stream=True, timeout=300, headers={"User-Agent": USER_AGENT}) as r:
                    r.raise_for_status()
                    tmp = p.with_suffix(p.suffix + ".part")
                    with open(tmp, "wb") as fh:
                        for chunk in r.iter_content(1 << 20):
                            fh.write(chunk)
                    tmp.replace(p)
                self.manifest[rel] = {"url": url, "retrieved_at": _now(), "method": "download"}
            except Exception as e:  # keep going; dependent diseases become "unknown"
                log.warning("download failed for %s: %s", source, e)
        if not p.exists():
            self.log_rows.append(dict(source=source, url=url, file=rel, status="missing",
                                      retrieved_at=None, sha256=None, bytes=None, method=None))
            log.warning("raw file missing for %s: %s", source, p)
            return None
        meta = self.manifest.get(rel)
        if meta is None:  # manually placed file
            meta = {"url": url, "method": "manual",
                    "retrieved_at": dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc)
                    .replace(microsecond=0).isoformat()}
            self.manifest[rel] = meta
        meta["sha256"] = sha256(p)
        meta["bytes"] = p.stat().st_size
        self.log_rows.append(dict(source=source, url=url, file=rel, status="ok",
                                  retrieved_at=meta["retrieved_at"], sha256=meta["sha256"],
                                  bytes=meta["bytes"], method=meta["method"]))
        return p

    def meta(self, rel: str) -> dict:
        return self.manifest.get(rel, {})


def _tag(df: pd.DataFrame, store: RawStore, source: str, url: str | None, rel: str) -> pd.DataFrame:
    m = store.meta(rel)
    df = df.copy()
    df["_source"] = source
    df["_source_url"] = url
    df["_file"] = rel
    df["_file_sha256"] = m.get("sha256")
    df["_retrieved_at"] = m.get("retrieved_at")
    return df


def _read_csv_filtered(path: Path, iso_col: str, keep: list[str]) -> pd.DataFrame:
    parts = []
    for chunk in pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""], chunksize=250_000):
        parts.append(chunk[chunk[iso_col].isin(keep)])
    return pd.concat(parts, ignore_index=True)


def ingest(cfg, sink=None, offline: bool = False, refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Run bronze ingestion. Returns {table_name: DataFrame}; also writes them through `sink`."""
    src = cfg["sources"]
    dest = cfg["destinations"]
    store = RawStore(cfg, offline=offline, refresh=refresh)
    out: dict[str, pd.DataFrame] = {}
    archive: list[tuple[Path, str]] = []

    # --- FluNet + dictionary -------------------------------------------------------------
    s = src["flunet"]
    p = store.fetch("flunet_dictionary", s["dictionary_url"], s["dictionary_file"])
    if p:
        out["flunet_dictionary"] = _tag(pd.read_csv(p, dtype=str), store, s["name"], s["dictionary_url"], s["dictionary_file"])
        archive.append((p, s["dictionary_file"]))
    p = store.fetch("flunet", s["url"], s["file"])
    if p:
        out["flunet_raw"] = _tag(pd.read_csv(p, dtype=str, keep_default_na=False, na_values=[""]),
                                 store, s["name"], s["url"], s["file"])
        archive.append((p, s["file"]))

    # --- OpenDengue ----------------------------------------------------------------------
    s = src["opendengue"]
    for key, stem in s["extracts"].items():
        rel_zip, rel_csv = f"{s['dir']}/{stem}.zip", f"{s['dir']}/{stem}.csv"
        url = f"{s['base_url']}/{stem}.zip"
        static = bool(s.get("static", False))
        zp = store.fetch(f"opendengue_{key}", url, rel_zip, static=static)
        csv = store.root / rel_csv
        if zp and (not csv.exists() or (store.refresh and not static)):
            with zipfile.ZipFile(zp) as z:
                member = next(n for n in z.namelist() if n.endswith(".csv"))
                with z.open(member) as fin, open(csv, "wb") as fout:
                    fout.write(fin.read())
        if csv.exists():
            store.manifest.setdefault(rel_csv, {**store.meta(rel_zip), "method": "unzipped"})
            store.manifest[rel_csv]["sha256"] = sha256(csv)
            df = _read_csv_filtered(csv, "ISO_A0", dest) if key != "national" else \
                pd.read_csv(csv, dtype=str, keep_default_na=False, na_values=["", "NA"])
            df = df.replace({"NA": None})
            out[f"opendengue_{key}_raw"] = _tag(df, store, s["name"], url, rel_csv)
            if zp:
                archive.append((zp, rel_zip))

    # --- Measles (WHO primary, TidyTuesday fallback) -------------------------------------
    s = src["measles"]
    p = store.fetch("measles_who", s["url"], s["file"])
    if p:
        df = pd.read_excel(p, sheet_name=s["sheet"], dtype=str)
        df.columns = [" ".join(str(c).split()) for c in df.columns]
        out["measles_raw"] = _tag(df, store, s["name"], s["url"], s["file"])
        archive.append((p, s["file"]))
    else:
        p = store.fetch("measles_tidytuesday", s["fallback_url"], s["fallback_file"])
        if p:
            df = pd.read_csv(p, dtype=str)
            df = df.rename(columns={"iso3": "ISO3", "year": "Year", "month": "Month",
                                    "country": "Country", "region": "Region",
                                    "measles_total": "Measles total"})
            out["measles_raw"] = _tag(df, store, s["fallback_name"], s["fallback_url"], s["fallback_file"])
            archive.append((p, s["fallback_file"]))

    # --- Population (World Bank JSON) ----------------------------------------------------
    s = src["population"]
    p = store.fetch("population", s["url"], s["file"])
    if p:
        j = json.loads(p.read_text(encoding="utf-8"))
        recs = [{"countryiso3code": r.get("countryiso3code"), "country": (r.get("country") or {}).get("value"),
                 "indicator": (r.get("indicator") or {}).get("id"), "date": r.get("date"),
                 "value": None if r.get("value") is None else str(r.get("value")),
                 "lastupdated": j[0].get("lastupdated")} for r in j[1]]
        out["population_raw"] = _tag(pd.DataFrame(recs), store, s["name"], s["url"], s["file"])
        archive.append((p, s["file"]))

    # --- Malaria: WHO GHO (auto) + MAP (manual, optional) --------------------------------
    s = src["malaria_who"]
    p = store.fetch("malaria_who", s["url"], s["file"])
    if p:
        df = pd.DataFrame(json.loads(p.read_text(encoding="utf-8"))["value"]).astype(str).replace({"None": None, "nan": None})
        out["malaria_who_raw"] = _tag(df, store, s["name"], s["url"], s["file"])
        archive.append((p, s["file"]))
    s = src["malaria_map"]
    map_files = sorted(glob.glob(str(store.root / s["file_glob"])))
    if map_files:
        parts = []
        for f in map_files:
            rel = str(Path(f).relative_to(store.root)).replace("\\", "/")
            store.fetch("malaria_map", None, rel, manual=True)
            parts.append(_tag(pd.read_csv(f, dtype=str), store, s["name"], s["page_url"], rel))
            archive.append((Path(f), rel))
        out["malaria_map_raw"] = pd.concat(parts, ignore_index=True)
    else:
        store.log_rows.append(dict(source="malaria_map", url=s["page_url"], file=s["file_glob"],
                                   status="missing (manual download, optional)", retrieved_at=None,
                                   sha256=None, bytes=None, method="manual"))

    store.save_manifest()
    archive.append((store.root / MANIFEST, MANIFEST))
    out["ingest_log"] = pd.DataFrame(store.log_rows).assign(ingested_at=_now())

    if sink is not None:
        if cfg["databricks"].get("upload_raw_files", True):
            for path, rel in archive:
                sink.upload_raw(path, rel)
        for name, df in out.items():
            sink.write("bronze", name, df, comment=f"VisitWell bronze: {name}")
    return out


# --- change detection (daily job) ---------------------------------------------------------------
def previous_hashes(raw_root: Path) -> dict[str, str]:
    """{raw file: sha256} recorded by the previous run's manifest (empty on the first run)."""
    mp = Path(raw_root) / MANIFEST
    if not mp.exists():
        return {}
    return {rel: m["sha256"] for rel, m in json.loads(mp.read_text()).items() if m.get("sha256")}


def changed_sources(prev: dict[str, str], ingest_log: pd.DataFrame) -> list[str]:
    """Sources whose raw file is new, changed or went missing since the previous run."""
    changed = []
    for r in ingest_log.itertuples(index=False):
        before = prev.get(r.file)
        now = r.sha256 if isinstance(r.sha256, str) else None
        if before != now and not (before is None and now is None):
            changed.append(r.source)
    return sorted(set(changed))
