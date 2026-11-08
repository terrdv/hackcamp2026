// Every country's outline (public/world/countries.json, built by scripts/build-world.mjs from Natural Earth 50m) and
// the global grid clipped to them. Fetched and built once per page load, then cached.

import type { FeatureCollection, MultiLineString, MultiPolygon, Point } from "geojson";
import {
  buildGraticule,
  buildWorldGrid,
  oceanParticles,
  worldOutlines,
  type CountryProps,
  type GridLevel,
  type GridProps,
} from "@/lib/world-grid";
import { HOLOGRAM } from "@/lib/globe-style";

export interface World {
  countries: FeatureCollection<MultiPolygon, CountryProps>;
  grid: FeatureCollection<MultiLineString, GridProps>;
  /** Country outlines without the antimeridian cut (hologram line layers). */
  outlines: FeatureCollection<MultiLineString, CountryProps>;
  /** Whole-globe grid (hologram style). */
  graticule: FeatureCollection<MultiLineString, { s: GridLevel }>;
  /** Ocean dots (hologram style, HOLOGRAM_PARTICLES). */
  particles: FeatureCollection<Point, { r: number }>;
}

let pending: Promise<World | null> | null = null;

export function loadWorld(): Promise<World | null> {
  pending ??= fetch("/world/countries.json")
    .then((r) => (r.ok ? (r.json() as Promise<World["countries"]>) : null))
    .then((countries) =>
      countries
        ? {
            countries,
            grid: buildWorldGrid(countries),
            outlines: worldOutlines(countries),
            graticule: buildGraticule(),
            particles: oceanParticles(countries, HOLOGRAM.particles.count),
          }
        : null,
    )
    .catch((err) => {
      console.warn("World outlines unavailable", err);
      pending = null; // allow a retry on the next map load
      return null;
    });
  return pending;
}
