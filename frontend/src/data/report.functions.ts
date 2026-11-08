// TanStack Start server function: reads the VisitWell gold tables in Databricks and returns a DestinationReport.
// The handler body (and the Databricks client it imports) only runs on the server.

import { createServerFn } from "@tanstack/react-start";
import {
  buildReport,
  type MonthlyRow,
  type OutlookRow,
  type PointRow,
  type TrendRow,
} from "./report-mapping";
import type { DestinationReport } from "./types";

const GOLD = "visitwell.gold";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRequest {
  destinationId: string;
  iso3: string;
  countryName: string;
  start: string;
  end: string;
}

export const getLiveReport = createServerFn({ method: "GET" })
  .inputValidator((d: ReportRequest): ReportRequest => {
    if (!/^[A-Z]{3}$/.test(d.iso3)) throw new Error("iso3 must be a 3-letter code");
    if (!ISO_DATE.test(d.start) || !ISO_DATE.test(d.end))
      throw new Error("dates must be YYYY-MM-DD");
    if (d.end < d.start) throw new Error("end is before start");
    return {
      ...d,
      countryName: String(d.countryName).slice(0, 80),
      destinationId: String(d.destinationId).slice(0, 40),
    };
  })
  .handler(async ({ data }): Promise<DestinationReport> => {
    const { query } = await import("@/server/databricks.server");
    const iso = [{ name: "iso", value: data.iso3 }];
    const [outlook, trends, monthly, points] = await Promise.all([
      query<OutlookRow>(
        `SELECT disease, row_type, CAST(month AS INT) AS month, level, based_on, CAST(data_as_of AS STRING) AS data_as_of, source
         FROM ${GOLD}.destination_outlook
         WHERE location_iso3 = :iso AND admin1 IS NULL AND row_type <> 'reminder'`,
        iso,
      ),
      query<TrendRow>(
        `SELECT disease, metric, CAST(latest_period AS STRING) AS latest_period, latest_cases, trend, source,
                CAST(data_as_of AS STRING) AS data_as_of
         FROM ${GOLD}.disease_trend WHERE location_iso3 = :iso AND admin1 IS NULL`,
        iso,
      ),
      query<MonthlyRow>(
        `SELECT disease, CAST(period_start AS STRING) AS period_start, cases
         FROM ${GOLD}.monthly_cases WHERE location_iso3 = :iso AND admin1 IS NULL ORDER BY period_start`,
        iso,
      ),
      query<PointRow>(
        `SELECT point_id, disease, admin1, point_type, latitude, longitude, cases, CAST(period_start AS STRING) AS period_start, source
         FROM ${GOLD}.map_points WHERE location_iso3 = :iso`,
        iso,
      ),
    ]);
    return buildReport({
      ...data,
      today: new Date().toISOString().slice(0, 10),
      outlook,
      trends,
      monthly,
      points,
    });
  });

// Warm-up: a trivial query sent when the page loads, so a cold serverless warehouse starts waking up while the
// visitor is still choosing a destination and the first real report query doesn't pay the full start-up time.
export const warmUpWarehouse = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: boolean }> => {
  const { query } = await import("@/server/databricks.server");
  await query("SELECT 1");
  return { ok: true };
});
