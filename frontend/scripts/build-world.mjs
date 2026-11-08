// Builds public/world/countries.json: every country outline (Natural Earth 50m admin-0, public domain), simplified
// once for the globe's always-on borders and grid. Run after the destination list changes:
//
//   node scripts/build-world.mjs
//
// Reads the Natural Earth file the pipeline already downloaded (pipeline/data/raw/naturalearth/), or fetches
// the same pinned release. Feature properties are kept tiny because every country is loaded at startup:
//   k    Natural Earth ADM0_A3 code (unique per feature)
//   d    destination id when the country has data in the app (hover + click select it), else omitted
//   span largest bounding-box side in degrees (used to skip the grid on countries too small to show it)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const LOCAL = resolve(
  root,
  "../pipeline/data/raw/naturalearth/ne_50m_admin_0_countries.geojson",
);
const REMOTE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
const OUT = resolve(root, "public/world/countries.json");
const TOLERANCE = 0.02; // degrees (~2 km): under 2 px at the closest destination zoom; the selected country uses its detailed outline
const DECIMALS = 2; // ~1 km

// Same code lookup as pipeline/build_geo.py (iso_of), so `d` matches the destination list.
function isoOf(p) {
  for (const k of ["ISO_A3_EH", "ISO_A3", "ADM0_A3"]) {
    const v = p[k];
    if (v && v !== "-99") return v === "KOS" ? "XKX" : v;
  }
  return null;
}

function destinationsByIso() {
  const src = readFileSync(resolve(root, "src/data/destinations.generated.ts"), "utf8");
  const list = JSON.parse(src.slice(src.indexOf("["), src.lastIndexOf("]") + 1));
  return new Map(list.map((d) => [d.iso3, d.id]));
}

// Douglas-Peucker on one ring; rings that would collapse (tiny islands, microstates) are kept as they are.
function simplify(ring) {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      // Closed rings start and end on the same point: fall back to the distance from that point.
      const d =
        len > 1e-12
          ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
          : Math.hypot(px - ax, py - ay);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > TOLERANCE && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

const round = (v) => Number(v.toFixed(DECIMALS));
function cleanRing(ring) {
  const out = [];
  for (const [x, y] of simplify(ring)) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}

async function main() {
  const raw = existsSync(LOCAL) ? readFileSync(LOCAL, "utf8") : await (await fetch(REMOTE)).text();
  const ne = JSON.parse(raw);
  const byIso = destinationsByIso();
  let vertices = 0;
  const features = [];
  for (const f of ne.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const cleaned = polys
      .map((poly) => poly.map(cleanRing).filter(Boolean))
      .filter((poly) => poly.length > 0);
    if (!cleaned.length) continue;
    let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
    for (const poly of cleaned)
      for (const [x, y] of poly[0]) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        vertices++;
      }
    // Countries split at the antimeridian (Russia, Fiji) look 360° wide; measure them in 0..360° too.
    let [minE, maxE] = [360, 0];
    for (const poly of cleaned)
      for (const [x] of poly[0]) {
        const e = (x + 360) % 360;
        minE = Math.min(minE, e);
        maxE = Math.max(maxE, e);
      }
    const width = Math.min(maxX - minX, maxE - minE);
    const p = f.properties;
    const d = byIso.get(isoOf(p));
    features.push({
      type: "Feature",
      properties: { k: p.ADM0_A3, ...(d ? { d } : {}), span: round(Math.max(width, maxY - minY)) },
      geometry: { type: "MultiPolygon", coordinates: cleaned },
    });
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
  const withData = features.filter((f) => f.properties.d).length;
  console.log(
    `world: ${features.length} countries (${withData} destinations), ${vertices} outer-ring vertices -> ${OUT}`,
  );
}

main();
