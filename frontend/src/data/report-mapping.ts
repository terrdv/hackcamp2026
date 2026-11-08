// Turns rows from the Databricks gold tables into the DestinationReport shape the UI renders.
// Pure functions only (no I/O) so they can run inside the server function and in tests.
//
// Level mapping (the pipeline uses a different vocabulary per method):
//   elevated  <- peak · much_higher · high · outbreak · widespread
//   moderate  <- moderate · higher_than_usual · circulating · present
//   low       <- low · typical · not_reported · some_areas
//   unknown   <- everything else (unknown, insufficient data, no row). Missing data is never shown as low.

import type {
  ActivityLevel,
  DestinationReport,
  Disease,
  OutbreakObservation,
  TimeSeriesPoint,
  Trend,
} from "./types";

export interface OutlookRow {
  disease: string;
  row_type: string; // seasonal | realtime | presence | recent_activity
  month: number | null;
  level: string | null;
  based_on: string | null;
  data_as_of: string | null;
  source: string | null;
}

export interface TrendRow {
  disease: string;
  metric: string;
  latest_period: string; // YYYY-MM-DD
  latest_cases: number | null;
  trend: string;
  source: string | null;
  data_as_of: string | null;
}

export interface MonthlyRow {
  disease: string;
  period_start: string;
  cases: number | null;
}

export interface PointRow {
  point_id: string;
  disease: string;
  admin1: string | null;
  point_type: "admin1" | "national";
  latitude: number;
  longitude: number;
  cases: number | null;
  period_start: string;
  source: string | null;
}

export interface ReportInput {
  destinationId: string;
  iso3: string;
  countryName: string;
  start: string; // YYYY-MM-DD
  end: string;
  today: string;
  outlook: OutlookRow[];
  trends: TrendRow[];
  monthly: MonthlyRow[];
  points: PointRow[];
}

const LEVEL: Record<string, ActivityLevel> = {
  peak: "elevated",
  much_higher: "elevated",
  high: "elevated",
  outbreak: "elevated",
  widespread: "elevated",
  moderate: "moderate",
  higher_than_usual: "moderate",
  circulating: "moderate",
  present: "moderate",
  low: "low",
  typical: "low",
  not_reported: "low",
  some_areas: "low",
};
const RANK: Record<ActivityLevel, number> = { unknown: 0, low: 1, moderate: 2, elevated: 3 };
const TRENDS = new Set<Trend>(["increasing", "stable", "decreasing", "unknown"]);

// Same rules as the pipeline config (influenza.realtime): departure window and freshness of the latest week.
export const REALTIME_DEPARTURE_WINDOW_DAYS = 21;
export const REALTIME_MAX_AGE_DAYS = 28;

const DISEASES: Record<string, { name: string; description: string }> = {
  influenza: {
    name: "Influenza",
    description:
      "Respiratory virus. Level compares your travel months with the usual seasonal pattern, or this week's activity for trips within 3 weeks.",
  },
  dengue: {
    name: "Dengue",
    description:
      "Mosquito-borne virus. Level reflects the usual seasonal pattern for your travel months where data allows.",
  },
  measles: {
    name: "Measles",
    description: "Highly contagious virus. Level reflects reported cases over the last 12 months.",
  },
  malaria: {
    name: "Malaria",
    description:
      "Mosquito-borne parasite. Level reflects whether it is present, from official presence data.",
  },
  yellow_fever: {
    name: "Yellow fever",
    description:
      "Mosquito-borne virus. Level reflects whether it is present, from official presence data.",
  },
  hepatitis_a: {
    name: "Hepatitis A",
    description:
      "Spread through food and water. Level reflects whether it is present, from official presence data.",
  },
  typhoid: {
    name: "Typhoid",
    description:
      "Spread through food and water. Level reflects whether it is present, from official presence data.",
  },
};

export function toActivityLevel(level: string | null | undefined): ActivityLevel {
  return (level && LEVEL[level]) || "unknown";
}

function maxLevel(levels: ActivityLevel[]): ActivityLevel {
  return levels.reduce<ActivityLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), "unknown");
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Calendar months (1-12) touched by the trip, in order, at most 12. */
export function tripMonths(start: string, end: string): number[] {
  const [sy, sm] = start.split("-").map(Number) as [number, number];
  const [ey, em] = end.split("-").map(Number) as [number, number];
  const out: number[] = [];
  let y = sy;
  let m = sm;
  while ((y < ey || (y === ey && m <= em)) && out.length < 12) {
    out.push(m);
    if (m === 12) {
      y++;
      m = 1;
    } else {
      m++;
    }
  }
  return out;
}

/** Activity level for one disease over the trip window. */
export function diseaseLevel(
  rows: OutlookRow[],
  start: string,
  end: string,
  today: string,
): ActivityLevel {
  if (rows.length === 0) return "unknown";
  const months = new Set(tripMonths(start, end));
  const rt = rows.find((r) => r.row_type === "realtime");
  if (
    rt &&
    rt.based_on === "realtime" &&
    rt.data_as_of &&
    daysBetween(today, start) <= REALTIME_DEPARTURE_WINDOW_DAYS &&
    daysBetween(rt.data_as_of, today) <= REALTIME_MAX_AGE_DAYS
  ) {
    return toActivityLevel(rt.level);
  }
  const seasonal = rows.filter((r) => r.row_type === "seasonal" && r.month != null);
  if (seasonal.length)
    return maxLevel(
      seasonal.filter((r) => months.has(r.month as number)).map((r) => toActivityLevel(r.level)),
    );
  const other = rows.find((r) => r.row_type !== "realtime" && r.month == null);
  return toActivityLevel(other?.level);
}

const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function sourceLabel(source: string | null, metric?: string) {
  const s = source ?? "Unknown source";
  return metric === "lab_confirmed_positives" ? `${s} (lab-confirmed positives)` : s;
}

// National points of different diseases share one coordinate; fan them out slightly so each dot is clickable.
function spread(points: PointRow[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const national = points.filter((p) => p.point_type === "national");
  national.forEach((p, i) => {
    const a = (2 * Math.PI * i) / national.length;
    const r = national.length < 2 ? 0 : 0.8;
    out.set(p.point_id, [p.longitude + r * Math.cos(a), p.latitude + r * Math.sin(a)]);
  });
  points
    .filter((p) => p.point_type === "admin1")
    .forEach((p) => out.set(p.point_id, [p.longitude, p.latitude]));
  return out;
}

export function buildReport(input: ReportInput): DestinationReport {
  const { iso3, start, end, today } = input;
  const id = (disease: string) => `${iso3.toLowerCase()}-${disease}`;
  const trendBy = new Map(input.trends.map((t) => [t.disease, t]));
  const byDisease = new Map<string, OutlookRow[]>();
  for (const r of input.outlook) byDisease.set(r.disease, [...(byDisease.get(r.disease) ?? []), r]);

  const diseases: Disease[] = [...byDisease.entries()].map(([disease, rows]) => {
    const t = trendBy.get(disease);
    const meta = DISEASES[disease] ?? { name: disease, description: "" };
    const asOf =
      t?.latest_period ??
      rows
        .map((r) => r.data_as_of)
        .filter(Boolean)
        .sort()
        .at(-1) ??
      null;
    return {
      id: id(disease),
      name: meta.name,
      description: meta.description,
      activityLevel: diseaseLevel(rows, start, end, today),
      trend: t && TRENDS.has(t.trend as Trend) ? (t.trend as Trend) : "unknown",
      latestCases: t?.latest_cases == null ? null : Math.round(t.latest_cases),
      reportingPeriod: asOf ? monthLabel(asOf) : "No data",
      source: sourceLabel(t?.source ?? rows.find((r) => r.source)?.source ?? null, t?.metric),
    };
  });
  const known = new Set(diseases.map((d) => d.id));

  const timeSeries: TimeSeriesPoint[] = input.monthly
    .filter((m) => m.cases != null && known.has(id(m.disease)))
    .map((m) => ({
      diseaseId: id(m.disease),
      date: m.period_start.slice(0, 7),
      cases: Math.round(m.cases as number),
    }));

  const xy = spread(input.points);
  const outbreaks: OutbreakObservation[] = input.points
    .filter((p) => p.cases != null && known.has(id(p.disease)))
    .map((p) => {
      const [lng, lat] = xy.get(p.point_id) ?? [p.longitude, p.latitude];
      return {
        id: p.point_id,
        diseaseId: id(p.disease),
        locationName:
          p.point_type === "admin1" && p.admin1 ? p.admin1 : `${input.countryName} (national)`,
        latitude: lat,
        longitude: lng,
        cases: Math.round(p.cases as number),
        reportDate: p.period_start.slice(0, 10),
        source: sourceLabel(p.source, trendBy.get(p.disease)?.metric),
      };
    });

  const dates = [
    ...input.trends.map((t) => t.data_as_of),
    ...input.outlook.map((r) => r.data_as_of),
  ].filter((d): d is string => !!d);
  return {
    destinationId: input.destinationId,
    surveillanceDate: dates.sort().at(-1) ?? today,
    diseases,
    outbreaks,
    timeSeries,
    recommendations: [], // checklist not wired to the pipeline yet
  };
}
