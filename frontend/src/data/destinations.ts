// Destinations: every country with at least one known disease level in the pipeline's gold tables.
// The list itself is generated (destinations.generated.ts, by backend/pipeline/build_geo.py); this file adds
// the shared text and the date helpers.

import { generatedDestinations } from "./destinations.generated";

export interface Destination {
  id: string;
  iso3: string; // matches location_iso3 in the Databricks gold tables
  name: string;
  region: string;
  coords: [number, number]; // [lng, lat] camera centre
  zoom: number;
  aliases: readonly string[]; // other names and codes the search box matches (e.g. "Viet Nam", "VN", "USA")
  overview: string;
  sources: { label: string; url: string }[];
}

const commonSources = [
  { label: "CDC Travelers' Health", url: "https://wwwnc.cdc.gov/travel" },
  {
    label: "WHO International Travel & Health",
    url: "https://www.who.int/health-topics/travel-and-health",
  },
  {
    label: "Government of Canada – Travel advice and advisories",
    url: "https://travel.gc.ca/travelling/advisories",
  },
];

const SURVEILLANCE_OVERVIEW =
  "Disease activity for this destination comes from WHO and OpenDengue surveillance data, compared with what is normal there for your travel dates. Always check official travel health advice before you go.";

export const destinations: Destination[] = generatedDestinations.map((d) => ({
  id: d.id,
  iso3: d.iso3,
  name: d.name,
  region: d.region,
  coords: [d.coords[0], d.coords[1]],
  zoom: d.zoom,
  aliases: d.aliases,
  overview: SURVEILLANCE_OVERVIEW,
  sources: commonSources,
}));

export function monthsBetween(start: string, end: string): number[] {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const out = new Set<number>();
  const d = new Date(s.getFullYear(), s.getMonth(), 1);
  while (d <= e && out.size < 12) {
    out.add(d.getMonth() + 1);
    d.setMonth(d.getMonth() + 1);
  }
  return [...out];
}

export function validateDates(depart: string, ret: string, today = new Date()): string | null {
  if (!depart || !ret) return "Please choose both dates.";
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(depart + "T00:00:00");
  const r = new Date(ret + "T00:00:00");
  if (d < t) return "Departure can't be in the past.";
  if (r < d) return "Return must be on or after departure.";
  return null;
}
