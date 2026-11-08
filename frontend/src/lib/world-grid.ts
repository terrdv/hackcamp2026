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

import type {
  Feature,
  FeatureCollection,
  MultiLineString,
  MultiPolygon,
  Point,
  Position,
} from "geojson";

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

/** Furthest latitude for the whole-globe grid: meridians converge near the poles and would just add clutter. */
export const GRATICULE_MAX_LAT = 80;

/**
 * The same whole-degree grid over the entire globe (oceans included), one MultiLineString per level. Its lines are
 * the ones buildWorldGrid clips to countries, so the ocean and land grids line up exactly.
 */
export function buildGraticule(
  spacing = GRID_SPACING_DEG,
  maxLat = GRATICULE_MAX_LAT,
): FeatureCollection<MultiLineString, { s: GridLevel }> {
  const byLevel = new Map<GridLevel, Position[][]>();
  const push = (level: GridLevel, line: Position[]) => {
    const list = byLevel.get(level);
    if (list) list.push(line);
    else byLevel.set(level, [line]);
  };
  const n = Math.floor(maxLat / spacing);
  for (let i = -n; i <= n; i++) {
    const lat = i * spacing;
    // Split each parallel into 10° pieces so it follows the curve of the globe.
    const line: Position[] = [];
    for (let lon = -180; lon <= 180; lon += 10) line.push([lon, lat]);
    push(levelOf(i), line);
  }
  for (let i = Math.ceil(-180 / spacing); i * spacing < 180; i++) {
    if (i * spacing === -180) continue; // the antimeridian seam
    push(levelOf(i), [
      [i * spacing, -n * spacing],
      [i * spacing, n * spacing],
    ]);
  }
  return {
    type: "FeatureCollection",
    features: GRID_LEVELS.filter((s) => byLevel.has(s)).map((s) => ({
      type: "Feature",
      properties: { s },
      geometry: { type: "MultiLineString", coordinates: byLevel.get(s)! },
    })),
  };
}

function insidePolygon(rings: Position[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!)
        inside = !inside;
    }
  }
  return inside;
}

/** Deterministic pseudo-random numbers (mulberry32), so the particles sit in the same places on every load. */
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` points spread evenly over the oceans (not on any country), within ±60° latitude. */
export function oceanParticles(
  countries: FeatureCollection<MultiPolygon, CountryProps>,
  count: number,
  seed = 7,
): FeatureCollection<Point, { r: number }> {
  const polys = countries.features.flatMap((f) =>
    f.geometry.coordinates.map((rings) => {
      let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of rings[0] ?? []) {
        minX = Math.min(minX, x!);
        maxX = Math.max(maxX, x!);
        minY = Math.min(minY, y!);
        maxY = Math.max(maxY, y!);
      }
      return { rings, minX, minY, maxX, maxY };
    }),
  );
  const rnd = random(seed);
  const features: Feature<Point, { r: number }>[] = [];
  const maxSin = Math.sin((60 * Math.PI) / 180);
  for (let tries = 0; features.length < count && tries < count * 20; tries++) {
    const x = rnd() * 360 - 180;
    const y = (Math.asin((rnd() * 2 - 1) * maxSin) * 180) / Math.PI; // area-uniform on the sphere
    const onLand = polys.some(
      (p) =>
        x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY && insidePolygon(p.rings, x, y),
    );
    if (!onLand) {
      features.push({
        type: "Feature",
        properties: { r: 0.6 + rnd() * 0.8 }, // size multiplier so the dots don't all look identical
        geometry: { type: "Point", coordinates: [x, y] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** True when a ring edge runs along the ±180° cut Natural Earth uses to split countries such as Russia and Fiji. */
const onSeam = (a: Position, b: Position) => Math.abs(a[0]!) >= 179.99 && Math.abs(b[0]!) >= 179.99;

/**
 * Polygon rings as outline lines, minus the edges along the antimeridian cut, so countries split at ±180° get no
 * fake border down the middle (e.g. through Chukotka). Fills and hit-testing keep using the polygons.
 */
export function outlineLines(polygons: Position[][][]): Position[][] {
  const lines: Position[][] = [];
  for (const rings of polygons) {
    for (const ring of rings) {
      let line: Position[] = [];
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[i + 1]!;
        if (onSeam(a, b)) {
          if (line.length > 1) lines.push(line);
          line = [];
          continue;
        }
        if (line.length === 0) line.push(a);
        line.push(b);
      }
      if (line.length > 1) lines.push(line);
    }
  }
  return lines;
}

/** Outline lines for every country (same properties as the polygons). */
export function worldOutlines(
  countries: FeatureCollection<MultiPolygon, CountryProps>,
): FeatureCollection<MultiLineString, CountryProps> {
  return {
    type: "FeatureCollection",
    features: countries.features.map((f) => ({
      type: "Feature",
      properties: f.properties,
      geometry: { type: "MultiLineString", coordinates: outlineLines(f.geometry.coordinates) },
    })),
  };
}
