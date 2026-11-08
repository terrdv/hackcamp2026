// Data access layer. Components call this service, never the mock records or Databricks directly.
// Live data comes from the getLiveReport server function (Databricks gold tables). If that fails and a
// demo dataset exists for the destination, the demo is returned, flagged with isDemo so the UI labels it.

import type { Destination } from "./destinations";
import type { DestinationReport } from "./types";
import { mockReports } from "./mockReports";
import { getLiveReport } from "./report.functions";

export async function getDestinationReport(
  destination: Destination,
  start: string,
  end: string,
): Promise<DestinationReport> {
  try {
    return await getLiveReport({
      data: {
        destinationId: destination.id,
        iso3: destination.iso3,
        countryName: destination.name,
        start,
        end,
      },
    });
  } catch (err) {
    const mock = mockReports[destination.id];
    if (!mock) throw err;
    console.warn(`Live report unavailable for ${destination.id}; showing demo data.`, err);
    return { ...mock, isDemo: true };
  }
}
