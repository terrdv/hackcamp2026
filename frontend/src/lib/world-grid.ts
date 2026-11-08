// One global latitude/longitude grid, clipped to every country outline. Every country uses the same whole-degree
// lines, so the grid lines up across neighbouring borders. Pure functions (no DOM or map), built once per page load
// from public/world/countries.json and cached by src/data/worldShapes.ts.
//
// Each grid line carries the coarsest level of detail it belongs to:
//   s = 4  multiples of 4°  (shown at every zoom)
//   s = 2  multiples of 2°  (fades in when zoomed in)
//   s = 1  every 1°         (the selected country, and every country at close zoom)
// Clipping uses an even-odd scanline per polygon, so holes (e.g. Lesotho inside South Africa) stay empty. Natural
// Earth splits countries at the antimeridian (Russia, Fiji), so each part is clipped on its own side of ±180° and
// no line ever wraps around the globe.

import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Position } from "geojson";

export const GRID_SPACING_DEG = 1;
export const GRID_LEVELS = [4, 2, 1] as const;
export type GridLevel = (typeof GRID_LEVELS)[number];

/** Smallest on-screen size (px) a country needs before its grid is drawn; below it the grid is just clutter. */
export const GRID_MIN_COUNTRY_PX = 48;

export interface CountryProps {
  k: string; // Natural Earth ADM0_A3
  d?: string; // destination id when the app has data for the country
  span: number; // largest bounding-box side in degrees
}

export interface GridProps {
  k: string;
  d?: string;
  s: GridLevel;
  mz: number; // map zoom from which the country is large enough on screen to show its grid
}

export function levelOf(index: number): GridLevel {
  return index % 4 === 0 ? 4 : index % 2 === 0 ? 2 : 1;
}

/** Zoom at which `span` degrees covers `px` screen pixels (MapLibre world is 512 px wide at zoom 0). */
export function zoomForSpan(span: number, px = GRID_MIN_COUNTRY_PX): number {
  if (span <= 0) return 24;
  return Math.round(Math.log2((px * 360) / (512 * span)) * 100) / 100;
}

/** Where the line coord = c (axis 1 = latitude, 0 = longitude) crosses the polygon, as sorted positions along it. */
function crossings(rings: Position[][], axis: 0 | 1, c: number): number[] {
  const other = axis === 1 ? 0 : 1;
  const out: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      const av = a[axis]!;
      const bv = b[axis]!;
      // Half-open test so a vertex exactly on the line is counted once.
      if ((av <= c && c < bv) || (bv <= c && c < av)) {
        out.push(a[other]! + ((c - av) * (b[other]! - a[other]!)) / (bv - av));
      }
    }
  }
  return out.sort((x, y) => x - y);
}

/** Grid segments inside one polygon (outer ring + holes), grouped by level. */
export function clipPolygon(
  rings: Position[][],
  spacing = GRID_SPACING_DEG,
): Map<GridLevel, Position[][]> {
  const out = new Map<GridLevel, Position[][]>();
  const outer = rings[0];
  if (!outer || outer.length < 4) return out;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of outer) {
    minX = Math.min(minX, x!);
    maxX = Math.max(maxX, x!);
    minY = Math.min(minY, y!);
    maxY = Math.max(maxY, y!);
  }
  const push = (level: GridLevel, seg: Position[]) => {
    const list = out.get(level);
    if (list) list.push(seg);
    else out.set(level, [seg]);
  };
  // Parallels (constant latitude).
  for (let i = Math.ceil(minY / spacing); i * spacing <= maxY; i++) {
    const lat = i * spacing;
    const xs = crossings(rings, 1, lat);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      if (xs[j + 1]! - xs[j]! > 1e-9)
        push(levelOf(i), [
          [xs[j]!, lat],
          [xs[j + 1]!, lat],
        ]);
    }
  }
  // Meridians (constant longitude). ±180° is skipped: it is the antimeridian seam, not a grid line.
  for (let i = Math.ceil(minX / spacing); i * spacing <= maxX; i++) {
    const lon = i * spacing;
    if (Math.abs(lon) >= 180) continue;
    const ys = crossings(rings, 0, lon);
    for (let j = 0; j + 1 < ys.length; j += 2) {
      if (ys[j + 1]! - ys[j]! > 1e-9)
        push(levelOf(i), [
          [lon, ys[j]!],
          [lon, ys[j + 1]!],
        ]);
    }
  }
  return out;
}

/** The clipped global grid for every country: one MultiLineString feature per country and level. */
export function buildWorldGrid(
  countries: FeatureCollection<MultiPolygon, CountryProps>,
  spacing = GRID_SPACING_DEG,
): FeatureCollection<MultiLineString, GridProps> {
  const features: Feature<MultiLineString, GridProps>[] = [];
  for (const f of countries.features) {
    const byLevel = new Map<GridLevel, Position[][]>();
    for (const poly of f.geometry.coordinates) {
      for (const [level, segs] of clipPolygon(poly, spacing)) {
        byLevel.set(level, [...(byLevel.get(level) ?? []), ...segs]);
      }
    }
    const { k, d, span } = f.properties;
    for (const level of GRID_LEVELS) {
      const segs = byLevel.get(level);
      if (!segs?.length) continue;
      features.push({
        type: "Feature",
        properties: { k, ...(d ? { d } : {}), s: level, mz: zoomForSpan(span) },
        geometry: { type: "MultiLineString", coordinates: segs },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
