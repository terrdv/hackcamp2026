"""Geography for the app, from Natural Earth (public domain) and the pipeline's own output.

    python build_geo.py centroids   # after silver: map coordinates for every country + every dengue admin1 region
    python build_geo.py frontend    # after gold:   destination list + one outline file per country for the web app

Order for a full refresh:  dt_preproc.py --steps bronze silver  ->  build_geo.py centroids
                           ->  dt_preproc.py --steps gold  ->  build_geo.py frontend

Natural Earth files are downloaded once into data/raw/naturalearth/ (gitignored with the rest of data/raw).
Only countries with at least one known (non-unknown) disease level are listed in the app.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from pathlib import Path

import pandas as pd
import pycountry
import requests

from visitwell_pipeline.config import load_config
from visitwell_pipeline.countries import admin1_key

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT.parents[1] / "frontend"
NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson"
NE_FILES = {"admin0_10m": "ne_10m_admin_0_countries", "admin0_50m": "ne_50m_admin_0_countries",
            "admin1_10m": "ne_10m_admin_1_states_provinces"}
CHECKED_ON = "2026-11-08"

# Region abbreviations used by sources that Natural Earth stores under their full name.
# Display names where Natural Earth's English name is not the everyday one.
DISPLAY_NAMES = {"CHN": "China"}

ADMIN1_ALIASES = {("AUS", "ACT"): "Australian Capital Territory", ("AUS", "NSW"): "New South Wales",
                  ("AUS", "QLD"): "Queensland", ("AUS", "TAS"): "Tasmania", ("AUS", "VIC"): "Victoria"}


def ne(name: str, cfg) -> list[dict]:
    d = cfg.raw("naturalearth")
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{NE_FILES[name]}.geojson"
    if not p.exists():
        r = requests.get(f"{NE_BASE}/{NE_FILES[name]}.geojson", timeout=300)
        r.raise_for_status()
        p.write_bytes(r.content)
    return json.loads(p.read_text(encoding="utf-8"))["features"]


def iso_of(p: dict) -> str | None:
    for k in ("ISO_A3_EH", "ISO_A3", "ADM0_A3"):
        v = p.get(k)
        if v and v != "-99":
            return {"KOS": "XKX"}.get(v, v)
    return None


# ------------------------------------------------------------------------------------------- centroids
def build_centroids(cfg) -> None:
    dests = set(cfg["destinations"])
    rows: dict[tuple, tuple] = {}
    for f in ne("admin0_10m", cfg):
        p = f["properties"]
        iso = iso_of(p)
        if iso in dests and (iso, "") not in rows:
            rows[(iso, "")] = (p["LABEL_Y"], p["LABEL_X"], p["NAME"])

    idx: dict[tuple, tuple] = {}
    for f in ne("admin1_10m", cfg):
        p = f["properties"]
        iso = {"KOS": "XKX"}.get(p.get("adm0_a3"), p.get("adm0_a3"))
        names = {p.get(k) for k in ("name", "name_en", "gn_name", "woe_name", "name_local", "postal")}
        names |= set(str(p.get("name_alt") or "").split("|"))
        for n in names - {None, "", "None"}:
            idx.setdefault((iso, admin1_key(n)), (p["latitude"], p["longitude"], p["name"]))
    for (iso, short), full in ADMIN1_ALIASES.items():
        if (iso, admin1_key(full)) in idx:
            idx[(iso, short)] = idx[(iso, admin1_key(full))]

    dengue = pd.read_parquet(cfg.path("silver") / "dengue_monthly.parquet", columns=["location_iso3", "admin1"])
    missing = 0
    for r in dengue.dropna().drop_duplicates().itertuples():
        hit = idx.get((r.location_iso3, admin1_key(r.admin1)))
        if hit:
            rows[(r.location_iso3, r.admin1)] = hit
        else:
            missing += 1   # e.g. regions reorganised after Natural Earth's boundaries: national point is used instead

    out = cfg.seed("centroids")
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["location_iso3", "admin1", "latitude", "longitude", "source_name", "source_url", "checked_on",
                    "verified", "needs_review", "notes"])
        for (iso, a1), (lat, lon, name) in sorted(rows.items()):
            w.writerow([iso, a1, round(lat, 4), round(lon, 4), "Natural Earth 10m v5.1.2 label point",
                        "https://www.naturalearthdata.com/", CHECKED_ON, "true", "false", name])
    n_a1 = sum(1 for k in rows if k[1])
    print(f"centroids: {len(rows) - n_a1} countries, {n_a1} admin1 regions ({missing} region names unmatched) -> {out}")


# ------------------------------------------------------------------------------------------- frontend
def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def ring_area(ring) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1, *_), (x2, y2, *_) in zip(ring, ring[1:]))) / 2


def camera_for(geometry: dict) -> tuple[list[float], float]:
    """Camera centre and zoom from the bounding box of the country's largest polygon
    (ignores overseas territories and antimeridian spans)."""
    polys = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    main = max(polys, key=lambda poly: ring_area(poly[0]))[0]
    xs, ys = [v[0] for v in main], [v[1] for v in main]
    span = max(max(xs) - min(xs), (max(ys) - min(ys)) * 1.3, 0.5)
    centre = [round((min(xs) + max(xs)) / 2, 2), round((min(ys) + max(ys)) / 2, 2)]
    return centre, round(min(6.5, max(2.5, math.log2(360 / span) + 0.5)), 1)


def rounded(c, nd=3):
    return [rounded(x, nd) for x in c] if isinstance(c[0], list) else [round(c[0], nd), round(c[1], nd)]


def aliases(p: dict, iso: str) -> list[str]:
    names = {p.get(k) for k in ("NAME", "NAME_LONG", "FORMAL_EN", "NAME_SORT", "ADMIN", "GEOUNIT", "BRK_NAME")}
    abbrev = (p.get("ABBREV") or "").replace(".", "")
    names |= {abbrev, iso, p.get("ISO_A2_EH") or p.get("ISO_A2")}
    c = pycountry.countries.get(alpha_3=iso)
    if c is not None:
        names |= {getattr(c, k, None) for k in ("name", "official_name", "common_name")}
    names.add(p.get("NAME_EN"))
    main = DISPLAY_NAMES.get(iso) or p.get("NAME_EN") or p["NAME"]
    return sorted({n for n in names if n and n not in ("-99", main) and len(n) >= 2})


def build_frontend(cfg) -> None:
    o = pd.read_parquet(cfg.path("gold") / "destination_outlook.parquet")
    o = o[o.admin1.isna() & (o.row_type != "reminder") & o.level.notna() & (o.level != "unknown")]
    with_data = set(o.location_iso3)

    shapes_dir = FRONTEND / "public" / "shapes"
    shapes_dir.mkdir(parents=True, exist_ok=True)
    for old in shapes_dir.glob("*.json"):
        old.unlink()
    # One feature per country code: dependencies sharing a code (e.g. Ashmore and Cartier Islands -> AUS) lose to
    # the feature whose own ADM0_A3 is that code, then to the largest landmass.
    best: dict[str, dict] = {}
    for f in ne("admin0_50m", cfg):
        p, iso = f["properties"], iso_of(f["properties"])
        if iso not in with_data or not f.get("geometry"):
            continue
        rank = (p.get("ADM0_A3") == iso, sum(ring_area(poly[0]) for poly in (
            [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"])))
        if iso not in best or rank > best[iso][0]:
            best[iso] = (rank, f)
    out, seen = [], set()
    for _, f in sorted(best.values(), key=lambda b: b[1]["properties"].get("NAME_EN") or b[1]["properties"]["NAME"]):
        p = f["properties"]
        iso = iso_of(p)
        seen.add(iso)
        name = DISPLAY_NAMES.get(iso) or p.get("NAME_EN") or p["NAME"]
        did = slug(name)
        g = f["geometry"]
        (shapes_dir / f"{did}.json").write_text(json.dumps(
            {"type": "Feature", "geometry": {"type": g["type"], "coordinates": rounded(g["coordinates"])},
             "properties": {"id": did}}, separators=(",", ":")), encoding="utf-8")
        centre, zoom = camera_for(g)
        out.append({"id": did, "iso3": iso, "name": name, "region": p.get("SUBREGION") or p.get("CONTINENT") or "",
                    "coords": centre, "zoom": zoom,
                    "aliases": aliases(p, iso)})

    ts = FRONTEND / "src" / "data" / "destinations.generated.ts"
    ts.write_text("// GENERATED by backend/pipeline/build_geo.py from the gold tables + Natural Earth. Do not edit.\n"
                  "// Countries with at least one known disease level. Outlines: public/shapes/<id>.json.\n"
                  "export const generatedDestinations = " + json.dumps(out, ensure_ascii=False, separators=(",", ":"))
                  + " as const;\n", encoding="utf-8")
    skipped = sorted(with_data - seen)
    print(f"frontend: {len(out)} destinations -> {ts}; outlines -> {shapes_dir}"
          + (f"; no Natural Earth outline for {skipped}" if skipped else ""))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["centroids", "frontend"])
    a = ap.parse_args()
    cfg = load_config()
    build_centroids(cfg) if a.what == "centroids" else build_frontend(cfg)
