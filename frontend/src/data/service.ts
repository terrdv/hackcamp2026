// Data access layer. Components call this service, never the mock records directly.
// When the real surveillance backend is ready, swap the implementation for HTTP calls —
// the returned shapes (src/data/types.ts) stay the same.

import type { DestinationReport } from "./types";
import { mockReports } from "./mockReports";

const SIMULATED_LATENCY_MS = 350;

export async function getDestinationReport(destinationId: string): Promise<DestinationReport> {
  await new Promise((r) => setTimeout(r, SIMULATED_LATENCY_MS));
  const report = mockReports[destinationId];
  if (!report) throw new Error(`No report available for destination: ${destinationId}`);
  return report;
}
