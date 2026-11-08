// Every country's outline (public/world/countries.json, built by scripts/build-world.mjs from Natural Earth 50m) and
// the global grid clipped to them. Fetched and built once per page load, then cached.

import type { FeatureCollection, MultiLineString, MultiPolygon } from "geojson";
import { buildWorldGrid, type CountryProps, type GridProps } from "@/lib/world-grid";

export interface World {
  countries: FeatureCollection<MultiPolygon, CountryProps>;
  grid: FeatureCollection<MultiLineString, GridProps>;
}

let pending: Promise<World | null> | null = null;

export function loadWorld(): Promise<World | null> {
  pending ??= fetch("/world/countries.json")
    .then((r) => (r.ok ? (r.json() as Promise<World["countries"]>) : null))
    .then((countries) => (countries ? { countries, grid: buildWorldGrid(countries) } : null))
    .catch((err) => {
      console.warn("World outlines unavailable", err);
      pending = null; // allow a retry on the next map load
      return null;
    });
  return pending;
}
